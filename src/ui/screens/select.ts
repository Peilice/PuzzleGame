// 選分類 → 選圖片 → 選難度。
import type { PuzzleImage } from '../../core/content';
import { comboKey } from '../../core/save';
import { categoryCap, computeStats } from '../../core/stats';
import { allProgress, deleteProgress, type GameProgress } from '../../core/storage';
import { asset, confirmDialog, el, esc, header, mount, openModal } from '../dom';
import { formatTime } from '../format';
import { nav } from '../nav';
import { content, safeWrite, store } from '../state';
import { S } from '../strings';

const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'];

/** 獨立入口的分類（不在分類列表中，由主畫面的「異型拼圖」進入） */
export const SHAPED_CATEGORY = 'shaped';

export function showCategories() {
  const stats = computeStats(store.save, content);
  const node = el(`<main class="screen"><div class="grid cats"></div></main>`);
  node.prepend(header(S.chooseCategory, nav.home));
  const grid = node.querySelector('.grid')!;
  let room = 0;
  for (const cat of content.categories) {
    if (cat.standalone) continue;
    const imgs = content.images.filter((i) => i.category === cat.id);
    if (!imgs.length) continue;
    room++;
    const done = stats.combosByCategory.get(cat.id) ?? 0;
    const cap = categoryCap(content, cat.id);
    const card = el(`
      <button class="card cat-card">
        <img src="${asset(imgs[0].thumb)}" alt="" loading="lazy">
        <div class="card-body">
          <span class="room">${S.room(ROMAN[room - 1] ?? String(room))}</span>
          <h2>${esc(cat.name)}</h2>
          <p>${S.combosDone(done, cap)}</p>
          <div class="bar"><i style="width:${(done / cap) * 100}%"></i></div>
        </div>
      </button>`);
    card.addEventListener('click', () => nav.images(cat.id));
    grid.append(card);
  }
  mount(node);
}

export async function showImages(categoryId: string) {
  const cat = content.categories.find((c) => c.id === categoryId);
  if (!cat) return nav.categories();
  // 獨立入口的分類從主畫面進來，返回也回主畫面
  const back = cat.standalone ? nav.home : nav.categories;
  const progress = new Map((await allProgress().catch(() => [])).map((p) => [comboKey(p.imageId, p.difficultyId), p]));
  const node = el(`<main class="screen"><div class="grid imgs"></div></main>`);
  node.prepend(header(cat.name, back));
  const grid = node.querySelector('.grid')!;
  for (const img of content.images.filter((i) => i.category === categoryId)) {
    const card = el(`
      <button class="card img-card">
        <img src="${asset(img.thumb)}" alt="" loading="lazy">
        <div class="card-body"><h3>${esc(img.name)}</h3></div>
      </button>`);
    card.addEventListener('click', () => showDifficultyDialog(img, progress));
    grid.append(card);
  }
  mount(node);
}

function showDifficultyDialog(img: PuzzleImage, progress: Map<string, GameProgress>) {
  const rows = content.difficulties
    .map((d) => {
      const key = comboKey(img.id, d.id);
      const best = store.save.best[key];
      const prog = progress.get(key);
      const pct = prog && prog.pieces.length ? Math.floor((prog.pieces.filter((p) => p[3] === 1).length / prog.pieces.length) * 100) : 0;
      return `
      <div class="diff-row" data-id="${d.id}">
        <div class="diff-info">
          <strong>${S.pieces(d.label)}</strong>
          <small>${S.bestTime}：${best !== undefined ? formatTime(best) : S.noRecord}${prog ? ` · ${S.inProgress(pct)}` : ''}</small>
        </div>
        <div class="diff-actions">
          ${prog ? `<button class="btn ghost restart">${S.restart}</button><button class="btn primary resume">${S.resume}</button>` : `<button class="btn primary go">${S.start}</button>`}
        </div>
      </div>`;
    })
    .join('');
  const { modal, close } = openModal(
    `<div class="frame"><img class="diff-thumb" src="${asset(img.thumb)}" alt=""></div>
      <h2>${esc(img.name)}</h2>
      <p class="artist">${[img.artist, img.license].filter(Boolean).map((x) => esc(x!)).join('　·　')}</p>
      <p class="muted">${S.chooseDifficulty}</p>
      ${rows}
      <div class="row end"><button class="btn ghost close">${S.cancel}</button></div>`,
    { cls: 'diff-modal' },
  );
  modal.querySelector('.close')!.addEventListener('click', close);
  modal.querySelectorAll<HTMLElement>('.diff-row').forEach((row) => {
    const diff = content.difficulties.find((x) => x.id === row.dataset.id)!;
    const play = () => {
      close();
      nav.game(img, diff);
    };
    row.querySelector('.go')?.addEventListener('click', play);
    row.querySelector('.resume')?.addEventListener('click', play);
    row.querySelector('.restart')?.addEventListener('click', async () => {
      if (!(await confirmDialog(S.confirmRestart))) return;
      await safeWrite(() => deleteProgress(img.id, diff.id));
      play();
    });
  });
}
