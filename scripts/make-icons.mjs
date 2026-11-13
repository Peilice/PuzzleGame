// 產生 PWA 圖示（由 SVG 轉 PNG）。
import fs from 'node:fs/promises';
import sharp from 'sharp';

const piece = `<path fill="#f4b942" d="M10 10h32c0-10 16-10 16 0h32v32c-10 0-10 16 0 16v32H58c0 10-16 10-16 0H10V58c10 0 10-16 0-16z"/><path fill="#e07a5f" d="M10 10h32c0-10 16-10 16 0h-8v40H10V42c10 0 10-16 0-16z" opacity=".9"/><path fill="#81b29a" d="M50 50h40v8c-10 0-10 16 0 16v16H58c0 10-16 10-16 0h8z" opacity=".9"/>`;
const svg = (bg, pad) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" rx="${pad ? 0 : 22}" fill="${bg}"/><g transform="translate(${pad ? 20 : 12} ${pad ? 20 : 12}) scale(${pad ? 0.6 : 0.76})">${piece}</g></svg>`;

await fs.writeFile('public/icons/icon.svg', svg('#7a4e27', false));
for (const [name, size, pad] of [
  ['icon-192.png', 192, false],
  ['icon-512.png', 512, false],
  ['icon-512-maskable.png', 512, true],
  ['apple-touch-icon.png', 180, true],
]) {
  await sharp(Buffer.from(svg('#7a4e27', pad)), { density: 600 }).resize(size, size).png().toFile(`public/icons/${name}`);
}
console.log('icons ok');
