// 端對端測試：托盤（拖出、拖回、捲動、邊框篩選、收回、存檔續玩、觸控手勢）。
// 用法：npm run e2e -- tray
import fs from 'node:fs';
import { drag, launch, newPage, openGame, report, sleep } from './lib.mjs';

const OUT = process.argv[2] ?? 'e2e-shots';
fs.mkdirSync(OUT, { recursive: true });
const browser = await launch();
const checks = {};
const allErrors = [];

/** 第 k 格（托盤清單中的順序）目前的畫面座標中心；捲動時只在可視範圍內有意義 */
const cellCenter = (page, k) =>
  page.evaluate((k) => {
    const g = window.__game;
    const r = g.trayRect();
    const geo = g.trayGeom();
    return {
      x: r.x + 8 + (k % geo.cols) * (geo.cellW + geo.gap) + geo.cellW / 2,
      y: g.trayTop + Math.floor(k / geo.cols) * (geo.cellH + geo.gap) + geo.cellH / 2 - g.trayScroll,
    };
  }, k);
/** 目前捲動位置下，第一個完整可見的格子 */
const firstVisibleCell = (page) =>
  page.evaluate(() => {
    const g = window.__game;
    const geo = g.trayGeom();
    return Math.ceil(g.trayScroll / (geo.cellH + geo.gap)) * geo.cols;
  });
const state = (page) =>
  page.evaluate(() => {
    const g = window.__game;
    return {
      n: g.pieces.length,
      tray: [...g.trayOrder],
      open: g.isTrayOpen,
      scroll: g.trayScroll,
      loose: g.pieces.filter((p) => !p.tray && !p.locked).length,
      onTable: g.pieces.filter((p) => !p.tray).length,
    };
  });
const boardCenter = (page) => page.evaluate(() => window.__game.toScreen(window.__game.L.boardW / 2, window.__game.L.boardH / 2));

// ---------------------------------------------------------------- 滑鼠
{
  const { page, errors } = await newPage(browser);
  await openGame(page, { inTray: true, image: 1, difficulty: -1 });
  const s0 = await state(page);
  checks.newGameAllInTray = s0.tray.length === s0.n && s0.open && s0.onTable === 0;
  checks.trayOrderIsRandom = s0.tray.some((v, i) => v !== i) && new Set(s0.tray).size === s0.n;
  await page.screenshot({ path: OUT + '/tray-01-new.png' });

  // 拖出：第一格的拼片落在桌面上、離開托盤順序
  const first = s0.tray[0];
  const second = s0.tray[1];
  const target = await boardCenter(page);
  await drag(page, await cellCenter(page, 0), target);
  const afterPick = await page.evaluate((i) => {
    const g = window.__game;
    const p = g.pieces[i];
    return { tray: p.tray, order: [...g.trayOrder], c: g.toScreen(p.x + g.L.pw / 2, p.y + g.L.ph / 2) };
  }, first);
  checks.pickOutLeavesTray = afterPick.tray === false && !afterPick.order.includes(first) && afterPick.order.length === s0.n - 1;
  checks.pickOutLandsAtPointer = Math.hypot(afterPick.c.x - target.x, afterPick.c.y - target.y) < 6;
  checks.trayReflows = afterPick.order[0] === second;
  await page.screenshot({ path: OUT + '/tray-02-picked.png' });

  // 拖回：放在托盤上就回到最後
  await drag(page, afterPick.c, await cellCenter(page, 3));
  const s2 = await state(page);
  checks.dropBackGoesToEnd = s2.tray.length === s0.n && s2.tray.at(-1) === first && s2.onTable === 0;

  // 捲動：滾輪在托盤上捲動托盤，不縮放桌面
  const camBefore = await page.evaluate(() => window.__game.cam.s);
  const mid = await cellCenter(page, 4);
  await page.mouse.move(mid.x, mid.y);
  await page.mouse.wheel({ deltaY: 400 });
  await sleep(100);
  const s3 = await state(page);
  checks.wheelScrollsTray = s3.scroll > 0 && (await page.evaluate(() => window.__game.cam.s)) === camBefore;
  await page.screenshot({ path: OUT + '/tray-03-scrolled.png' });

  // 捲動後仍能命中正確的拼片
  const fv = await firstVisibleCell(page);
  const wantPiece = s3.tray[fv];
  await drag(page, await cellCenter(page, fv), target);
  checks.pickAfterScrollHitsRightPiece = await page.evaluate((i) => window.__game.pieces[i].tray === false, wantPiece);

  // 邊框篩選：托盤只顯示邊緣片
  await page.click('.edge-btn');
  const edge = await page.evaluate(() => {
    const g = window.__game;
    return { shown: g.trayList().length, expected: g.trayOrder.filter((i) => g.isEdge[i]).length };
  });
  checks.edgeFilterFiltersTray = edge.shown === edge.expected && edge.shown > 0 && edge.shown < s0.n;
  await page.screenshot({ path: OUT + '/tray-04-edge.png' });
  await page.click('.edge-btn');

  // 收回：桌面上的散片全部回到托盤
  await page.evaluate(() => {
    window.__game.trayScroll = 0;
  });
  await drag(page, await cellCenter(page, await firstVisibleCell(page)), { x: target.x - 120, y: target.y });
  await drag(page, await cellCenter(page, await firstVisibleCell(page)), { x: target.x + 40, y: target.y + 60 });
  const before = await state(page);
  await page.click('.gather-btn');
  const after = await state(page);
  checks.gatherReturnsAll = before.loose >= 3 && after.tray.length === after.n && after.onTable === 0;
  checks.gatherReshuffles = after.tray.join() !== before.tray.join();

  // 收合 / 展開
  await page.click('.tray-btn');
  checks.trayCloses = (await state(page)).open === false && (await page.$eval('.tray-btn', (e) => e.getAttribute('aria-pressed'))) === 'false';
  await page.click('.tray-btn');
  checks.trayReopens = (await state(page)).open === true;

  // 存檔：拿出兩片後離開，再續玩，托盤順序與內容一致
  await page.evaluate(() => {
    window.__game.trayScroll = 0;
  });
  await drag(page, await cellCenter(page, 0), target);
  await drag(page, await cellCenter(page, 0), { x: target.x + 150, y: target.y });
  const saved = await state(page);
  await page.click('.back');
  await page.waitForSelector('.img-card');
  await page.click('.img-card:nth-child(2)');
  await page.waitForSelector('.diff-modal');
  await page.evaluate(() => (window.__game = undefined));
  await page.$$eval('.diff-row', (rows) => rows.at(-1).querySelector('.go, .resume').click());
  await page.waitForFunction(() => window.__game, { timeout: 60000 });
  await sleep(400);
  const restored = await state(page);
  checks.resumeKeepsTray = restored.tray.join() === saved.tray.join() && restored.open === true && restored.onTable === saved.onTable;

  allErrors.push(...errors);
  await page.close();
}

// ---------------------------------------------------------------- 觸控（手機橫向）
{
  const { page, errors } = await newPage(browser, { width: 844, height: 390, isMobile: true, hasTouch: true });
  await openGame(page, { inTray: true, image: 2, difficulty: -1 });
  const s0 = await state(page);
  const swipe = async (from, to) => {
    const finger = await page.touchscreen.touchStart(from.x, from.y);
    for (let k = 1; k <= 10; k++) await finger.move(from.x + ((to.x - from.x) * k) / 10, from.y + ((to.y - from.y) * k) / 10);
    await finger.end();
  };

  // 上下滑動是捲動，不會拿起拼片
  const c0 = await cellCenter(page, 0);
  await swipe(c0, { x: c0.x, y: c0.y - 150 });
  const s1 = await state(page);
  checks.touchVerticalScrolls = s1.scroll > 0 && s1.tray.length === s0.n;
  await page.screenshot({ path: OUT + '/tray-05-phone.png' });

  // 往桌面（左）拖才是拿起
  const k = await firstVisibleCell(page);
  const picked = s1.tray[k];
  await swipe(await cellCenter(page, k), { x: 300, y: 200 });
  checks.touchLeftPicksOut = await page.evaluate((i) => window.__game.pieces[i].tray === false, picked);

  allErrors.push(...errors);
  await page.close();
}

checks.noPageErrors = allErrors.length === 0;
await report(browser, checks, { errors: allErrors });
