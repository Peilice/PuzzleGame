// 稱號圖鑑。
import { computeStats } from '../../core/stats';
import { TITLE_LINES, visibleTitles, type TitleLine } from '../../core/titles';
import { el, esc, header, mount } from '../dom';
import { formatDate, formatNumber } from '../format';
import { nav } from '../nav';
import { content, defs, persist, store } from '../state';
import { S } from '../strings';

type Filter = TitleLine | 'all';

export function showTitles(filter: Filter = 'all') {
  const stats = computeStats(store.save, content);
  const views = visibleTitles(store.save, stats, content, defs);
  const unlockedCount = views.filter((v) => v.unlocked).length;
  const filters: Filter[] = ['all', ...TITLE_LINES];
  const tabs = filters
    .map((l) => `<button class="tab ${l === filter ? 'active' : ''}" data-line="${l}">${l === 'all' ? S.all : S.lineNames[l]}</button>`)
    .join('');
  const node = el(`<main class="screen"><p class="center muted count-line">${S.titleCount(unlockedCount, views.length)}</p><div class="tabs">${tabs}</div><div class="title-grid"></div></main>`);
  node.prepend(header(S.titles, nav.home));
  const grid = node.querySelector('.title-grid')!;
  for (const v of views) {
    if (filter !== 'all' && v.def.line !== filter) continue;
    const d = v.def;
    const secret = !v.unlocked && d.hidden;
    const prog = !v.unlocked && !secret && d.progress ? d.progress(stats, content) : null;
    const equipped = store.save.profile.equippedTitle === d.id;
    const progressBar = prog
      ? `<div class="bar"><i style="width:${Math.min(100, (prog.value / Math.max(1, prog.target)) * 100)}%"></i></div><small class="muted">${formatNumber(prog.value)} / ${formatNumber(prog.target)}</small>`
      : '';
    const card = el(`
      <div class="title-card ${v.unlocked ? 'unlocked' : 'locked'} r-${d.rarity}">
        <div class="title-head">
          <span class="title-name">${secret ? S.hiddenTitle : esc(d.name)}</span>
          <span class="rarity r-${d.rarity}">${S.rarityNames[d.rarity]}</span>
        </div>
        <p class="cond">${secret ? S.hiddenCondition : esc(S.titleCondition(d.condition))}</p>
        ${progressBar}
        ${v.hasNewContent ? `<p class="new-content">${S.hasNewContent}</p>` : ''}
        <div class="title-foot">
          <small class="muted">${v.unlockedAt !== null ? S.unlockedOn(formatDate(v.unlockedAt)) : S.locked}</small>
          ${v.unlocked ? `<button class="btn small equip" ${equipped ? 'disabled' : ''}>${equipped ? S.equippedLabel : S.equip}</button>` : ''}
        </div>
      </div>`);
    card.querySelector('.equip')?.addEventListener('click', async () => {
      store.save.profile.equippedTitle = d.id;
      await persist();
      showTitles(filter);
    });
    grid.append(card);
  }
  node.querySelectorAll<HTMLButtonElement>('.tab').forEach((t) => t.addEventListener('click', () => showTitles(t.dataset.line as Filter)));
  mount(node);
}
