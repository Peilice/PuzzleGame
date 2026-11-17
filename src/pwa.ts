// Service worker 註冊與版本更新檢查。
// 瀏覽器只在開啟 App 時檢查新版；另外在每天 00:00、12:00 與 App 從背景切回來時主動檢查，
// 避免一直開著（或手機只是切到背景）就永遠停在舊版。
import { registerSW } from 'virtual:pwa-register';
import { msUntilNextUpdateCheck } from './core/update';

/** 計時器在背景可能被延後，最短也隔一秒，避免在整點附近連續觸發 */
const MIN_DELAY_MS = 1000;

/** onUpdated：新版已接手、需要重新載入才會套用時呼叫 */
export function setupPwa(onUpdated: () => void) {
  registerSW({
    immediate: true,
    onNeedReload: onUpdated,
    onRegisteredSW(_url, reg) {
      if (!reg) return;
      const check = () => {
        if (!navigator.onLine || reg.installing) return;
        reg.update().catch(() => {}); // 離線、伺服器暫時連不上都無妨，下次再檢查
      };
      const schedule = () => {
        setTimeout(
          () => {
            check();
            schedule();
          },
          Math.max(MIN_DELAY_MS, msUntilNextUpdateCheck(new Date())),
        );
      };
      schedule();
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') check();
      });
    },
  });
}
