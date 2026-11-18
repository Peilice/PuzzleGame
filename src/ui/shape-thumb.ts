// 造型（異型切割）圖片的縮圖：依拼盤輪廓裁切，並疊上示意切線，
// 讓選圖時就看得出這張拼圖的外形與不規則拼片，不會誤以為是一般長方形拼圖。
import type { PuzzleImage } from '../core/content';
import { isSilhouette, makeIrregularLayout } from '../core/irregular';
import type { PathSink } from '../core/puzzle';
import { asset } from './dom';
import { content } from './state';

/** 示意切線用的片數（4 × 3）：夠看出不規則，又不會在小卡片上糊成一團 */
const COLS = 4;
const ROWS = 3;
/** 縮圖都是 4:3 */
const ASPECT = 4 / 3;

const f = (n: number) => n.toFixed(1);

function pathSink(ox: number, oy: number) {
  let d = '';
  const sink: PathSink = {
    moveTo: (x, y) => (d += `M${f(ox + x)} ${f(oy + y)}`),
    lineTo: (x, y) => (d += `L${f(ox + x)} ${f(oy + y)}`),
    bezierCurveTo: (a, b, c, e, x, y) => (d += `C${f(ox + a)} ${f(oy + b)} ${f(ox + c)} ${f(oy + e)} ${f(ox + x)} ${f(oy + y)}`),
    closePath: () => (d += 'Z'),
  };
  return { sink, d: () => d };
}

/** 依圖片 id 取固定的種子，每張圖的示意切法不同但每次都一樣 */
function seedOf(id: string) {
  let h = 2166136261;
  for (let k = 0; k < id.length; k++) h = Math.imul(h ^ id.charCodeAt(k), 16777619);
  return h >>> 0;
}

export const isShaped = (img: PuzzleImage) => content.categories.find((c) => c.id === img.category)?.cut === 'irregular';

/** 縮圖的 HTML：造型圖會裁成輪廓並疊上切線，其他圖片維持一般 <img> */
export function thumbHtml(img: PuzzleImage, cls = '') {
  const tag = `<img src="${asset(img.thumb)}" alt="" loading="lazy"${cls ? ` class="${cls}"` : ''}>`;
  if (!isShaped(img)) return tag;
  const silhouette = isSilhouette(img.silhouette) ? img.silhouette : 'rect';
  const L = makeIrregularLayout(COLS, ROWS, ASPECT, seedOf(img.id), silhouette);
  const { boardW: W, boardH: H } = L;
  const clip = L.outline ? `polygon(${L.outline.map(([x, y]) => `${f((x / W) * 100)}% ${f((y / H) * 100)}%`).join(',')})` : '';
  const d = L.geoms
    .map((g) => {
      const p = pathSink(g.x, g.y);
      g.trace(p.sink);
      return p.d();
    })
    .join('');
  return `
    <div class="shape-thumb${cls ? ` ${cls}` : ''}" data-silhouette="${silhouette}">
      <img src="${asset(img.thumb)}" alt="" loading="lazy"${clip ? ` style="clip-path:${clip}"` : ''}>
      <svg viewBox="0 0 ${f(W)} ${f(H)}" preserveAspectRatio="none" aria-hidden="true">
        <path class="cut-shadow" d="${d}"/><path class="cut-line" d="${d}"/>
      </svg>
    </div>`;
}
