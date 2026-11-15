// 統計頁。
import { mainImages } from '../../core/content';
import { comboKey } from '../../core/save';
import { categoryCap, computeStats } from '../../core/stats';
import { visibleTitles } from '../../core/titles';
import { el, esc, header, mount } from '../dom';
import { formatNumber, formatTime } from '../format';
import { nav } from '../nav';
import { content, defs, store } from '../state';
import { S } from '../strings';

const barRow = (label: string, done: number, cap: number) =>
  `<li><span>${esc(label)}</span><div class="bar"><i style="width:${cap ? (done / cap) * 100 : 0}%"></i></div><b>${done} / ${cap}</b></li>`;

export function showStats(filterCat = content.categories[0].id) {
  const { save } = store;
  const stats = computeStats(save, content);
  const views = visibleTitles(save, stats, content, defs);
  // 獨立入口的分類（只能靠網址進入）要完成過才會出現在統計裡，沒玩過的人看不到它
  const shownCategories = content.categories.filter((c) => !c.standalone || (stats.combosByCategory.get(c.id) ?? 0) > 0);
  const catRows = shownCategories.map((c) => barRow(c.name, stats.combosByCategory.get(c.id) ?? 0, categoryCap(content, c.id))).join('');
  const diffRows = content.difficulties
    .map((d) => barRow(S.pieces(d.label), stats.combosByDifficulty.get(d.id) ?? 0, mainImages(content).length))
    .join('');
  const catTabs = shownCategories
    .map((c) => `<button class="tab ${c.id === filterCat ? 'active' : ''}" data-cat="${c.id}">${esc(c.name)}</button>`)
    .join('');
  const matrix = content.images
    .filter((i) => i.category === filterCat)
    .map((i) => {
      const cells = content.difficulties
        .map((d) => {
          const best = save.best[comboKey(i.id, d.id)];
          return `<td class="${best !== undefined ? 'has' : ''}">${best !== undefined ? formatTime(best) : '—'}</td>`;
        })
        .join('');
      return `<tr><th>${esc(i.name)}</th>${cells}</tr>`;
    })
    .join('');
  const node = el(`<main class="screen stats-screen">
      <section class="panel-card"><h2>${S.overview}</h2>
        <div class="kpis">
          <div><small>${S.totalPlayTime}</small><b>${S.duration(save.totalPlayMs)}</b></div>
          <div><small>${S.totalPieces}</small><b>${formatNumber(stats.totalPieces)}</b></div>
          <div><small>${S.totalCompletions}</small><b>${stats.totalCompletions}</b></div>
          <div><small>${S.titlesUnlocked}</small><b>${views.filter((v) => v.unlocked).length} / ${views.length}</b></div>
        </div>
      </section>
      <section class="panel-card"><h2>${S.byCategory}</h2><ul class="bars">${catRows}</ul></section>
      <section class="panel-card"><h2>${S.byDifficulty}</h2><ul class="bars">${diffRows}</ul></section>
      <section class="panel-card"><h2>${S.bestTimes}</h2><div class="tabs">${catTabs}</div>
        <div class="table-wrap"><table class="matrix"><thead><tr><th>${S.image}</th>${content.difficulties.map((d) => `<th>${d.label}</th>`).join('')}</tr></thead><tbody>${matrix}</tbody></table></div>
      </section>
    </main>`);
  node.prepend(header(S.stats, nav.home));
  node.querySelectorAll<HTMLButtonElement>('.tab').forEach((t) => t.addEventListener('click', () => showStats(t.dataset.cat!)));
  mount(node);
}
