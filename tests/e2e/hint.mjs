// 端對端測試：操作提示的顯示 / 關閉 / 重新打開與記憶，以及滑鼠游標。
// 用法：npm run e2e -- hint
import fs from 'node:fs';
import { launch, newPage, openGame, report, sleep } from './lib.mjs';

const OUT = process.argv[2] ?? 'e2e-shots';
fs.mkdirSync(OUT, { recursive: true });
const browser = await launch();
const { page, errors } = await newPage(browser);

const hintVisible = () => page.$eval('.hint', (e) => getComputedStyle(e).display !== 'none' && getComputedStyle(e.querySelector('.hint-mouse')).display !== 'none');
const helpPressed = () => page.$eval('.help-btn', (e) => e.getAttribute('aria-pressed'));
const cursorAt = async (pt) => {
  await page.mouse.move(pt.x, pt.y);
  return page.$eval('canvas.board', (c) => c.style.cursor);
};

await openGame(page);
const checks = {};
checks.shownByDefault = (await hintVisible()) && (await helpPressed()) === 'true';
await page.screenshot({ path: OUT + '/hint-01-shown.png' });

// 游標：拼盤中央（空）→ 一般箭頭；可拖動拼片上 → 抓手
const board = await page.evaluate(() => window.__game.toScreen(window.__game.L.boardW / 2, window.__game.L.boardH / 2));
const piece = await page.evaluate(() => {
  const g = window.__game;
  const p = g.pieces[0];
  return g.toScreen(p.x + g.L.pw / 2, p.y + g.L.ph / 2);
});
checks.defaultCursorOnBoard = (await cursorAt(board)) === 'default';
checks.grabCursorOnPiece = (await cursorAt(piece)) === 'grab';

await page.click('.hint-close');
checks.closed = !(await hintVisible()) && (await helpPressed()) === 'false';
await sleep(300);

// 重新進入遊戲：記住已關閉
await openGame(page);
checks.staysClosedAfterReload = !(await hintVisible());

await page.click('.help-btn');
checks.reopenedByHelp = (await hintVisible()) && (await helpPressed()) === 'true';

// 觸控裝置：顯示觸控說明
// 觸控模擬會改變 (pointer: coarse) / (hover: none)，需重新進入遊戲才生效
await page.setViewport({ width: 844, height: 390, hasTouch: true, isMobile: true });
await openGame(page);
await sleep(400);
const touchText = await page.$eval('.hint', (e) => e.innerText.replace(/\s+/g, ' '));
await page.screenshot({ path: OUT + '/hint-02-touch.png' });
checks.touchHintsOnTouchDevice = touchText.includes('單指拖曳') && !touchText.includes('右鍵');
checks.noPageErrors = errors.length === 0;

await report(browser, checks, { touchText, errors });
