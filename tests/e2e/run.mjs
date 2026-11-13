// 一鍵執行端對端測試：自動啟動 dev server 與建置後的 preview，依序執行各腳本。
// 用法：npm run e2e              全部（smoke、pan、hint、extra、storage）
//       npm run e2e -- pan hint   只跑指定的腳本
//       npm run e2e -- perf       效能量測
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build, createServer, preview } from 'vite';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT = ['smoke', 'pan', 'hint', 'extra', 'storage'];
const names = process.argv.slice(2).length ? process.argv.slice(2) : DEFAULT;

const dev = await createServer({ server: { port: 5199 }, logLevel: 'error' });
await dev.listen();
const env = { ...process.env, E2E_URL: dev.resolvedUrls.local[0] };

// 只有離線測試需要建置後的版本
let previewServer = null;
if (names.includes('extra')) {
  await build({ logLevel: 'error' });
  previewServer = await preview({ preview: { port: 4199 }, logLevel: 'error' });
  env.E2E_PREVIEW_URL = previewServer.resolvedUrls.local[0];
}

const failed = [];
for (const name of names) {
  console.log('\n=== ' + name + ' ===');
  // 不能用 spawnSync：伺服器與本程式同一個行程，阻塞事件迴圈會讓頁面載不進來
  const child = spawn(process.execPath, [path.join(HERE, name + '.mjs')], { stdio: 'inherit', env });
  const code = await new Promise((res) => child.on('exit', res));
  if (code !== 0) failed.push(name);
}

await dev.close();
if (previewServer) await new Promise((res) => previewServer.httpServer.close(res));
console.log(failed.length ? '\n失敗：' + failed.join('、') : '\n全部通過：' + names.join('、'));
process.exit(failed.length ? 1 : 0);
