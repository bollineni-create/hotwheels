import AppKit
import UserNotifications
import WebKit

// Gridline: a native window around the car search site.
// Pages load live from the project folder named in Info.plist (GridlineSourceFolder), so edits show up
// without rebuilding: the app checks the folder every second and reloads when a file changes.
// If that folder is missing, it falls back to the copy bundled inside the app.
// It also pulls the latest version from GitHub when opened and every 15 minutes.
// Listing APIs (auto.dev, Visor) refuse requests from web pages, so the page hands them to the app,
// which sends them itself and replies by id: the same bridge the Electron build provides (window.gridlineDesktop).
// Hunts (saved searches that keep watching) post native notifications through the same bridge, and the app
// asks the page to check them every few minutes, since a web view's own timers can stall while it's hidden.

let apiBases = [
    "autodev": ProcessInfo.processInfo.environment["AUTODEV_API_BASE"] ?? "https://api.auto.dev",
    "visor": ProcessInfo.processInfo.environment["VISOR_API_BASE"] ?? "https://api.visor.vin",
]
let apiPaths = [
    "autodev": "^/(listings|photos)(/[A-Za-z0-9]{1,17})?$",
    "visor": "^/v1/[A-Za-z0-9_\\-/.%]+$",
]

/// Sends a listing-API request for the page and calls back with { status, body, cost }.
func apiFetch(_ req: [String: Any], completion: @escaping ([String: Any]) -> Void) {
    let provider = req["provider"] as? String ?? ""
    let path = req["path"] as? String ?? ""
    let query = req["query"] as? String ?? ""
    let key = req["key"] as? String ?? ""
    guard let base = apiBases[provider], let pattern = apiPaths[provider],
          path.range(of: pattern, options: .regularExpression) != nil,
          let url = URL(string: base + path + (query.isEmpty ? "" : "?" + query))
    else {
        completion(["status": 400, "body": "{\"error\":{\"message\":\"Request not allowed\"}}", "cost": 0])
        return
    }
    var request = URLRequest(url: url, timeoutInterval: 30)
    request.setValue("Bearer \(key)", forHTTPHeaderField: "Authorization")
    URLSession.shared.dataTask(with: request) { data, response, error in
        var reply: [String: Any]
        if let http = response as? HTTPURLResponse {
            reply = ["status": http.statusCode,
                     "body": String(data: data ?? Data(), encoding: .utf8) ?? "",
                     "cost": Int(http.value(forHTTPHeaderField: "x-usage-cost-micros") ?? "") ?? 0]
        } else {
            let msg = (error?.localizedDescription ?? "no response").replacingOccurrences(of: "\"", with: "'")
            reply = ["status": 502, "body": "{\"error\":{\"message\":\"Could not reach the listings API: \(msg)\"}}", "cost": 0]
        }
        DispatchQueue.main.async { completion(reply) }
    }.resume()
}

final class AppDelegate: NSObject, NSApplicationDelegate, NSWindowDelegate, WKNavigationDelegate, WKUIDelegate, WKScriptMessageHandler, UNUserNotificationCenterDelegate {
    var window: NSWindow!
    var webView: WKWebView!
    var lastSignature = ""
    var showingLive = false

    lazy var sourceFolder: URL? = {
        guard let path = Bundle.main.object(forInfoDictionaryKey: "GridlineSourceFolder") as? String, !path.isEmpty else { return nil }
        return URL(fileURLWithPath: (path as NSString).expandingTildeInPath, isDirectory: true)
    }()

    func applicationDidFinishLaunching(_ notification: Notification) {
        buildMenu()

        let config = WKWebViewConfiguration()
        config.websiteDataStore = .default()               // keeps saved searches, favorites and settings
        config.preferences.isElementFullscreenEnabled = true
        let content = config.userContentController
        content.add(self, name: "api")
        content.add(self, name: "print")
        content.add(self, name: "notify")
        UNUserNotificationCenter.current().delegate = self
        content.addUserScript(WKUserScript(source: bridgeScript(), injectionTime: .atDocumentStart, forMainFrameOnly: true))

        webView = WKWebView(frame: .zero, configuration: config)
        webView.navigationDelegate = self
        webView.uiDelegate = self
        webView.allowsBackForwardNavigationGestures = true

        let screen = NSScreen.main?.visibleFrame ?? NSRect(x: 0, y: 0, width: 1440, height: 900)
        let size = NSSize(width: min(1440, screen.width * 0.85), height: screen.height * 0.88)
        window = NSWindow(
            contentRect: NSRect(origin: .zero, size: size),
            styleMask: [.titled, .closable, .miniaturizable, .resizable],
            backing: .buffered, defer: false)
        window.title = "Gridline"
        window.minSize = NSSize(width: 720, height: 520)
        window.collectionBehavior.insert(.fullScreenPrimary)
        window.contentView = webView
        window.delegate = self
        window.setFrameAutosaveName("GridlineMainWindow")
        if !window.setFrameUsingName("GridlineMainWindow") { window.center() }
        window.makeKeyAndOrderFront(nil)

        load()
        lastSignature = signature()
        Timer.scheduledTimer(withTimeInterval: 1.0, repeats: true) { [weak self] _ in self?.checkForChanges() }
        Timer.scheduledTimer(withTimeInterval: 15 * 60, repeats: true) { [weak self] _ in self?.pullUpdates() }
        Timer.scheduledTimer(withTimeInterval: 5 * 60, repeats: true) { [weak self] _ in
            self?.webView.evaluateJavaScript("window.gridlineHuntTick && window.gridlineHuntTick()", completionHandler: nil)
        }
        pullUpdates()
        NSApp.activate(ignoringOtherApps: true)
    }

    // MARK: Bridge

    /// API keys built into this copy: electron/keys.local.json in the project, else the bundled copy.
    private func bundledKeys() -> [String: String] {
        var candidates: [URL] = []
        if let folder = sourceFolder { candidates.append(folder.appendingPathComponent("electron/keys.local.json")) }
        if let res = Bundle.main.resourceURL { candidates.append(res.appendingPathComponent("keys.local.json")) }
        for url in candidates {
            if let data = try? Data(contentsOf: url), let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
                return obj.compactMapValues { $0 as? String }.filter { ["autodev", "visor"].contains($0.key) && !$0.value.isEmpty }
            }
        }
        return [:]
    }

    private func bridgeScript() -> String {
        let keys = (try? JSONSerialization.data(withJSONObject: bundledKeys())).flatMap { String(data: $0, encoding: .utf8) } ?? "{}"
        return """
        (() => {
          const pending = { n: 0 };
          window.__gridlineReply = (id, res) => { const done = pending[id]; delete pending[id]; if (done) done(res); };
          window.gridlineDesktop = Object.freeze({
            apiFetch: (req) => new Promise((resolve) => {
              const id = String(++pending.n);
              pending[id] = resolve;
              window.webkit.messageHandlers.api.postMessage({ id, req });
            }),
            notify: (n) => window.webkit.messageHandlers.notify.postMessage(n),
            defaultKeys: Object.freeze(\(keys)),
          });
          window.print = () => window.webkit.messageHandlers.print.postMessage(null);
          document.addEventListener('DOMContentLoaded', () => document.documentElement.classList.add('is-desktop'));
        })();
        """
    }

    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        if message.name == "print" { printPage(nil) }
        if message.name == "notify", let body = message.body as? [String: Any] { showNotification(body) }
        if message.name == "api", let body = message.body as? [String: Any], let id = body["id"] as? String, Int(id) != nil {
            apiFetch(body["req"] as? [String: Any] ?? [:]) { [weak self] reply in
                guard let data = try? JSONSerialization.data(withJSONObject: reply),
                      let json = String(data: data, encoding: .utf8) else { return }
                self?.webView.evaluateJavaScript("window.__gridlineReply('\(id)', \(json))", completionHandler: nil)
            }
        }
    }

    // MARK: Notifications

    /// Only in-app links like "#/hunt/s123" are opened from a notification.
    private func safeHash(_ value: Any?) -> String? {
        guard let href = value as? String, href.range(of: "^#/[A-Za-z0-9/_?=&.%-]*$", options: .regularExpression) != nil else { return nil }
        return href
    }

    /// Shows a hunt notification. macOS asks for permission the first time.
    func showNotification(_ n: [String: Any]) {
        guard let title = n["title"] as? String else { return }
        let content = UNMutableNotificationContent()
        content.title = String(title.prefix(200))
        content.body = String((n["body"] as? String ?? "").prefix(400))
        content.sound = .default
        if let href = safeHash(n["href"]) { content.userInfo = ["href": href] }
        let center = UNUserNotificationCenter.current()
        center.requestAuthorization(options: [.alert, .sound]) { granted, _ in
            guard granted else { return }
            center.add(UNNotificationRequest(identifier: UUID().uuidString, content: content, trigger: nil))
        }
    }

    // Show notifications even while Gridline is the frontmost app.
    func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification,
                                withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void) {
        completionHandler([.banner, .sound])
    }

    // Clicking a notification brings the window forward on that hunt.
    func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse,
                                withCompletionHandler completionHandler: @escaping () -> Void) {
        let href = safeHash(response.notification.request.content.userInfo["href"])
        DispatchQueue.main.async { [weak self] in
            guard let self = self else { return }
            NSApp.activate(ignoringOtherApps: true)
            self.window.makeKeyAndOrderFront(nil)
            if let href = href { self.webView.evaluateJavaScript("location.hash = '\(href)'", completionHandler: nil) }
        }
        completionHandler()
    }

    // MARK: Live loading

    private func liveURL() -> URL? {
        guard let folder = sourceFolder else { return nil }
        let url = folder.appendingPathComponent("index.html")
        return FileManager.default.fileExists(atPath: url.path) ? url : nil
    }

    /// Loads the app, keeping the current page (the part after #) across reloads.
    func load() {
        let fragment = webView.url?.fragment
        func withFragment(_ url: URL) -> URL {
            guard let f = fragment, var c = URLComponents(url: url, resolvingAgainstBaseURL: false) else { return url }
            c.fragment = f
            return c.url ?? url
        }
        if let url = liveURL(), let folder = sourceFolder {
            showingLive = true
            webView.loadFileURL(withFragment(url), allowingReadAccessTo: folder)
        } else if let resources = Bundle.main.resourceURL {
            showingLive = false
            webView.loadFileURL(withFragment(resources.appendingPathComponent("index.html")), allowingReadAccessTo: resources)
        }
        window.subtitle = showingLive ? "Live from \((sourceFolder?.path as NSString?)?.abbreviatingWithTildeInPath ?? "")" : ""
    }

    /// Modification dates of every page, script, stylesheet and key file the app uses.
    private func signature() -> String {
        guard let folder = sourceFolder,
              let walker = FileManager.default.enumerator(at: folder, includingPropertiesForKeys: [.contentModificationDateKey, .fileSizeKey],
                                                          options: [.skipsHiddenFiles, .skipsPackageDescendants])
        else { return "" }
        var files: [URL] = []
        for case let url as URL in walker {
            if ["app", "build", "release", "node_modules", "test"].contains(url.lastPathComponent) { walker.skipDescendants(); continue }
            files.append(url)
        }
        return files
            .filter { ["html", "js", "css", "json"].contains($0.pathExtension.lowercased()) }
            .sorted { $0.path < $1.path }
            .map { url -> String in
                let v = try? url.resourceValues(forKeys: [.contentModificationDateKey, .fileSizeKey])
                return "\(url.path):\(v?.contentModificationDate?.timeIntervalSince1970 ?? 0):\(v?.fileSize ?? 0)"
            }
            .joined(separator: "|")
    }

    // MARK: Updates

    var lastPull = Date.distantPast

    /// Runs git in the project folder and returns its trimmed output, or nil if it failed.
    private func git(_ args: [String], in folder: URL) -> String? {
        let p = Process()
        p.executableURL = URL(fileURLWithPath: "/usr/bin/git")
        p.arguments = ["-C", folder.path] + args
        p.environment = ProcessInfo.processInfo.environment.merging(["GIT_TERMINAL_PROMPT": "0"]) { $1 }
        let out = Pipe()
        p.standardOutput = out
        p.standardError = FileHandle.nullDevice
        guard (try? p.run()) != nil else { return nil }
        let data = out.fileHandleForReading.readDataToEndOfFile()
        p.waitUntilExit()
        return p.terminationStatus == 0 ? String(data: data, encoding: .utf8)?.trimmingCharacters(in: .whitespacesAndNewlines) : nil
    }

    /// Pulls the latest version from GitHub. Page changes then show up through checkForChanges;
    /// if the Mac app itself changed, it rebuilds, reinstalls and reopens itself.
    func pullUpdates() {
        guard let folder = sourceFolder, Date().timeIntervalSince(lastPull) > 60,
              FileManager.default.fileExists(atPath: folder.appendingPathComponent(".git").path) else { return }
        lastPull = Date()
        DispatchQueue.global(qos: .utility).async { [self] in
            guard let before = git(["rev-parse", "HEAD"], in: folder),
                  git(["pull", "--ff-only", "--quiet"], in: folder) != nil,
                  let after = git(["rev-parse", "HEAD"], in: folder), after != before,
                  git(["diff", "--quiet", before, after, "--", "app/macos"], in: folder) == nil
            else { return }
            let build = Process()
            build.executableURL = URL(fileURLWithPath: "/bin/zsh")
            build.arguments = [folder.appendingPathComponent("app/macos/build.sh").path]
            try? build.run()
        }
    }

    func applicationDidBecomeActive(_ notification: Notification) { pullUpdates() }

    private func checkForChanges() {
        let sig = signature()
        if sig != lastSignature || (liveURL() != nil) != showingLive {
            lastSignature = sig
            reloadBridge()
            load()
        }
    }

    /// Picks up a changed keys file on the next load.
    private func reloadBridge() {
        let content = webView.configuration.userContentController
        content.removeAllUserScripts()
        content.addUserScript(WKUserScript(source: bridgeScript(), injectionTime: .atDocumentStart, forMainFrameOnly: true))
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }

    // Dealer pages, history reports and other web links open in the default browser.
    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        if let url = action.request.url, action.navigationType == .linkActivated, url.scheme?.hasPrefix("http") == true {
            NSWorkspace.shared.open(url)
            decisionHandler(.cancel)
            return
        }
        decisionHandler(.allow)
    }

    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
                 for action: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if let url = action.request.url { NSWorkspace.shared.open(url) }
        return nil
    }

    func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String,
                 initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping () -> Void) {
        let alert = NSAlert()
        alert.messageText = message
        alert.beginSheetModal(for: window) { _ in completionHandler() }
    }

    func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String,
                 initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
        let alert = NSAlert()
        alert.messageText = message
        alert.addButton(withTitle: "OK")
        alert.addButton(withTitle: "Cancel")
        alert.beginSheetModal(for: window) { completionHandler($0 == .alertFirstButtonReturn) }
    }

    // MARK: Menu actions

    @objc func go(_ sender: NSMenuItem) {
        guard let hash = sender.representedObject as? String else { return }
        webView.evaluateJavaScript("location.hash = '\(hash)'", completionHandler: nil)
    }
    @objc func focusSearch(_ sender: Any?) {
        let js = """
        (() => {
          const el = ['#hero-search input', '#q-input', '#header-search input']
            .map((s) => document.querySelector(s))
            .find((e) => e && e.offsetParent !== null && !e.closest('[hidden]'));
          if (el) { el.focus(); el.select(); } else { location.hash = '#/search'; }
        })()
        """
        webView.evaluateJavaScript(js, completionHandler: nil)
    }
    @objc func reloadPage(_ sender: Any?) { reloadBridge(); load() }
    @objc func goBack(_ sender: Any?) { webView.goBack() }
    @objc func goForward(_ sender: Any?) { webView.goForward() }
    @objc func printPage(_ sender: Any?) {
        let op = webView.printOperation(with: NSPrintInfo.shared)
        op.view?.frame = webView.bounds
        op.runModal(for: window, delegate: nil, didRun: nil, contextInfo: nil)
    }
    @objc func revealProject(_ sender: Any?) {
        if let folder = sourceFolder { NSWorkspace.shared.activateFileViewerSelecting([folder]) }
    }
    @objc func openRepository(_ sender: Any?) {
        if let url = URL(string: "https://github.com/bollineni-create/hotwheels") { NSWorkspace.shared.open(url) }
    }

    private func buildMenu() {
        let main = NSMenu()

        let appItem = NSMenuItem(); main.addItem(appItem)
        let appMenu = NSMenu()
        appMenu.addItem(withTitle: "About Gridline", action: #selector(NSApplication.orderFrontStandardAboutPanel(_:)), keyEquivalent: "")
        appMenu.addItem(.separator())
        let settings = NSMenuItem(title: "Settings…", action: #selector(go(_:)), keyEquivalent: ",")
        settings.representedObject = "#/settings"; appMenu.addItem(settings)
        appMenu.addItem(.separator())
        appMenu.addItem(withTitle: "Hide Gridline", action: #selector(NSApplication.hide(_:)), keyEquivalent: "h")
        appMenu.addItem(.separator())
        appMenu.addItem(withTitle: "Quit Gridline", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        appItem.submenu = appMenu

        let fileItem = NSMenuItem(); main.addItem(fileItem)
        let file = NSMenu(title: "File")
        let newSearch = NSMenuItem(title: "New Search", action: #selector(go(_:)), keyEquivalent: "n")
        newSearch.representedObject = "#/search"; file.addItem(newSearch)
        file.addItem(withTitle: "Find…", action: #selector(focusSearch(_:)), keyEquivalent: "f")
        file.addItem(withTitle: "Find…", action: #selector(focusSearch(_:)), keyEquivalent: "k").isHidden = true
        file.addItem(.separator())
        file.addItem(withTitle: "Print…", action: #selector(printPage(_:)), keyEquivalent: "p")
        file.addItem(withTitle: "Close Window", action: #selector(NSWindow.performClose(_:)), keyEquivalent: "w")
        fileItem.submenu = file

        let editItem = NSMenuItem(); main.addItem(editItem)
        let edit = NSMenu(title: "Edit")
        edit.addItem(withTitle: "Undo", action: Selector(("undo:")), keyEquivalent: "z")
        edit.addItem(withTitle: "Redo", action: Selector(("redo:")), keyEquivalent: "Z")
        edit.addItem(.separator())
        edit.addItem(withTitle: "Cut", action: #selector(NSText.cut(_:)), keyEquivalent: "x")
        edit.addItem(withTitle: "Copy", action: #selector(NSText.copy(_:)), keyEquivalent: "c")
        edit.addItem(withTitle: "Paste", action: #selector(NSText.paste(_:)), keyEquivalent: "v")
        edit.addItem(withTitle: "Select All", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a")
        editItem.submenu = edit

        let goItem = NSMenuItem(); main.addItem(goItem)
        let goMenu = NSMenu(title: "Go")
        for (i, (title, hash)) in [("Home", "#/"), ("Search", "#/search"), ("Insights", "#/insights"), ("Saved & Hunts", "#/saved"), ("Compare", "#/compare")].enumerated() {
            let item = NSMenuItem(title: title, action: #selector(go(_:)), keyEquivalent: "\(i + 1)")
            item.representedObject = hash
            goMenu.addItem(item)
        }
        goMenu.addItem(.separator())
        goMenu.addItem(withTitle: "Back", action: #selector(goBack(_:)), keyEquivalent: "[")
        goMenu.addItem(withTitle: "Forward", action: #selector(goForward(_:)), keyEquivalent: "]")
        goItem.submenu = goMenu

        let viewItem = NSMenuItem(); main.addItem(viewItem)
        let view = NSMenu(title: "View")
        view.addItem(withTitle: "Reload", action: #selector(reloadPage(_:)), keyEquivalent: "r")
        view.addItem(withTitle: "Show Project Folder", action: #selector(revealProject(_:)), keyEquivalent: "")
        view.addItem(.separator())
        let fs = NSMenuItem(title: "Enter Full Screen", action: #selector(NSWindow.toggleFullScreen(_:)), keyEquivalent: "f")
        fs.keyEquivalentModifierMask = [.control, .command]
        view.addItem(fs)
        viewItem.submenu = view

        let winItem = NSMenuItem(); main.addItem(winItem)
        let win = NSMenu(title: "Window")
        win.addItem(withTitle: "Minimize", action: #selector(NSWindow.performMiniaturize(_:)), keyEquivalent: "m")
        win.addItem(withTitle: "Zoom", action: #selector(NSWindow.performZoom(_:)), keyEquivalent: "")
        winItem.submenu = win
        NSApp.windowsMenu = win

        let helpItem = NSMenuItem(); main.addItem(helpItem)
        let help = NSMenu(title: "Help")
        help.addItem(withTitle: "Gridline Source Code", action: #selector(openRepository(_:)), keyEquivalent: "")
        helpItem.submenu = help
        NSApp.helpMenu = help

        NSApp.mainMenu = main
    }
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.regular)
app.run()
