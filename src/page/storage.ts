import type { PaintFile } from '../lib';

/**
 * What the page keeps on this device (#167, design note `docs/design/painter-on-the-page.md` §8):
 * the one place it reads and writes the browser's storage beyond the theme's `mt-theme`, which
 * `theme.js` owns. An unsaved painting, as a paint file's contents (no pixels) with the files'
 * names, in IndexedDB; the last colours painted with in `localStorage`. Every call is guarded: a
 * storage that is missing, blocked, full or throwing gives null or does nothing, and the page never
 * shows an error for it. Nothing here is sent anywhere. No DOM.
 */

/** The unsaved painting: a paint file's contents and what the person would recognise it by. */
export interface UnsavedPainting {
  file: PaintFile;
  /** The files' names in the file's order, so the offer can name them. */
  names: string[];
  /** When it was last written, ms since the epoch. */
  at: number;
}

/** The colours the palette keeps across minis and visits, newest first. _(proposal)_ */
export const PALETTE_MAX = 16;
export const DB_NAME = 'polywash';
export const STORE_UNSAVED = 'unsaved';
/** The one record's key: one unsaved painting on this device. _(proposal)_ */
const UNSAVED_KEY = 'painting';
export const PALETTE_KEY = 'mt-palette';
const HEX = /^#[0-9a-f]{6}$/;

/** Under `?dev` a failed storage call says so in the console; otherwise nothing. */
let warn: (message: string) => void = () => {};
export function warnWith(log: (message: string) => void): void {
  warn = log;
}

/** The database, opened once; null where IndexedDB is missing or refused. */
let database: Promise<IDBDatabase | null> | null = null;

function openDatabase(): Promise<IDBDatabase | null> {
  database ??= new Promise<IDBDatabase | null>((resolve) => {
    try {
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => request.result.createObjectStore(STORE_UNSAVED);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => {
        warn(`storage: ${request.error?.message ?? 'IndexedDB refused'}`);
        resolve(null);
      };
      request.onblocked = () => resolve(null);
    } catch (error) {
      warn(`storage: ${error instanceof Error ? error.message : String(error)}`);
      resolve(null);
    }
  });
  return database;
}

/** One request on the store, guarded: its result, or null when anything fails. */
async function withStore<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T | null> {
  const db = await openDatabase();
  if (!db) return null;
  return new Promise<T | null>((resolve) => {
    try {
      const request = run(db.transaction(STORE_UNSAVED, mode).objectStore(STORE_UNSAVED));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => {
        warn(`storage: ${request.error?.message ?? 'request failed'}`);
        resolve(null);
      };
    } catch (error) {
      warn(`storage: ${error instanceof Error ? error.message : String(error)}`);
      resolve(null);
    }
  });
}

export async function readUnsaved(): Promise<UnsavedPainting | null> {
  const record = await withStore<unknown>('readonly', (store) => store.get(UNSAVED_KEY));
  return isUnsaved(record) ? record : null;
}

export async function writeUnsaved(painting: UnsavedPainting): Promise<void> {
  await withStore('readwrite', (store) => store.put(painting, UNSAVED_KEY));
}

export async function forgetUnsaved(): Promise<void> {
  await withStore('readwrite', (store) => store.delete(UNSAVED_KEY));
}

/** Whether a stored value has the record's shape: anything else is as if there were none. */
export function isUnsaved(value: unknown): value is UnsavedPainting {
  const record = value as Partial<UnsavedPainting> | null;
  return (
    typeof record === 'object' &&
    record !== null &&
    typeof record.at === 'number' &&
    Array.isArray(record.names) &&
    record.names.every((name) => typeof name === 'string') &&
    typeof record.file === 'object' &&
    record.file !== null &&
    Array.isArray(record.file.sources) &&
    Array.isArray(record.file.steps)
  );
}

/** The palette kept on this device, newest first; empty when there is none or storage is refused. */
export function readPalette(): string[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(PALETTE_KEY) ?? '[]');
    if (!Array.isArray(value)) return [];
    return value.filter(
      (colour): colour is string => typeof colour === 'string' && HEX.test(colour),
    );
  } catch (error) {
    warn(`storage: ${error instanceof Error ? error.message : String(error)}`);
    return [];
  }
}

export function writePalette(colours: readonly string[]): void {
  try {
    localStorage.setItem(PALETTE_KEY, JSON.stringify(colours.slice(0, PALETTE_MAX)));
  } catch (error) {
    warn(`storage: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/** `colour` first, the rest after it, each once, at most `max`: the palette after a step. Pure. */
export function withColour(
  palette: readonly string[],
  colour: string,
  max = PALETTE_MAX,
): string[] {
  const hex = colour.trim().toLowerCase();
  return [hex, ...palette.filter((other) => other.toLowerCase() !== hex)].slice(0, max);
}
