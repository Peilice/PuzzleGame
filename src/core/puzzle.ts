// 拼圖幾何與狀態邏輯（純函式，不依賴 DOM）。

/** mulberry32：可重現的亂數產生器 */
export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 卡榫：dir = 1 往外凸、-1 往內凹、0 平邊；其餘為形狀微調參數 */
export interface Tab {
  dir: -1 | 0 | 1;
  /** 卡榫中心沿邊的位置（0.5 為中央） */
  center: number;
  /** 卡榫大小倍率 */
  size: number;
  /** 頸部偏移 */
  skew: number;
}

const FLAT: Tab = { dir: 0, center: 0.5, size: 1, skew: 0 };

export interface PieceEdges {
  top: Tab;
  right: Tab;
  bottom: Tab;
  left: Tab;
}

/**
 * 從相鄰拼片的角度看同一條邊：凹凸相反。
 * tracePiece 以順時針描邊，共用邊在兩片中的走向相反（例如上片的下邊由右往左、下片的上邊由左往右），
 * 所以沿邊的參數也要鏡射：center → 1 - center、skew → -skew，切割線才會在世界座標重合。
 */
const invert = (t: Tab): Tab => ({ dir: (-t.dir) as Tab['dir'], center: 1 - t.center, size: t.size, skew: -t.skew });

/** 產生所有拼片的邊；相鄰兩片共享同一條邊的參數，方向相反（互補）。 */
export function generateEdges(cols: number, rows: number, seed: number): PieceEdges[] {
  const r = rng(seed);
  const mk = (): Tab => ({
    dir: r() < 0.5 ? 1 : -1,
    center: 0.5 + (r() - 0.5) * 0.12,
    size: 0.9 + r() * 0.2,
    skew: (r() - 0.5) * 0.1,
  });
  // horizontal[r][c]：第 r 列與第 r+1 列之間、第 c 欄的邊（從上方拼片看）
  const horizontal: Tab[][] = [];
  for (let y = 0; y < rows - 1; y++) horizontal.push(Array.from({ length: cols }, mk));
  // vertical[r][c]：第 c 欄與第 c+1 欄之間、第 r 列的邊（從左方拼片看）
  const vertical: Tab[][] = [];
  for (let y = 0; y < rows; y++) vertical.push(Array.from({ length: cols - 1 }, mk));

  const out: PieceEdges[] = [];
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      out.push({
        top: y === 0 ? FLAT : invert(horizontal[y - 1][x]),
        bottom: y === rows - 1 ? FLAT : horizontal[y][x],
        left: x === 0 ? FLAT : invert(vertical[y][x - 1]),
        right: x === cols - 1 ? FLAT : vertical[y][x],
      });
    }
  }
  return out;
}

/** 拼片索引 → 所在的欄、列 */
export const cellOf = (index: number, cols: number) => ({ col: index % cols, row: Math.floor(index / cols) });

export const isEdgePiece = (index: number, cols: number, rows: number) => {
  const { col, row } = cellOf(index, cols);
  return col === 0 || row === 0 || col === cols - 1 || row === rows - 1;
};

/** 卡榫最多凸出拼片尺寸的比例（繪圖時的留白） */
export const TAB_EXTENT = 0.28;

type PathSink = {
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  bezierCurveTo(c1x: number, c1y: number, c2x: number, c2y: number, x: number, y: number): void;
  closePath(): void;
};

/**
 * 將一片拼片的輪廓寫入 path（拼片左上角為原點，寬 w、高 h）。
 * 每條邊以「沿邊方向 u、法線方向 v」的局部座標描述，v 為正代表往外。
 */
export function tracePiece(p: PathSink, e: PieceEdges, w: number, h: number) {
  p.moveTo(0, 0);
  edge(p, e.top, 0, 0, w, 0, 0, -1, w, h);
  edge(p, e.right, w, 0, w, h, 1, 0, h, w);
  edge(p, e.bottom, w, h, 0, h, 0, 1, w, h);
  edge(p, e.left, 0, h, 0, 0, -1, 0, h, w);
  p.closePath();
}

function edge(
  p: PathSink,
  t: Tab,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  nx: number,
  ny: number,
  len: number,
  other: number,
) {
  if (t.dir === 0) {
    p.lineTo(x1, y1);
    return;
  }
  const ux = (x1 - x0) / len;
  const uy = (y1 - y0) / len;
  const s = Math.min(len, other) * t.size;
  const d = t.dir;
  // (u, v) → 世界座標；u 沿邊、v 往外（d = -1 時往內凹）
  const P = (u: number, v: number): [number, number] => [x0 + ux * u + nx * v * d, y0 + uy * u + ny * v * d];
  const c = len * t.center;
  const k = t.skew * s;
  const bz = (a: [number, number], b: [number, number], e: [number, number]) => p.bezierCurveTo(a[0], a[1], b[0], b[1], e[0], e[1]);
  const s0 = P(c - 0.1 * s, 0);
  p.lineTo(s0[0], s0[1]);
  bz(P(c - 0.06 * s, 0.03 * s), P(c - 0.18 * s + k, 0.08 * s), P(c - 0.16 * s + k, 0.16 * s));
  bz(P(c - 0.14 * s + k, 0.25 * s), P(c + 0.14 * s + k, 0.25 * s), P(c + 0.16 * s + k, 0.16 * s));
  bz(P(c + 0.18 * s + k, 0.08 * s), P(c + 0.06 * s, 0.03 * s), P(c + 0.1 * s, 0));
  p.lineTo(x1, y1);
}

// ---------------------------------------------------------------------------
// 拼盤狀態

export interface PieceState {
  /** 拼片左上角的世界座標 */
  x: number;
  y: number;
  group: number;
  locked: boolean;
  /** 在托盤裡（不在桌面上）。只存在於執行期；存檔另外記托盤的順序 */
  tray?: boolean;
}

export interface Layout {
  cols: number;
  rows: number;
  /** 拼片寬高（世界座標） */
  pw: number;
  ph: number;
  /** 拼盤左上角在世界座標的位置（固定為 0,0） */
  boardW: number;
  boardH: number;
}

export function makeLayout(cols: number, rows: number, imageAspect = 4 / 3): Layout {
  const pw = 100;
  const boardW = pw * cols;
  const boardH = boardW / imageAspect;
  return { cols, rows, pw, ph: boardH / rows, boardW, boardH };
}

export const correctPos = (L: Layout, i: number) => {
  const { col, row } = cellOf(i, L.cols);
  return { x: col * L.pw, y: row * L.ph };
};

/** 吸附容差（世界座標）：拼片較短邊的 22% */
const snapTolerance = (L: Layout) => Math.min(L.pw, L.ph) * 0.22;

function groupMembers(pieces: PieceState[], group: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < pieces.length; i++) if (pieces[i].group === group) out.push(i);
  return out;
}

export function moveGroup(pieces: PieceState[], group: number, dx: number, dy: number) {
  for (const p of pieces) {
    if (p.group === group) {
      p.x += dx;
      p.y += dy;
    }
  }
}

export interface DropResult {
  /** 是否與其他拼片合併 */
  merged: boolean;
  /** 是否鎖定到正確位置 */
  locked: boolean;
  /** 本次之後所在的組 */
  group: number;
}

/**
 * 放下一組拼片時呼叫：檢查與相鄰拼片的吸附、合併、是否到位鎖定。
 * 會直接修改 pieces。
 */
export function dropGroup(pieces: PieceState[], L: Layout, group: number): DropResult {
  const tol = snapTolerance(L);
  let merged = false;
  let changed = true;
  // 反覆檢查，因為合併後的新組可能又能和其他組吸附
  while (changed) {
    changed = false;
    const members = groupMembers(pieces, group);
    outer: for (const i of members) {
      const { col, row } = cellOf(i, L.cols);
      const neighbors: [number, number, number][] = [];
      if (col > 0) neighbors.push([i - 1, -L.pw, 0]);
      if (col < L.cols - 1) neighbors.push([i + 1, L.pw, 0]);
      if (row > 0) neighbors.push([i - L.cols, 0, -L.ph]);
      if (row < L.rows - 1) neighbors.push([i + L.cols, 0, L.ph]);
      for (const [n, ex, ey] of neighbors) {
        const np = pieces[n];
        if (np.group === group || np.tray) continue;
        const dx = np.x - (pieces[i].x + ex);
        const dy = np.y - (pieces[i].y + ey);
        if (Math.abs(dx) <= tol && Math.abs(dy) <= tol) {
          if (np.locked) {
            // 對齊到已鎖定的拼片 → 整組移到正確位置並鎖定
            moveGroup(pieces, group, dx, dy);
            for (const p of pieces) if (p.group === group) p.group = np.group;
            group = np.group;
          } else {
            // 把對方的組併進來，對齊到自己
            const other = np.group;
            moveGroup(pieces, other, -dx, -dy);
            for (const p of pieces) if (p.group === other) p.group = group;
          }
          merged = true;
          changed = true;
          break outer;
        }
      }
    }
  }
  // 檢查是否到位
  const members = groupMembers(pieces, group);
  let locked = members.some((m) => pieces[m].locked);
  if (!locked) {
    const i = members[0];
    const c = correctPos(L, i);
    const dx = c.x - pieces[i].x;
    const dy = c.y - pieces[i].y;
    if (Math.abs(dx) <= tol && Math.abs(dy) <= tol) {
      moveGroup(pieces, group, dx, dy);
      locked = true;
    }
  }
  if (locked) for (const m of members) pieces[m].locked = true;
  return { merged, locked, group };
}

export const isComplete = (pieces: PieceState[]) => pieces.every((p) => p.locked);

/** Fisher–Yates 洗牌（直接修改陣列） */
function shuffleInPlace<T>(a: T[], r: () => number): T[] {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * 把散片隨機排列到拼盤四周的環狀區域（會直接修改 pieces）。
 * targets：要排列的拼片。
 */
export function arrangeAround(pieces: PieceState[], L: Layout, targets: number[], seed: number) {
  const r = rng(seed);
  const order = shuffleInPlace([...targets], r);
  const slotW = L.pw * 1.45;
  const slotH = L.ph * 1.45;
  const slots = ringSlots(L, slotW, slotH, order.length);
  order.forEach((idx, k) => {
    const s = slots[k];
    pieces[idx].x = s.x + (r() - 0.5) * L.pw * 0.25;
    pieces[idx].y = s.y + (r() - 0.5) * L.ph * 0.25;
  });
}

/** 在拼盤外圍逐圈產生 n 個格位（左上角座標），內圈優先 */
function ringSlots(L: Layout, slotW: number, slotH: number, n: number) {
  const slots: { x: number; y: number }[] = [];
  const gap = L.pw * 0.6;
  let ring = 0;
  while (slots.length < n) {
    const left = -gap - slotW * (ring + 1);
    const top = -gap - slotH * (ring + 1);
    const right = L.boardW + gap + slotW * ring;
    const bottom = L.boardH + gap + slotH * ring;
    const cols = Math.round((right + slotW - left) / slotW);
    const rows = Math.round((bottom + slotH - top) / slotH);
    for (let c = 0; c < cols; c++) slots.push({ x: left + c * slotW, y: top });
    for (let rr = 1; rr < rows - 1; rr++) slots.push({ x: right, y: top + rr * slotH });
    for (let c = cols - 1; c >= 0; c--) slots.push({ x: left + c * slotW, y: bottom });
    for (let rr = rows - 2; rr >= 1; rr--) slots.push({ x: left, y: top + rr * slotH });
    ring++;
  }
  return slots.slice(0, n);
}

/** 建立新局：所有拼片各自成組並散放在拼盤四周 */
export function newPieces(L: Layout, seed: number): PieceState[] {
  const n = L.cols * L.rows;
  const pieces: PieceState[] = Array.from({ length: n }, (_, i) => ({ x: 0, y: 0, group: i, locked: false }));
  arrangeAround(pieces, L, pieces.map((_, i) => i), seed);
  return pieces;
}

/** 桌面範圍（所有拼片的外框，加上拼盤） */
export function tableBounds(pieces: PieceState[], L: Layout) {
  let minX = 0;
  let minY = 0;
  let maxX = L.boardW;
  let maxY = L.boardH;
  for (const p of pieces) {
    if (p.tray) continue;
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x + L.pw);
    maxY = Math.max(maxY, p.y + L.ph);
  }
  return { minX, minY, maxX, maxY };
}

// ---------------------------------------------------------------------------
// 托盤：像盒蓋一樣放散片。順序是隨機的，不會依顏色或特徵排序，分類要靠玩家自己拿出來。
// 這些函式直接修改 pieces 與 order（托盤內拼片索引的順序）。

/** 用種子產生 0..n-1 的隨機順序，作為托盤的初始順序 */
export function shuffledOrder(n: number, seed: number): number[] {
  return shuffleInPlace(
    Array.from({ length: n }, (_, i) => i),
    rng((seed ^ 0x9e3779b9) >>> 0),
  );
}

function groupSizes(pieces: PieceState[]) {
  const sizes = new Map<number, number>();
  for (const p of pieces) sizes.set(p.group, (sizes.get(p.group) ?? 0) + 1);
  return sizes;
}

/** 桌面上未鎖定、也沒有和別片合併的單片（可以放進托盤的拼片） */
export function looseSingles(pieces: PieceState[]): number[] {
  const sizes = groupSizes(pieces);
  const out: number[] = [];
  pieces.forEach((p, i) => {
    if (!p.locked && !p.tray && sizes.get(p.group) === 1) out.push(i);
  });
  return out;
}

/** 整理來源不可信的托盤順序（存檔、匯入檔）：去掉重複、越界，以及已鎖定或已合併的拼片 */
export function sanitizeTray(tray: unknown, pieces: PieceState[]): number[] {
  if (!Array.isArray(tray)) return [];
  const sizes = groupSizes(pieces);
  const seen = new Set<number>();
  const out: number[] = [];
  for (const v of tray) {
    if (!Number.isInteger(v) || v < 0 || v >= pieces.length || seen.has(v)) continue;
    const p = pieces[v];
    if (p.locked || sizes.get(p.group) !== 1) continue;
    seen.add(v);
    out.push(v);
  }
  return out;
}

/** 把一片單片放進托盤（接在最後）。已在托盤、已鎖定或已合併的拼片不處理，回傳 false。 */
export function enterTray(pieces: PieceState[], order: number[], index: number): boolean {
  const p = pieces[index];
  if (!p || p.tray || p.locked || groupMembers(pieces, p.group).length !== 1) return false;
  p.tray = true;
  order.push(index);
  return true;
}

/** 把一片從托盤拿出來，放到桌面上的 (x, y)（拼片左上角的世界座標） */
export function leaveTray(pieces: PieceState[], order: number[], index: number, x: number, y: number): boolean {
  const at = order.indexOf(index);
  if (at < 0) return false;
  order.splice(at, 1);
  pieces[index].tray = false;
  pieces[index].x = x;
  pieces[index].y = y;
  return true;
}

/** 把桌面上的散片全部收回托盤，整個托盤重新洗牌 */
export function gatherToTray(pieces: PieceState[], order: number[], seed: number) {
  for (const i of looseSingles(pieces)) {
    pieces[i].tray = true;
    order.push(i);
  }
  shuffleInPlace(order, rng(seed));
}

/**
 * 回傳一份拼片副本，托盤內的拼片放在拼盤外圍的環上。
 * 存檔時用：托盤只是新版的概念，舊版或托盤資料損毀時，這些拼片仍會落在桌面上，不會消失。
 */
export function withTrayFallback(pieces: PieceState[], L: Layout, order: number[], seed: number): PieceState[] {
  const copy = pieces.map((p) => ({ ...p }));
  arrangeAround(copy, L, order, seed);
  return copy;
}

/** 拼片的繪製留白（卡榫凸出的部分） */
export const piecePad = (L: Layout) => TAB_EXTENT * Math.min(L.pw, L.ph) + 4;

export interface TrayGeometry {
  cols: number;
  cellW: number;
  cellH: number;
  gap: number;
  /** 拼片在托盤中的縮放（世界單位 → 螢幕 px） */
  scale: number;
  contentH: number;
}

/** 托盤的格子排列：innerW 是可用寬度（px），拼片含卡榫留白各佔一格 */
export function trayGeometry(L: Layout, innerW: number, count: number): TrayGeometry {
  const pad = piecePad(L);
  const cols = innerW >= 240 ? 3 : 2;
  const gap = 6;
  const cellW = (innerW - (cols - 1) * gap) / cols;
  const scale = cellW / (L.pw + 2 * pad);
  const cellH = (L.ph + 2 * pad) * scale;
  const rows = Math.ceil(count / cols);
  return { cols, cellW, cellH, gap, scale, contentH: rows > 0 ? rows * cellH + (rows - 1) * gap : 0 };
}

/** 內容座標（相對於托盤內容左上角）落在第幾格；不在任何格子上回傳 -1 */
export function trayCellAt(g: TrayGeometry, count: number, x: number, y: number): number {
  if (x < 0 || y < 0) return -1;
  const col = Math.floor(x / (g.cellW + g.gap));
  const row = Math.floor(y / (g.cellH + g.gap));
  if (col >= g.cols) return -1;
  if (x - col * (g.cellW + g.gap) > g.cellW || y - row * (g.cellH + g.gap) > g.cellH) return -1;
  const k = row * g.cols + col;
  return k < count ? k : -1;
}
