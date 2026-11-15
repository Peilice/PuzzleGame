// 「異型」分類的圖片：以程式生成的幾何藝術（固定種子，每次輸出一致）。
// 全部原創、無外部素材，授權視為 CC0。
// 用法：
//   node scripts/shaped-art.mjs <輸出資料夾>      # 只輸出 shaped-XX.webp / -thumb.webp 供預覽
// 也由 scripts/fetch-images.mjs build 呼叫 renderShaped()。
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const W = 1920;
const H = 1440;
const THUMB_W = 400;
const THUMB_H = 300;

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const f = (n) => Math.round(n * 10) / 10;
const svg = (body, defs = '') => `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><defs>${defs}</defs>${body}</svg>`;

/** #rrggbb → [r,g,b] */
const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const toHex = (c) => '#' + c.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
const mix = (a, b, t) => {
  const A = rgb(a);
  const B = rgb(b);
  return toHex(A.map((v, i) => v + (B[i] - v) * t));
};
/** 在色票上依 0..1 取內插色 */
const ramp = (stops, t) => {
  const x = Math.max(0, Math.min(0.9999, t)) * (stops.length - 1);
  const i = Math.floor(x);
  return mix(stops[i], stops[i + 1], x - i);
};

// ---------------------------------------------------------------------------
// 01 八角星磚：摩洛哥彩磚常見的八角星與十字格

function islamicStars() {
  const T = 240;
  const r = rng(11);
  let out = `<rect width="${W}" height="${H}" fill="#10243f"/>`;
  const star = (cx, cy, R, ri, rot) => {
    const pts = [];
    for (let k = 0; k < 16; k++) {
      const a = rot + (k * Math.PI) / 8;
      const rr = k % 2 === 0 ? R : ri;
      pts.push(`${f(cx + Math.cos(a) * rr)},${f(cy + Math.sin(a) * rr)}`);
    }
    return pts.join(' ');
  };
  const palette = ['#e9b44c', '#d96c3b', '#3a9d93', '#f2e6c9'];
  for (let y = -1; y <= H / T + 1; y++) {
    for (let x = -1; x <= W / T + 1; x++) {
      const cx = x * T + T / 2;
      const cy = y * T + T / 2;
      const alt = (x + y) % 2 === 0;
      // 角落的小菱形（四顆星之間的空隙）
      const gx = cx + T / 2;
      const gy = cy + T / 2;
      const d = T * 0.17;
      out += `<polygon points="${f(gx)},${f(gy - d)} ${f(gx + d)},${f(gy)} ${f(gx)},${f(gy + d)} ${f(gx - d)},${f(gy)}" fill="${alt ? '#3a9d93' : '#e9b44c'}" stroke="#f2e6c9" stroke-width="2"/>`;
      // 外星
      out += `<polygon points="${star(cx, cy, T * 0.5, T * 0.29, -Math.PI / 8)}" fill="${alt ? palette[0] : palette[3]}" stroke="#10243f" stroke-width="3" stroke-linejoin="round"/>`;
      // 中星
      out += `<polygon points="${star(cx, cy, T * 0.34, T * 0.17, 0)}" fill="${alt ? palette[1] : palette[2]}" stroke="#10243f" stroke-width="2.5" stroke-linejoin="round"/>`;
      // 花心
      out += `<circle cx="${f(cx)}" cy="${f(cy)}" r="${T * 0.1}" fill="${alt ? '#f2e6c9' : '#e9b44c'}" stroke="#10243f" stroke-width="2.5"/>`;
      out += `<circle cx="${f(cx)}" cy="${f(cy)}" r="${T * 0.04}" fill="#10243f"/>`;
      void r;
    }
  }
  const glow = `<radialGradient id="g" cx="50%" cy="50%" r="75%"><stop offset="55%" stop-color="#000" stop-opacity="0"/><stop offset="100%" stop-color="#000" stop-opacity=".45"/></radialGradient>`;
  return svg(out + `<rect width="${W}" height="${H}" fill="url(#g)"/>`, glow);
}

// ---------------------------------------------------------------------------
// 02 生命之花：六角格上重疊的圓，金線與半透明色塊

function flowerOfLife() {
  const R = 110;
  const dy = R * Math.sqrt(3) / 2;
  const stops = ['#7b2ff7', '#d62f8c', '#f77f3b', '#f7c548', '#2fb5a4'];
  let out = '';
  for (let row = -1; row < H / dy + 2; row++) {
    for (let col = -1; col < W / R + 2; col++) {
      const cx = col * R + (row % 2 ? R / 2 : 0);
      const cy = row * dy;
      const t = (cx / W) * 0.55 + (cy / H) * 0.45;
      out += `<circle cx="${f(cx)}" cy="${f(cy)}" r="${R}" fill="${ramp(stops, t)}" fill-opacity=".22" stroke="#f6dc9b" stroke-opacity=".85" stroke-width="2.2"/>`;
    }
  }
  const defs = `<radialGradient id="bg" cx="50%" cy="50%" r="80%"><stop offset="0" stop-color="#2a1757"/><stop offset="1" stop-color="#0b0620"/></radialGradient>`;
  return svg(`<rect width="${W}" height="${H}" fill="url(#bg)"/>${out}`, defs);
}

// ---------------------------------------------------------------------------
// 03 萬花曼陀羅：多層花瓣由中心向外

function mandala() {
  const cx = W / 2;
  const cy = H / 2;
  const stops = ['#e3cb92', '#d1a257', '#bd6a44', '#9c4150', '#74306a', '#452a6e', '#252658'];
  let out = '';
  const layers = 11;
  const step = 118;
  for (let i = layers; i >= 0; i--) {
    const n = 12 + (i % 3) * 4;
    const r0 = i * step;
    const r1 = r0 + step * 1.9;
    const w = ((Math.PI * 2 * (r0 + step * 0.9)) / n) * 0.62;
    const col = ramp(stops, i / layers);
    const col2 = ramp(stops, Math.min(1, i / layers + 0.12));
    for (let k = 0; k < n; k++) {
      const a = ((k + (i % 2 ? 0.5 : 0)) * 360) / n;
      out += `<g transform="translate(${cx} ${cy}) rotate(${f(a)})"><path d="M${f(r0)},0 C${f(r0 + (r1 - r0) * 0.25)},${f(-w)} ${f(r0 + (r1 - r0) * 0.8)},${f(-w * 0.55)} ${f(r1)},0 C${f(r0 + (r1 - r0) * 0.8)},${f(w * 0.55)} ${f(r0 + (r1 - r0) * 0.25)},${f(w)} ${f(r0)},0Z" fill="${col}" stroke="${col2}" stroke-width="2.5" stroke-linejoin="round"/><path d="M${f(r0 + step * 0.35)},0 Q${f(r0 + step * 0.9)},${f(-w * 0.32)} ${f(r1 - step * 0.35)},0 Q${f(r0 + step * 0.9)},${f(w * 0.32)} ${f(r0 + step * 0.35)},0Z" fill="#fff" fill-opacity=".12"/></g>`;
    }
    out += `<circle cx="${cx}" cy="${cy}" r="${f(r0 + step * 0.2)}" fill="none" stroke="#fff" stroke-opacity=".14" stroke-width="2"/>`;
  }
  out += `<circle cx="${cx}" cy="${cy}" r="62" fill="#ecdcb0" stroke="#d1a257" stroke-width="6"/><circle cx="${cx}" cy="${cy}" r="28" fill="#9c4150"/>`;
  const defs = `<radialGradient id="bg" cx="50%" cy="50%" r="75%"><stop offset="0" stop-color="#1d1d4a"/><stop offset="1" stop-color="#090720"/></radialGradient>`;
  return svg(`<rect width="${W}" height="${H}" fill="url(#bg)"/>${out}`, defs);
}

// ---------------------------------------------------------------------------
// 04 琉璃彩窗：Voronoi 分區，深色鉛條

function clip(poly, ax, ay, bx, by) {
  // 保留離 a 比 b 近的半平面
  const mx = (ax + bx) / 2;
  const my = (ay + by) / 2;
  const nx = bx - ax;
  const ny = by - ay;
  const side = (p) => (p[0] - mx) * nx + (p[1] - my) * ny;
  const out = [];
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    const sp = side(p);
    const sq = side(q);
    if (sp <= 0) out.push(p);
    if ((sp < 0 && sq > 0) || (sp > 0 && sq < 0)) {
      const t = sp / (sp - sq);
      out.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]);
    }
  }
  return out;
}

function voronoiCells(pts) {
  return pts.map((p, i) => {
    let poly = [[-50, -50], [W + 50, -50], [W + 50, H + 50], [-50, H + 50]];
    const order = pts.map((q, j) => ({ j, d: (q[0] - p[0]) ** 2 + (q[1] - p[1]) ** 2 })).sort((a, b) => a.d - b.d);
    for (const { j } of order) {
      if (j === i) continue;
      poly = clip(poly, p[0], p[1], pts[j][0], pts[j][1]);
      if (poly.length < 3) break;
    }
    return poly;
  });
}

function stainedGlass() {
  const r = rng(404);
  const cols = 15;
  const rows = 11;
  let pts = [];
  for (let y = 0; y < rows; y++)
    for (let x = 0; x < cols; x++) pts.push([((x + 0.5 + (r() - 0.5) * 0.85) * W) / cols, ((y + 0.5 + (r() - 0.5) * 0.85) * H) / rows]);
  // 兩次鬆弛，讓分區大小更均勻
  for (let it = 0; it < 2; it++) {
    const cells = voronoiCells(pts);
    pts = cells.map((poly) => {
      let sx = 0;
      let sy = 0;
      for (const p of poly) {
        sx += p[0];
        sy += p[1];
      }
      return [Math.max(5, Math.min(W - 5, sx / poly.length)), Math.max(5, Math.min(H - 5, sy / poly.length))];
    });
  }
  const cells = voronoiCells(pts);
  const jewels = ['#1f4fa3', '#b3202f', '#1d8a5b', '#e0a21b', '#6a2d91', '#17869e', '#d2581f'];
  let out = `<rect width="${W}" height="${H}" fill="#14110f"/>`;
  cells.forEach((poly, i) => {
    const c = pts[i];
    // 以位置決定色相區域，加上少量隨機，整體仍有色塊感
    const k = Math.floor(((Math.sin(c[0] * 0.0032 + 1) + Math.cos(c[1] * 0.0041) + 2) / 4) * jewels.length + r() * 1.4) % jewels.length;
    const base = jewels[k];
    const light = 0.15 + (1 - Math.hypot(c[0] - W * 0.5, c[1] - H * 0.5) / 1200) * 0.35;
    const fill = mix(base, '#ffffff', Math.max(0, light * 0.55));
    const pts2 = poly.map((p) => `${f(p[0])},${f(p[1])}`).join(' ');
    const inner = poly.map((p) => `${f(c[0] + (p[0] - c[0]) * 0.7)},${f(c[1] + (p[1] - c[1]) * 0.7)}`).join(' ');
    out += `<polygon points="${pts2}" fill="${fill}"/><polygon points="${inner}" fill="${mix(base, '#ffffff', 0.5)}" fill-opacity=".28"/>`;
    out += `<polygon points="${pts2}" fill="none" stroke="#14110f" stroke-width="11" stroke-linejoin="round"/>`;
  });
  const defs = `<radialGradient id="g" cx="50%" cy="50%" r="75%"><stop offset="50%" stop-color="#000" stop-opacity="0"/><stop offset="100%" stop-color="#000" stop-opacity=".4"/></radialGradient>`;
  return svg(out + `<rect width="${W}" height="${H}" fill="url(#g)"/>`, defs);
}

// ---------------------------------------------------------------------------
// 06 青海波：日本傳統的波浪鱗紋

function seigaiha() {
  const R = 132;
  const stepY = R / 2;
  const rows = Math.ceil(H / stepY) + 3;
  const cols = Math.ceil(W / (2 * R)) + 2;
  let out = '';
  for (let row = 0; row < rows; row++) {
    const cy = row * stepY - R * 0.3;
    const t = row / rows;
    const deep = mix('#8fc1d8', '#0f2f5a', t);
    const light = mix('#f1ecd9', '#9ec3d6', t * 0.7);
    for (let col = -1; col < cols; col++) {
      const cx = col * 2 * R + (row % 2 ? R : 0);
      const ring = (k, c) => `<circle cx="${f(cx)}" cy="${f(cy)}" r="${f(R * k)}" fill="${c}" stroke="${deep}" stroke-width="2.4"/>`;
      out += ring(1, light) + ring(0.8, deep) + ring(0.6, light) + ring(0.4, deep) + ring(0.2, light);
    }
  }
  return svg(`<rect width="${W}" height="${H}" fill="#0f2f5a"/>${out}`);
}

// ---------------------------------------------------------------------------
// 07 包浩斯方磚：四分之一圓拼貼

function bauhaus() {
  const T = 160;
  const r = rng(77);
  const pal = ['#e63946', '#f4e9d2', '#1d3557', '#f4a259', '#2a9d8f', '#f2c14e'];
  let out = '';
  for (let y = 0; y < H / T; y++) {
    for (let x = 0; x < W / T; x++) {
      const x0 = x * T;
      const y0 = y * T;
      const bg = Math.floor(r() * pal.length);
      let fg = Math.floor(r() * pal.length);
      if (fg === bg) fg = (fg + 2) % pal.length;
      let fg2 = Math.floor(r() * pal.length);
      if (fg2 === fg || fg2 === bg) fg2 = (Math.max(fg, bg) + 1) % pal.length;
      out += `<rect x="${x0}" y="${y0}" width="${T}" height="${T}" fill="${pal[bg]}"/>`;
      const kind = Math.floor(r() * 4);
      const rot = Math.floor(r() * 4) * 90;
      const g = (inner) => `<g transform="translate(${x0 + T / 2} ${y0 + T / 2}) rotate(${rot}) translate(${-T / 2} ${-T / 2})">${inner}</g>`;
      if (kind === 0) out += g(`<path d="M0,0 H${T} A${T},${T} 0 0 1 0,${T}Z" fill="${pal[fg]}"/><path d="M0,0 H${T * 0.55} A${T * 0.55},${T * 0.55} 0 0 1 0,${T * 0.55}Z" fill="${pal[fg2]}"/>`);
      else if (kind === 1) out += g(`<circle cx="${T / 2}" cy="${T / 2}" r="${T * 0.42}" fill="${pal[fg]}"/><circle cx="${T / 2}" cy="${T / 2}" r="${T * 0.2}" fill="${pal[fg2]}"/>`);
      else if (kind === 2) out += g(`<path d="M0,${T / 2} A${T / 2},${T / 2} 0 0 1 ${T},${T / 2}Z" fill="${pal[fg]}"/><path d="M0,${T / 2} A${T / 2},${T / 2} 0 0 0 ${T},${T / 2}Z" fill="${pal[fg2]}"/>`);
      else out += g(`<path d="M0,0 L${T},0 L0,${T}Z" fill="${pal[fg]}"/><circle cx="${T * 0.7}" cy="${T * 0.7}" r="${T * 0.2}" fill="${pal[fg2]}"/>`);
    }
  }
  return svg(out);
}

// ---------------------------------------------------------------------------
// 09 立方積木：等角視角的方塊錯視

function tumblingBlocks() {
  const s = 96;
  const h = s * Math.sqrt(3);
  const stops = ['#0e4d5c', '#1e8c8a', '#e6b23c', '#d9653b', '#8a2f5f'];
  let out = '';
  for (let row = -1; row < H / (1.5 * s) + 2; row++) {
    for (let col = -1; col < W / h + 2; col++) {
      const cx = col * h + (row % 2 ? h / 2 : 0);
      const cy = row * 1.5 * s;
      const t = (cx / W) * 0.6 + (cy / H) * 0.4;
      const base = ramp(stops, t);
      const top = mix(base, '#ffffff', 0.38);
      const left = base;
      const right = mix(base, '#000000', 0.38);
      const p = (a, b) => `${f(cx + a)},${f(cy + b)}`;
      const o = '#0b1a22';
      out += `<polygon points="${p(0, 0)} ${p(h / 2, -s / 2)} ${p(0, -s)} ${p(-h / 2, -s / 2)}" fill="${top}" stroke="${o}" stroke-width="2.5" stroke-linejoin="round"/>`;
      out += `<polygon points="${p(0, 0)} ${p(-h / 2, -s / 2)} ${p(-h / 2, s / 2)} ${p(0, s)}" fill="${left}" stroke="${o}" stroke-width="2.5" stroke-linejoin="round"/>`;
      out += `<polygon points="${p(0, 0)} ${p(h / 2, -s / 2)} ${p(h / 2, s / 2)} ${p(0, s)}" fill="${right}" stroke="${o}" stroke-width="2.5" stroke-linejoin="round"/>`;
    }
  }
  return svg(`<rect width="${W}" height="${H}" fill="#0b1a22"/>${out}`);
}

// ---------------------------------------------------------------------------
// 彩繪生命之花：同樣的圓陣，但每個封閉區塊都填上實色（逐像素判斷屬於哪個區塊）

async function paintedFlower() {
  const R = 190;
  const dy = (R * Math.sqrt(3)) / 2;
  const jewels = ['#173f7a', '#2a7f9e', '#e3b04b', '#9c3b5c'].map(rgb);
  const buf = Buffer.alloc(W * H * 3);
  const colorOf = new Map();
  for (let y = 0; y < H; y++) {
    const row0 = Math.round(y / dy);
    for (let x = 0; x < W; x++) {
      let sig = 0;
      for (let row = row0 - 2; row <= row0 + 2; row++) {
        const off = row % 2 ? R / 2 : 0;
        const col0 = Math.round((x - off) / R);
        const cy = row * dy;
        for (let col = col0 - 2; col <= col0 + 2; col++) {
          const dx = x - (col * R + off);
          const dyy = y - cy;
          if (dx * dx + dyy * dyy < R * R) sig = (Math.imul(sig, 31) + row * 977 + col * 131 + 7) | 0;
        }
      }
      let c = colorOf.get(sig);
      if (!c) {
        const h = Math.imul(sig ^ (sig >>> 15), 2246822519) >>> 0;
        c = jewels[h % jewels.length];
        colorOf.set(sig, c);
      }
      // 暈邊：愈靠邊緣愈暗
      const v = 1 - Math.min(1, Math.hypot(x - W / 2, y - H / 2) / 1250) * 0.4;
      const i = (y * W + x) * 3;
      buf[i] = c[0] * v;
      buf[i + 1] = c[1] * v;
      buf[i + 2] = c[2] * v;
    }
  }
  let dark = '';
  let gold = '';
  for (let row = -1; row < H / dy + 2; row++) {
    for (let col = -1; col < W / R + 2; col++) {
      const cx = col * R + (row % 2 ? R / 2 : 0);
      const c = `cx="${f(cx)}" cy="${f(row * dy)}" r="${R}" fill="none"`;
      dark += `<circle ${c} stroke="#150f26" stroke-width="12"/>`;
      gold += `<circle ${c} stroke="#f0d28a" stroke-width="2.4"/>`;
    }
  }
  return sharp(buf, { raw: { width: W, height: H, channels: 3 } })
    .composite([{ input: Buffer.from(svg(dark + gold)) }])
    .png()
    .toBuffer();
}

// ---------------------------------------------------------------------------
// 北歐編織：Fair Isle 針織花紋，一格一針

const SNOW = ['....#....', '.#..#..#.', '..#.#.#..', '...###...', '#########', '...###...', '..#.#.#..', '.#..#..#.', '....#....'];
const FLOWER = ['..#.#..', '.#####.', '#######', '.#####.', '..#.#..'].map((r) => r.replace(/#/g, '#'));

function fairIsle() {
  const C = { navy: '#1d2a4a', cream: '#efe4c8', red: '#b8403a', teal: '#2f8582', gold: '#d9a53c', plum: '#5a2d54' };
  // 每個帶：高度、背景色、前景色、(x, y) → 是否為前景
  const solid = (h, bg) => ({ h, bg, fg: bg, on: () => false });
  const bands = [
    solid(2, C.red),
    { h: 3, bg: C.navy, fg: C.gold, on: (x, y) => (x + y) % 2 === 0 },
    solid(1, C.cream),
    { h: 9, bg: C.navy, fg: C.cream, on: (x, y) => x % 12 < 9 && SNOW[y][x % 12] === '#' },
    solid(1, C.cream),
    { h: 5, bg: C.cream, fg: C.red, on: (x, y) => Math.abs((x % 8) - 4) === y || Math.abs((x % 8) - 4) === y - 1 },
    solid(1, C.teal),
    { h: 9, bg: C.teal, fg: C.cream, on: (x, y) => { const dx = (x % 10) - 4; return x % 10 < 9 && (Math.abs(dx) + Math.abs(y - 4) === 4 || (dx === 0 && y === 4)); } },
    solid(1, C.teal),
    { h: 5, bg: C.plum, fg: C.gold, on: (x, y) => x % 8 < 7 && FLOWER[y][x % 8] === '#' },
    solid(1, C.cream),
    { h: 9, bg: C.red, fg: C.cream, on: (x, y) => { const k = (x + 6) % 12; return k < 9 && SNOW[y][k] === '#'; } },
    solid(1, C.cream),
    { h: 3, bg: C.navy, fg: C.gold, on: (x, y) => (x + y) % 2 === 0 },
  ];
  const seq = [...bands, ...bands.slice(0, -1).reverse()];
  const rows = seq.reduce((n, b) => n + b.h, 0);
  const S = H / rows;
  const cols = Math.ceil(W / S);
  let out = `<rect width="${W}" height="${H}" fill="#0e0f14"/>`;
  let y0 = 0;
  for (const b of seq) {
    for (let y = 0; y < b.h; y++) {
      for (let x = 0; x < cols; x++) {
        const col = b.on(x, y) ? b.fg : b.bg;
        const px = x * S;
        const py = (y0 + y) * S;
        out += `<rect x="${f(px + 0.6)}" y="${f(py + 0.6)}" width="${f(S - 1.2)}" height="${f(S - 1.2)}" rx="${f(S * 0.28)}" fill="${col}"/>`;
        out += `<path d="M${f(px + S * 0.2)},${f(py + S * 0.18)} L${f(px + S * 0.5)},${f(py + S * 0.82)} L${f(px + S * 0.8)},${f(py + S * 0.18)}" fill="none" stroke="#fff" stroke-opacity=".16" stroke-width="${f(S * 0.13)}" stroke-linecap="round" stroke-linejoin="round"/>`;
      }
    }
    y0 += b.h;
  }
  return svg(out);
}

// ---------------------------------------------------------------------------

export const SHAPED_ART = [
  { name: '八角星磚', make: islamicStars },
  { name: '生命之花', make: flowerOfLife },
  { name: '彩繪生命之花', make: paintedFlower },
  { name: '萬花曼陀羅', make: mandala },
  { name: '琉璃彩窗', make: stainedGlass },
  { name: '青海波', make: seigaiha },
  { name: '包浩斯方磚', make: bauhaus },
  { name: '立方積木', make: tumblingBlocks },
  { name: '北歐編織', make: fairIsle },
];

/** 輸出 shaped-XX.webp 與縮圖到 outDir，回傳 images.json 用的項目 */
export async function renderShaped(outDir, only) {
  await fs.mkdir(outDir, { recursive: true });
  const entries = [];
  for (let i = 0; i < SHAPED_ART.length; i++) {
    const id = `shaped-${String(i + 1).padStart(2, '0')}`;
    if (only && !only.includes(i + 1)) continue;
    const made = await SHAPED_ART[i].make();
    const buf = typeof made === 'string' ? Buffer.from(made) : made;
    const base = sharp(buf, { density: 72 }).resize(W, H);
    await base.clone().webp({ quality: 88 }).toFile(path.join(outDir, `${id}.webp`));
    await base.clone().resize(THUMB_W, THUMB_H).webp({ quality: 80 }).toFile(path.join(outDir, `${id}-thumb.webp`));
    entries.push({ id, category: 'shaped', name: SHAPED_ART[i].name, src: `images/${id}.webp`, thumb: `images/${id}-thumb.webp`, artist: '程式生成', license: 'CC0' });
  }
  return entries;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const out = process.argv[2];
  if (!out) {
    console.log('用法：node scripts/shaped-art.mjs <輸出資料夾> [編號,編號...]');
  } else {
    const only = process.argv[3]?.split(',').map(Number);
    const entries = await renderShaped(path.resolve(out), only);
    console.log(`輸出 ${entries.length} 張`);
  }
}
