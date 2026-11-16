// Saved data, kept under the same key and in the same shape as the website (gridline:v1).
import { useSyncExternalStore } from 'react';

import { Geo, type Listing } from '@/lib/modules';

export type Source = 'demo' | 'visor' | 'autodev';
export type Prefs = {
  homeZip: string | null;
  homeRadius: number;
  showDealer: boolean;
  dataSource: Source;
  sourceChosen?: boolean;
  [k: string]: unknown;
};
export type AppState = {
  saved: unknown[];
  favs: Record<string, number>; // id -> price when favorited
  compare: string[];
  recent: string[];
  theme: 'light' | 'dark' | null;
  prefs: Prefs;
  liveCars: Record<string, Listing>;
};

const STORE_KEY = 'gridline:v1';
export const MAX_COMPARE = 4;

function load(): AppState {
  let s: AppState = { saved: [], favs: {}, compare: [], recent: [], theme: null, prefs: {} as Prefs, liveCars: {} };
  try {
    s = Object.assign(s, JSON.parse(localStorage.getItem(STORE_KEY) || 'null') || {});
  } catch {
    /* unreadable: start fresh */
  }
  s.prefs = Object.assign({ homeZip: null, homeRadius: 100, showDealer: false, dataSource: 'demo' }, s.prefs);
  if ((s.prefs.dataSource as string) === 'live') s.prefs.dataSource = 'visor';
  if (!Geo.isZip(s.prefs.homeZip) || !Geo.lookup(s.prefs.homeZip)) s.prefs.homeZip = null;
  s.liveCars = s.liveCars || {};
  return s;
}

let state = load();
const listeners = new Set<() => void>();

export const getState = () => state;

export function update(fn: (s: AppState) => AppState | void) {
  const draft: AppState = { ...state, prefs: { ...state.prefs }, favs: { ...state.favs }, compare: [...state.compare], recent: [...state.recent], liveCars: { ...state.liveCars } };
  state = fn(draft) || draft;
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(state));
  } catch {
    /* storage full: keep it in memory */
  }
  listeners.forEach((l) => l());
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

export function useAppState() {
  return useSyncExternalStore(subscribe, getState, getState);
}

export const setPrefs = (p: Partial<Prefs>) => update((s) => { Object.assign(s.prefs, p); });
