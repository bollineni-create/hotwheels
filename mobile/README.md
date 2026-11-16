# Gridline for iPhone and Android

A native Expo app for Gridline. It reuses the market logic in `../js` (demo inventory, fair value, search, natural-language queries, VIN decoding, the Visor and auto.dev clients and the chart drawings) unchanged, so the app, the website and the desktop app always agree on the numbers. Only the screens are new.

## Run it on your phone

Install **Expo Go** from the App Store or Google Play, then:

```bash
cd mobile
npm install
npx expo start
```

Scan the QR code with the iPhone camera (or from Expo Go on Android). Your phone and computer need to be on the same Wi‑Fi; if they aren't, use `npx expo start --tunnel`.

## What's in it

| Tab | What it shows |
| --- | --- |
| Home | Type a ZIP for your market: best deals near you, cars worth the drive, what your market charges vs. the US, and this week's price cuts |
| Search | Plain-words search ("white 4runner under 40k near 94022"), sort and quick filters |
| Saved | Hearted cars and what their price has done since |
| Compare | Up to four cars side by side, best value in each row highlighted |
| Settings | Demo, auto.dev or Visor data, your API key (stored only on the phone), home ZIP, theme |

Tapping a car opens its page: photos or the drawn car, price vs. fair value, price history, details, an out-the-door estimate and similar cars.

Live data works straight from the phone: native apps aren't subject to the browser rule that makes the website go through the desktop app or `npm start`.

Not ported yet: hunts (saved searches with notifications), the Insights wall, the maps, the VIN page and the full filter panel.

## How it fits together

- `metro.config.js` adds `../js` to Metro's watch folders, and `src/lib/modules.ts` loads those files.
- The modules read and write `localStorage` synchronously, so `expo-sqlite/localStorage/install` provides one before they load.
- `src/components/svg-art.tsx` draws the SVG the chart module produces, with the site's CSS for its classes, via `react-native-svg`'s `SvgCss`.
- Saved data uses the same `gridline:v1` key and shape as the website.

```bash
npx tsc --noEmit   # typecheck
npx eslint src     # lint
```
