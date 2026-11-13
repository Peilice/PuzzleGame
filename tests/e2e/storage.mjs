// 端對端測試：存檔異常時遊戲仍能啟動，且不會覆蓋不該動的資料。
// 用法：npm run e2e -- storage
import { DEV_URL, launch, newPage, report, sleep } from './lib.mjs';

const browser = await launch();
const checks = {};
const allErrors = [];

/** 直接改寫裝置上的存檔（模擬壞掉或較新版本的存檔） */
const putRawSave = (page, value) =>
  page.evaluate(
    (v) =>
      new Promise((resolve, reject) => {
        const req = indexedDB.open('puzzle-game', 1);
        req.onsuccess = () => {
          const t = req.result.transaction('kv', 'readwrite');
          t.objectStore('kv').put(v, 'save');
          t.oncomplete = () => resolve();
          t.onerror = () => reject(t.error);
        };
        req.onerror = () => reject(req.error);
      }),
    value,
  );

const getRaw = (page, key) =>
  page.evaluate(
    (k) =>
      new Promise((resolve, reject) => {
        const req = indexedDB.open('puzzle-game', 1);
        req.onsuccess = () => {
          const r = req.result.transaction('kv', 'readonly').objectStore('kv').get(k);
          r.onsuccess = () => resolve(r.result);
          r.onerror = () => reject(r.error);
        };
        req.onerror = () => reject(req.error);
      }),
    key,
  );

const homeWithWarning = async (page) => {
  await page.waitForSelector('.home', { timeout: 5000 });
  return page.waitForSelector('.toast.error', { timeout: 3000 }).then(() => true, () => false);
};

// ---------------------------------------------------------------- 版本較新的存檔
{
  const { page, errors } = await newPage(browser);
  await page.goto(DEV_URL, { waitUntil: 'networkidle0' });
  const newer = { version: 999, fromTheFuture: true };
  await putRawSave(page, newer);
  await page.reload({ waitUntil: 'networkidle0' });
  checks.newerSaveStartsWithWarning = await homeWithWarning(page);
  // 改個設定觸發存檔，確認沒有寫到裝置上
  await page.click('.settings');
  await page.waitForSelector('.sound-off');
  await page.click('.sound-off');
  await sleep(300);
  checks.newerSaveNotOverwritten = JSON.stringify(await getRaw(page, 'save')) === JSON.stringify(newer);
  allErrors.push(...errors);
  await page.close();
}

// ---------------------------------------------------------------- 無法辨識的存檔
{
  const { page, errors } = await newPage(browser);
  await page.goto(DEV_URL, { waitUntil: 'networkidle0' });
  const junk = { hello: 'world' };
  await putRawSave(page, junk);
  await page.reload({ waitUntil: 'networkidle0' });
  checks.corruptSaveStartsWithWarning = await homeWithWarning(page);
  checks.corruptSaveBackedUp = JSON.stringify(await getRaw(page, 'save-corrupt')) === JSON.stringify(junk);
  allErrors.push(...errors);
  await page.close();
}

// ---------------------------------------------------------------- IndexedDB 無法使用
{
  const { page, errors } = await newPage(browser);
  await page.evaluateOnNewDocument(() => {
    Object.defineProperty(window, 'indexedDB', {
      get() {
        throw new Error('IndexedDB disabled for test');
      },
    });
  });
  await page.goto(DEV_URL, { waitUntil: 'networkidle0' });
  checks.noIndexedDbStartsWithWarning = await homeWithWarning(page);
  // 仍然可以進入遊戲
  await page.click('.play');
  await page.waitForSelector('.cat-card');
  await page.click('.cat-card');
  await page.waitForSelector('.img-card');
  await page.click('.img-card');
  await page.waitForSelector('.diff-row .go');
  await page.click('.diff-row .go');
  checks.noIndexedDbGamePlayable = await page.waitForFunction(() => window.__game, { timeout: 20000 }).then(() => true, () => false);
  allErrors.push(...errors);
  await page.close();
}

checks.noPageErrors = allErrors.length === 0;
await report(browser, checks, { errors: allErrors });
