// 稱號系統：由內容資料自動產生稱號定義，並以純函式判定解鎖 / 可見。
// 稱號名稱屬於內容資料，放在這裡與 content.ts；條件說明等介面文字由 ui/strings.ts 依 TitleCondition 產生。
import type { Content } from './content';
import { categoryCap, type Stats } from './stats';
import { comboKey, type SaveData } from './save';

export type Rarity = 'common' | 'rare' | 'epic' | 'legendary';
export type TitleLine = 'category' | 'difficulty' | 'speed' | 'collection' | 'progress';

/** 解鎖條件的結構化描述（顯示文字見 ui/strings.ts 的 titleCondition） */
export type TitleCondition =
  | { kind: 'category'; category: string; count: number }
  | { kind: 'difficulty'; label: number; count: number }
  /** tier：0 銅、1 銀、2 金 */
  | { kind: 'speed'; label: number; minutes: number; tier: number }
  | { kind: 'each-category'; categories: string[] }
  | { kind: 'all-categories' }
  | { kind: 'collector'; category: string }
  | { kind: 'all-images' }
  | { kind: 'perfect' }
  | { kind: 'progress'; pieces: number };

export interface TitleDef {
  id: string;
  name: string;
  line: TitleLine;
  rarity: Rarity;
  /** 未解鎖時顯示「???」 */
  hidden: boolean;
  condition: TitleCondition;
  /** 「全部完成」類：內容增加後可能不再滿足，需顯示「有新內容尚未完成」 */
  completionType: boolean;
  /** 依目前內容是否可能達成（不可能時圖鑑不顯示） */
  reachable: (content: Content) => boolean;
  /** 目前是否滿足條件 */
  met: (stats: Stats, content: Content) => boolean;
  /** 進度（目前值 / 目標），可選 */
  progress?: (stats: Stats, content: Content) => { value: number; target: number };
}

const CATEGORY_THRESHOLDS = [1, 3, 5, 10, 20, 30, 40, 60, 80, 100];
const CATEGORY_RARITY: Rarity[] = ['common', 'common', 'common', 'rare', 'rare', 'epic', 'epic', 'epic', 'legendary', 'legendary'];
const DIFFICULTY_THRESHOLDS = [1, 5, 10, 25, 50];
const DIFFICULTY_RARITY: Rarity[] = ['common', 'common', 'rare', 'epic', 'legendary'];
const SPEED_RARITY: Rarity[] = ['rare', 'epic', 'legendary'];
const PROGRESS_LEVELS: { pieces: number; name: string; rarity: Rarity }[] = [
  { pieces: 0, name: '見習拼圖師', rarity: 'common' },
  { pieces: 500, name: '拼圖新手', rarity: 'common' },
  { pieces: 1500, name: '拼圖學徒', rarity: 'common' },
  { pieces: 3000, name: '拼圖愛好者', rarity: 'common' },
  { pieces: 6000, name: '拼圖職人', rarity: 'rare' },
  { pieces: 10000, name: '拼圖專家', rarity: 'rare' },
  { pieces: 20000, name: '拼圖高手', rarity: 'epic' },
  { pieces: 35000, name: '拼圖大師', rarity: 'epic' },
  { pieces: 50000, name: '拼圖宗師', rarity: 'epic' },
  { pieces: 75000, name: '拼圖泰斗', rarity: 'legendary' },
  { pieces: 100000, name: '拼圖傳說', rarity: 'legendary' },
  { pieces: 150000, name: '拼圖之神', rarity: 'legendary' },
];

export const TITLE_LINES: TitleLine[] = ['category', 'difficulty', 'speed', 'collection', 'progress'];

const always = () => true;

export function buildTitles(content: Content): TitleDef[] {
  const defs: TitleDef[] = [];
  const totalCombos = content.images.length * content.difficulties.length;

  // ① 分類線
  for (const cat of content.categories) {
    CATEGORY_THRESHOLDS.forEach((t, i) => {
      defs.push({
        id: `cat-${cat.id}-${t}`,
        name: cat.titleNames[i],
        line: 'category',
        rarity: CATEGORY_RARITY[i],
        hidden: false,
        condition: { kind: 'category', category: cat.name, count: t },
        completionType: false,
        reachable: (c) => categoryCap(c, cat.id) >= t,
        met: (s) => (s.combosByCategory.get(cat.id) ?? 0) >= t,
        progress: (s) => ({ value: s.combosByCategory.get(cat.id) ?? 0, target: t }),
      });
    });
  }

  // ② 難度線
  for (const d of content.difficulties) {
    DIFFICULTY_THRESHOLDS.forEach((t, i) => {
      defs.push({
        id: `diff-${d.id}-${t}`,
        name: d.titleNames[i],
        line: 'difficulty',
        rarity: DIFFICULTY_RARITY[i],
        hidden: false,
        condition: { kind: 'difficulty', label: d.label, count: t },
        completionType: false,
        reachable: always,
        met: (s) => (s.countByDifficulty.get(d.id) ?? 0) >= t,
        progress: (s) => ({ value: s.countByDifficulty.get(d.id) ?? 0, target: t }),
      });
    });
  }

  // ③ 速度線
  for (const d of content.difficulties) {
    d.speed.forEach((sp, i) => {
      defs.push({
        id: `speed-${d.id}-${i}`,
        name: sp.name,
        line: 'speed',
        rarity: SPEED_RARITY[i],
        hidden: i === 2,
        condition: { kind: 'speed', label: d.label, minutes: sp.minutes, tier: i },
        completionType: false,
        reachable: always,
        met: (s) => {
          const f = s.fastestByDifficulty.get(d.id);
          return f !== undefined && f <= sp.minutes * 60_000;
        },
      });
    });
  }

  // ④ 蒐集線
  const originals = content.categories.filter((c) => c.original);
  defs.push({
    id: 'col-five-senses',
    name: '五感全開',
    line: 'collection',
    rarity: 'rare',
    hidden: false,
    condition: { kind: 'each-category', categories: originals.map((c) => c.name) },
    completionType: false,
    reachable: (c) => originals.every((cat) => categoryCap(c, cat.id) > 0),
    met: (s) => originals.every((cat) => (s.combosByCategory.get(cat.id) ?? 0) >= 1),
    progress: (s) => ({ value: originals.filter((cat) => (s.combosByCategory.get(cat.id) ?? 0) >= 1).length, target: originals.length }),
  });
  if (content.categories.some((c) => !c.original)) {
    defs.push({
      id: 'col-all-categories',
      name: '萬象通曉',
      line: 'collection',
      rarity: 'rare',
      hidden: false,
      condition: { kind: 'all-categories' },
      completionType: true,
      reachable: always,
      met: (s, c) => c.categories.every((cat) => (s.combosByCategory.get(cat.id) ?? 0) >= 1),
    });
  }
  for (const cat of content.categories) {
    defs.push({
      id: `col-cat-${cat.id}`,
      name: cat.collectorName,
      line: 'collection',
      rarity: 'epic',
      hidden: false,
      condition: { kind: 'collector', category: cat.name },
      completionType: true,
      reachable: (c) => categoryCap(c, cat.id) > 0,
      met: (s, c) => (s.combosByCategory.get(cat.id) ?? 0) >= categoryCap(c, cat.id),
      progress: (s, c) => ({ value: s.combosByCategory.get(cat.id) ?? 0, target: categoryCap(c, cat.id) }),
    });
  }
  defs.push({
    id: 'col-all-images',
    name: '拼圖收藏家',
    line: 'collection',
    rarity: 'epic',
    hidden: false,
    condition: { kind: 'all-images' },
    completionType: true,
    reachable: (c) => c.images.length > 0,
    met: (s, c) => c.images.every((i) => s.imagesDone.has(i.id)),
    progress: (s, c) => ({ value: c.images.filter((i) => s.imagesDone.has(i.id)).length, target: c.images.length }),
  });
  defs.push({
    id: 'col-perfect',
    name: '完美主義者',
    line: 'collection',
    rarity: 'legendary',
    hidden: true,
    condition: { kind: 'perfect' },
    completionType: true,
    reachable: () => totalCombos > 0,
    met: (s, c) => c.images.every((i) => c.difficulties.every((d) => s.combos.has(comboKey(i.id, d.id)))),
  });

  // ⑤ 總進度線
  PROGRESS_LEVELS.forEach((lv) => {
    defs.push({
      id: `progress-${lv.pieces}`,
      name: lv.name,
      line: 'progress',
      rarity: lv.rarity,
      hidden: false,
      condition: { kind: 'progress', pieces: lv.pieces },
      completionType: false,
      reachable: always,
      met: (s) => s.totalPieces >= lv.pieces,
      progress: (s) => ({ value: s.totalPieces, target: lv.pieces }),
    });
  });

  return defs;
}

export interface TitleView {
  def: TitleDef;
  unlocked: boolean;
  unlockedAt: number | null;
  /** 「全部完成」類已解鎖但目前內容尚未全部完成 */
  hasNewContent: boolean;
}

/**
 * 判定新解鎖的稱號。已解鎖者永久保留，不會被移除。
 * 回傳新的存檔與本次新解鎖的稱號 id。
 */
export function evaluateTitles(save: SaveData, stats: Stats, content: Content, defs: TitleDef[], now = Date.now()) {
  const newlyUnlocked: string[] = [];
  const unlockedTitles = { ...save.unlockedTitles };
  for (const def of defs) {
    if (unlockedTitles[def.id] !== undefined) continue;
    if (!def.reachable(content)) continue;
    if (def.met(stats, content)) {
      unlockedTitles[def.id] = now;
      newlyUnlocked.push(def.id);
    }
  }
  return { save: newlyUnlocked.length ? { ...save, unlockedTitles } : save, newlyUnlocked };
}

/** 圖鑑頁要顯示的稱號：已解鎖者一律顯示；未解鎖者需目前內容可達成。 */
export function visibleTitles(save: SaveData, stats: Stats, content: Content, defs: TitleDef[]): TitleView[] {
  const out: TitleView[] = [];
  for (const def of defs) {
    const at = save.unlockedTitles[def.id];
    const unlocked = at !== undefined;
    if (!unlocked && !def.reachable(content)) continue;
    out.push({
      def,
      unlocked,
      unlockedAt: unlocked ? at : null,
      hasNewContent: unlocked && def.completionType && !def.met(stats, content),
    });
  }
  return out;
}
