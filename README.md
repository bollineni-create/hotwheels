# Gridline: see the whole car market

A local, dependency-free car search and market-insights site, modeled on [visor.vin](https://visor.vin) and extended past it.
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
npm start          # or: python3 -m http.server 8080
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

## Data

The site runs on `js/data.js`, a seeded generator that produces about 3,200 listings from 1,400 dealers. The same seed always gives the same market, which keeps tests stable. The listings cover 33 models with real trims and approximate MSRPs, the makes' real paint names, realistic depreciation and mileage, regional price differences, options packages, new-car pipeline status (on lot, in transit, in production) and price-cut histories. Every VIN has a valid check digit and the correct model-year code.

To use real data, have `generateInventory()` return listings with the same shape: `{ id, vin, year, make, model, trim, body, segment, condition, status, miles, price, msrp, msrpBase, options, extColor, extHex, intColor, dealer, city, state, lat, lng, daysListed, history: [{ daysAgo, price }] }`. Nothing else needs to change.

## Layout

```
index.html        shell: header, footer, script tags
electron/         desktop app: window, menu, link handling (main.js, preload.js)
assets/icons/     app icons (SVG source plus PNG sizes)
css/styles.css    design tokens (light and dark), components, responsive rules
js/vin.js         VIN validation and decoding (works in the browser and Node)
js/data.js        seeded inventory generator
js/market.js      search, facets, fair-value model, insight calculations (pure functions)
js/charts.js      SVG scatter, bars, tile map, price-history and car illustrations
js/app.js         hash router and views: home, search, car, compare, saved, VIN
test/             node --test unit tests
```
