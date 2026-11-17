// 版本更新的檢查時刻：每天 00:00 與 12:00（裝置當地時間）。

/** 每天固定檢查的整點 */
export const UPDATE_CHECK_HOURS = [0, 12];

/** 從 now 到下一個檢查時刻（嚴格晚於 now）的毫秒數 */
export function msUntilNextUpdateCheck(now: Date): number {
  for (let day = 0; day <= 1; day++) {
    for (const h of UPDATE_CHECK_HOURS) {
      const t = new Date(now.getFullYear(), now.getMonth(), now.getDate() + day, h);
      if (t.getTime() > now.getTime()) return t.getTime() - now.getTime();
    }
  }
  /* c8 ignore next */
  return 12 * 60 * 60 * 1000;
}
