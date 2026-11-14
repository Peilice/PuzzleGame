// Canvas 拼圖遊戲：繪製、拖曳、縮放平移、吸附與完成判定。
import {
  correctPos,
  dropGroup,
  enterTray,
  gatherToTray,
  generateEdges,
  isComplete,
  isEdgePiece,
  leaveTray,
  makeLayout,
  moveGroup,
  newPieces,
  piecePad,
  sanitizeTray,
  shuffledOrder,
  tableBounds,
  trayCellAt,
  trayGeometry,
  trayRowCellAt,
  trayRowGeometry,
  tracePiece,
  withTrayFallback,
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
  /** 新局的拼片放在托盤；續玩舊進度時以進度為準 */
  startInTray: boolean;
  onComplete: (elapsedMs: number) => void;
  onChange: () => void;
}

type Sprite = HTMLCanvasElement | OffscreenCanvas;

/** 托盤內容與邊緣的留白（CSS px） */
const TRAY_MARGIN = 8;

export class PuzzleGame {
  readonly L: Layout;
  readonly seed: number;
  readonly pieces: PieceState[];
  private readonly edges: PieceEdges[];
  private readonly sprites: Sprite[] = [];
  private readonly shadows: Sprite[] = [];
  private readonly paths: Path2D[] = [];
  private readonly pad: number;
  private readonly isEdge: boolean[];
  private edgeOnly = false;
  private zOrder: number[] = [];
  /** 組 → 成員索引的快取；只有合併 / 鎖定會改變分組，屆時清掉重建 */
  private groupCache: Map<number, number[]> | null = null;
  /** 含有邊緣片的組（邊框篩選用）的快取，與 groupCache 一起失效 */
  private edgeGroups: Set<number> | null = null;
  /** 托盤內的拼片索引，依托盤順序 */
  private readonly trayOrder: number[];
  private trayOpen: boolean;
  private trayScroll = 0;
  /** 托盤內容區的上緣（在 HUD 下方，CSS px） */
  private trayTop = 56;
  /** 套用邊框篩選後實際顯示的托盤清單；托盤或篩選改變時清掉重建 */
  private trayListCache: number[] | null = null;
  /** 拖曳中的單片正在托盤上方（放開就會放進托盤） */
  private trayHot = false;
  /** 在托盤上按下、尚未決定是捲動還是拿起拼片 */
  private trayPress: { pointerId: number; piece: number; sx: number; sy: number; scroll0: number; scrolling: boolean } | null = null;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly hitCtx: CanvasRenderingContext2D;
  private cam = { s: 1, tx: 0, ty: 0 };
  private dpr = 1;
  private dirty = true;
  private raf = 0;
  private pointers = new Map<number, { x: number; y: number }>();
  private drag: { group: number; wx: number; wy: number; pointerId: number; px: number; py: number } | null = null;
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
    this.trayOrder = prog ? sanitizeTray(prog.tray, this.pieces) : o.startInTray ? shuffledOrder(this.pieces.length, this.seed) : [];
    for (const i of this.trayOrder) this.pieces[i].tray = true;
    this.trayOpen = this.trayOrder.length > 0;
    this.elapsedBase = prog ? prog.elapsedMs : 0;
    this.isEdge = this.pieces.map((_, i) => isEdgePiece(i, o.cols, o.rows));
    this.pad = piecePad(this.L);
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
    // 托盤內的拼片另外存順序；座標先放到桌面外圍，舊版或托盤資料損毀時才不會讓拼片消失
    const pieces = this.trayOrder.length ? withTrayFallback(this.pieces, this.L, this.trayOrder, this.seed) : this.pieces;
    return {
      imageId: this.o.imageId,
      difficultyId: this.o.difficultyId,
      seed: this.seed,
      elapsedMs: Math.round(this.elapsedMs),
      pieces: pieces.map((p) => [Math.round(p.x * 10) / 10, Math.round(p.y * 10) / 10, p.group, p.locked ? 1 : 0]),
      ...(this.trayOrder.length ? { tray: [...this.trayOrder] } : {}),
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
      const mk = (): Sprite => (typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(w, h) : Object.assign(document.createElement('canvas'), { width: w, height: h }));
      // 陰影與圖片分成兩張：同組拼片繪製時先畫完所有陰影再畫圖片，鄰片的陰影才不會蓋到凸起
      const sc = mk();
      const sg = sc.getContext('2d') as CanvasRenderingContext2D;
      sg.scale(res, res);
      sg.translate(pad, pad);
      sg.save();
      sg.shadowColor = 'rgba(0,0,0,0.45)';
      sg.shadowBlur = 4 * res;
      sg.shadowOffsetX = 1.5 * res;
      sg.shadowOffsetY = 2 * res;
      sg.fillStyle = '#000';
      sg.fill(path);
      sg.restore();
      // 挖掉拼片本體，只留下外側陰影
      sg.globalCompositeOperation = 'destination-out';
      sg.fill(path);
      this.shadows.push(sc);

      const c = mk();
      const g = c.getContext('2d') as CanvasRenderingContext2D;
      g.scale(res, res);
      g.translate(pad, pad);
      // 圖片
      g.save();
      g.clip(path);
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
    this.layoutTray();
    this.dirty = true;
  }

  resetView() {
    const c = this.o.canvas;
    const b = tableBounds(this.pieces, this.L);
    const margin = 40;
    const vw = (c.clientWidth || 800) - this.trayInset();
    const vh = (c.clientHeight || 600) - this.trayInsetY();
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
    this.invalidateTray();
  }

  private isHidden(i: number) {
    if (!this.edgeOnly || this.pieces[i].locked || this.isEdge[i]) return false;
    if (!this.edgeGroups) {
      this.edgeGroups = new Set();
      this.pieces.forEach((p, j) => this.isEdge[j] && this.edgeGroups!.add(p.group));
    }
    return !this.edgeGroups.has(this.pieces[i].group);
  }

  /** 收回散片：把桌面上未鎖定的單片全部放回托盤，整個托盤重新洗牌 */
  gather() {
    gatherToTray(this.pieces, this.trayOrder, Date.now() & 0xffffff);
    this.trayScroll = 0;
    this.invalidateTray();
    this.setTrayOpen(true);
    this.resetView();
    this.o.onChange();
  }

  // ---------------------------------------------------------------- 托盤

  get trayCount() {
    return this.trayOrder.length;
  }

  get isTrayOpen() {
    return this.trayOpen;
  }

  setTrayOpen(v: boolean) {
    this.trayOpen = v;
    this.trayHot = false;
    this.layoutTray();
    this.dirty = true;
  }

  /** 托盤寬度（CSS px）：畫面寬的 26%，限制在 170–320 之間 */
  private trayWidth() {
    return Math.round(Math.min(320, Math.max(170, this.o.canvas.clientWidth * 0.26)));
  }

  /** 平板、電腦（短邊 ≥ 600px）托盤放下方；手機維持在右側 */
  private get bottomTray() {
    return Math.min(window.innerWidth, window.innerHeight) >= 600;
  }

  /** 下方托盤高度（CSS px）：畫面高的 22%，限制在 130–200 之間 */
  private trayHeight() {
    return Math.round(Math.min(200, Math.max(130, this.o.canvas.clientHeight * 0.22)));
  }

  /** 右側托盤佔掉的畫面寬度；收合或在下方時為 0 */
  private trayInset() {
    return this.trayOpen && !this.bottomTray ? this.trayWidth() : 0;
  }

  /** 下方托盤佔掉的畫面高度；收合或在右側時為 0 */
  private trayInsetY() {
    return this.trayOpen && this.bottomTray ? this.trayHeight() : 0;
  }

  /** 托盤在畫面上的範圍；收合時為 null */
  private trayRect() {
    if (!this.trayOpen) return null;
    const c = this.o.canvas;
    if (this.bottomTray) {
      const h = this.trayHeight();
      return { x: 0, y: c.clientHeight - h, w: c.clientWidth, h };
    }
    const w = this.trayWidth();
    return { x: c.clientWidth - w, y: 0, w, h: c.clientHeight };
  }

  /** 通知頁面其他元素（預覽圖、提示）避開托盤，並量出右側托盤內容區的上緣（HUD 下方） */
  private layoutTray() {
    const c = this.o.canvas;
    const host = c.parentElement;
    host?.style.setProperty('--tray-w', `${this.trayInset()}px`);
    host?.style.setProperty('--tray-h', `${this.trayInsetY()}px`);
    const hud = host?.querySelector('.hud');
    this.trayTop = hud ? Math.max(0, hud.getBoundingClientRect().bottom - c.getBoundingClientRect().top) + 6 : 56;
    this.clampTrayScroll();
  }

  private trayList() {
    return (this.trayListCache ??= this.edgeOnly ? this.trayOrder.filter((i) => this.isEdge[i]) : this.trayOrder.slice());
  }

  private trayGeom() {
    return trayGeometry(this.L, this.trayWidth() - TRAY_MARGIN * 2, this.trayList().length);
  }

  private trayRowGeom() {
    return trayRowGeometry(this.L, this.trayHeight() - TRAY_MARGIN * 2, this.trayList().length);
  }

  /** 托盤捲動方向的可視長度與內容長度（右側為垂直、下方為水平） */
  private trayScrollExtent() {
    const c = this.o.canvas;
    if (this.bottomTray) return { view: c.clientWidth - TRAY_MARGIN * 2, content: this.trayRowGeom().contentW };
    return { view: c.clientHeight - this.trayTop - TRAY_MARGIN, content: this.trayGeom().contentH };
  }

  private invalidateTray() {
    this.trayListCache = null;
    this.clampTrayScroll();
    this.dirty = true;
  }

  private clampTrayScroll() {
    const { view, content } = this.trayScrollExtent();
    this.trayScroll = Math.max(0, Math.min(this.trayScroll, content - view));
  }

  private inTray(pt: { x: number; y: number }) {
    const r = this.trayRect();
    if (!r) return false;
    return this.bottomTray ? pt.y >= r.y : pt.x >= r.x;
  }

  /** 螢幕座標指到的托盤拼片索引；沒有指到回傳 -1 */
  private trayPieceAt(pt: { x: number; y: number }) {
    const r = this.trayRect();
    if (!r) return -1;
    const list = this.trayList();
    let k: number;
    if (this.bottomTray) {
      k = trayRowCellAt(this.trayRowGeom(), list.length, pt.x - TRAY_MARGIN + this.trayScroll, pt.y - r.y - TRAY_MARGIN);
    } else {
      if (pt.y < this.trayTop) return -1;
      k = trayCellAt(this.trayGeom(), list.length, pt.x - r.x - TRAY_MARGIN, pt.y - this.trayTop + this.trayScroll);
    }
    return k < 0 ? -1 : list[k];
  }

  /** 把托盤裡的拼片拿到桌面上（以指標位置為拼片中心）並開始拖曳 */
  private pickFromTray(index: number, pt: { x: number; y: number }, pointerId: number) {
    const w = this.toWorld(pt.x, pt.y);
    if (!leaveTray(this.pieces, this.trayOrder, index, w.x - this.L.pw / 2, w.y - this.L.ph / 2)) return;
    const group = this.pieces[index].group;
    this.drag = { group, wx: w.x, wy: w.y, pointerId, px: pt.x, py: pt.y };
    this.trayHot = this.inTray(pt);
    this.invalidateTray();
    this.bringToFront(group);
    this.start();
    sfx.pick();
    this.o.onChange();
  }

  /** 一組拼片放在托盤上方放不進去（多片相連）時，推離托盤（右側托盤往左、下方托盤往上），避免被托盤蓋住 */
  private nudgeLeftOfTray(group: number) {
    const r = this.trayRect();
    if (!r) return;
    const members = this.membersByGroup().get(group) ?? [];
    if (this.bottomTray) {
      const limit = this.toWorld(0, r.y - 8).y;
      let bottom = -Infinity;
      for (const i of members) bottom = Math.max(bottom, this.pieces[i].y + this.L.ph);
      if (bottom > limit) moveGroup(this.pieces, group, 0, limit - bottom);
      return;
    }
    const limit = this.toWorld(r.x - 8, 0).x;
    let right = -Infinity;
    for (const i of members) right = Math.max(right, this.pieces[i].x + this.L.pw);
    if (right > limit) moveGroup(this.pieces, group, limit - right, 0);
  }

  /** 托盤上拖曳：滑鼠按住拼片往任何方向都是拿起；觸控往桌面拖（右側托盤向左、下方托盤向上）才拿起，沿托盤方向滑動是捲動 */
  private moveTrayPress(tp: NonNullable<PuzzleGame['trayPress']>, pt: { x: number; y: number }, pointerType: string) {
    const dx = pt.x - tp.sx;
    const dy = pt.y - tp.sy;
    const bottom = this.bottomTray;
    if (!tp.scrolling) {
      if (Math.hypot(dx, dy) < 8) return;
      const towardTable = bottom ? dy < 0 && Math.abs(dy) > Math.abs(dx) : dx < 0 && Math.abs(dx) > Math.abs(dy);
      if (tp.piece >= 0 && (pointerType !== 'touch' || towardTable)) {
        this.trayPress = null;
        this.pickFromTray(tp.piece, pt, tp.pointerId);
        return;
      }
      tp.scrolling = true;
    }
    this.trayScroll = tp.scroll0 - (bottom ? dx : dy);
    this.clampTrayScroll();
    this.dirty = true;
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
        if (p.tray || this.isHidden(i)) continue;
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
      this.trayPress = null;
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
    if (this.inTray(pt)) {
      this.trayPress = { pointerId: e.pointerId, piece: this.trayPieceAt(pt), sx: pt.x, sy: pt.y, scroll0: this.trayScroll, scrolling: false };
      return;
    }
    const w = this.toWorld(pt.x, pt.y);
    const hit = this.hitTest(w.x, w.y);
    if (hit !== null && !this.pieces[hit].locked) {
      const g = this.pieces[hit].group;
      this.drag = { group: g, wx: w.x, wy: w.y, pointerId: e.pointerId, px: pt.x, py: pt.y };
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
      if (this.inTray(pt)) {
        if (this.trayPieceAt(pt) >= 0) cursor = 'grab';
      } else {
        const w = this.toWorld(pt.x, pt.y);
        const hit = this.hitTest(w.x, w.y);
        if (hit !== null && !this.pieces[hit].locked) cursor = 'grab';
      }
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
    const tp = this.trayPress;
    if (tp && tp.pointerId === e.pointerId) {
      this.moveTrayPress(tp, pt, e.pointerType);
      return;
    }
    if (this.drag && this.drag.pointerId === e.pointerId) {
      const w = this.toWorld(pt.x, pt.y);
      moveGroup(this.pieces, this.drag.group, w.x - this.drag.wx, w.y - this.drag.wy);
      this.drag.wx = w.x;
      this.drag.wy = w.y;
      this.drag.px = pt.x;
      this.drag.py = pt.y;
      this.trayHot = this.inTray(pt) && this.membersByGroup().get(this.drag.group)?.length === 1;
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
    if (this.trayPress?.pointerId === e.pointerId) this.trayPress = null;
    if (this.drag && this.drag.pointerId === e.pointerId) this.finishDrag();
    if (this.pan && this.pan.pointerId === e.pointerId) this.pan = null;
    if (this.pointers.size < 2) this.pinch = null;
    this.updateCursor(e);
  };

  /** 結束拖曳。snap 為 false 時只把拼片留在原地，不檢查吸附 / 鎖定。 */
  private finishDrag(snap = true) {
    if (!this.drag) return;
    const { group, px, py } = this.drag;
    this.drag = null;
    this.trayHot = false;
    this.dirty = true;
    if (!snap) {
      this.o.onChange();
      return;
    }
    if (this.inTray({ x: px, y: py })) {
      // 單片放在托盤上 = 放回托盤；相連的多片放不進去，推到托盤旁邊再照常判定吸附
      const members = this.membersByGroup().get(group) ?? [];
      if (members.length === 1 && enterTray(this.pieces, this.trayOrder, members[0])) {
        this.invalidateTray();
        sfx.snap();
        this.o.onChange();
        return;
      }
      this.nudgeLeftOfTray(group);
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
    if (this.inTray(pt)) {
      // 下方托盤橫向捲動：觸控板橫向滑動優先，其次滾輪（deltaY）
      const dx = e.deltaMode === 1 ? e.deltaX * 33 : e.deltaX;
      this.trayScroll += this.bottomTray && Math.abs(dx) > Math.abs(delta) ? dx : delta;
      this.clampTrayScroll();
      this.dirty = true;
      return;
    }
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
    const { ctx, cam, L } = this;
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
    const dragged = this.drag?.group;
    for (const g of this.zOrder) if (g !== dragged) this.drawGroup(g, v0, v1);

    // 托盤蓋在桌面上；拖曳中的拼片畫在托盤之上，這樣才看得到它被拖進托盤
    this.drawTray();
    if (dragged !== undefined) {
      ctx.setTransform(cam.s * this.dpr, 0, 0, cam.s * this.dpr, cam.tx * this.dpr, cam.ty * this.dpr);
      this.drawGroup(dragged, v0, v1);
    }
  }

  private drawGroup(group: number, v0: { x: number; y: number }, v1: { x: number; y: number }) {
    const { ctx, L, pad } = this;
    const dw = L.pw + pad * 2;
    const dh = L.ph + pad * 2;
    const visible: number[] = [];
    for (const i of this.membersByGroup().get(group) ?? []) {
      const p = this.pieces[i];
      if (p.tray || this.isHidden(i)) continue;
      if (p.x + L.pw + pad < v0.x || p.y + L.ph + pad < v0.y || p.x - pad > v1.x || p.y - pad > v1.y) continue;
      visible.push(i);
    }
    for (const i of visible) ctx.drawImage(this.shadows[i], this.pieces[i].x - pad, this.pieces[i].y - pad, dw, dh);
    for (const i of visible) ctx.drawImage(this.sprites[i], this.pieces[i].x - pad, this.pieces[i].y - pad, dw, dh);
  }

  private drawTray() {
    const r = this.trayRect();
    if (!r) return;
    const { ctx } = this;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.fillStyle = this.trayHot ? 'rgba(38, 36, 32, 0.95)' : 'rgba(10, 10, 10, 0.88)';
    ctx.fillRect(r.x, r.y, r.w, r.h);
    ctx.fillStyle = this.trayHot ? '#c9a45c' : 'rgba(255, 255, 255, 0.18)';
    const edge = this.trayHot ? 3 : 1.5;
    const list = this.trayList();

    if (this.bottomTray) {
      ctx.fillRect(r.x, r.y, r.w, edge);
      const g = this.trayRowGeom();
      const viewW = r.w - TRAY_MARGIN * 2;
      const step = g.cellW + g.gap;
      ctx.save();
      ctx.beginPath();
      ctx.rect(r.x, r.y, r.w, r.h);
      ctx.clip();
      const firstCol = Math.max(0, Math.floor(this.trayScroll / step));
      const endCol = Math.ceil((this.trayScroll + viewW) / step);
      const end = Math.min(list.length, endCol * g.rows);
      for (let k = firstCol * g.rows; k < end; k++) {
        const x = TRAY_MARGIN + Math.floor(k / g.rows) * step - this.trayScroll;
        const y = r.y + TRAY_MARGIN + (k % g.rows) * (g.cellH + g.gap);
        ctx.drawImage(this.shadows[list[k]], x, y, g.cellW, g.cellH);
        ctx.drawImage(this.sprites[list[k]], x, y, g.cellW, g.cellH);
      }
      if (g.contentW > viewW) {
        const w = Math.max(24, (viewW * viewW) / g.contentW);
        const x = TRAY_MARGIN + (viewW - w) * (this.trayScroll / (g.contentW - viewW));
        ctx.fillStyle = 'rgba(255, 255, 255, 0.3)';
        ctx.fillRect(x, r.y + r.h - 4, w, 2.5);
      }
      ctx.restore();
      return;
    }

    ctx.fillRect(r.x, 0, edge, r.h);
    const g = this.trayGeom();
    const viewH = r.h - this.trayTop;
    const step = g.cellH + g.gap;
    ctx.save();
    ctx.beginPath();
    ctx.rect(r.x, this.trayTop, r.w, viewH);
    ctx.clip();
    const first = Math.max(0, Math.floor(this.trayScroll / step)) * g.cols;
    const end = Math.min(list.length, Math.ceil((this.trayScroll + viewH) / step) * g.cols);
    for (let k = first; k < end; k++) {
      const x = r.x + TRAY_MARGIN + (k % g.cols) * (g.cellW + g.gap);
      const y = this.trayTop + Math.floor(k / g.cols) * step - this.trayScroll;
      ctx.drawImage(this.shadows[list[k]], x, y, g.cellW, g.cellH);
      ctx.drawImage(this.sprites[list[k]], x, y, g.cellW, g.cellH);
    }
    if (g.contentH > viewH) {
      const h = Math.max(24, (viewH * viewH) / g.contentH);
      const y = this.trayTop + (viewH - h) * (this.trayScroll / (g.contentH - viewH));
      ctx.fillStyle = 'rgba(255, 255, 255, 0.3)';
      ctx.fillRect(r.x + r.w - 4, y, 2.5, h);
    }
    ctx.restore();
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
