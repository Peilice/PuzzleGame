// 由存檔推導出的統計數字，供稱號判定與統計頁使用。
import type { Content } from './content';
import { comboKey, type SaveData } from './save';

export interface Stats {
  /** 已完成的不重複組合（comboKey） */
  combos: Set<string>;
  /** 分類 → 已完成不重複組合數 */
  combosByCategory: Map<string, number>;
  /** 至少完成一次的圖片 */
  imagesDone: Set<string>;
  /** 難度 → 完成次數（含重複） */
  countByDifficulty: Map<string, number>;
  /** 難度 → 不重複組合數 */
  combosByDifficulty: Map<string, number>;
  /** 難度 → 最快時間 ms */
  fastestByDifficulty: Map<string, number>;
  totalPieces: number;
  totalCompletions: number;
}

const inc = (m: Map<string, number>, k: string, by = 1) => m.set(k, (m.get(k) ?? 0) + by);

export function computeStats(save: SaveData, content: Content): Stats {
  const imageCat = new Map(content.images.map((i) => [i.id, i.category]));
  const s: Stats = {
    combos: new Set(),
    combosByCategory: new Map(),
    imagesDone: new Set(),
    countByDifficulty: new Map(),
    combosByDifficulty: new Map(),
    fastestByDifficulty: new Map(),
    totalPieces: 0,
    totalCompletions: 0,
  };
  for (const c of save.completions) {
    s.totalPieces += c.pieces;
    s.totalCompletions += 1;
    inc(s.countByDifficulty, c.difficultyId);
    const prevFast = s.fastestByDifficulty.get(c.difficultyId);
    if (prevFast === undefined || c.timeMs < prevFast) s.fastestByDifficulty.set(c.difficultyId, c.timeMs);
    const cat = imageCat.get(c.imageId);
    if (cat === undefined) continue; // 已移除的圖片：只計入總進度與次數
    const key = comboKey(c.imageId, c.difficultyId);
    if (!s.combos.has(key)) {
      s.combos.add(key);
      inc(s.combosByCategory, cat);
      inc(s.combosByDifficulty, c.difficultyId);
    }
    s.imagesDone.add(c.imageId);
  }
  return s;
}

/** 某分類目前內容可達到的組合上限 */
export function categoryCap(content: Content, categoryId: string): number {
  return content.images.filter((i) => i.category === categoryId).length * content.difficulties.length;
}
