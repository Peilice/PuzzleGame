// 端對端測試：異型拼圖（獨立入口、不規則切割、異形輪廓、拖曳吸附、托盤、存檔續玩）。
// 用法：npm run e2e -- shaped
import fs from 'node:fs';
import { drag, launch, newPage, openGame, report, sleep, DEV_URL } from './lib.mjs';

const OUT = process.argv[2] ?? 'e2e-shots';
fs.mkdirSync(OUT, { recursive: true });
const browser = await launch();
const checks = {};
const allErrors = [];

/** 第 i 片拼片上、最靠近外框中心且滑鼠真的點得到它（沒被別片蓋住）的點；回傳畫面座標、縮放與該點在拼片內的座標 */
const grabPoint = (page, i) =>
  page.evaluate((i) => {
    const g = window.__game;
    const geom = g.L.geoms[i];
    const p = g.pieces[i];
    let best = null;
    for (let k = 0; k <= 20; k++) {
      for (let m = 0; m <= 20; m++) {
        const lx = (geom.w * k) / 20;
        const ly = (geom.h * m) / 20;
        if (!g.hitCtx.isPointInPath(g.paths[i], lx, ly)) continue;
        if (g.hitTest(p.x + lx, p.y + ly) !== i) continue;
        const d = Math.hypot(lx - geom.w / 2, ly - geom.h / 2);
        if (!best || d < best.d) best = { d, lx, ly };
      }
    }
    if (!best) return null;
    return { from: g.toScreen(p.x + best.lx, p.y + best.ly), home: g.toScreen(geom.x + best.lx, geom.y + best.ly), scale: g.cam.s };
  }, i);

// ---------------------------------------------------------------- 入口與列表
{
  const { page, errors } = await newPage(browser);
  await page.goto(DEV_URL, { waitUntil: 'networkidle0' });
  checks.homeHasShapedButton = !!(await page.$('.shaped'));
  await page.click('.play');
  await page.waitForSelector('.cat-card');
  checks.categoryListHasNoShaped = (await page.$$eval('.cat-card h2', (h) => h.map((x) => x.textContent))).every((t) => t !== '異型');
  checks.categoryListHasFive = (await page.$$('.cat-card')).length === 5;
  await page.click('.back');
  await page.waitForSelector('.shaped');
  await page.click('.shaped');
  await page.waitForSelector('.img-card');
  checks.shapedListNine = (await page.$$('.img-card')).length === 9;
  checks.shapedHeaderName = (await page.$eval('.screen h1, .screen header h1, header h1', (h) => h.textContent).catch(() => '')) === '異型';
  await page.click('.back');
  checks.shapedBackGoesHome = !!(await page.waitForSelector('.shaped', { timeout: 3000 }).catch(() => null));
  allErrors.push(...errors);
  await page.close();
}

// ---------------------------------------------------------------- 各種輪廓都能開局並畫出來
const shots = [
  [0, 'octagon'],
  [1, 'circle'],
  [4, 'arch'],
  [5, 'rect'],
];
for (const [image, sil] of shots) {
  const { page, errors } = await newPage(browser);
  await openGame(page, { shaped: true, image, difficulty: 0 });
  const info = await page.evaluate(() => {
    const g = window.__game;
    return { n: g.pieces.length, outline: !!g.L.outline, geoms: g.L.geoms.length, sprites: g.sprites.length };
  });
  checks[`${sil}_pieceCount`] = info.n === 154 && info.geoms === 154 && info.sprites === 154;
  checks[`${sil}_outline`] = info.outline === (sil !== 'rect');
  await page.screenshot({ path: `${OUT}/shaped-${sil}-table.png` });
  allErrors.push(...errors);
  await page.close();
}

// ---------------------------------------------------------------- 拖曳吸附與鎖定（拼盤輪廓 = 六角形）
{
  const { page, errors } = await newPage(browser);
  await openGame(page, { shaped: true, image: 2, difficulty: 0 });

  // 一片邊框片：拖回正確位置就會鎖定（用滑鼠真的拖，走完整的命中判定與吸附流程）
  let locked = 0;
  for (let tries = 0; tries < 12 && locked < 1; tries++) {
    const idx = await page.evaluate((skip) => window.__game.L.geoms.findIndex((g, i) => g.edge && i >= skip && !window.__game.pieces[i].locked), tries);
    const grab = await grabPoint(page, idx);
    if (!grab) continue;
    await drag(page, grab.from, grab.home);
    await sleep(80);
    if (await page.evaluate((i) => window.__game.pieces[i].locked, idx)) locked++;
  }
  checks.edgePieceLocks = locked >= 1;

  // 兩片相鄰的拼片：把 b 拖到 a 旁邊的正確相對位置，應合併成同一組
  let merged = false;
  for (let tries = 0; tries < 20 && !merged; tries++) {
    const pair = await page.evaluate((skip) => {
      const g = window.__game;
      let seen = 0;
      for (let a = 0; a < g.pieces.length; a++) {
        if (g.pieces[a].locked) continue;
        for (const n of g.L.geoms[a].neighbors) {
          if (g.pieces[n.i].locked || g.pieces[n.i].group === g.pieces[a].group) continue;
          if (seen++ < skip) continue;
          const pa = g.pieces[a];
          const pb = g.pieces[n.i];
          return { a, b: n.i, wx: pa.x + n.dx - pb.x, wy: pa.y + n.dy - pb.y };
        }
      }
      return null;
    }, tries);
    if (!pair) break;
    const grab = await grabPoint(page, pair.b);
    if (!grab) continue;
    await drag(page, grab.from, { x: grab.from.x + pair.wx * grab.scale, y: grab.from.y + pair.wy * grab.scale });
    await sleep(80);
    merged = await page.evaluate(({ a, b }) => window.__game.pieces[a].group === window.__game.pieces[b].group, pair);
  }
  checks.neighborsMerge = merged;
  await page.screenshot({ path: OUT + '/shaped-hexagon-merged.png' });
  allErrors.push(...errors);
  await page.close();
}

// ---------------------------------------------------------------- 托盤（拼片大小不一）與存檔續玩
{
  const { page, errors } = await newPage(browser);
  await openGame(page, { shaped: true, image: 3, difficulty: 0, inTray: true });
  const s = await page.evaluate(() => ({ n: window.__game.pieces.length, tray: window.__game.trayOrder.length, open: window.__game.isTrayOpen }));
  checks.shapedNewGameInTray = s.n === 154 && s.tray === 154 && s.open;
  await page.screenshot({ path: `${OUT}/shaped-ellipse-tray.png` });

  // 從托盤拖出第一片到拼盤中央，再放回托盤
  const first = await page.evaluate(() => window.__game.trayOrder[0]);
  const cell = await page.evaluate(() => {
    const g = window.__game;
    const r = g.trayRect();
    const geo = g.trayRowGeom();
    return { x: 8 + geo.cellW / 2, y: r.y + 8 + geo.cellH / 2 };
  });
  const center = await page.evaluate(() => window.__game.toScreen(window.__game.L.boardW / 2, window.__game.L.boardH / 2));
  await drag(page, cell, center);
  await sleep(100);
  checks.pickedFromTray = await page.evaluate((i) => !window.__game.pieces[i].tray, first);
  const pos = await page.evaluate((i) => ({ x: window.__game.pieces[i].x, y: window.__game.pieces[i].y }), first);
  checks.pickedNearCenter = Math.abs(pos.x + (await page.evaluate((i) => window.__game.L.geoms[i].w, first)) / 2 - (await page.evaluate(() => window.__game.L.boardW / 2))) < 60;

  // 存檔續玩：重新載入後同一局的切法、位置要完全一樣
  await sleep(1500);
  const before = await page.evaluate(() => {
    const g = window.__game;
    // 托盤內拼片的座標存檔時會改寫成拼盤外圍（既有設計），所以只比桌面上的拼片與托盤順序
    const onTable = g.pieces.map((p, i) => [i, p]).filter(([, p]) => !p.tray);
    return { seed: g.seed, tray: g.trayOrder.slice(0, 20), pos: onTable.map(([i, p]) => [i, Math.round(p.x), Math.round(p.y)]), shape: g.L.geoms.slice(0, 5).map((x) => [Math.round(x.x), Math.round(x.y), Math.round(x.w), Math.round(x.h)]) };
  });
  await page.evaluate(() => window.__game.destroy?.());
  await page.reload({ waitUntil: 'networkidle0' });
  await page.waitForSelector('.continue:not(.hidden)', { timeout: 10000 });
  await page.click('.continue');
  await page.waitForFunction(() => window.__game, { timeout: 60000 });
  await sleep(500);
  const after = await page.evaluate(() => {
    const g = window.__game;
    // 托盤內拼片的座標存檔時會改寫成拼盤外圍（既有設計），所以只比桌面上的拼片與托盤順序
    const onTable = g.pieces.map((p, i) => [i, p]).filter(([, p]) => !p.tray);
    return { seed: g.seed, tray: g.trayOrder.slice(0, 20), pos: onTable.map(([i, p]) => [i, Math.round(p.x), Math.round(p.y)]), shape: g.L.geoms.slice(0, 5).map((x) => [Math.round(x.x), Math.round(x.y), Math.round(x.w), Math.round(x.h)]) };
  });
  checks.resumeSameSeed = before.seed === after.seed;
  checks.resumeSameShape = JSON.stringify(before.shape) === JSON.stringify(after.shape);
  checks.resumeSamePositions = before.pos.length === 1 && JSON.stringify(before.pos) === JSON.stringify(after.pos);
  checks.resumeSameTrayOrder = JSON.stringify(before.tray) === JSON.stringify(after.tray);
  allErrors.push(...errors);
  await page.close();
}

// ---------------------------------------------------------------- 最大難度（588 片）能載入，且不會慢到無法玩
let largestMs = 0;
{
  const { page, errors } = await newPage(browser);
  const t0 = Date.now();
  await openGame(page, { shaped: true, image: 2, difficulty: -1 });
  largestMs = Date.now() - t0;
  const n = await page.evaluate(() => ({ pieces: window.__game.pieces.length, sprites: window.__game.sprites.length }));
  checks.largestLoads = n.pieces === 588 && n.sprites === 588;
  checks.largestLoadsInTime = largestMs < 20000;
  await page.screenshot({ path: `${OUT}/shaped-largest.png` });
  allErrors.push(...errors);
  await page.close();
}

checks.noPageErrors = allErrors.length === 0;
await report(browser, checks, { largestLoadMs: largestMs, errors: allErrors });
