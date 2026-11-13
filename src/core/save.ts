// 存檔資料結構與純函式操作（不含 IndexedDB I/O）。

export const SAVE_VERSION = 1;

export interface Completion {
  imageId: string;
  difficultyId: string;
  /** 實際片數 */
  pieces: number;
  timeMs: number;
  /** 完成時間（epoch ms） */
  at: number;
  /** 使用過的輔助功能；目前一律為空陣列 */
  assistsUsed: string[];
}

export interface Settings {
  sound: boolean;
  table: string;
  /** 遊戲畫面是否顯示操作提示 */
  showHints: boolean;
}

export interface SaveData {
  version: number;
  profile: {
    id: string;
    equippedTitle: string;
  };
  completions: Completion[];
  /** key: comboKey(imageId, difficultyId) → 最佳時間 ms */
  best: Record<string, number>;
  /** 已解鎖稱號 → 解鎖時間；一旦解鎖永久保留 */
  unlockedTitles: Record<string, number>;
  totalPlayMs: number;
  settings: Settings;
}

/** 「圖片 × 難度」組合的鍵；存檔、進度與統計共用 */
export const comboKey = (imageId: string, difficultyId: string) => `${imageId}|${difficultyId}`;

export const INITIAL_TITLE = 'progress-0';

/** 存檔無法讀取的原因；對應的顯示文字在 ui/strings.ts */
export type SaveErrorCode = 'not-json' | 'not-ours' | 'format' | 'no-version' | 'newer';

export class SaveError extends Error {
  constructor(readonly code: SaveErrorCode) {
    super(`save error: ${code}`);
    this.name = 'SaveError';
  }
}

export function createSave(now = Date.now()): SaveData {
  return {
    version: SAVE_VERSION,
    profile: { id: 'default', equippedTitle: INITIAL_TITLE },
    completions: [],
    best: {},
    unlockedTitles: { [INITIAL_TITLE]: now },
    totalPlayMs: 0,
    settings: { sound: true, table: 'oak', showHints: true },
  };
}

export const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
export const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

const pick = <T>(v: unknown, ok: (x: unknown) => x is T, fallback: T): T => (ok(v) ? v : fallback);
const isStr = (v: unknown): v is string => typeof v === 'string';
const isBool = (v: unknown): v is boolean => typeof v === 'boolean';

/** 只留下值為非負有限數字的欄位 */
function numberRecord(v: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (isRecord(v)) for (const [k, n] of Object.entries(v)) if (isNum(n) && n >= 0) out[k] = n;
  return out;
}

function toCompletion(v: unknown): Completion | null {
  if (!isRecord(v)) return null;
  const { imageId, difficultyId, pieces, timeMs, at, assistsUsed } = v;
  if (!isStr(imageId) || !isStr(difficultyId) || !isNum(pieces) || pieces <= 0 || !isNum(timeMs) || timeMs < 0) return null;
  return {
    imageId,
    difficultyId,
    pieces,
    timeMs,
    at: isNum(at) ? at : 0,
    assistsUsed: Array.isArray(assistsUsed) ? assistsUsed.filter(isStr) : [],
  };
}

/**
 * 將任意舊版本 / 不完整的存檔升級為目前版本。無法辨識時丟出 SaveError。
 * 型別不對的欄位以預設值取代、壞掉的完成紀錄會被略過，確保回傳值可以安全地拿去計算。
 */
export function migrate(raw: unknown): SaveData {
  if (!isRecord(raw)) throw new SaveError('format');
  if (typeof raw.version !== 'number') throw new SaveError('no-version');
  if (raw.version > SAVE_VERSION) throw new SaveError('newer');
  const base = createSave();
  const profile = isRecord(raw.profile) ? raw.profile : {};
  const settings = isRecord(raw.settings) ? raw.settings : {};
  // v1：目前唯一版本；補齊缺漏欄位即可。日後新增版本時在此依序升級。
  return {
    version: SAVE_VERSION,
    profile: {
      id: pick(profile.id, isStr, base.profile.id),
      equippedTitle: pick(profile.equippedTitle, isStr, base.profile.equippedTitle),
    },
    completions: Array.isArray(raw.completions) ? raw.completions.map(toCompletion).filter((c) => c !== null) : [],
    best: numberRecord(raw.best),
    unlockedTitles: { ...base.unlockedTitles, ...numberRecord(raw.unlockedTitles) },
    totalPlayMs: isNum(raw.totalPlayMs) && raw.totalPlayMs >= 0 ? raw.totalPlayMs : 0,
    settings: {
      sound: pick(settings.sound, isBool, base.settings.sound),
      table: pick(settings.table, isStr, base.settings.table),
      showHints: pick(settings.showHints, isBool, base.settings.showHints),
    },
  };
}

export interface CompletionResult {
  save: SaveData;
  isNewBest: boolean;
  previousBest: number | null;
}

/** 記錄一次完成（回傳新的存檔物件，不修改原物件）。 */
export function recordCompletion(save: SaveData, c: Completion): CompletionResult {
  const key = comboKey(c.imageId, c.difficultyId);
  const previousBest = save.best[key] ?? null;
  const isNewBest = previousBest === null || c.timeMs < previousBest;
  return {
    save: {
      ...save,
      completions: [...save.completions, c],
      best: isNewBest ? { ...save.best, [key]: c.timeMs } : save.best,
    },
    isNewBest,
    previousBest,
  };
}
