// 端對端測試：左鍵在拼盤 / 空白處拖曳不移動視角；右鍵拖曳才平移。
// 用法：npm run e2e -- pan
import { drag, launch, newPage, openGame, report } from './lib.mjs';

const browser = await launch();
const { page, errors } = await newPage(browser);
await openGame(page);

const cam = () => page.evaluate(() => ({ tx: window.__game.cam.tx, ty: window.__game.cam.ty }));
// 拼盤正中央：新局時拼片都在拼盤外，這裡是空的拼盤
const c = await page.evaluate(() => window.__game.toScreen(window.__game.L.boardW / 2, window.__game.L.boardH / 2));
const to = { x: c.x + 200, y: c.y + 120 };

const before = await cam();
await drag(page, c, to);
const afterLeft = await cam();
await drag(page, c, to, 'right');
const afterRight = await cam();

await report(
  browser,
  {
    leftDragKeepsBoard: before.tx === afterLeft.tx && before.ty === afterLeft.ty,
    rightDragPans: Math.round(afterRight.tx - afterLeft.tx) === 200 && Math.round(afterRight.ty - afterLeft.ty) === 120,
    noPageErrors: errors.length === 0,
  },
  { errors },
);
