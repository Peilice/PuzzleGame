// 主畫面。
import { allProgress } from '../../core/storage';
import { asset, el, esc, mount } from '../dom';
import { nav } from '../nav';
import { content, defById, store, titleBadge } from '../state';
import { S } from '../strings';

const LOGO = `<svg viewBox="0 0 100 100" width="24" height="24"><path fill="#f4b942" d="M10 10h32c0-10 16-10 16 0h32v32c-10 0-10 16 0 16v32H58c0 10-16 10-16 0H10V58c10 0 10-16 0-16z"/><path fill="#e07a5f" d="M10 10h32c0-10 16-10 16 0h-8v40H10V42c10 0 10-16 0-16z" opacity=".9"/><path fill="#81b29a" d="M50 50h40v8c-10 0-10 16 0 16v16H58c0 10-16 10-16 0h8z" opacity=".9"/></svg>`;

export function showHome() {
  const equipped = defById.get(store.save.profile.equippedTitle);
  // 主視覺：每次進主畫面隨機挑一幅
  const hero = content.images[Math.floor(Math.random() * content.images.length)];
  const node = el(`
    <main class="screen home">
      <nav class="home-bar">
        <span class="brand"><span aria-hidden="true">${LOGO}</span><span>${S.appName}</span></span>
        <span class="links">
          <button class="link titles">${S.titles}</button>
          <button class="link stats">${S.stats}</button>
          <button class="link settings">${S.settings}</button>
        </span>
      </nav>
      <section class="hero">
        <div class="hero-text">
          <h1 class="app-name">${S.appName}</h1>
          <p class="tagline">${S.appTagline}</p>
          <p class="exhibit">${S.exhibition(content.images.length)}</p>
          <div class="equipped"><span class="label">${S.equipped}</span>${titleBadge(equipped)}</div>
          <div class="hero-actions">
            <button class="btn primary big play">${S.play}</button>
            <button class="btn big continue hidden">${S.continueLast}</button>
          </div>
        </div>
        ${hero ? `<aside class="wall-label hero-label"><small>${S.nowShowing}</small><strong>${esc(hero.name)}</strong>${hero.artist ? `<span>${esc(hero.artist)}</span>` : ''}${hero.license ? `<em>${esc(hero.license)}</em>` : ''}</aside>` : ''}
      </section>
    </main>`);
  if (hero) node.querySelector<HTMLElement>('.hero')!.style.setProperty('--hero', `url("${asset(hero.src)}")`);
  node.querySelector('.play')!.addEventListener('click', nav.categories);
  node.querySelector('.titles')!.addEventListener('click', nav.titles);
  node.querySelector('.stats')!.addEventListener('click', nav.stats);
  node.querySelector('.settings')!.addEventListener('click', nav.settings);
  mount(node);
  void showContinue(node.querySelector<HTMLButtonElement>('.continue')!);
}

/** 有未完成的進度時，顯示「繼續上一局」（最近玩的那一局）。 */
async function showContinue(btn: HTMLButtonElement) {
  let last: { img: (typeof content.images)[number]; diff: (typeof content.difficulties)[number]; updatedAt: number } | null = null;
  for (const p of await allProgress().catch(() => [])) {
    const img = content.images.find((i) => i.id === p.imageId);
    const diff = content.difficulties.find((d) => d.id === p.difficultyId);
    // 圖片或難度已不存在的舊進度略過
    if (img && diff && (!last || p.updatedAt > last.updatedAt)) last = { img, diff, updatedAt: p.updatedAt };
  }
  if (!last) return;
  const { img, diff } = last;
  btn.classList.remove('hidden');
  btn.innerHTML = `${S.continueLast}<small>${esc(img.name)} · ${S.pieces(diff.label)}</small>`;
  btn.addEventListener('click', () => nav.game(img, diff));
}
