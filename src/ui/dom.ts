// DOM 小工具：建立元素、切換畫面、對話框、通知。
import { S } from './strings';

export const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** public/ 下的資源路徑（考慮部署的 base） */
export const asset = (p: string) => `${import.meta.env.BASE_URL}${p}`;

export function el<T extends HTMLElement = HTMLElement>(html: string): T {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild as T;
}

// ------------------------------------------------------------------ 畫面切換

const root = () => document.getElementById('app')!;
let leaveCurrent: (() => void) | null = null;

/** 換上新畫面；先執行上一個畫面登記的清理工作。 */
export function mount(node: HTMLElement) {
  leaveCurrent?.();
  leaveCurrent = null;
  const r = root();
  r.replaceChildren(node);
  r.scrollTop = 0;
  window.scrollTo(0, 0);
}

/** 登記目前畫面被換掉時要做的清理（計時器、事件監聽等）。 */
export function onLeave(fn: () => void) {
  leaveCurrent = fn;
}

export const isMounted = (node: HTMLElement) => root().firstElementChild === node;

export function header(title: string, back: () => void) {
  const h = el(`<header class="topbar"><button class="btn ghost back">‹ ${S.back}</button><h1>${esc(title)}</h1><span></span></header>`);
  h.querySelector('.back')!.addEventListener('click', back);
  return h;
}

// ------------------------------------------------------------------ 通知

export function toast(html: string, cls = '', durationMs = 3200) {
  let holder = document.getElementById('toasts');
  if (!holder) {
    holder = el('<div id="toasts" role="status" aria-live="polite"></div>');
    document.body.append(holder);
  }
  const t = el(`<div class="toast ${cls}">${html}</div>`);
  holder.append(t);
  setTimeout(() => t.classList.add('out'), durationMs);
  setTimeout(() => t.remove(), durationMs + 600);
}

// ------------------------------------------------------------------ 對話框

/** 目前開著的對話框（後開的在後面）；Esc 只關最上層那個 */
const openModals: HTMLElement[] = [];

/**
 * 開啟對話框。點背景或按 Esc 會關閉；關閉後焦點回到原本的元素。
 * innerHtml 為 .modal 內的內容；回傳對話框元素與關閉函式。
 */
export function openModal(innerHtml: string, opts: { cls?: string; onClose?: () => void } = {}) {
  const back = el(`<div class="modal-back"><div class="modal ${opts.cls ?? ''}" role="dialog" aria-modal="true" tabindex="-1">${innerHtml}</div></div>`);
  const modal = back.firstElementChild as HTMLElement;
  const previous = document.activeElement as HTMLElement | null;
  const close = () => {
    const at = openModals.indexOf(back);
    if (at < 0) return;
    openModals.splice(at, 1);
    document.removeEventListener('keydown', onKey);
    back.remove();
    previous?.focus?.();
    opts.onClose?.();
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && openModals[openModals.length - 1] === back) close();
  };
  back.addEventListener('click', (e) => e.target === back && close());
  document.addEventListener('keydown', onKey);
  openModals.push(back);
  document.body.append(back);
  // 焦點移到對話框本身而非按鈕，避免連按 Enter 誤觸「確定」
  modal.focus();
  return { modal, close };
}

export function confirmDialog(message: string): Promise<boolean> {
  return new Promise((resolve) => {
    let answer = false;
    const { modal, close } = openModal(
      `<p>${esc(message)}</p><div class="row end"><button class="btn ghost no">${S.cancel}</button><button class="btn primary yes">${S.ok}</button></div>`,
      { onClose: () => resolve(answer) },
    );
    modal.querySelector('.no')!.addEventListener('click', close);
    modal.querySelector('.yes')!.addEventListener('click', () => {
      answer = true;
      close();
    });
  });
}
