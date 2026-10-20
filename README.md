<p align="center"><img src="assets/icons/icon-256.png" width="96" alt=""></p>

<h1 align="center">Gridline</h1>

<p align="center"><b>Type your ZIP code. See the best car deals around you, and the ones worth the drive.</b><br>
A local, dependency-free car search and market-insights site, modeled on <a href="https://visor.vin">visor.vin</a> and extended past it. It runs as a desktop app (Electron) or as a plain website: HTML, CSS and JavaScript with no build step.</p>

<p align="center"><b><a href="https://bollineni-create.github.io/hotwheels/">Open Gridline in your browser</a></b></p>

## Install it on a Mac (simplest)

Paste this into Terminal. It downloads Gridline to `~/hotwheels`, builds a small native app, puts it in Applications and opens it (and offers to install Apple's command-line tools first if you don't have them):

```bash
curl -fsSL https://raw.githubusercontent.com/bollineni-create/hotwheels/main/app/macos/install.sh | zsh
```

To build your API keys in at the same time, put them in front of `zsh`: `... | VISOR_KEY=your_visor_key AUTODEV_KEY=your_autodev_key zsh`. Running the same line again updates and reinstalls.

The first time, it asks for your Visor and auto.dev keys so you get real listings (Visor is used when both are given). Press Enter to skip either; with neither, it uses the demo listings. The key is saved in `electron/keys.local.json`, which git ignores, so it never gets uploaded.

After that, open Gridline from Launchpad, Spotlight or the Dock like any other app. It keeps itself up to date: each time you open or switch to it, and every 15 minutes while it's open, it pulls the latest version of the `main` branch from GitHub into `~/hotwheels`. Changes to the pages show up in the open window within a second. If the update changed the Mac app itself (`app/macos/`), Gridline rebuilds, reinstalls and reopens itself. Edits you make to the HTML, CSS or JS in `~/hotwheels` also show up right away. If the folder moves, the app falls back to the copy built into it.

### Give it to family: a DMG with your keys built in

To hand someone a finished app with your API keys already inside, so they never see a Terminal or a key: open the repository on GitHub, go to **Settings → Secrets and variables → Actions** and add `VISOR_KEY` and/or `AUTODEV_KEY`. Then open the **Actions** tab, choose **Build Mac DMG** and press **Run workflow**. A few minutes later, download the `Gridline-mac-dmg` artifact from the run and send the `.dmg` inside it (AirDrop, Messages, a shared drive). They open it, drag Gridline to Applications, and the first time they right-click the app and choose **Open** because it is unsigned. The build works on both Intel and Apple-silicon Macs.

Only people with access to this repository can download the artifact, so the keys stay private, but anyone who has the `.dmg` can use the keys inside it: share it only with people you trust. Like the one-line installer, this copy keeps itself up to date: it shows the pages from the public site, which GitHub Pages rebuilds from `main` within a minute or two of every merge, so your changes reach it the next time it is opened or switched to, or within 15 minutes while it is open. The keys built into it stay as they are. Without internet it shows the copy of the pages built into it. Only a change to the desktop shell itself (the `electron/` folder) needs a new `.dmg`.

## Run it as an Electron app

Requires [Node.js](https://nodejs.org) 18 or newer.

```bash
npm install        # one time: downloads Electron and the packager
npm run app        # opens Gridline in its own window
```

To build an installer you can double-click, run this on the OS you're targeting:

| Command | Output in `release/` |
| --- | --- |
| `npm run dist:mac` | `Gridline-1.0.0.dmg` (drag to Applications) |
| `npm run dist:win` | `Gridline Setup 1.0.0.exe` |
| `npm run dist:linux` | `Gridline-1.0.0.AppImage` and `gridline_1.0.0_amd64.deb` |

The builds are unsigned. The first time you open the app, macOS asks you to confirm it (right-click → Open) and Windows SmartScreen asks you to choose "Run anyway". Packaged builds show the pages from the public site (set `GRIDLINE_LIVE_URL` to point them elsewhere, or to an empty string to use only the bundled files); `npm run app` shows your local files.

The desktop app adds a native menu with shortcuts: `⌘/Ctrl+F` or `⌘/Ctrl+K` to search, `⌘/Ctrl+N` for a new search, `⌘/Ctrl+1`–`5` to switch between Home, Search, Insights, Saved & Hunts and Compare, and Back/Forward. On a Mac, the red close button hides the window rather than quitting, so hunts keep watching; click the Dock icon to bring it back, or quit with `⌘Q`. It remembers the window's size and position, and external links open in your browser. Hunts, favorites and the compare list persist between launches, and hunts show native notifications (see **Hunts** below).

## Run it as a website

```bash
npm start          # local server on http://localhost:8080 (needed for live data in the browser)
open http://localhost:8080
npm test           # node's built-in test runner
```

The public site at https://bollineni-create.github.io/hotwheels/ is served by GitHub Pages from the root of `main`, so it updates on its own within a minute or two of every merge. Before committing changes to the JS or CSS, run `./tools/stamp-version.sh`: it stamps a fresh `?v=` on the page's script and stylesheet links, so visitors get the new files instead of a cached mix of old and new.

## What carried over from the baseline

| visor.vin homepage | Here |
| --- | --- |
| Hero with a search box for models, VINs and dealers | One search box at the top of the page, with typeahead across models, model + year, makes, dealers, cities, ZIP codes, saved searches and VINs and full keyboard support (`/` to focus, arrow keys, Enter). Under it, your market: a ZIP code (see **Your market** below) |
| "What the market's doing" weekly cards | Four cards, each **computed from the inventory** rather than written by hand: 4-year value retention in a segment, the trim that sells days faster than its sibling (with a state map of how fast the model sells), the make whose sales climbed most in a month (with a state map of the change), and new-model arrivals by status |
| Category pills next to the weekly heading (Time Capsules, Rare Specs) | The home page is a set of categories: **This week**, **Your market**, **National trends**, **Time capsules**, **Rare specs** and **Browse**. A strip under the search box jumps between them and follows you as you scroll, and every heading has previous/next pills |
| National market pages | **National trends**: inventory over 90 days with the median price, a real map of the states where used cars sit below market (click a state to shop it), the biggest 30-day price move as a price-vs-miles scatter, the models selling fastest, this week's price cuts, and the cars priced lowest for what they are |
| Time Capsules | Three capsules (1 week, 1 month, 3 months ago), each the whole market frozen on that day: cars for sale and median prices then vs. now, what sold, was listed and was cut since, the used models whose price moved most, and a link that runs any search as of that day |
| Rare specs carousel | Rarity scored per listing: paint and interior counts within the model, and options value vs. the model average |
| "Built for buyers, not dealers" pitch | Removed |
| Footer links for SEO (models, overviews, prices) | "Browse the market" grid with live counts and median prices, plus footer links into real searches |

## Your market: the best deals around a ZIP code

The home page starts from where you are. Type a ZIP code (or press **Near me** to use your location) and Gridline builds your market from it:

- **Your market at a glance**: cars for sale within your radius, the median asking price, how many days cars sit, the share priced below fair value and this week's price cuts, each against the whole US. Switch the radius between 25, 50, 100 and 250 miles in place.
- **Best deals near you**: the cars priced furthest below their fair value, ranked, with the saving on each card and how far away it is. Filter to used or new.
- **Worth the drive**: cars beyond your radius but within 500 miles that still come out ahead once you subtract a round-trip fuel estimate (about 14¢ a mile) and the best deal on the same model near you. Each one shows the math.
- **Where the cars are**: a map centered on you, with your radius and the 500-mile market around it; cities are sized by inventory and colored by how they price against fair value. Click one to search there.
- **What your market charges**: median used asking price near you vs. nationwide, model by model, so you can see what's cheaper to buy at home and what's cheaper to bring in.
- **Price cuts near you this week**, with a link to all of them.

Your ZIP stays on this device. It also sets the distance shown on every listing, the **Distance from home** sort, the "Near me" shortcut in the search filters, and the radius used by the home page (**Settings → Display**). Searches understand ZIP codes too: *"4x4 trucks near 94022"*, *"within 50 miles of 80202 manual miata under 30k"*, or just a ZIP on its own.

Every ZIP code works offline: `js/zipdata.js` (generated by `tools/build-zip-table.js` from GeoNames postal data, CC BY 4.0) has the center and main place of all 900-odd 3-digit ZIP areas. When online, the exact place for a 5-digit ZIP is fetched from the free [Zippopotam.us](https://api.zippopotam.us) service and remembered. With live data, the home page asks Visor or auto.dev for the newest listings within your radius and within 500 miles, and fair value is learned from those cars.

## Hunts: find the car you want before someone else does

Search for the exact car you want, then press **🎯 Hunt this**. Gridline keeps checking that search while it's open (in the background too) and tells you what changed:

- **Notifications** when a new match is listed or one drops its price, naming the best new find and whether it's below market. The Mac app and the Electron app show native notifications (click one to open the hunt); in a browser, allow notifications when asked.
- **Since you last looked** on each hunt's page: new listings, price cuts (from → to) and cars that sold or were delisted. The **Saved** tab shows how many are new. **Mark all as seen** clears them.
- **How rare it is**: how many are for sale, how many new listings come up a month (so roughly how long until the next one), how many sold and how fast, median asking and sold prices, a plain-English verdict on how quickly to move, the best-priced one for sale now, and a 90-day inventory chart.

Watched hunts are checked every 6 hours by default; **Settings → Hunts** changes that to hourly, daily or by hand only, and pausing a hunt stops its checks. With live data, a check fetches only the newest page of matches in one request, so a car that isn't on that page is never reported as gone; Settings estimates how many of auto.dev's 1,000 free monthly requests your hunts use. The demo market never changes, so a new demo hunt starts from the market as it was a week ago, and its first check shows that week's new listings, cuts and sales.

## What's new

The baseline homepage only describes its search, filters, price history and alerts. This build implements them.

- **Search with live facet counts.** Each filter option shows how many cars you'd get by picking it (standard faceting: a facet's own selection doesn't narrow its counts). Options with zero results are hidden. All filter state lives in the URL, so every search can be shared and bookmarked.
- **Distance search.** Pick a city and a radius (25–1,000 mi) instead of a ZIP code. Uses great-circle distance.
- **Transparent fair value.** For each make and model, a log-linear regression of retained value (price ÷ base MSRP) on age and mileage, trained on cars for sale and recently sold. Every car shows the dollar gap to its expected price, with the method explained, in place of an unexplained "great deal" badge. You can filter or sort by it.
- **Spec premiums in fair value.** Within each model, Gridline also learns what a transmission or a paint is worth compared with the model's most common one, so a manual Mustang isn't called overpriced next to the automatics. A premium counts only when it's clear of normal price noise (2 standard errors for transmissions, 3 for paints, since many paints are tested at once), and it's shrunk toward zero by n ÷ (n + 10) so a few cars can't swing it. The listing page breaks the expected price into the base value and each premium, e.g. "Manual transmission +4.7% vs. Automatic, from 30 cars".
- **Transmission filter.** Automatic, CVT or Manual, with live counts and exclude mode. Search understands "manual", "stick shift", "6-speed manual", "three pedals" and "no CVT".
- **The whole result set on a chart.** A price-vs-miles scatter colored by market position (click a dot to open that car) and a map of the United States, drawn from real state outlines, showing where the matches are (click a state to filter). The same outlines back every map on the site: `js/usmap.js` is generated by `tools/build-us-map.js` from the US Census TIGER state boundaries (via us-atlas, public domain), projected with Albers USA so Alaska and Hawaii sit inset at the bottom left.
- **Model overviews.** Pick a single model to see median price by model year, trim mix, days on market and the share of listings with price cuts.
- **Listing pages.** A step chart and timeline of the full price history, a gauge of price vs. market, the car plotted against similar listings, color and option rarity, a payment calculator (down payment, APR, term, tax), a VIN decode, and similar cars.
- **VIN decoder** (`#/vin/<VIN>`): validates the check digit, decodes model year, manufacturer (WMI), region, plant and serial, and explains typos (e.g. "VINs never contain I, O or Q").
- **Compare** up to 4 cars side by side, with the best value in each row highlighted.
- **Hunts, favorites and recently viewed.** Stored only on your machine, never sent anywhere.
- **Dark mode** (follows the system, with a manual toggle), a responsive layout down to 375px with a slide-in filter drawer, a skip link, labeled controls, keyboard-operable map tiles, and support for `prefers-reduced-motion`.
- **No hotlinked dealer photos.** Every car is drawn as an SVG side profile by body style, painted in its real exterior color.

## Live data (real listings), free

Gridline ships with a demo sample. To search **real** cars for sale, connect a listings source in **Settings → Listing data**:

| Source | Cost | What you get |
| --- | --- | --- |
| **[auto.dev](https://auto.dev/pricing)** (recommended) | **Free**: 1,000 requests a month, no credit card. It stops at the limit, so you are never charged | Cars for sale now from US dealers: search, filters with live counts, photos, dealer links, accident and owner-count history, Carfax link |
| [Visor](https://visor.vin/account/api) | Pay per request (~$0.002–$0.04) after starter credit | Everything above, plus sold cars, past-date snapshots, installed options, features, upfitters, dealer fees and sales velocity |

**Setup for auto.dev (free):** sign up at auto.dev, copy the API key from your dashboard, then paste it into Settings → auto.dev and press **Save**. A search uses 1 request (up to 20 cars), loading more uses 1, and opening a car uses 2–3. Settings shows how many of the month's 1,000 you've used on this device, and repeat requests within 30 minutes are free.

**Recalls and complaints** come from [NHTSA](https://www.nhtsa.gov/recalls). They're free, need no key, and appear on every listing, in every mode, including the public website.

Where live listings work:

| Where you run Gridline | Live listings |
| --- | --- |
| Desktop app (`npm run app` or the Mac app) | ✅ Requests go out from the app itself |
| `npm start`, then http://localhost:8080 | ✅ The local server relays requests |
| The public GitHub Pages site | ❌ Demo listings only, because auto.dev and Visor only accept browser requests from their own sites. NHTSA recalls still work |

Keys are stored only on your device and are never written into the code or uploaded. Gridline names the data source on every live page, as the providers' terms require.

With Visor connected, the home page keeps the **This week**, **Your market**, **Time capsules** and **Browse** categories (the capsules open Visor's daily snapshots for your area; **National trends** and **Rare specs** need the demo's sales history and spec data, so they're left out). Its "What the market's doing" cards are about *your* market rather than a national summary: with a home ZIP set, every card covers your market radius around it (switchable in place): cars for sale with days of supply and median asking price, the models selling fastest, the biggest new-car discounts, and the "Browse the market" grid with live counts. A **Your market** card follows the hunts you've saved and the models you've favorited or opened, showing how many are for sale right now and how that's changed since you saved the hunt. The page uses three requests for the cards plus one per followed hunt or model, and repeats within 30 minutes are free.

When a source can't provide something, Gridline hides that control instead of showing empty results. On the free auto.dev plan, sold history, past dates, installed options and upfitters, dealer fees, velocity and exclude filters are hidden, and auto.dev has no free-text search, so describe the car in the main search box instead.

To develop without using real requests, run the stand-in APIs (`node test/mock-autodev.js`, key `ad_test_key`; `node test/mock-visor.js`, key `vis_test_key`) and start Gridline with `AUTODEV_API_BASE=http://127.0.0.1:8798 VISOR_API_BASE=http://127.0.0.1:8799 npm start`.

## Visor Plus features, included

Visor charges for these as "Visor Plus". Here they're all built in, with no account or paywall.

| Visor Plus / exclusive feature | Where it is in Gridline |
| --- | --- |
| Filter by installed options | **Installed options** filter (factory packages on each car). Each option on a listing links to others that have it |
| Filter by top features | **Top features** filter (heated seats, CarPlay, third row, tow package and more). Checking several means "has all of them" |
| Exclude mode | Every filter has an **Exclude** toggle; type `without sunroof` in the filter search or the main search box |
| Search your filters | **Search filters** box at the top of the sidebar: `brown interior`, `without sunroof`. Enter adds; ⌘/Ctrl+Enter adds and keeps searching; `/` jumps to it |
| Sort filter values by price, days for sale or discount | **Sort filter values by** menu above the filters (also in Settings) |
| Filter by assembly location | **Assembly location** filter; the plant is also written into each VIN's 11th character |
| Filter by upfitter | **Upfitter** filter (Roush, Shelby American, Hennessey, RTR, Rocky Ridge, Black Widow, BraunAbility and more), with a badge on listings |
| Search by VIN pattern | **VIN pattern** filter and the main search box: prefixes plus `*` or `?` wildcards (e.g. `1FT*`, `JTE??????N`) |
| MSRP filtering and sorting | **Original MSRP** range filter; sort by MSRP high or low |
| Best discount sorting | Sort by **Biggest discount from MSRP** |
| Sold listings | Switch the results headline from **for sale today** to **sold in the last 120 days**; sort by recently sold or sold fastest |
| Past dates / track inventory over time | The same menu rewinds the market **1 week, 1 month or 3 months**; every search shows an **Inventory over time** chart |
| Market velocity stats | Sold in 30 days, median days to sell, days of supply and sale vs. first asking price, on model overviews and listing pages |
| Leaderboard and comparables, with advanced filters | **Against the market** on each listing: rank by value, price, miles, newest or discount, with peers limited by trim, years, condition, distance or MSRP match. Sold comps and an MSRP-adjusted (%) view are optional |
| Vehicle docs | **Window sticker** and **Build sheet**, reconstructed from listing data, printable |
| Previous seller history | **Seller history**: every earlier listing of the same VIN, with dealer, dates, last price and miles |
| Private listings | **Seller type** filter (Dealer / Private) and a Private badge |
| Natural-language search | Main search: "4x4 trucks under 50k miles near Denver", "white Lexus GX with brown interior" |
| Pricing breakdown | Discounts, market adjustments, conditional incentives, dealer add-ons, doc fee, estimated tax and out-the-door, with the "price gap" called out |
| Deal Check | Price, add-ons, fees, tax, trade-in and payoff, down payment and APR, totalled and checked against market value, comparable listings and typical doc fees |
| Map search | **Map** layout: listings grouped by city, sized by count, colored by price vs. market, with your search radius drawn |
| Display preferences | **Settings**: home location (distances and a "Distance from home" sort), seller name vs. location, compact cards |

With a Visor API key, all of this runs on real listings; the free auto.dev source covers the subset described in **Live data** above. NHTSA recalls and owner complaints are included for every model year. Visor's own API/MCP server and email alerts are left out because they need a server; hunts cover alerts with notifications while Gridline is open.

## Data

The site runs on `js/data.js`, a seeded generator that produces about 3,200 cars for sale and 7,000 sales from the last 120 days. The same seed always gives the same market, which keeps tests stable. The listings cover 33 models with real trims and approximate MSRPs, the makes' real paint names, realistic depreciation and mileage, regional price differences, options packages, new-car pipeline status (on lot, in transit, in production) and price-cut histories. Every VIN has a valid check digit and the correct model-year code.

The demo market also has transmissions: manuals on the trims that offered them (Miata, Civic Si and Type R, Mustang, Wrangler, Bronco, Tacoma), CVTs on the models and hybrids that use them, and a premium for used manuals.

To use real data, have `generateInventory()` return listings with the same shape: `{ id, vin, year, make, model, trim, body, segment, condition, status, miles, price, msrp, msrpBase, options, extColor, extHex, intColor, transmission, dealer, city, state, lat, lng, daysListed, history: [{ daysAgo, price }] }`. Nothing else needs to change.

## Layout

```
index.html        shell: header, footer, script tags
app/macos/        native Mac app: build.sh, Swift window that loads the site live and relays API requests
electron/         Electron desktop app: window, menu, link handling (main.js, preload.js)
assets/icons/     app icons (SVG source plus PNG sizes)
css/styles.css    design tokens (light and dark), components, responsive rules
js/vin.js         VIN validation and decoding (works in the browser and Node)
js/data.js        seeded inventory generator
js/market.js      search, facets, fair value and spec premiums, snapshots, time capsules, velocity, make momentum, trim velocity, leaderboard, Deal Check, hunt diffs (pure functions)
js/nlq.js         natural-language search and filter search
js/live.js        listings API clients (auto.dev free, Visor paid): filter mapping, caching, usage tracking
server.js         local server that also relays /api/<source>/* requests
test/mock-*.js    stand-in auto.dev and Visor APIs for tests and development
js/usmap.js       US state outlines (Albers USA projection) and the projection itself, generated by tools/build-us-map.js
js/charts.js      SVG scatter, bars, US maps (choropleth and dots), price-history and car illustrations
js/app.js         hash router and views: home, search, car, compare, saved, hunts, VIN; hunt checks and notifications
test/             node --test unit tests
tools/stamp-version.sh  stamps ?v= on script and stylesheet links so browsers pick up updates
tools/build-us-map.js   regenerates js/usmap.js from us-atlas states-10m.json
```
