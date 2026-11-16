// The shared, DOM-free Gridline modules from ../js, used unchanged by the website,
// the desktop app and this app. They read and write `localStorage` synchronously
// (API keys, usage counts, the rate-limit tier), so install one before loading them.
import 'expo-sqlite/localStorage/install';

/* eslint-disable @typescript-eslint/no-require-imports */
export const VIN = require('../../../js/vin.js');
export const Geo = require('../../../js/geo.js');
export const MarketData = require('../../../js/data.js');
export const Market = require('../../../js/market.js');
export const Charts = require('../../../js/charts.js');
export const NLQ = require('../../../js/nlq.js');
export const Live = require('../../../js/live.js');
/* eslint-enable @typescript-eslint/no-require-imports */

// A listing, as the shared modules build it (demo inventory or a normalized live result).
export type Listing = any;  
export type Filters = any;  
