// 端對端冒煙測試：走過主要流程（選圖 → 拼完 → 結算 → 各頁面）並截圖。
// 用法：npm run e2e -- smoke（或先啟動 dev server 後 node tests/e2e/smoke.mjs [截圖輸出目錄]）
import fs from 'node:fs';
import { DEV_URL, drag, launch, newPage, openGame, report, sleep } from './lib.mjs';

const OUT = process.argv[2] ?? 'e2e-shots';
fs.mkdirSync(OUT, { recursive: true });
const browser = await launch();
const { page, errors } = await newPage(browser);
const shot = (n) => page.screenshot({ path: `${OUT}/${n}.png` });
const checks = {};

await page.goto(DEV_URL, { waitUntil: 'networkidle0' });
await shot('01-home');
await page.click('.play');
await page.waitForSelector('.cat-card');
await shot('02-categories');
await page.click('.cat-card');
await page.waitForSelector('.img-card');
await shot('03-images');
await page.click('.img-card');
await page.waitForSelector('.diff-modal');
await shot('04-difficulty');
// Esc 關閉對話框
await page.keyboard.press('Escape');
checks.escClosesDialog = (await page.$('.diff-modal')) === null;

await openGame(page);
await shot('05-game');

// 拖一片到正確位置，驗證鎖定
const t1 = await page.evaluate(() => {
  const g = window.__game;
  const p = g.pieces[0];
  return { from: g.toScreen(p.x + g.L.pw / 2, p.y + g.L.ph / 2), to: g.toScreen(g.L.pw / 2 + 3, g.L.ph / 2 + 3) };
});
await drag(page, t1.from, t1.to);
checks.pieceLocksInPlace = await page.evaluate(() => window.__game.pieces[0].locked);

// 拖相鄰的第 2 片靠近第 1 片右側，驗證吸附
const t2 = await page.evaluate(() => {
  const g = window.__game;
  const p = g.pieces[1];
  return { from: g.toScreen(p.x + g.L.pw / 2, p.y + g.L.ph / 2), to: g.toScreen(g.L.pw * 1.5 - 4, g.L.ph / 2 + 4) };
});
await drag(page, t2.from, t2.to);
checks.neighborSnaps = await page.evaluate(() => window.__game.pieces[1].locked);
await shot('06-after-drag');

// 邊框篩選 + 整理：已鎖定的拼片不動，散片仍在拼盤外
await page.click('.edge-btn');
await page.click('.arrange-btn');
await sleep(300);
await shot('07-edge-arranged');
checks.arrangeKeepsLocked = await page.evaluate(() => {
  const g = window.__game;
  return g.pieces[0].x === 0 && g.pieces[0].y === 0 && g.pieces[1].x === g.L.pw && g.pieces[1].y === 0;
});
await page.click('.edge-btn');
await page.click('.preview-btn');
await shot('08-preview');
await page.click('.preview-btn');

// 把其餘拼片直接放到正確位置，只留最後一片用滑鼠拖
const last = await page.evaluate(() => {
  const g = window.__game;
  const n = g.pieces.length;
  const at = (i) => ({ x: (i % g.L.cols) * g.L.pw, y: Math.floor(i / g.L.cols) * g.L.ph });
  g.pieces.forEach((p, i) => {
    if (i === n - 1) return;
    Object.assign(p, at(i), { locked: true, group: 0 });
  });
  g.invalidateGroups();
  g.resetView();
  const p = g.pieces[n - 1];
  const c = at(n - 1);
  return { from: g.toScreen(p.x + g.L.pw / 2, p.y + g.L.ph / 2), to: g.toScreen(c.x + g.L.pw / 2 + 2, c.y + g.L.ph / 2 - 2) };
});
await drag(page, last.from, last.to);
await page.waitForSelector('.overlay.result', { timeout: 5000 });
await sleep(1500);
await shot('09-result');
const resultText = await page.$eval('.overlay.result', (e) => e.innerText);
checks.resultShown = resultText.includes('完成') && resultText.includes('新紀錄');
checks.titlesUnlocked = resultText.includes('解鎖新稱號');

await page.click('.to-home');
await page.waitForSelector('.home');
await shot('10-home-after');
// 完成的局不應留下「繼續上一局」
await sleep(300);
checks.noContinueAfterFinish = await page.$eval('.continue', (e) => e.classList.contains('hidden'));
await page.click('.titles');
await page.waitForSelector('.title-card');
await shot('11-titles');
checks.titleConditionsRendered = await page.$$eval('.title-card .cond', (els) => els.length > 50 && els.every((e) => e.textContent.trim().length > 0 && !e.textContent.includes('[object')));
await page.click('.back');
await page.click('.stats');
await page.waitForSelector('.kpis');
await shot('12-stats');
checks.statsCountCompletion = await page.$eval('.kpis', (e) => /完成局數\s*1(?!\d)/.test(e.innerText));
await page.click('.back');
await page.click('.settings');
await page.waitForSelector('.swatch');
await shot('13-settings');
checks.tableColorsNamed = await page.$$eval('.swatch span', (els) => els.map((e) => e.textContent).join(',') === '橡木,胡桃木,綠絨布,石板灰');

// 重新載入後存檔仍在
await page.reload({ waitUntil: 'networkidle0' });
await page.click('.stats');
await page.waitForSelector('.kpis');
checks.savePersistsAcrossReload = await page.$eval('.kpis', (e) => /完成局數\s*1(?!\d)/.test(e.innerText));

// 手機橫向 / 直向
await page.setViewport({ width: 844, height: 390, isMobile: true, hasTouch: true });
await openGame(page, { image: 1, difficulty: -1 });
checks.largestDifficultyLoads = await page.evaluate(() => window.__game.pieces.length > 500);
await sleep(400);
await shot('14-phone-landscape-600');
await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
await sleep(300);
await shot('15-phone-portrait');
checks.rotateHintInPortrait = await page.$eval('.rotate-hint', (e) => getComputedStyle(e).display !== 'none');

checks.noPageErrors = errors.length === 0;
await report(browser, checks, { resultText, errors });
