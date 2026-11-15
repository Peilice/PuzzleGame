// 應用程式進入點：接上各畫面的導覽，載入存檔後顯示主畫面。
import { INITIAL_TITLE, type SaveData } from '../core/save';
import type { SaveIssue } from '../core/storage';
import { esc, toast } from './dom';
import { nav, type Nav } from './nav';
import { startGame } from './screens/game';
import { showHome } from './screens/home';
import { SHAPED_CATEGORY, showCategories, showImages } from './screens/select';
import { showSettings } from './screens/settings';
import { showStats } from './screens/stats';
import { showTitles } from './screens/titles';
import { applySettings, defById, persist, refreshTitles, store } from './state';
import { S } from './strings';

/** 存檔異常的提示要停久一點，讓玩家來得及讀完 */
const ISSUE_TOAST_MS = 9000;

/** 獨立入口「異型拼圖」的網址：主畫面沒有連結，只能靠這個網址進入（hash 路由，靜態部署與離線都能用） */
export const SHAPED_HASH = '#/shaped';

/** 改網址的 hash：用 replaceState，不新增瀏覽紀錄，也不會觸發 hashchange */
function setHash(hash: string) {
  if (location.hash === hash) return;
  history.replaceState(null, '', location.pathname + location.search + hash);
}

const routes: Nav = {
  home: () => {
    setHash('');
    showHome();
  },
  categories: showCategories,
  shaped: () => {
    setHash(SHAPED_HASH);
    void showImages(SHAPED_CATEGORY);
  },
  images: (categoryId) => void showImages(categoryId),
  game: (img, diff) => void startGame(img, diff),
  titles: () => showTitles(),
  stats: () => showStats(),
  settings: showSettings,
};
Object.assign(nav, routes);

export async function startApp(initial: SaveData, issue: SaveIssue | null = null) {
  store.save = initial;
  // 補發可能因內容更新而達成的稱號（例如新版本調整了條件）
  const unlocked = refreshTitles();
  const equippedMissing = !defById.has(store.save.profile.equippedTitle);
  if (equippedMissing) store.save.profile.equippedTitle = INITIAL_TITLE;
  // 沒有變動就不寫入，避免每次啟動都重寫存檔
  if (unlocked.length || equippedMissing) await persist();
  applySettings();
  // 手動改網址（輸入或貼上 #/shaped）時也要導向；其他 hash 不處理
  window.addEventListener('hashchange', () => {
    if (location.hash === SHAPED_HASH) nav.shaped();
    else if (!location.hash) nav.home();
  });
  if (location.hash === SHAPED_HASH) nav.shaped();
  else nav.home();
  if (issue) toast(esc(S.saveIssue[issue]), 'error', ISSUE_TOAST_MS);
}
