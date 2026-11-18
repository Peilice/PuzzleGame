// 造型（異型切割）圖片的縮圖：依拼盤輪廓裁切，
// 讓選圖時就看得出這張拼圖的外形，不會誤以為是一般長方形拼圖。
import type { PuzzleImage } from '../core/content';
import { isSilhouette, silhouettePolygon } from '../core/irregular';
import { asset } from './dom';
import { content } from './state';

const f = (n: number) => n.toFixed(1);

export const isShaped = (img: PuzzleImage) => content.categories.find((c) => c.id === img.category)?.cut === 'irregular';

/** 縮圖的 HTML：造型圖會裁成輪廓，其他圖片維持一般 <img> */
export function thumbHtml(img: PuzzleImage, cls = '') {
  const tag = (attrs = '') => `<img src="${asset(img.thumb)}" alt="" loading="lazy"${attrs}>`;
  if (!isShaped(img)) return tag(cls ? ` class="${cls}"` : '');
  const silhouette = isSilhouette(img.silhouette) ? img.silhouette : 'rect';
  // 縮圖都是 4:3，以 100 × 75 的座標算出百分比
  const clip =
    silhouette === 'rect' ? '' : `polygon(${silhouettePolygon(silhouette, 100, 75).map(([x, y]) => `${f(x)}% ${f((y / 75) * 100)}%`).join(',')})`;
  return `
    <div class="shape-thumb${cls ? ` ${cls}` : ''}" data-silhouette="${silhouette}">
      ${tag(clip ? ` style="clip-path:${clip}"` : '')}
    </div>`;
}
