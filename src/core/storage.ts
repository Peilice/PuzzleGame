// 存檔與每局進度的儲存層。平常用 IndexedDB；無法使用時自動改用記憶體（本次遊玩不會留下存檔）。
import { SaveError, comboKey, createSave, isNum, isRecord, migrate, type SaveData } from './save';

const DB_NAME = 'puzzle-game';
const DB_VERSION = 1;
const KV = 'kv';
const PROGRESS = 'progress';
type StoreName = typeof KV | typeof PROGRESS;
const SAVE_KEY = 'save';
/** 讀不懂的存檔在被新存檔覆蓋前，原樣備份到這個鍵 */
const CORRUPT_BACKUP_KEY = 'save-corrupt';

export interface GameProgress {
  imageId: string;
  difficultyId: string;
  seed: number;
  elapsedMs: number;
  /** 每片 [x, y, group, locked(0/1)] */
  pieces: [number, number, number, number][];
  /** 托盤內的拼片索引（依托盤順序）；沒有這個欄位表示托盤是空的（舊存檔） */
  tray?: number[];
  updatedAt: number;
}

/** 驗證進度資料（來自匯入檔等不可信來源）；格式不對回傳 null。 */
export function toProgress(v: unknown): GameProgress | null {
  if (!isRecord(v)) return null;
  const { imageId, difficultyId, seed, elapsedMs, pieces, updatedAt } = v;
  if (typeof imageId !== 'string' || typeof difficultyId !== 'string' || !isNum(seed) || !isNum(elapsedMs) || elapsedMs < 0) return null;
  if (!Array.isArray(pieces)) return null;
  const n = pieces.length;
  const ok = pieces.every(
    (p) =>
      Array.isArray(p) &&
      p.length === 4 &&
      isNum(p[0]) &&
      isNum(p[1]) &&
      Number.isInteger(p[2]) &&
      p[2] >= 0 &&
      p[2] < n &&
      (p[3] === 0 || p[3] === 1),
  );
  if (!ok) return null;
  const out: GameProgress = { imageId, difficultyId, seed, elapsedMs, pieces: pieces as GameProgress['pieces'], updatedAt: isNum(updatedAt) ? updatedAt : 0 };
  // 托盤順序只確認型別；去重、越界與是否仍是單片，由遊戲載入時的 sanitizeTray 處理
  if (Array.isArray(v.tray)) out.tray = v.tray.filter((i): i is number => Number.isInteger(i));
  return out;
}

// ---------------------------------------------------------------------------
// 後端

interface Backend {
  get(store: StoreName, key: string): Promise<unknown>;
  getAll(store: StoreName): Promise<unknown[]>;
  put(store: StoreName, key: string, value: unknown): Promise<void>;
  delete(store: StoreName, key: string): Promise<void>;
  /** 以單一交易覆蓋存檔與全部進度（匯入用）；失敗時原資料不變 */
  replaceAll(save: SaveData, progress: GameProgress[]): Promise<void>;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const d = req.result;
      if (!d.objectStoreNames.contains(KV)) d.createObjectStore(KV);
      if (!d.objectStoreNames.contains(PROGRESS)) d.createObjectStore(PROGRESS);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function idbBackend(d: IDBDatabase): Backend {
  /** 交易完成（而非單一請求成功）才算寫入成功 */
  const run = <T>(stores: StoreName[], mode: IDBTransactionMode, fn: (t: IDBTransaction) => IDBRequest<T> | void) =>
    new Promise<T>((resolve, reject) => {
      const t = d.transaction(stores, mode);
      const req = fn(t);
      t.oncomplete = () => resolve((req ? req.result : undefined) as T);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
    });
  return {
    get: (store, key) => run([store], 'readonly', (t) => t.objectStore(store).get(key)),
    getAll: (store) => run([store], 'readonly', (t) => t.objectStore(store).getAll()),
    put: (store, key, value) => run<void>([store], 'readwrite', (t) => void t.objectStore(store).put(value, key)),
    delete: (store, key) => run<void>([store], 'readwrite', (t) => void t.objectStore(store).delete(key)),
    replaceAll: (save, progress) =>
      run<void>([KV, PROGRESS], 'readwrite', (t) => {
        t.objectStore(KV).put(save, SAVE_KEY);
        const ps = t.objectStore(PROGRESS);
        ps.clear();
        for (const p of progress) ps.put(p, comboKey(p.imageId, p.difficultyId));
      }),
  };
}

function memoryBackend(): Backend {
  const stores: Record<StoreName, Map<string, unknown>> = { [KV]: new Map(), [PROGRESS]: new Map() };
  // 與 IndexedDB 一樣存入 / 取出的都是複本，避免呼叫端之後的修改影響已存的資料
  const copy = <T>(v: T): T => structuredClone(v);
  return {
    get: async (store, key) => copy(stores[store].get(key)),
    getAll: async (store) => copy([...stores[store].values()]),
    put: async (store, key, value) => void stores[store].set(key, copy(value)),
    delete: async (store, key) => void stores[store].delete(key),
    replaceAll: async (save, progress) => {
      stores[KV].set(SAVE_KEY, copy(save));
      stores[PROGRESS] = new Map(progress.map((p) => [comboKey(p.imageId, p.difficultyId), copy(p)]));
    },
  };
}

let backendPromise: Promise<Backend> | null = null;
let persistent = true;

function backend(): Promise<Backend> {
  backendPromise ??= openDb().then(idbBackend, () => {
    // IndexedDB 無法使用（例如部分無痕模式）：以記憶體暫存遊玩
    persistent = false;
    return memoryBackend();
  });
  return backendPromise;
}

/** 之後的讀寫都只留在記憶體，不再碰 IndexedDB（用來保護不該被覆蓋的既有資料）。 */
export function useMemoryStorage() {
  persistent = false;
  backendPromise = Promise.resolve(memoryBackend());
}

/** 目前的存檔是否會真的寫進裝置 */
export const isPersistent = () => persistent;

// ---------------------------------------------------------------------------
// 存檔

/**
 * 啟動時存檔的異常狀況：
 * - unavailable：IndexedDB 無法使用，改以記憶體暫存。
 * - newer：既有存檔的版本比遊戲新；為了不覆蓋它，本次改以記憶體暫存。
 * - corrupt：既有存檔無法辨識；已原樣備份，改用新存檔。
 */
export type SaveIssue = 'unavailable' | 'newer' | 'corrupt';

export interface LoadResult {
  save: SaveData;
  issue: SaveIssue | null;
}

export async function loadSave(): Promise<LoadResult> {
  let b = await backend();
  let raw: unknown;
  if (persistent) {
    try {
      raw = await b.get(KV, SAVE_KEY);
    } catch {
      useMemoryStorage();
      b = await backend();
    }
  }
  if (!persistent) return { save: createSave(), issue: 'unavailable' };
  if (raw === undefined) return { save: createSave(), issue: null };
  try {
    return { save: migrate(raw), issue: null };
  } catch (e) {
    if (e instanceof SaveError && e.code === 'newer') {
      useMemoryStorage();
      return { save: createSave(), issue: 'newer' };
    }
    await b.put(KV, CORRUPT_BACKUP_KEY, raw);
    return { save: createSave(), issue: 'corrupt' };
  }
}

export const writeSave = async (save: SaveData) => (await backend()).put(KV, SAVE_KEY, save);

// ---------------------------------------------------------------------------
// 每局進度

export const loadProgress = async (imageId: string, difficultyId: string) =>
  (await (await backend()).get(PROGRESS, comboKey(imageId, difficultyId))) as GameProgress | undefined;

export const writeProgress = async (p: GameProgress) => (await backend()).put(PROGRESS, comboKey(p.imageId, p.difficultyId), p);

export const deleteProgress = async (imageId: string, difficultyId: string) =>
  (await backend()).delete(PROGRESS, comboKey(imageId, difficultyId));

export const allProgress = async () => (await (await backend()).getAll(PROGRESS)) as GameProgress[];

/** 請瀏覽器將本站資料標為持久，降低被自動清除的機會 */
export async function requestPersistence() {
  try {
    if (navigator.storage?.persist && !(await navigator.storage.persisted())) await navigator.storage.persist();
  } catch {
    /* 不支援時略過 */
  }
}

// ---------------------------------------------------------------------------
// 匯出 / 匯入

const APP_ID = 'puzzle-game';

export interface ExportFile {
  app: typeof APP_ID;
  exportedAt: number;
  save: SaveData;
  progress: GameProgress[];
}

export async function exportAll(save: SaveData): Promise<ExportFile> {
  return { app: APP_ID, exportedAt: Date.now(), save, progress: await allProgress() };
}

/**
 * 匯入存檔：先完整驗證，再以單一交易覆蓋目前資料（失敗時原資料不變）。
 * 格式不對的進度會被略過。回傳新的存檔；檔案無效時丟出 SaveError。
 */
export async function importAll(text: string): Promise<SaveData> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new SaveError('not-json');
  }
  if (!isRecord(parsed) || parsed.app !== APP_ID || !parsed.save) throw new SaveError('not-ours');
  const save = migrate(parsed.save);
  const progress = (Array.isArray(parsed.progress) ? parsed.progress : []).map(toProgress).filter((p) => p !== null);
  await (await backend()).replaceAll(save, progress);
  return save;
}
