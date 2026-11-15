// 主畫面。
import { allProgress } from '../../core/storage';
import { asset, el, esc, mount } from '../dom';
import { nav } from '../nav';
import { content, defById, store, titleBadge } from '../state';
import { S } from '../strings';

// 畫框＋拼圖榫（與 PWA 圖示同一組圖形，見 scripts/make-icons.mjs）
const LOGO = `<svg viewBox="0 0 48 48" width="32" height="32" fill="none" stroke="var(--accent)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"><path d="M6 8H42V21A4.2 4.2 0 1 1 42 27V40H6Z"/><path d="M6 36 17 22l6 8 5-6 14 14"/><circle cx="15" cy="16" r="2.6" fill="var(--accent)" stroke="none"/></svg>`;

export function showHome() {
  const equipped = defById.get(store.save.profile.equippedTitle);
  // 主視覺：每次進主畫面隨機挑一幅
  // 獨立入口的分類（只能靠網址進入）不出現在主畫面：主視覺與館藏數都不計入
  const hidden = new Set(content.categories.filter((c) => c.standalone).map((c) => c.id));
  const shown = content.images.filter((i) => !hidden.has(i.category));
  const hero = shown[Math.floor(Math.random() * shown.length)];
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
          <p class="exhibit">${S.exhibition(shown.length)}</p>
          <div class="equipped"><span class="label">${S.equipped}</span>${titleBadge(equipped)}</div>
          <div class="hero-actions">
            <button class="btn primary big play">${S.play}</button>
            <button class="btn big continue hidden">${S.continueLast}</button>
          </div>
        </div>
        ${hero ? `<aside class="wall-label hero-label"><small>${S.nowShowing}</small><strong>${esc(hero.name)}</strong>${hero.artist ? `<span>${esc(hero.artist)}</span>` : ''}${hero.license ? `<em>${esc(hero.license)}</em>` : ''}</aside>` : ''}
      </section>
    </main>`);
  if (hero) {
    // CSS 變數內的相對 URL 會以樣式表（打包後在 assets/）為基準，須先換成以頁面為基準的絕對網址
    const url = new URL(asset(hero.src), document.baseURI).href;
    node.querySelector<HTMLElement>('.hero')!.style.setProperty('--hero', `url("${url}")`);
  }
  node.querySelector('.play')!.addEventListener('click', nav.categories);  node.querySelector('.titles')!.addEventListener('click', nav.titles);
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
