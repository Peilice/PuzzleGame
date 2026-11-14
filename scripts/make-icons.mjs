// 產生 PWA 圖示（由 SVG 轉 PNG）：金線畫框＋拼圖榫，深色底。
import fs from 'node:fs/promises';
import sharp from 'sharp';

const piece = `<g fill="none" stroke="#c9a45c" stroke-width="2.6" stroke-linejoin="round" stroke-linecap="round"><path d="M6 8H42V21A4.2 4.2 0 1 1 42 27V40H6Z"/><path d="M6 36 17 22l6 8 5-6 14 14"/><circle cx="15" cy="16" r="2.8" fill="#c9a45c" stroke="none"/></g>`;
const BG = '#121212';
const svg = (bg, pad) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" rx="${pad ? 0 : 22}" fill="${bg}"/><g transform="translate(${50 - 26 * (pad ? 1.15 : 1.45)} ${50 - 24 * (pad ? 1.15 : 1.45)}) scale(${pad ? 1.15 : 1.45})">${piece}</g></svg>`;

await fs.writeFile('public/icons/icon.svg', svg(BG, false));
for (const [name, size, pad] of [
  ['icon-192.png', 192, false],
  ['icon-512.png', 512, false],
  ['icon-512-maskable.png', 512, true],
  ['apple-touch-icon.png', 180, true],
]) {
  await sharp(Buffer.from(svg(BG, pad)), { density: 600 }).resize(size, size).png().toFile(`public/icons/${name}`);
}
console.log('icons ok');
