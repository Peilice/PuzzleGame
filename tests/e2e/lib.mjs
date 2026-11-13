// 端對端測試的共用工具：啟動瀏覽器、進入遊戲、回報結果。
// 環境變數：
//   CHROME_PATH       瀏覽器執行檔（未設定時自動尋找 Chrome / Edge）
//   E2E_URL           dev server 網址（預設 http://localhost:5173/）
//   E2E_PREVIEW_URL   建置後 preview 的網址（預設 http://localhost:4173/，離線測試用）
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';

export const DEV_URL = process.env.E2E_URL ?? 'http://localhost:5173/';
export const PREVIEW_URL = process.env.E2E_PREVIEW_URL ?? 'http://localhost:4173/';

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function findBrowser() {
  const candidates = [
    process.env.CHROME_PATH,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ];
  const found = candidates.find((p) => p && fs.existsSync(p));
  if (!found) throw new Error('找不到 Chrome / Edge，請以環境變數 CHROME_PATH 指定瀏覽器執行檔');
  return found;
}

/** 啟動瀏覽器（每次都是全新的設定檔，因此存檔是空的）。 */
export const launch = () => puppeteer.launch({ executablePath: findBrowser(), headless: true, args: ['--no-first-run'] });

/** 開新分頁並收集頁面錯誤；回傳 { page, errors }。 */
export async function newPage(browser, viewport = { width: 1280, height: 800 }) {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.setViewport(viewport);
  return { page, errors };
}

/**
 * 從主畫面一路點進遊戲並等到可以操作。
 * image：第幾張圖（從 0 起算）；difficulty：第幾個難度，-1 為最後一個；已有進度時會續玩。
 * inTray：新局的拼片放在托盤（遊戲預設）；測試預設為 false（散在桌面），因為多數測試是從桌面座標拖拼片。
 */
export async function openGame(page, { url = DEV_URL, image = 0, difficulty = 0, inTray = false } = {}) {
  await page.goto(url, { waitUntil: 'networkidle0' });
  await page.evaluate(() => (window.__game = undefined));
  const place = inTray ? '.place-tray' : '.place-table';
  await page.click('.settings');
  await page.waitForSelector(place);
  await page.click(place);
  await page.waitForSelector(place + '.active');
  await page.click('.back');
  await page.waitForSelector('.play');
  await page.click('.play');
  await page.waitForSelector('.cat-card');
  await page.click('.cat-card');
  await page.waitForSelector('.img-card');
  await page.click(`.img-card:nth-child(${image + 1})`);
  await page.waitForSelector('.diff-modal');
  await page.$$eval(
    '.diff-row',
    (rows, d) => rows.at(d).querySelector('.go, .resume').click(),
    difficulty,
  );
  await page.waitForFunction(() => window.__game, { timeout: 60000 });
  await sleep(400);
}

/** 以滑鼠從 from 拖到 to（畫面座標）。 */
export async function drag(page, from, to, button = 'left') {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down({ button });
  await page.mouse.move(to.x, to.y, { steps: 10 });
  await page.mouse.up({ button });
}

/**
 * 印出結果並以結束碼回報：checks 的每一項都必須為 true。
 * details 只供閱讀，不影響結果。
 */
export async function report(browser, checks, details = {}) {
  await browser.close();
  const failed = Object.entries(checks).filter(([, ok]) => ok !== true);
  console.log(JSON.stringify({ checks, ...details }, null, 2));
  if (failed.length) console.error(`失敗：${failed.map(([k]) => k).join('、')}`);
  process.exit(failed.length ? 1 : 0);
}
