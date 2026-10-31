/*
  SAVED COPY OF THE SHEET (phones only)

  Every visit downloads the whole Google Sheet before anything shows, which on mobile data can take
  a while. So on a phone the app keeps the last download on the phone itself, shows it straight
  away on the next visit, and swaps in the fresh download when it arrives.

  Where it is kept: IndexedDB, a small database every browser gives each website. Unlike the
  simpler localStorage (about 5 MB, text only) it holds tens of megabytes and stores the data
  exactly as the app uses it, including the Maps inside the EDO bond data, so nothing has to be
  converted on the way in or out.

  Desktop never reads or writes it: the caller only uses these on a phone-width screen.

  Everything here fails quietly. A private window, a full phone or a blocked database just means
  "no saved copy", and the app downloads as it always did.
*/

import type { ParsedData } from './fetchData';

const DB_NAME = 'portfolio-backtester';
const STORE = 'sheet';
const KEY = 'last';

// Bump this whenever the shape of ParsedData changes (a field added, renamed or re-typed). A copy
// saved by the older code is then ignored instead of being fed to code that expects the new shape.
const SAVED_SHEET_VERSION = 1;

interface SavedSheet {
  version: number;
  savedAt: number;   // when it was downloaded, in milliseconds since 1970 (Date.now())
  data: ParsedData;
}

// Same width as Tailwind's "max-md:" classes, which is what every phone-only style in the app uses
export const isPhoneScreen = (): boolean =>
  typeof window !== 'undefined' && window.matchMedia('(max-width: 767px)').matches;

// Opens (and on the very first visit creates) the database with its one storage "table"
function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** The copy saved last time with when it was downloaded, or null if there is none (or it can't be read). */
export async function readSavedSheet(): Promise<{ data: ParsedData; savedAt: Date } | null> {
  try {
    const db = await openDb();
    const saved = await new Promise<SavedSheet | undefined>((resolve, reject) => {
      const req = db.transaction(STORE, 'readonly').objectStore(STORE).get(KEY);
      req.onsuccess = () => resolve(req.result as SavedSheet | undefined);
      req.onerror = () => reject(req.error);
    });
    db.close();
    if (!saved || saved.version !== SAVED_SHEET_VERSION || !saved.data) return null;
    return { data: saved.data, savedAt: new Date(saved.savedAt) };
  } catch {
    return null;
  }
}

/** Keeps this download for next time, replacing the previous copy. */
export async function saveSheet(data: ParsedData): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      const record: SavedSheet = { version: SAVED_SHEET_VERSION, savedAt: Date.now(), data };
      tx.objectStore(STORE).put(record, KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch {
    // Not saved this time; the next visit simply downloads as usual
  }
}
