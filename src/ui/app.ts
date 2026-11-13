// 應用程式進入點：接上各畫面的導覽，載入存檔後顯示主畫面。
import { INITIAL_TITLE, type SaveData } from '../core/save';
import type { SaveIssue } from '../core/storage';
import { esc, toast } from './dom';
import { nav, type Nav } from './nav';
import { startGame } from './screens/game';
import { showHome } from './screens/home';
import { showCategories, showImages } from './screens/select';
import { showSettings } from './screens/settings';
import { showStats } from './screens/stats';
import { showTitles } from './screens/titles';
import { applySettings, defById, persist, refreshTitles, store } from './state';
import { S } from './strings';

/** 存檔異常的提示要停久一點，讓玩家來得及讀完 */
const ISSUE_TOAST_MS = 9000;

const routes: Nav = {
  home: showHome,
  categories: showCategories,
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
  nav.home();
  if (issue) toast(esc(S.saveIssue[issue]), 'error', ISSUE_TOAST_MS);
}
