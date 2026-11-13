// Canvas 拼圖遊戲：繪製、拖曳、縮放平移、吸附與完成判定。
import {
  TAB_EXTENT,
  arrangeAround,
  correctPos,
  dropGroup,
  generateEdges,
  isComplete,
  isEdgePiece,
  makeLayout,
  moveGroup,
  newPieces,
  tableBounds,
  tracePiece,
  type Layout,
  type PieceEdges,
  type PieceState,
} from '../core/puzzle';
import type { GameProgress } from '../core/storage';
import { sfx } from '../audio';

export interface GameOptions {
  canvas: HTMLCanvasElement;
  image: HTMLImageElement;
  imageId: string;
  difficultyId: string;
  cols: number;
  rows: number;
  progress: GameProgress | null;
  onComplete: (elapsedMs: number) => void;
  onChange: () => void;
}

type Sprite = HTMLCanvasElement | OffscreenCanvas;

export class PuzzleGame {
  readonly L: Layout;
  readonly seed: number;
  readonly pieces: PieceState[];
  private readonly edges: PieceEdges[];
  private readonly sprites: Sprite[] = [];
  private readonly paths: Path2D[] = [];
  private readonly pad: number;
  private readonly isEdge: boolean[];
  private edgeOnly = false;
  private zOrder: number[] = [];
  /** 組 → 成員索引的快取；只有合併 / 鎖定會改變分組，屆時清掉重建 */
  private groupCache: Map<number, number[]> | null = null;
  /** 含有邊緣片的組（邊框篩選用）的快取，與 groupCache 一起失效 */
  private edgeGroups: Set<number> | null = null;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly hitCtx: CanvasRenderingContext2D;
  private cam = { s: 1, tx: 0, ty: 0 };
  private dpr = 1;
  private dirty = true;
  private raf = 0;
  private pointers = new Map<number, { x: number; y: number }>();
  private drag: { group: number; wx: number; wy: number; pointerId: number } | null = null;
  private pan: { x: number; y: number; pointerId: number } | null = null;
  private pinch: { dist: number; mx: number; my: number } | null = null;
  private elapsedBase: number;
  private runningSince: number | null = null;
  private finished = false;
  private destroyed = false;
  private resizeObs: ResizeObserver;

  constructor(private readonly o: GameOptions) {
    this.L = makeLayout(o.cols, o.rows, o.image.naturalWidth / o.image.naturalHeight);
    const prog = o.progress && o.progress.pieces.length === o.cols * o.rows ? o.progress : null;
    this.seed = prog ? prog.seed : Math.floor(Math.random() * 2 ** 31);
    this.edges = generateEdges(o.cols, o.rows, this.seed);
    this.pieces = prog
      ? prog.pieces.map(([x, y, group, locked]) => ({ x, y, group, locked: locked === 1 }))
      : newPieces(this.L, this.seed);
    this.elapsedBase = prog ? prog.elapsedMs : 0;
    this.isEdge = this.pieces.map((_, i) => isEdgePiece(i, o.cols, o.rows));
    this.pad = TAB_EXTENT * Math.min(this.L.pw, this.L.ph) + 4;
    this.rebuildZOrder();

    const ctx = o.canvas.getContext('2d');
    if (!ctx) throw new Error('canvas-unsupported');
    this.ctx = ctx;
    const hc = document.createElement('canvas');
    hc.width = hc.height = 1;
    this.hitCtx = hc.getContext('2d')!;

    this.buildSprites();
    this.bindEvents();
    this.resizeObs = new ResizeObserver(() => this.resize());
    this.resizeObs.observe(o.canvas);
    this.resize();
    this.resetView();
    this.loop();
  }

  // ---------------------------------------------------------------- 計時

  get elapsedMs() {
    return this.elapsedBase + (this.runningSince !== null ? performance.now() - this.runningSince : 0);
  }

  get running() {
    return this.runningSince !== null;
  }

  start() {
    if (this.finished || this.runningSince !== null) return;
    this.runningSince = performance.now();
  }

  pause() {
    if (this.runningSince === null) return;
    this.elapsedBase += performance.now() - this.runningSince;
    this.runningSince = null;
  }

  get isFinished() {
    return this.finished;
  }

  get lockedCount() {
    return this.pieces.reduce((n, p) => n + (p.locked ? 1 : 0), 0);
  }

  // ---------------------------------------------------------------- 進度

  serialize(): GameProgress {
    return {
      imageId: this.o.imageId,
      difficultyId: this.o.difficultyId,
      seed: this.seed,
      elapsedMs: Math.round(this.elapsedMs),
      pieces: this.pieces.map((p) => [Math.round(p.x * 10) / 10, Math.round(p.y * 10) / 10, p.group, p.locked ? 1 : 0]),
      updatedAt: Date.now(),
    };
  }

  // ---------------------------------------------------------------- 繪製準備

  private buildSprites() {
    const { image } = this.o;
    const L = this.L;
    const res = Math.min(image.naturalWidth / L.boardW, 2.5); // 每世界單位對應的像素
    const pad = this.pad;
    const sx = image.naturalWidth / L.boardW;
    const sy = image.naturalHeight / L.boardH;
    for (let i = 0; i < this.pieces.length; i++) {
      const { x: x0, y: y0 } = correctPos(L, i);
      const path = new Path2D();
      tracePiece(path, this.edges[i], L.pw, L.ph);
      this.paths.push(path);

      const w = Math.ceil((L.pw + pad * 2) * res);
      const h = Math.ceil((L.ph + pad * 2) * res);
      const c: Sprite = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(w, h) : Object.assign(document.createElement('canvas'), { width: w, height: h });
      const g = c.getContext('2d') as CanvasRenderingContext2D;
      g.scale(res, res);
      g.translate(pad, pad);
      // 陰影
      g.save();
      g.shadowColor = 'rgba(0,0,0,0.45)';
      g.shadowBlur = 4 * res;
      g.shadowOffsetX = 1.5 * res;
      g.shadowOffsetY = 2 * res;
      g.fillStyle = '#000';
      g.fill(path);
      g.restore();
      // 圖片
      g.save();
      g.clip(path);
      g.clearRect(-pad, -pad, L.pw + pad * 2, L.ph + pad * 2);
      const bx = x0 - pad;
      const by = y0 - pad;
      const bw = L.pw + pad * 2;
      const bh = L.ph + pad * 2;
      g.drawImage(image, bx * sx, by * sy, bw * sx, bh * sy, -pad, -pad, bw, bh);
      // 立體邊緣
      g.lineWidth = 2;
      g.strokeStyle = 'rgba(255,255,255,0.35)';
      g.translate(0.7, 0.7);
      g.stroke(path);
      g.strokeStyle = 'rgba(0,0,0,0.35)';
      g.translate(-1.4, -1.4);
      g.stroke(path);
      g.restore();
      this.sprites.push(c);
    }
  }

  private rebuildZOrder() {
    const seen = new Set<number>();
    const order: number[] = [];
    for (const p of this.pieces) {
      if (!seen.has(p.group)) {
        seen.add(p.group);
        order.push(p.group);
      }
    }
    // 已鎖定的組放最底層
    const lockedGroups = new Set(this.pieces.filter((p) => p.locked).map((p) => p.group));
    const prev = new Map(this.zOrder.map((g, i) => [g, i]));
    order.sort((a, b) => (prev.get(a) ?? -1) - (prev.get(b) ?? -1));
    this.zOrder = [...order.filter((g) => lockedGroups.has(g)), ...order.filter((g) => !lockedGroups.has(g))];
  }

  private membersByGroup() {
    if (!this.groupCache) {
      const byGroup = new Map<number, number[]>();
      this.pieces.forEach((p, i) => {
        const arr = byGroup.get(p.group);
        if (arr) arr.push(i);
        else byGroup.set(p.group, [i]);
      });
      this.groupCache = byGroup;
    }
    return this.groupCache;
  }

  private invalidateGroups() {
    this.groupCache = null;
    this.edgeGroups = null;
  }

  private bringToFront(group: number) {
    this.zOrder = this.zOrder.filter((g) => g !== group);
    this.zOrder.push(group);
  }

  // ---------------------------------------------------------------- 視角

  private resize() {
    const c = this.o.canvas;
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(1, Math.round(c.clientWidth * this.dpr));
    const h = Math.max(1, Math.round(c.clientHeight * this.dpr));
    if (c.width !== w || c.height !== h) {
      c.width = w;
      c.height = h;
    }
    this.dirty = true;
  }

  resetView() {
    const c = this.o.canvas;
    const b = tableBounds(this.pieces, this.L);
    const margin = 40;
    const vw = c.clientWidth || 800;
    const vh = c.clientHeight || 600;
    const s = Math.min((vw - margin * 2) / (b.maxX - b.minX), (vh - margin * 2) / (b.maxY - b.minY));
    this.cam.s = s;
    this.cam.tx = (vw - (b.maxX - b.minX) * s) / 2 - b.minX * s;
    this.cam.ty = (vh - (b.maxY - b.minY) * s) / 2 - b.minY * s;
    this.dirty = true;
  }

  private zoomAt(sx: number, sy: number, factor: number) {
    const ns = Math.max(0.02, Math.min(8, this.cam.s * factor));
    const f = ns / this.cam.s;
    this.cam.tx = sx - (sx - this.cam.tx) * f;
    this.cam.ty = sy - (sy - this.cam.ty) * f;
    this.cam.s = ns;
    this.dirty = true;
  }

  zoomBy(factor: number) {
    const c = this.o.canvas;
    this.zoomAt(c.clientWidth / 2, c.clientHeight / 2, factor);
  }

  /** 世界座標 → 畫面座標（CSS px，相對於 canvas） */
  toScreen(wx: number, wy: number) {
    return { x: wx * this.cam.s + this.cam.tx, y: wy * this.cam.s + this.cam.ty };
  }

  private toWorld(sx: number, sy: number) {
    return { x: (sx - this.cam.tx) / this.cam.s, y: (sy - this.cam.ty) / this.cam.s };
  }

  // ---------------------------------------------------------------- 功能

  get isEdgeOnly() {
    return this.edgeOnly;
  }

  setEdgeOnly(v: boolean) {
    this.edgeOnly = v;
    this.dirty = true;
  }

  private isHidden(i: number) {
    if (!this.edgeOnly || this.pieces[i].locked || this.isEdge[i]) return false;
    if (!this.edgeGroups) {
      this.edgeGroups = new Set();
      this.pieces.forEach((p, j) => this.isEdge[j] && this.edgeGroups!.add(p.group));
    }
    return !this.edgeGroups.has(this.pieces[i].group);
  }

  /** 整理散片：把未鎖定的單片重新排到拼盤四周（邊框篩選時邊緣片排在內圈） */
  arrange() {
    const loose: number[] = [];
    for (const members of this.membersByGroup().values()) {
      if (members.length === 1 && !this.pieces[members[0]].locked) loose.push(members[0]);
    }
    arrangeAround(this.pieces, this.L, loose, Date.now() & 0xffffff, this.edgeOnly ? (i) => this.isEdge[i] : undefined);
    this.resetView();
    this.o.onChange();
  }

  // ---------------------------------------------------------------- 事件

  private bindEvents() {
    const c = this.o.canvas;
    c.addEventListener('pointerdown', this.onDown);
    c.addEventListener('pointermove', this.onMove);
    c.addEventListener('pointerup', this.onUp);
    c.addEventListener('pointercancel', this.onUp);
    c.addEventListener('wheel', this.onWheel, { passive: false });
    c.addEventListener('contextmenu', this.prevent);
  }

  private prevent = (e: Event) => e.preventDefault();

  private local(e: PointerEvent | WheelEvent) {
    const r = this.o.canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  private hitTest(wx: number, wy: number): number | null {
    const byGroup = this.membersByGroup();
    for (let z = this.zOrder.length - 1; z >= 0; z--) {
      for (const i of byGroup.get(this.zOrder[z]) ?? []) {
        const p = this.pieces[i];
        if (this.isHidden(i)) continue;
        const lx = wx - p.x;
        const ly = wy - p.y;
        if (lx < -this.pad || ly < -this.pad || lx > this.L.pw + this.pad || ly > this.L.ph + this.pad) continue;
        if (this.hitCtx.isPointInPath(this.paths[i], lx, ly)) return i;
      }
    }
    return null;
  }

  private onDown = (e: PointerEvent) => {
    if (this.finished) return;
    const pt = this.local(e);
    this.pointers.set(e.pointerId, pt);
    this.o.canvas.setPointerCapture(e.pointerId);
    if (this.pointers.size === 2) {
      // 雙指：取消拖曳 / 平移，改為縮放。拼片留在原地、不做吸附，避免手勢中途誤合併
      if (this.drag) this.finishDrag(false);
      this.pan = null;
      const [a, b] = [...this.pointers.values()];
      this.pinch = { dist: Math.hypot(a.x - b.x, a.y - b.y), mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 };
      return;
    }
    if (this.pointers.size > 2) return;
    if (e.button === 2 || e.button === 1) {
      this.pan = { x: pt.x, y: pt.y, pointerId: e.pointerId };
      this.updateCursor(e);
      return;
    }
    const w = this.toWorld(pt.x, pt.y);
    const hit = this.hitTest(w.x, w.y);
    if (hit !== null && !this.pieces[hit].locked) {
      const g = this.pieces[hit].group;
      this.drag = { group: g, wx: w.x, wy: w.y, pointerId: e.pointerId };
      this.bringToFront(g);
      this.start();
      sfx.pick();
      this.dirty = true;
      this.updateCursor(e);
    }
    // 左鍵 / 單指沒點到可拖動的拼片（空白處、拼盤、已鎖定的拼片）時不做任何事，
    // 避免拖空時整個拼盤跟著跑。平移改用右鍵 / 中鍵拖曳或雙指。
  };

  /** 滑鼠游標：可拖動的拼片上顯示抓手，拖曳 / 平移中顯示對應游標，其餘為一般箭頭 */
  private updateCursor(e: PointerEvent) {
    if (e.pointerType !== 'mouse') return;
    let cursor = 'default';
    if (this.drag) cursor = 'grabbing';
    else if (this.pan) cursor = 'move';
    else if (!this.finished) {
      const pt = this.local(e);
      const w = this.toWorld(pt.x, pt.y);
      const hit = this.hitTest(w.x, w.y);
      if (hit !== null && !this.pieces[hit].locked) cursor = 'grab';
    }
    const c = this.o.canvas;
    if (c.style.cursor !== cursor) c.style.cursor = cursor;
  }

  private onMove = (e: PointerEvent) => {
    if (!this.pointers.has(e.pointerId)) {
      this.updateCursor(e);
      return;
    }
    const pt = this.local(e);
    this.pointers.set(e.pointerId, pt);
    if (this.pinch && this.pointers.size >= 2) {
      const [a, b] = [...this.pointers.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      const mx = (a.x + b.x) / 2;
      const my = (a.y + b.y) / 2;
      this.cam.tx += mx - this.pinch.mx;
      this.cam.ty += my - this.pinch.my;
      if (this.pinch.dist > 0) this.zoomAt(mx, my, dist / this.pinch.dist);
      this.pinch = { dist, mx, my };
      this.dirty = true;
      return;
    }
    if (this.drag && this.drag.pointerId === e.pointerId) {
      const w = this.toWorld(pt.x, pt.y);
      moveGroup(this.pieces, this.drag.group, w.x - this.drag.wx, w.y - this.drag.wy);
      this.drag.wx = w.x;
      this.drag.wy = w.y;
      this.dirty = true;
    } else if (this.pan && this.pan.pointerId === e.pointerId) {
      this.cam.tx += pt.x - this.pan.x;
      this.cam.ty += pt.y - this.pan.y;
      this.pan.x = pt.x;
      this.pan.y = pt.y;
      this.dirty = true;
    }
  };

  private onUp = (e: PointerEvent) => {
    this.pointers.delete(e.pointerId);
    if (this.drag && this.drag.pointerId === e.pointerId) this.finishDrag();
    if (this.pan && this.pan.pointerId === e.pointerId) this.pan = null;
    if (this.pointers.size < 2) this.pinch = null;
    this.updateCursor(e);
  };

  /** 結束拖曳。snap 為 false 時只把拼片留在原地，不檢查吸附 / 鎖定。 */
  private finishDrag(snap = true) {
    if (!this.drag) return;
    const group = this.drag.group;
    this.drag = null;
    this.dirty = true;
    if (!snap) {
      this.o.onChange();
      return;
    }
    const r = dropGroup(this.pieces, this.L, group);
    if (r.merged || r.locked) this.invalidateGroups();
    if (r.locked) {
      this.rebuildZOrder();
      sfx.lock();
    } else if (r.merged) {
      this.rebuildZOrder();
      this.bringToFront(r.group);
      sfx.snap();
    }
    if (isComplete(this.pieces)) {
      this.pause();
      this.finished = true;
      sfx.complete();
      this.o.onComplete(this.elapsedMs);
    }
    this.o.onChange();
  }

  private onWheel = (e: WheelEvent) => {
    e.preventDefault();
    const pt = this.local(e);
    const delta = e.deltaMode === 1 ? e.deltaY * 33 : e.deltaY;
    this.zoomAt(pt.x, pt.y, Math.exp(-delta * 0.0015));
  };

  // ---------------------------------------------------------------- 繪製

  private loop = () => {
    if (this.destroyed) return;
    if (this.dirty) {
      this.dirty = false;
      this.draw();
    }
    this.raf = requestAnimationFrame(this.loop);
  };

  private draw() {
    const { ctx, cam, L, pad } = this;
    const c = this.o.canvas;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.setTransform(cam.s * this.dpr, 0, 0, cam.s * this.dpr, cam.tx * this.dpr, cam.ty * this.dpr);

    // 拼盤
    ctx.fillStyle = 'rgba(0,0,0,0.18)';
    ctx.fillRect(0, 0, L.boardW, L.boardH);
    ctx.lineWidth = 3 / cam.s;
    ctx.strokeStyle = 'rgba(255,255,255,0.25)';
    ctx.strokeRect(0, 0, L.boardW, L.boardH);

    // 可視範圍（世界座標）用於略過畫面外的拼片
    const v0 = this.toWorld(0, 0);
    const v1 = this.toWorld(c.clientWidth, c.clientHeight);
    const byGroup = this.membersByGroup();
    const dw = L.pw + pad * 2;
    const dh = L.ph + pad * 2;
    for (const g of this.zOrder) {
      const members = byGroup.get(g);
      if (!members) continue;
      for (const i of members) {
        if (this.isHidden(i)) continue;
        const p = this.pieces[i];
        if (p.x + L.pw + pad < v0.x || p.y + L.ph + pad < v0.y || p.x - pad > v1.x || p.y - pad > v1.y) continue;
        ctx.drawImage(this.sprites[i], p.x - pad, p.y - pad, dw, dh);
      }
    }
  }

  destroy() {
    this.destroyed = true;
    cancelAnimationFrame(this.raf);
    this.resizeObs.disconnect();
    const c = this.o.canvas;
    c.removeEventListener('pointerdown', this.onDown);
    c.removeEventListener('pointermove', this.onMove);
    c.removeEventListener('pointerup', this.onUp);
    c.removeEventListener('pointercancel', this.onUp);
    c.removeEventListener('wheel', this.onWheel);
    c.removeEventListener('contextmenu', this.prevent);
  }
}
