// 遊戲畫面：工具列、暫停、自動存檔與結算。拼圖本身（Canvas）在 game/game.ts。
import { pieceCount, type Difficulty, type PuzzleImage } from '../../core/content';
import { recordCompletion } from '../../core/save';
import { deleteProgress, loadProgress, writeProgress, type GameProgress } from '../../core/storage';
import { PuzzleGame } from '../../game/game';
import { sfx } from '../../audio';
import { asset, el, esc, isMounted, mount, onLeave, toast } from '../dom';
import { formatTime } from '../format';
import { nav } from '../nav';
import { defById, persist, refreshTitles, safeWrite, store, titleBadge } from '../state';
import { S } from '../strings';

/** 放下拼片後隔多久自動存檔 */
const AUTOSAVE_DELAY_MS = 800;
/** 完成後等完成音效與畫面停一下再顯示結算 */
const RESULT_DELAY_MS = 900;

const ICONS = {
  back: '<path d="M15 5l-7 7 7 7"/>',
  preview: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 16l5-5 4 4 3-3 6 6"/>',
  edge: '<rect x="4" y="4" width="16" height="16" rx="1"/><rect x="9" y="9" width="6" height="6" stroke-dasharray="2 2"/>',
  tray: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M15 4v16"/>',
  gather: '<rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/>',
  fit: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
  minus: '<circle cx="11" cy="11" r="7"/><path d="M8 11h6M16 16l5 5"/>',
  plus: '<circle cx="11" cy="11" r="7"/><path d="M8 11h6M11 8v6M16 16l5 5"/>',
  pause: '<path d="M8 5v14M16 5v14"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6v.6"/><path d="M12 17.2v.1"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  collapse: '<path d="M9 5l7 7-7 7"/>',
  expand: '<path d="M15 5l-7 7 7 7"/>',
};
const icon = (k: keyof typeof ICONS) => `<svg viewBox="0 0 24 24" class="ic">${ICONS[k]}</svg>`;
const hintRows = (rows: [string, string][]) => rows.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('');

function gameMarkup(img: PuzzleImage) {
  return `
    <main class="screen game">
      <canvas class="board"></canvas>
      <div class="hud">
        <button class="tool back" aria-label="${S.back}">${icon('back')}<span>${S.back}</span></button>
        <div class="hud-info"><span class="timer">00:00</span><span class="count"></span></div>
        <div class="tools">
          <div class="tools-items">
          <button class="tool preview-btn" aria-pressed="false">${icon('preview')}<span>${S.preview}</span></button>
          <button class="tool edge-btn" aria-pressed="false">${icon('edge')}<span>${S.edgeOnly}</span></button>
          <button class="tool tray-btn" aria-pressed="false">${icon('tray')}<span>${S.tray}</span><b class="badge hidden"></b></button>
          <button class="tool gather-btn">${icon('gather')}<span>${S.gather}</span></button>
          <button class="tool fit-btn">${icon('fit')}<span>${S.resetView}</span></button>
          <button class="tool zoom-out">${icon('minus')}<span>${S.zoomOut}</span></button>
          <button class="tool zoom-in">${icon('plus')}<span>${S.zoomIn}</span></button>
          <button class="tool help-btn" aria-pressed="false">${icon('help')}<span>${S.help}</span></button>
          <button class="tool pause-btn">${icon('pause')}<span>${S.pause}</span></button>
          </div>
          <button class="tool tools-toggle" aria-expanded="true" aria-label="${S.collapseTools}">${icon('collapse')}</button>
        </div>
      </div>
      <div class="preview hidden">
        <img src="${asset(img.src)}" alt="" draggable="false">
        <button class="preview-close" aria-label="${S.hintClose}">${icon('close')}</button>
        <div class="preview-resize" aria-hidden="true"></div>
      </div>
      <aside class="hint hidden" aria-label="${S.hintTitle}">
        <button class="hint-close" aria-label="${S.hintClose}">${icon('close')}</button>
        <dl class="hint-list hint-mouse">${hintRows(S.hintMouse)}</dl>
        <dl class="hint-list hint-touch">${hintRows(Math.min(window.innerWidth, window.innerHeight) >= 600 ? S.hintTouchTablet : S.hintTouch)}</dl>
      </aside>
      <div class="overlay loading"><div class="spinner"></div><p>${S.loadingImage}</p></div>
      <div class="rotate-hint"><div class="phone-icon"></div><p>${S.rotateDevice}</p><small>${S.rotateDeviceHint}</small></div>
    </main>`;
}

function loadImage(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const im = new Image();
    im.onload = () => resolve(im);
    im.onerror = () => reject(new Error(S.imageLoadFailed));
    im.src = src;
  });
}

/** 自動存檔：把進度寫入裝置，並把這一局新增的時間計入總遊玩時間。 */
function createAutosave(game: PuzzleGame) {
  // 已計入總遊玩時間的部分；以遊戲實際採用的時間為準（進度檔不合用時會從 0 開始）
  let counted = game.elapsedMs;
  let timer = 0;
  const addPlayTime = () => {
    const now = game.elapsedMs;
    store.save.totalPlayMs += Math.max(0, now - counted);
    counted = now;
  };
  const cancel = () => window.clearTimeout(timer);
  /** 立刻存檔（已完成的局不存進度） */
  const flush = async () => {
    cancel();
    if (game.isFinished) return;
    addPlayTime();
    await Promise.all([safeWrite(() => writeProgress(game.serialize())), persist()]);
  };
  /** 稍後存檔；連續操作只會存最後一次 */
  const schedule = () => {
    cancel();
    timer = window.setTimeout(() => void flush(), AUTOSAVE_DELAY_MS);
  };
  return { addPlayTime, cancel, flush, schedule };
}

export async function startGame(img: PuzzleImage, diff: Difficulty) {
  const node = el(gameMarkup(img));
  mount(node);
  const q = <T extends HTMLElement = HTMLElement>(sel: string) => node.querySelector<T>(sel)!;
  const toImages = () => nav.images(img.category);
  // 返回鍵在圖片載入期間就要能用；遊戲建立後改為先存檔再離開
  let onBack: () => void = toImages;
  q('.back').addEventListener('click', () => onBack());

  let game: PuzzleGame;
  try {
    const [image, progress] = await Promise.all([
      loadImage(asset(img.src)),
      loadProgress(img.id, diff.id).catch((): GameProgress | undefined => undefined),
    ]);
    if (!isMounted(node)) return; // 載入期間已離開
    game = new PuzzleGame({
      canvas: q<HTMLCanvasElement>('canvas'),
      image,
      imageId: img.id,
      difficultyId: diff.id,
      cols: diff.cols,
      rows: diff.rows,
      progress: progress ?? null,
      startInTray: store.save.settings.startInTray,
      onChange: () => {
        updateCount();
        autosave.schedule();
      },
      onComplete: (ms) => void finish(ms),
    });
  } catch (e) {
    if (!isMounted(node)) return;
    const message = (e as Error).message;
    toast(esc(message === 'canvas-unsupported' ? S.gameStartFailed : message), 'error');
    toImages();
    return;
  }

  const autosave = createAutosave(game);
  const total = pieceCount(diff);
  const timerEl = q('.timer');
  const countEl = q('.count');
  const trayBtn = q('.tray-btn');
  const trayBadge = q('.tray-btn .badge');
  const updateCount = () => {
    countEl.textContent = `${game.lockedCount} / ${total}`;
    trayBadge.textContent = String(game.trayCount);
    trayBadge.classList.toggle('hidden', game.trayCount === 0);
    trayBtn.setAttribute('aria-pressed', String(game.isTrayOpen));
  };
  updateCount();
  const tick = window.setInterval(() => (timerEl.textContent = formatTime(game.elapsedMs)), 250);
  q('.loading').remove();
  if (import.meta.env.DEV) (window as unknown as { __game: PuzzleGame }).__game = game;
  game.start();

  // ---- 離開、暫停
  let leaving = false;
  let disposed = false;
  const leave = async (next: () => void) => {
    if (leaving) return;
    leaving = true;
    game.pause();
    await autosave.flush();
    next();
  };
  onBack = () => void leave(toImages);

  const pauseGame = () => {
    if (game.isFinished || node.querySelector('.pause-overlay')) return;
    game.pause();
    void autosave.flush();
    const o = el(`<div class="overlay pause-overlay"><div class="panel"><h2>${S.paused}</h2><p class="big-time">${formatTime(game.elapsedMs)}</p>
      <button class="btn primary big resume">${S.resumeGame}</button><button class="btn big leave">${S.leaveGame}</button></div></div>`);
    o.querySelector('.resume')!.addEventListener('click', () => {
      o.remove();
      game.start();
    });
    o.querySelector('.leave')!.addEventListener('click', () => void leave(toImages));
    node.append(o);
  };
  q('.pause-btn').addEventListener('click', pauseGame);

  // 切到背景時暫停並存檔；頁面被關閉前再存一次
  const onVisibility = () => {
    if (document.visibilityState === 'hidden') pauseGame();
  };
  const onPageHide = () => {
    game.pause();
    void autosave.flush();
  };
  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('pagehide', onPageHide);

  onLeave(() => {
    disposed = true;
    window.clearInterval(tick);
    autosave.cancel();
    document.removeEventListener('visibilitychange', onVisibility);
    window.removeEventListener('pagehide', onPageHide);
    game.destroy();
  });

  bindTools(node, game, updateCount);

  // ---- 完成
  async function finish(ms: number) {
    window.clearInterval(tick);
    autosave.cancel();
    timerEl.textContent = formatTime(ms);
    autosave.addPlayTime();
    const timeMs = Math.round(ms);
    const r = recordCompletion(store.save, { imageId: img.id, difficultyId: diff.id, pieces: total, timeMs, at: Date.now(), assistsUsed: [] });
    store.save = r.save;
    const unlocked = refreshTitles();
    await Promise.all([persist(), safeWrite(() => deleteProgress(img.id, diff.id))]);
    setTimeout(() => {
      if (disposed) return; // 結算出現前已離開遊戲畫面
      if (unlocked.length) sfx.title();
      showResult(node, img, diff, { timeMs, isNewBest: r.isNewBest, previousBest: r.previousBest, unlocked });
    }, RESULT_DELAY_MS);
  }
}

const PREVIEW_KEY = 'puzzle.previewWin';
const PREVIEW_MIN_W = 80;

/** 讀取記住的預覽視窗位置與寬度（以畫面比例儲存，視窗大小改變也能還原）。 */
function readPreviewPref(): { x: number; y: number; w: number } | null {
  try {
    const v = JSON.parse(localStorage.getItem(PREVIEW_KEY) ?? 'null');
    if (v && [v.x, v.y, v.w].every((n) => typeof n === 'number' && Number.isFinite(n))) return v;
  } catch { /* 無法讀取就用預設 */ }
  return null;
}

/** 預覽圖視窗：拖曳移動、右下角拖曳縮放（維持圖片比例），位置與大小跨關卡記住。 */
function bindPreviewWindow(win: HTMLElement, area: HTMLElement) {
  const handle = win.querySelector<HTMLElement>('.preview-resize')!;
  const bounds = () => area.getBoundingClientRect();
  const maxW = () => Math.max(PREVIEW_MIN_W, bounds().width - 16);

  const apply = (x: number, y: number, w: number) => {
    const b = bounds();
    w = Math.min(Math.max(w, PREVIEW_MIN_W), maxW());
    win.style.width = `${w}px`;
    const h = win.offsetHeight;
    x = Math.min(Math.max(x, 0), Math.max(0, b.width - w));
    y = Math.min(Math.max(y, 0), Math.max(0, b.height - h));
    win.style.left = `${x}px`;
    win.style.top = `${y}px`;
    win.style.right = 'auto';
    win.style.bottom = 'auto';
    return { x, y, w };
  };
  const save = () => {
    const b = bounds();
    const r = win.getBoundingClientRect();
    try {
      localStorage.setItem(PREVIEW_KEY, JSON.stringify({ x: (r.left - b.left) / b.width, y: (r.top - b.top) / b.height, w: r.width / b.width }));
    } catch { /* 存不了就算了 */ }
  };
  /** 視窗開啟或畫面尺寸改變時，依記住的比例還原並夾回畫面內；沒有記錄就維持 CSS 預設 */
  const restore = () => {
    if (!win.isConnected) { window.removeEventListener('resize', restore); return; }
    const p = readPreviewPref();
    if (!p || win.classList.contains('hidden')) return;
    const b = bounds();
    apply(p.x * b.width, p.y * b.height, p.w * b.width);
  };
  new MutationObserver(restore).observe(win, { attributes: true, attributeFilter: ['class'] });
  window.addEventListener('resize', restore);

  const drag = (el: HTMLElement, onMove: (dx: number, dy: number, start: DOMRect, b: DOMRect) => void) => {
    el.addEventListener('pointerdown', (e) => {
      if ((e.target as HTMLElement).closest('.preview-close')) return;
      e.preventDefault();
      e.stopPropagation();
      el.setPointerCapture(e.pointerId);
      const sx = e.clientX, sy = e.clientY;
      const start = win.getBoundingClientRect();
      const move = (ev: PointerEvent) => onMove(ev.clientX - sx, ev.clientY - sy, start, bounds());
      const up = () => {
        el.removeEventListener('pointermove', move);
        el.removeEventListener('pointerup', up);
        el.removeEventListener('pointercancel', up);
        save();
      };
      el.addEventListener('pointermove', move);
      el.addEventListener('pointerup', up);
      el.addEventListener('pointercancel', up);
    });
  };
  drag(win, (dx, dy, s, b) => apply(s.left - b.left + dx, s.top - b.top + dy, s.width));
  // 縮放：以左上角為錨點，依水平／垂直位移較大者放大縮小
  drag(handle, (dx, dy, s, b) => {
    const ratio = s.height / s.width;
    const delta = Math.abs(dx) > Math.abs(dy / ratio) ? dx : dy / ratio;
    apply(s.left - b.left, s.top - b.top, s.width + delta);
  });
}

/** 工具列：預覽、邊框篩選、托盤、視角、操作提示。 */
function bindTools(node: HTMLElement, game: PuzzleGame, updateCount: () => void) {
  const q = <T extends HTMLElement = HTMLElement>(sel: string) => node.querySelector<T>(sel)!;

  const previewImg = q('.preview');
  const previewBtn = q('.preview-btn');
  const setPreview = (on: boolean) => {
    previewImg.classList.toggle('hidden', !on);
    previewBtn.setAttribute('aria-pressed', String(on));
  };
  previewBtn.addEventListener('click', () => setPreview(previewImg.classList.contains('hidden')));
  q('.preview-close').addEventListener('click', () => setPreview(false));
  bindPreviewWindow(previewImg, node);

  const edgeBtn = q('.edge-btn');
  edgeBtn.addEventListener('click', () => {
    game.setEdgeOnly(!game.isEdgeOnly);
    edgeBtn.setAttribute('aria-pressed', String(game.isEdgeOnly));
  });

  q('.tray-btn').addEventListener('click', () => {
    game.setTrayOpen(!game.isTrayOpen);
    updateCount();
  });
  q('.gather-btn').addEventListener('click', () => game.gather());
  q('.fit-btn').addEventListener('click', () => game.resetView());
  q('.zoom-in').addEventListener('click', () => game.zoomBy(1.3));
  q('.zoom-out').addEventListener('click', () => game.zoomBy(1 / 1.3));

  // 工具列：可收成右上角一顆按鈕，狀態記在設定裡
  const tools = q('.tools');
  const toggle = q('.tools-toggle');
  const setCollapsed = (collapsed: boolean, remember = true) => {
    tools.classList.toggle('collapsed', collapsed);
    toggle.setAttribute('aria-expanded', String(!collapsed));
    toggle.setAttribute('aria-label', collapsed ? S.expandTools : S.collapseTools);
    toggle.innerHTML = icon(collapsed ? 'expand' : 'collapse');
    if (remember && store.save.settings.toolsCollapsed !== collapsed) {
      store.save.settings.toolsCollapsed = collapsed;
      void persist();
    }
  };
  setCollapsed(store.save.settings.toolsCollapsed, false);
  toggle.addEventListener('click', () => setCollapsed(!tools.classList.contains('collapsed')));

  // 操作提示：顯示與否記在設定裡，關掉後不再自動出現，可用「說明」按鈕重新打開
  const hintEl = q('.hint');
  const helpBtn = q('.help-btn');
  const setHints = (on: boolean, remember = true) => {
    hintEl.classList.toggle('hidden', !on);
    helpBtn.setAttribute('aria-pressed', String(on));
    if (remember && store.save.settings.showHints !== on) {
      store.save.settings.showHints = on;
      void persist();
    }
  };
  setHints(store.save.settings.showHints, false);
  helpBtn.addEventListener('click', () => setHints(hintEl.classList.contains('hidden')));
  q('.hint-close').addEventListener('click', () => setHints(false));
}

interface GameResult {
  timeMs: number;
  isNewBest: boolean;
  previousBest: number | null;
  /** 本局新解鎖的稱號 id */
  unlocked: string[];
}

/** 一次最多跳出幾個稱號通知，其餘合併成一則「還有 N 個」 */
const MAX_TITLE_TOASTS = 3;

function showResult(node: HTMLElement, img: PuzzleImage, diff: Difficulty, result: GameResult) {
  const { timeMs, isNewBest, previousBest } = result;
  const unlocked = result.unlocked.map((id) => defById.get(id)!);
  const titles = unlocked
    .map(
      (d) => `<li><div>${titleBadge(d)}<small class="rarity r-${d.rarity}">${S.rarityNames[d.rarity]}</small></div>
        <button class="btn small equip" data-id="${d.id}">${S.equip}</button></li>`,
    )
    .join('');
  const o = el(`<div class="overlay result"><div class="panel">
      <div class="frame"><img class="result-img" src="${asset(img.thumb)}" alt=""></div>
      <p class="room">${S.collected}</p>
      <h2>${S.completeTitle}</h2>
      <p class="muted">${esc(img.name)} · ${S.pieces(diff.label)}</p>
      <div class="result-time"><span>${S.timeUsed}</span><strong>${formatTime(timeMs)}</strong>
        ${isNewBest ? `<em class="new-record">${S.newRecord}</em>` : ''}
        ${previousBest !== null ? `<small>${S.previousBest(formatTime(previousBest))}</small>` : ''}
      </div>
      ${titles ? `<h3>${S.newTitles}</h3><ul class="new-titles">${titles}</ul>` : ''}
      <div class="row center wrap">
        <button class="btn again">${S.playAgain}</button>
        <button class="btn primary to-images">${S.backToImages}</button>
        <button class="btn ghost to-home">${S.home}</button>
      </div>
    </div></div>`);
  const equipButtons = [...o.querySelectorAll<HTMLButtonElement>('.equip')];
  for (const b of equipButtons) {
    b.addEventListener('click', async () => {
      store.save.profile.equippedTitle = b.dataset.id!;
      await persist();
      for (const x of equipButtons) {
        x.textContent = x === b ? S.equippedLabel : S.equip;
        x.disabled = x === b;
      }
    });
  }
  o.querySelector('.again')!.addEventListener('click', () => nav.game(img, diff));
  o.querySelector('.to-images')!.addEventListener('click', () => nav.images(img.category));
  o.querySelector('.to-home')!.addEventListener('click', nav.home);
  node.append(o);

  const stagger = (i: number) => 300 + i * 450;
  unlocked.slice(0, MAX_TITLE_TOASTS).forEach((d, i) => {
    setTimeout(() => toast(`<small>${S.titleUnlocked}</small>${titleBadge(d)}`, 'title-toast'), stagger(i));
  });
  const more = unlocked.length - MAX_TITLE_TOASTS;
  if (more > 0) setTimeout(() => toast(`<small>${S.moreTitles(more)}</small>`), stagger(MAX_TITLE_TOASTS));
}
