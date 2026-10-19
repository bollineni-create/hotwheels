# Gridline: see the whole car market

A local, dependency-free car search and market-insights site, modeled on [visor.vin](https://visor.vin) and extended past it.
**Use it in your browser:** https://bollineni-create.github.io/hotwheels/

It runs as a desktop app (Electron) or as a plain website. The site itself is HTML, CSS and JavaScript with no build step.

## Run it as a desktop app

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

The builds are unsigned. The first time you open the app, macOS asks you to confirm it (right-click → Open) and Windows SmartScreen asks you to choose "Run anyway".

The desktop app adds a native menu with shortcuts: `⌘/Ctrl+F` or `⌘/Ctrl+K` to search, `⌘/Ctrl+N` for a new search, `⌘/Ctrl+1`–`5` to switch between Home, Search, Insights, Saved and Compare, and Back/Forward. It remembers the window's size and position, and external links open in your browser. Saved searches, favorites and the compare list persist between launches.

## Run it as a website

```bash
npm start          # local server on http://localhost:8080 (needed for live data in the browser)
open http://localhost:8080
npm test           # node's built-in test runner
```

## What carried over from the baseline

| visor.vin homepage | Here |
| --- | --- |
| Hero with a search box for models, VINs and dealers | Typeahead search across models, model + year, makes, dealers, cities, saved searches and VINs, with full keyboard support (`/` to focus, arrow keys, Enter) |
| "What the market's doing" weekly cards | Six cards, each **computed from the inventory** rather than written by hand: new-model arrivals by status, the biggest 30-day price move (price-vs-miles scatter, then vs. now), 4-year value retention, this week's price cuts, a state map of prices vs. market, and the cars priced lowest for what they are |
| Rare specs carousel | Rarity scored per listing: paint and interior counts within the model, and options value vs. the model average |
| "Built for buyers, not dealers" pitch | Kept. Every claim on the page is backed by a working feature |
| Footer links for SEO (models, overviews, prices) | "Browse the market" grid with live counts and median prices, plus footer links into real searches |

## What's new

The baseline homepage only describes its search, filters, price history and alerts. This build implements them.

- **Search with live facet counts.** Each filter option shows how many cars you'd get by picking it (standard faceting: a facet's own selection doesn't narrow its counts). Options with zero results are hidden. All filter state lives in the URL, so every search can be shared and bookmarked.
- **Distance search.** Pick a city and a radius (25–1,000 mi) instead of a ZIP code. Uses great-circle distance.
- **Transparent fair value.** For each make and model, a log-linear regression of retained value (price ÷ base MSRP) on age and mileage. Every car shows the dollar gap to its expected price, with the method explained, in place of an unexplained "great deal" badge. You can filter or sort by it.
- **The whole result set on a chart.** A price-vs-miles scatter colored by market position (click a dot to open that car) and a state tile map of where the matches are (click a state to filter).
- **Model overviews.** Pick a single model to see median price by model year, trim mix, days on market and the share of listings with price cuts.
- **Listing pages.** A step chart and timeline of the full price history, a gauge of price vs. market, the car plotted against similar listings, color and option rarity, a payment calculator (down payment, APR, term, tax), a VIN decode, and similar cars.
- **VIN decoder** (`#/vin/<VIN>`): validates the check digit, decodes model year, manufacturer (WMI), region, plant and serial, and explains typos (e.g. "VINs never contain I, O or Q").
- **Compare** up to 4 cars side by side, with the best value in each row highlighted.
- **Saved searches, favorites and recently viewed.** Stored only on your machine, never sent anywhere. Saved searches show how many cars match now.
- **Dark mode** (follows the system, with a manual toggle), a responsive layout down to 375px with a slide-in filter drawer, a skip link, labeled controls, keyboard-operable map tiles, and support for `prefers-reduced-motion`.
- **No hotlinked dealer photos.** Every car is drawn as an SVG side profile by body style, painted in its real exterior color.

## Live data (real listings)

Gridline ships with a demo sample. To search **real** cars, connect it to the [Visor Public API](https://api.visor.vin/docs):

1. Create an API key at [visor.vin/account/api](https://visor.vin/account/api). New accounts get starter credit, and after that you pay per request: about $0.002–$0.003 per search or count, and about $0.04 for a full listing page with price history and options. Visor shows your balance and lets you set a spending cap.
2. In Gridline open **Settings → Listing data**, paste the key, and press **Save**. **Test connection** confirms it works, and Settings shows what you've spent.

Where live data works:

| Where you run Gridline | Live data |
| --- | --- |
| Desktop app (`npm run app` or the Mac app) | ✅ Requests go out from the app itself |
| `npm start`, then http://localhost:8080 | ✅ The local server relays requests |
| The public GitHub Pages site | ❌ Demo data only. Visor only accepts browser requests from visor.vin |

What changes with live data:
- Search, filters, filter counts, sorting, sold listings and past-date snapshots all come from Visor
- Listings show the dealer's photos, link to the dealer's own page, and show dealer pricing line items (fees, add-ons, conditional discounts) where Visor has them
- Leaderboard, comparables, fair value, velocity and Deal Check use live comparable listings
- The inventory trend loads on request (9 calls, about 3¢)
- Repeat requests within 30 minutes come from a cache, so they cost nothing

Your key is stored only on your device (browser storage, or the desktop app's storage). It is never written to the code or uploaded. Per Visor's [API agreement](https://visor.vin/legal/api-license/2026-06-12), keys must not be embedded in public pages, and Visor's attribution must stay visible; Gridline shows "Live listings from Visor" on every live page.

A few demo features have no live equivalent. Visor covers dealer listings only, so there are no private sellers. It has no free-text search, so describe what you want in the main search box instead. Seller history across past dealers and "has price cuts" are demo-only.

To develop against a stand-in API without spending credit, run `node test/mock-visor.js` (key: `vis_test_key`) and start Gridline with `VISOR_API_BASE=http://127.0.0.1:8799`.

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

With a Visor API key, all of this runs on real listings (see **Live data** above). Two Visor features are left out on purpose. NHTSA recalls and complaints would have to be made up for synthetic cars, and the API/MCP server and email alerts need a server.

## Data

The site runs on `js/data.js`, a seeded generator that produces about 3,200 cars for sale and 7,000 sales from the last 120 days. The same seed always gives the same market, which keeps tests stable. The listings cover 33 models with real trims and approximate MSRPs, the makes' real paint names, realistic depreciation and mileage, regional price differences, options packages, new-car pipeline status (on lot, in transit, in production) and price-cut histories. Every VIN has a valid check digit and the correct model-year code.

To use real data, have `generateInventory()` return listings with the same shape: `{ id, vin, year, make, model, trim, body, segment, condition, status, miles, price, msrp, msrpBase, options, extColor, extHex, intColor, dealer, city, state, lat, lng, daysListed, history: [{ daysAgo, price }] }`. Nothing else needs to change.

## Layout

```
index.html        shell: header, footer, script tags
electron/         desktop app: window, menu, link handling (main.js, preload.js)
assets/icons/     app icons (SVG source plus PNG sizes)
css/styles.css    design tokens (light and dark), components, responsive rules
js/vin.js         VIN validation and decoding (works in the browser and Node)
js/data.js        seeded inventory generator
js/market.js      search, facets, fair value, snapshots, velocity, leaderboard, Deal Check (pure functions)
js/nlq.js         natural-language search and filter search
js/live.js        Visor API client: filter mapping, caching, cost tracking, normalizing records
server.js         local server that also relays /visor/* requests to the Visor API
test/mock-visor.js  stand-in Visor API for tests and development
js/charts.js      SVG scatter, bars, tile map, price-history and car illustrations
js/app.js         hash router and views: home, search, car, compare, saved, VIN
test/             node --test unit tests
```
