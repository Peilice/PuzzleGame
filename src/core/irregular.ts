// 異型切割（純函式，不依賴 DOM）：
// 以 Voronoi 分區切出大小與形狀不一的拼片，每條共用邊仍有凹凸卡榫；
// 整個拼盤可限制在一個凸多邊形輪廓內（圓、六角形、拱門…），輪廓外沒有拼片。
import { invertTab, rng, traceEdge, type Layout, type Neighbor, type PieceGeom, type Tab } from './puzzle';

type Pt = [number, number];

export const SILHOUETTES = ['rect', 'circle', 'ellipse', 'hexagon', 'octagon', 'arch', 'rounded', 'diamond'] as const;
export type Silhouette = (typeof SILHOUETTES)[number];

export const isSilhouette = (v: unknown): v is Silhouette => typeof v === 'string' && (SILHOUETTES as readonly string[]).includes(v);

/** 輪廓內縮的比例，讓邊緣拼片不會貼著圖片邊 */
const MARGIN = 0.97;

const arc = (cx: number, cy: number, rx: number, ry: number, a0: number, a1: number, steps: number): Pt[] =>
  Array.from({ length: steps + 1 }, (_, k) => {
    const a = ((a0 + ((a1 - a0) * k) / steps) * Math.PI) / 180;
    return [cx + rx * Math.cos(a), cy + ry * Math.sin(a)] as Pt;
  });

/** 輪廓多邊形（世界座標，順時針、y 軸向下）。全部是凸多邊形，才能直接當 Voronoi 的裁切範圍。 */
export function silhouettePolygon(id: Silhouette, W: number, H: number): Pt[] {
  const cx = W / 2;
  const cy = H / 2;
  switch (id) {
    case 'rect':
      return [[0, 0], [W, 0], [W, H], [0, H]];
    case 'circle': {
      const r = (Math.min(W, H) / 2) * MARGIN;
      return arc(cx, cy, r, r, -90, 270, 96).slice(0, -1);
    }
    case 'ellipse':
      return arc(cx, cy, (W / 2) * MARGIN, (H / 2) * MARGIN, -90, 270, 96).slice(0, -1);
    case 'hexagon': {
      const r = (H / 2) * MARGIN;
      return arc(cx, cy, r, r, -90, 270, 6).slice(0, -1);
    }
    case 'octagon': {
      const r = ((H / 2) * MARGIN) / Math.cos(Math.PI / 8);
      return arc(cx, cy, r, r, -67.5, 292.5, 8).slice(0, -1);
    }
    case 'arch': {
      const w = W * 0.6;
      const r = w / 2;
      const top = (H * (1 - MARGIN)) / 2;
      const bottom = H - top;
      const midY = top + r;
      return [[cx - r, bottom], [cx - r, midY], ...arc(cx, midY, r, r, 180, 360, 48).slice(1, -1), [cx + r, midY], [cx + r, bottom]];
    }
    case 'rounded': {
      const m = (H * (1 - MARGIN)) / 2;
      const r = H * 0.28;
      return [
        ...arc(m + r, m + r, r, r, 180, 270, 12),
        ...arc(W - m - r, m + r, r, r, 270, 360, 12),
        ...arc(W - m - r, H - m - r, r, r, 0, 90, 12),
        ...arc(m + r, H - m - r, r, r, 90, 180, 12),
      ];
    }
    case 'diamond': {
      const mx = (W * (1 - MARGIN)) / 2;
      const my = (H * (1 - MARGIN)) / 2;
      return [[cx, my], [W - mx, cy], [cx, H - my], [mx, cy]];
    }
  }
}

export function polygonArea(poly: Pt[]): number {
  let s = 0;
  for (let k = 0; k < poly.length; k++) {
    const [x0, y0] = poly[k];
    const [x1, y1] = poly[(k + 1) % poly.length];
    s += x0 * y1 - x1 * y0;
  }
  return s / 2;
}

/** 點是否在凸多邊形（順時針）內，且離每條邊至少 margin */
function inside(poly: Pt[], x: number, y: number, margin: number): boolean {
  for (let k = 0; k < poly.length; k++) {
    const [ax, ay] = poly[k];
    const [bx, by] = poly[(k + 1) % poly.length];
    const len = Math.hypot(bx - ax, by - ay);
    if (((bx - ax) * (y - ay) - (by - ay) * (x - ax)) / len < margin) return false;
  }
  return true;
}

function bounds(poly: Pt[]) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of poly) {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  return { minX, minY, maxX, maxY };
}

/** 在輪廓內撒 n 個點：先用帶抖動的格點，再隨機刪補到剛好 n 個，讓拼片大小有落差 */
function placeSeeds(poly: Pt[], n: number, unit: number, r: () => number): Pt[] {
  const bb = bounds(poly);
  const pts: Pt[] = [];
  for (let y = bb.minY + unit / 2; y < bb.maxY; y += unit) {
    for (let x = bb.minX + unit / 2; x < bb.maxX; x += unit) {
      const px = x + (r() - 0.5) * unit * 0.8;
      const py = y + (r() - 0.5) * unit * 0.8;
      if (inside(poly, px, py, unit * 0.15)) pts.push([px, py]);
    }
  }
  while (pts.length > n) pts.splice(Math.floor(r() * pts.length), 1);
  while (pts.length < n) {
    // 最遠候選：多抽幾個點，取離現有點最遠的，補在空隙裡
    let best: Pt | null = null;
    let bestD = -1;
    for (let t = 0; t < 12; t++) {
      let c: Pt | null = null;
      for (let guard = 0; guard < 200 && !c; guard++) {
        const x = bb.minX + r() * (bb.maxX - bb.minX);
        const y = bb.minY + r() * (bb.maxY - bb.minY);
        if (inside(poly, x, y, unit * 0.15)) c = [x, y];
      }
      if (!c) continue;
      let d = Infinity;
      for (const p of pts) d = Math.min(d, (p[0] - c[0]) ** 2 + (p[1] - c[1]) ** 2);
      if (d > bestD) {
        bestD = d;
        best = c;
      }
    }
    pts.push(best ?? [(bb.minX + bb.maxX) / 2, (bb.minY + bb.maxY) / 2]);
  }
  return pts;
}

/** 帶標籤的多邊形頂點：l 為「從這個頂點出發的那條邊」的鄰居索引，-1 表示拼盤邊界 */
interface V {
  x: number;
  y: number;
  l: number;
}

/** 保留離 a 比離 b 近的半平面（Sutherland–Hodgman），新產生的切線標上標籤 j */
function clip(poly: V[], ax: number, ay: number, bx: number, by: number, j: number): V[] {
  const mx = (ax + bx) / 2;
  const my = (ay + by) / 2;
  const nx = bx - ax;
  const ny = by - ay;
  const side = (p: V) => (p.x - mx) * nx + (p.y - my) * ny;
  const out: V[] = [];
  for (let k = 0; k < poly.length; k++) {
    const p = poly[k];
    const q = poly[(k + 1) % poly.length];
    const sp = side(p);
    const sq = side(q);
    if (sp <= 0) {
      out.push({ x: p.x, y: p.y, l: p.l });
      if (sq > 0) {
        const t = sp / (sp - sq);
        out.push({ x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t, l: j });
      }
    } else if (sq <= 0) {
      const t = sp / (sp - sq);
      out.push({ x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t, l: p.l });
    }
  }
  return out;
}

/** 去掉重複的頂點（長度近 0 的邊），保留後一個頂點的標籤 */
function dedupe(poly: V[]): V[] {
  const out = poly.filter((p, k) => {
    const q = poly[(k + 1) % poly.length];
    return Math.hypot(q.x - p.x, q.y - p.y) > 1e-6;
  });
  return out.length < 3 ? [] : out;
}

function voronoi(seeds: Pt[], outline: Pt[]): V[][] {
  return seeds.map((s, i) => {
    let poly: V[] = outline.map(([x, y]) => ({ x, y, l: -1 }));
    const order = seeds
      .map((q, j) => ({ j, d: (q[0] - s[0]) ** 2 + (q[1] - s[1]) ** 2 }))
      .filter((o) => o.j !== i)
      .sort((a, b) => a.d - b.d);
    for (const { j, d } of order) {
      // 切線在 √d / 2 處；比最遠的頂點還遠就不可能再切到了
      let far = 0;
      for (const p of poly) far = Math.max(far, (p.x - s[0]) ** 2 + (p.y - s[1]) ** 2);
      if (d > 4 * far) break;
      poly = clip(poly, s[0], s[1], seeds[j][0], seeds[j][1], j);
      if (poly.length < 3) break;
    }
    return dedupe(poly);
  });
}

function centroid(poly: V[]): Pt {
  let a = 0;
  let cx = 0;
  let cy = 0;
  for (let k = 0; k < poly.length; k++) {
    const p = poly[k];
    const q = poly[(k + 1) % poly.length];
    const cross = p.x * q.y - q.x * p.y;
    a += cross;
    cx += (p.x + q.x) * cross;
    cy += (p.y + q.y) * cross;
  }
  return a === 0 ? [poly[0].x, poly[0].y] : [cx / (3 * a), cy / (3 * a)];
}

const angleAt = (poly: V[], k: number) => {
  const n = poly.length;
  const prev = poly[(k - 1 + n) % n];
  const cur = poly[k];
  const next = poly[(k + 1) % n];
  const ax = prev.x - cur.x;
  const ay = prev.y - cur.y;
  const bx = next.x - cur.x;
  const by = next.y - cur.y;
  const c = (ax * bx + ay * by) / (Math.hypot(ax, ay) * Math.hypot(bx, by));
  return Math.acos(Math.max(-1, Math.min(1, c)));
};

/** 卡榫太擠會互相撞到：邊夠長、兩端的夾角不能太尖 */
const MIN_EDGE = 0.5;
const MIN_ANGLE = 0.7; // 約 40°

const FLAT: Tab = { dir: 0, center: 0.5, size: 1, skew: 0 };

/**
 * 異型切割：count 片，拼盤為 cols × rows 個經典拼片大小的版面（與經典款同尺寸），
 * 限制在 silhouette 輪廓內。seed 決定切法與卡榫，同一個 seed 結果完全相同。
 */
export function makeIrregularLayout(cols: number, rows: number, imageAspect: number, seed: number, silhouette: Silhouette = 'rect'): Layout {
  const boardW = 100 * cols;
  const boardH = boardW / imageAspect;
  const count = cols * rows;
  const outline = silhouettePolygon(silhouette, boardW, boardH);
  const unit = Math.sqrt(polygonArea(outline) / count);
  let r = rng(seed);
  let cells: V[][] = [];
  // 極端情況下某個分區可能退化（太小或消失），那就換一組亂數重切
  for (let attempt = 0; attempt < 8; attempt++) {
    r = rng((seed + attempt * 7919) >>> 0);
    let seeds = placeSeeds(outline, count, unit, r);
    // 鬆弛一次：拼片的大小比較均勻，但保留落差
    seeds = voronoi(seeds, outline).map((cell, i) => (cell.length ? centroid(cell) : seeds[i]));
    cells = voronoi(seeds, outline);
    const minArea = unit * unit * 0.12;
    if (cells.every((c) => c.length >= 3 && Math.abs(polygonArea(c.map((v) => [v.x, v.y] as Pt))) >= minArea)) break;
  }

  // 每一對相鄰拼片共用一個卡榫（以索引小的為準）；邊太短或夾角太尖的改成平邊
  const edgeOk = (cell: V[], k: number) => {
    const p = cell[k];
    const q = cell[(k + 1) % cell.length];
    return Math.hypot(q.x - p.x, q.y - p.y) >= MIN_EDGE * unit && angleAt(cell, k) >= MIN_ANGLE && angleAt(cell, (k + 1) % cell.length) >= MIN_ANGLE;
  };
  const pairTab = new Map<number, Tab | null>();
  cells.forEach((cell, i) => {
    cell.forEach((v, k) => {
      const j = v.l;
      if (j <= i) return;
      const m = cells[j].findIndex((u) => u.l === i);
      const ok = m >= 0 && edgeOk(cell, k) && edgeOk(cells[j], m);
      pairTab.set(i * count + j, ok ? { dir: r() < 0.5 ? 1 : -1, center: 0.5 + (r() - 0.5) * 0.12, size: 0.85 + r() * 0.2, skew: (r() - 0.5) * 0.1 } : null);
    });
  });

  // 本體外框左上角當作拼片的位置
  const anchors = cells.map((cell) => {
    const b = bounds(cell.map((v) => [v.x, v.y] as Pt));
    return { x: b.minX, y: b.minY, w: b.maxX - b.minX, h: b.maxY - b.minY };
  });

  const geoms: PieceGeom[] = cells.map((cell, i) => {
    const a = anchors[i];
    const rel = cell.map((v) => [v.x - a.x, v.y - a.y] as Pt);
    const neighbors: Neighbor[] = [];
    for (const v of cell) if (v.l >= 0) neighbors.push({ i: v.l, dx: anchors[v.l].x - a.x, dy: anchors[v.l].y - a.y });
    const tabs: Tab[] = cell.map((v) => {
      if (v.l < 0) return FLAT;
      const t = pairTab.get(Math.min(i, v.l) * count + Math.max(i, v.l)) ?? null;
      if (!t) return FLAT;
      return i < v.l ? t : invertTab(t);
    });
    return {
      x: a.x,
      y: a.y,
      w: a.w,
      h: a.h,
      neighbors,
      edge: cell.some((v) => v.l < 0),
      trace(p) {
        p.moveTo(rel[0][0], rel[0][1]);
        for (let k = 0; k < rel.length; k++) {
          const [x0, y0] = rel[k];
          const [x1, y1] = rel[(k + 1) % rel.length];
          const len = Math.hypot(x1 - x0, y1 - y0);
          // 順時針走向時，往外的法線是 (uy, -ux)
          traceEdge(p, tabs[k], x0, y0, x1, y1, (y1 - y0) / len, -(x1 - x0) / len, len, unit);
        }
        p.closePath();
      },
    };
  });

  return {
    cols,
    rows,
    pw: Math.max(...anchors.map((a) => a.w)),
    ph: Math.max(...anchors.map((a) => a.h)),
    unit,
    boardW,
    boardH,
    geoms,
    outline: silhouette === 'rect' ? null : outline,
  };
}
