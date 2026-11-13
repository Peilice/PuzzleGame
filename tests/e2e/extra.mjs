// 端對端測試：觸控拖曳、雙指縮放、返回鍵與續玩、離線。
// 用法：npm run e2e -- extra（離線測試需要建置後的 preview；連不上時該項略過）
import { PREVIEW_URL, drag, launch, newPage, openGame, report, sleep } from './lib.mjs';

const browser = await launch();
const checks = {};
const details = {};
const allErrors = [];

// ---------------------------------------------------------------- 觸控
{
  const { page, errors } = await newPage(browser, { width: 1024, height: 768, isMobile: true, hasTouch: true });
  await openGame(page);
  /** 單指從 from 滑到 to，不放開；回傳該觸控點 */
  const swipe = async (from, to) => {
    const finger = await page.touchscreen.touchStart(from.x, from.y);
    for (let k = 1; k <= 10; k++) await finger.move(from.x + ((to.x - from.x) * k) / 10, from.y + ((to.y - from.y) * k) / 10);
    return finger;
  };

  const t = await page.evaluate(() => {
    const g = window.__game;
    const p = g.pieces[0];
    return { from: g.toScreen(p.x + g.L.pw / 2, p.y + g.L.ph / 2), to: g.toScreen(g.L.pw / 2 + 4, g.L.ph / 2 - 4) };
  });
  await (await swipe(t.from, t.to)).end();
  checks.touchDragLocks = await page.evaluate(() => window.__game.pieces[0].locked);

  // 拖曳途中放上第二指：拼片留在放開處（第 1 片右側的正確位置附近），但不吸附
  const d2 = await page.evaluate(() => {
    const g = window.__game;
    const p = g.pieces[1];
    return { from: g.toScreen(p.x + g.L.pw / 2, p.y + g.L.ph / 2), to: g.toScreen(g.L.pw * 1.5 - 3, g.L.ph / 2 + 3) };
  });
  const first = await swipe(d2.from, d2.to);
  const second = await page.touchscreen.touchStart(d2.to.x + 80, d2.to.y + 80);
  await first.end();
  await second.end();
  const p1 = await page.evaluate(() => {
    const g = window.__game;
    const p = g.pieces[1];
    return { locked: p.locked, group: p.group, dx: p.x - g.L.pw, dy: p.y };
  });
  details.secondFingerPiece = p1;
  checks.secondFingerDragMoved = Math.abs(p1.dx) < 10 && Math.abs(p1.dy) < 10;
  checks.secondFingerDoesNotSnap = !p1.locked && p1.group === 1 && (p1.dx !== 0 || p1.dy !== 0);

  const cdp = await page.createCDPSession();
  const touch = (type, touchPoints) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints });
  // 雙指縮放：在空白（拼盤中央）處開合
  const before = await page.evaluate(() => {
    const g = window.__game;
    return { s: g.cam.s, pos: g.pieces.map((p) => [p.x, p.y]), center: g.toScreen(g.L.boardW / 2, g.L.boardH / 2) };
  });
  const c = before.center;
  const pts = (d) => [
    { x: c.x - d, y: c.y, id: 1 },
    { x: c.x + d, y: c.y, id: 2 },
  ];
  await touch('touchStart', pts(40));
  for (let d = 50; d <= 140; d += 10) await touch('touchMove', pts(d));
  await touch('touchEnd', []);
  const after = await page.evaluate(() => ({ s: window.__game.cam.s, pos: window.__game.pieces.map((p) => [p.x, p.y]) }));
  details.pinchZoomRatio = +(after.s / before.s).toFixed(2);
  checks.pinchZooms = details.pinchZoomRatio > 2;
  checks.pinchMovesNoPieces = after.pos.every((p, i) => p[0] === before.pos[i][0] && p[1] === before.pos[i][1]);
  allErrors.push(...errors);
  await page.close();
}

// ---------------------------------------------------------------- 返回鍵與續玩
{
  const { page, errors } = await newPage(browser);
  await openGame(page);
  const t = await page.evaluate(() => {
    const g = window.__game;
    const p = g.pieces[5];
    return { from: g.toScreen(p.x + g.L.pw / 2, p.y + g.L.ph / 2), to: g.toScreen(g.L.boardW / 2, g.L.boardH / 2) };
  });
  await drag(page, t.from, t.to);
  await sleep(1500);
  const state = () => page.evaluate(() => ({ p5: [window.__game.pieces[5].x, window.__game.pieces[5].y], seed: window.__game.seed, t: window.__game.elapsedMs }));
  const snap = await state();
  await page.click('.back');
  await page.waitForSelector('.img-card');
  checks.progressDotShown = (await page.$('.img-card .dot.prog')) !== null;
  await page.click('.topbar .back');
  await page.waitForSelector('.cat-card');
  await page.click('.topbar .back');
  await page.waitForSelector('.continue:not(.hidden)');
  details.continueButton = await page.$eval('.continue', (e) => e.innerText.replace(/\s+/g, ' '));
  checks.continueButtonShown = details.continueButton.includes('150 片');
  await page.evaluate(() => (window.__game = undefined));
  await page.click('.continue');
  await page.waitForFunction(() => window.__game);
  const restored = await state();
  checks.resumeSamePosition = Math.abs(restored.p5[0] - snap.p5[0]) < 0.2 && Math.abs(restored.p5[1] - snap.p5[1]) < 0.2;
  checks.resumeSameSeed = restored.seed === snap.seed;
  checks.resumeTimeKept = restored.t >= snap.t - 50;

  // 暫停 → 離開
  await sleep(300);
  await page.click('.pause-btn');
  await page.waitForSelector('.pause-overlay');
  await page.click('.pause-overlay .leave');
  checks.leaveFromPause = await page.waitForSelector('.img-card', { timeout: 5000 }).then(() => true, () => false);
  allErrors.push(...errors);
  await page.close();
}

// ---------------------------------------------------------------- 離線（需建置後的 preview）
{
  const { page } = await newPage(browser);
  const reachable = await page.goto(PREVIEW_URL, { waitUntil: 'networkidle0' }).then(() => true, () => false);
  if (!reachable) {
    details.offline = '略過：連不上 ' + PREVIEW_URL;
  } else {
    try {
      await page.evaluate(() => navigator.serviceWorker.ready);
      await sleep(4000); // 等預快取完成
      await page.setOfflineMode(true);
      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.waitForSelector('.home', { timeout: 5000 });
      await page.click('.play');
      await page.waitForSelector('.cat-card');
      await page.click('.cat-card');
      await page.waitForSelector('.img-card');
      await page.click('.img-card');
      await page.waitForSelector('.diff-row .go');
      await page.click('.diff-row .go');
      await page.waitForSelector('canvas.board');
      await page.waitForFunction(() => !document.querySelector('.overlay.loading'), { timeout: 8000 });
      checks.offlineGameLoads = !(await page.$('.toast.error'));
    } catch (e) {
      checks.offlineGameLoads = false;
      details.offline = '失敗：' + e.message;
    }
  }
  await page.close();
}

checks.noPageErrors = allErrors.length === 0;
await report(browser, checks, { ...details, errors: allErrors });
