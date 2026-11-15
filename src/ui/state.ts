// 介面共用的狀態：遊戲內容、稱號定義、目前的存檔，以及寫入存檔的統一入口。
import { CATEGORIES, DIFFICULTIES, type Content, type PuzzleImage } from '../core/content';
import type { SaveData } from '../core/save';
import { computeStats } from '../core/stats';
import { writeSave } from '../core/storage';
import { buildTitles, evaluateTitles, type TitleDef } from '../core/titles';
import { setSoundEnabled } from '../audio';
import imagesJson from '../content/images.json';
import { esc, toast } from './dom';
import { S } from './strings';
import { TABLE_COLORS } from './theme';

export const content: Content = { categories: CATEGORIES, difficulties: DIFFICULTIES, images: imagesJson as PuzzleImage[] };
export const defs = buildTitles(content);
export const defById = new Map(defs.map((d) => [d.id, d]));

/** 目前的存檔。各畫面直接讀取 / 修改 store.save，改完呼叫 persist()。 */
export const store = { save: null as unknown as SaveData };

let saveFailureShown = false;

/**
 * 執行一個寫入動作；失敗時不中斷遊戲，只提示一次（之後成功過才會再提示）。
 * 所有寫入裝置的動作都應經過這裡，避免失敗無聲無息。
 */
export async function safeWrite(write: () => Promise<unknown>) {
  try {
    await write();
    saveFailureShown = false;
  } catch {
    if (!saveFailureShown) {
      saveFailureShown = true;
      toast(esc(S.saveFailed), 'error', 6000);
    }
  }
}

export const persist = () => safeWrite(() => writeSave(store.save));

/** 依目前存檔重新判定稱號並套用結果；回傳本次新解鎖的稱號 id。 */
export function refreshTitles(): string[] {
  const ev = evaluateTitles(store.save, computeStats(store.save, content), content, defs);
  store.save = ev.save;
  return ev.newlyUnlocked;
}

/**
 * 新解鎖的稱號中，要在畫面上宣告（結算清單、通知、音效）的部分。
 * 獨立入口分類的專屬稱號靜默解鎖：照常存檔，但不跳通知，避免洩漏那個只能靠網址進入的入口。
 */
export const announceable = (ids: string[]) => ids.filter((id) => !defById.get(id)?.standalone);

export function applySettings() {
  const t = TABLE_COLORS.find((c) => c.id === store.save.settings.table) ?? TABLE_COLORS[0];
  document.documentElement.style.setProperty('--table', t.css);
  setSoundEnabled(store.save.settings.sound);
}

export function titleBadge(def: TitleDef | undefined, extra = '') {
  if (!def) return '';
  return `<span class="title-badge r-${def.rarity} ${extra}">${esc(def.name)}</span>`;
}
