// 端對端冒煙測試：走過主要流程（選圖 → 拼完 → 結算 → 各頁面）並截圖。
// 用法：npm run e2e -- smoke（或先啟動 dev server 後 node tests/e2e/smoke.mjs [截圖輸出目錄]）
import fs from 'node:fs';
import { DEV_URL, drag, grabPiece, launch, newPage, openGame, report, sleep } from './lib.mjs';

const OUT = process.argv[2] ?? 'e2e-shots';
fs.mkdirSync(OUT, { recursive: true });
const browser = await launch();
const { page, errors } = await newPage(browser);
const shot = (n) => page.screenshot({ path: `${OUT}/${n}.png` });
const checks = {};

// 記下來源範圍超出圖片的 drawImage：舊版 WebKit 對這種呼叫只縮小目的地、不平移起點，拼片凸角會變透明
await page.evaluateOnNewDocument(() => {
  window.__srcOutOfBounds = 0;
  for (const C of [globalThis.CanvasRenderingContext2D, globalThis.OffscreenCanvasRenderingContext2D]) {
    if (!C) continue;
    const orig = C.prototype.drawImage;
    C.prototype.drawImage = function (img, ...a) {
      if (a.length === 8 && img instanceof HTMLImageElement) {
        const [x, y, w, h] = a;
        if (x < 0 || y < 0 || x + w > img.naturalWidth + 1e-6 || y + h > img.naturalHeight + 1e-6) window.__srcOutOfBounds++;
      }
      return orig.call(this, img, ...a);
    };
  }
});

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
checks.drawImageSrcInBounds = await page.evaluate(() => window.__srcOutOfBounds === 0);
// 每片拼片的輪廓內（扣掉描邊）都要有圖片，凸角不能是透明的
checks.spritesFilled = await page.evaluate(() => {
  const g = window.__game;
  return g.sprites.every((s, i) => {
    const res = s.width / (g.L.geoms[i].w + g.pad * 2);
    const m = Object.assign(document.createElement('canvas'), { width: s.width, height: s.height });
    const mc = m.getContext('2d');
    mc.scale(res, res);
    mc.translate(g.pad, g.pad);
    mc.fill(g.paths[i]);
    mc.lineWidth = 3;
    mc.globalCompositeOperation = 'destination-out';
    mc.stroke(g.paths[i]);
    const md = mc.getImageData(0, 0, s.width, s.height).data;
    const sd = s.getContext('2d').getImageData(0, 0, s.width, s.height).data;
    for (let k = 3; k < md.length; k += 4) if (md[k] > 250 && sd[k] < 200) return false;
    return true;
  });
});

// 拖一片到正確位置，驗證鎖定
const t1 = await grabPiece(page, 0, 3, 3);
await drag(page, t1.from, t1.home);
checks.pieceLocksInPlace = await page.evaluate(() => window.__game.pieces[0].locked);

// 拖相鄰的第 2 片靠近第 1 片右側，驗證吸附
const t2 = await grabPiece(page, 1, -4, 4);
await drag(page, t2.from, t2.home);
checks.neighborSnaps = await page.evaluate(() => window.__game.pieces[1].locked);
await shot('06-after-drag');

// 邊框篩選 + 收回托盤：已鎖定的拼片不動，其餘散片收進托盤
await page.click('.edge-btn');
await page.click('.gather-btn');
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
    Object.assign(p, at(i), { locked: true, group: 0, tray: false });
  });
  // 只留最後一片在托盤裡，用滑鼠從托盤拖到正確位置
  g.trayOrder.length = 0;
  g.trayOrder.push(n - 1);
  g.pieces[n - 1].tray = true;
  g.invalidateGroups();
  g.invalidateTray();
  g.setTrayOpen(true);
  g.resetView();
  const r = g.trayRect();
  const geo = g.bottomTray ? g.trayRowGeom() : g.trayGeom();
  const c = at(n - 1);
  return {
    from: g.bottomTray ? { x: 8 + geo.cellW / 2, y: r.y + 8 + geo.cellH / 2 } : { x: r.x + 8 + geo.cellW / 2, y: g.trayTop + geo.cellH / 2 },
    to: g.toScreen(c.x + g.L.pw / 2 + 2, c.y + g.L.ph / 2 - 2),
  };
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
checks.tableColorsNamed = await page.$$eval('.swatch span', (els) => els.map((e) => e.textContent).join(',') === '墨黑,石墨灰,午夜藍,深酒紅');

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
