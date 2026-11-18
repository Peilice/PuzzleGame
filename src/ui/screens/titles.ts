// 稱號圖鑑：依系列分段，分類／難度／速度線再依分類或難度分小組，方便分辨稱號的來源。
import { computeStats } from '../../core/stats';
import { TITLE_LINES, visibleTitles, type TitleLine, type TitleView } from '../../core/titles';
import { el, esc, header, mount } from '../dom';
import { formatDate, formatNumber } from '../format';
import { nav } from '../nav';
import { content, defs, persist, store } from '../state';
import { S } from '../strings';

type Filter = TitleLine | 'all';

/** 依出現順序分組（Map 保留插入順序，與 buildTitles 的排列一致） */
function groupBy<T>(items: T[], key: (item: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const it of items) {
    const k = key(it);
    const list = map.get(k);
    if (list) list.push(it);
    else map.set(k, [it]);
  }
  return map;
}

const countText = (views: TitleView[]) => S.lineCount(views.filter((v) => v.unlocked).length, views.length);

export function showTitles(filter: Filter = 'all') {
  const stats = computeStats(store.save, content);
  const views = visibleTitles(store.save, stats, content, defs);
  const unlockedCount = views.filter((v) => v.unlocked).length;
  const filters: Filter[] = ['all', ...TITLE_LINES];
  const tabs = filters
    .map((l) => `<button class="tab ${l === filter ? 'active' : ''}" data-line="${l}">${l === 'all' ? S.all : S.lineNames[l]}</button>`)
    .join('');
  const node = el(`<main class="screen"><p class="center muted count-line">${S.titleCount(unlockedCount, views.length)}</p><div class="tabs">${tabs}</div><div class="title-sections"></div></main>`);
  node.prepend(header(S.titles, nav.home));
  const sections = node.querySelector('.title-sections')!;

  const renderCard = (v: TitleView) => {
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
          ${v.unlockedAt !== null ? `<small class="got">✓ ${S.unlockedOn(formatDate(v.unlockedAt))}</small>` : `<small class="muted">${S.locked}</small>`}
          ${v.unlocked ? `<button class="btn small equip" ${equipped ? 'disabled' : ''}>${equipped ? S.equippedLabel : S.equip}</button>` : ''}
        </div>
      </div>`);
    card.querySelector('.equip')?.addEventListener('click', async () => {
      store.save.profile.equippedTitle = d.id;
      await persist();
      showTitles(filter);
    });
    return card;
  };

  const renderGrid = (items: TitleView[]) => {
    const grid = el(`<div class="title-grid"></div>`);
    for (const v of items) grid.append(renderCard(v));
    return grid;
  };

  const lines = filter === 'all' ? TITLE_LINES : [filter];
  for (const line of lines) {
    const lineViews = views.filter((v) => v.def.line === line);
    if (!lineViews.length) continue;
    const section = el(`
      <section class="title-section">
        <h2 class="title-section-head"><span>${S.lineNames[line]}</span><small>${countText(lineViews)}</small></h2>
      </section>`);
    const groups = groupBy(lineViews, (v) => S.titleGroup(v.def.condition) ?? '');
    if (groups.size === 1 && groups.has('')) {
      section.append(renderGrid(lineViews));
    } else {
      for (const [name, items] of groups) {
        const group = el(`
          <div class="title-group">
            <h3 class="title-group-head"><span>${esc(name)}</span><small>${countText(items)}</small></h3>
          </div>`);
        group.append(renderGrid(items));
        section.append(group);
      }
    }
    sections.append(section);
  }

  node.querySelectorAll<HTMLButtonElement>('.tab').forEach((t) => t.addEventListener('click', () => showTitles(t.dataset.line as Filter)));
  mount(node);
}
