// 效能量測（非測試）：600 片在 CPU 降速 4 倍時，從按下開始到可遊玩的時間與平均影格時間。
// 用法：npm run e2e -- perf
import { DEV_URL, launch, newPage } from './lib.mjs';

const browser = await launch();
const { page } = await newPage(browser, { width: 1024, height: 768 });
await page.goto(DEV_URL, { waitUntil: 'networkidle0' });
await page.emulateCPUThrottling(4);
await page.click('.play');
await page.waitForSelector('.cat-card');
await page.click('.cat-card');
await page.waitForSelector('.img-card');
await page.click('.img-card');
await page.waitForSelector('.diff-row .go');
const t0 = Date.now();
await page.$$eval('.diff-row .go', (b) => b.at(-1).click());
await page.waitForFunction(() => window.__game && window.__game.pieces.length > 500, { timeout: 60000 });
const readyMs = Date.now() - t0;
// 每一幀都強制重畫時的平均影格時間
const avgFrameMs = await page.evaluate(async () => {
  const times = [];
  let last = performance.now();
  await new Promise((res) => {
    let n = 0;
    const tick = (t) => {
      times.push(t - last);
      last = t;
      window.__game.dirty = true;
      if (++n < 60) requestAnimationFrame(tick);
      else res();
    };
    requestAnimationFrame(tick);
  });
  return times.slice(5).reduce((a, b) => a + b, 0) / (times.length - 5);
});
console.log(JSON.stringify({ readyMs, avgFrameMs: +avgFrameMs.toFixed(1) }));
await browser.close();
