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

/** 重新載入後要提示「已更新」的旗標（sessionStorage 只活在這個分頁，重開 App 不會誤報） */
const UPDATED_FLAG = 'just-updated';

/** 新版已接手、等待重新載入套用 */
let updatePending = false;

/** 重新載入以套用新版，並留下旗標讓載入後提示「已更新」 */
function reloadForUpdate() {
  try {
    sessionStorage.setItem(UPDATED_FLAG, '1');
  } catch {
    // 無法使用 sessionStorage 只是少一則提示
  }
  location.reload();
}

/**
 * 新版已就緒：不在拼圖中就立刻重新載入；拼圖中則等離開遊戲畫面時再載入，不打斷遊戲。
 */
export function applyUpdateWhenSafe() {
  if (document.querySelector('main.screen.game')) updatePending = true;
  else reloadForUpdate();
}

const baseRoutes: Nav = {
  home: showHome,
  categories: showCategories,
  images: (categoryId) => void showImages(categoryId),
  game: (img, diff) => void startGame(img, diff),
  titles: () => showTitles(),
  stats: () => showStats(),
  settings: showSettings,
};
// 每次換畫面前，若有等待中的更新且要去的不是遊戲畫面，就先套用新版（重新載入後回到主畫面）
const routes = Object.fromEntries(
  Object.entries(baseRoutes).map(([name, go]) => [
    name,
    (...args: unknown[]) => {
      if (updatePending && name !== 'game') return reloadForUpdate();
      (go as (...a: unknown[]) => void)(...args);
    },
  ]),
) as unknown as Nav;
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
  let justUpdated = false;
  try {
    justUpdated = sessionStorage.getItem(UPDATED_FLAG) === '1';
    sessionStorage.removeItem(UPDATED_FLAG);
  } catch {
    // 同上，略過提示
  }
  if (justUpdated) toast(esc(S.updated));
}
