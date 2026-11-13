// 數字、時間與日期的顯示格式（不含文字；需要文字的由 strings.ts 組合）。

export const formatNumber = (n: number) => n.toLocaleString('en-US');

/** 碼錶格式：mm:ss，超過一小時為 h:mm:ss */
export function formatTime(ms: number) {
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const mm = String(Math.floor((total % 3600) / 60)).padStart(2, '0');
  const ss = String(total % 60).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

/** 拆成小時與分鐘，供 strings.ts 組成「3 小時 5 分」之類的文字 */
export function splitDuration(ms: number) {
  const mins = Math.floor(ms / 60000);
  return { hours: Math.floor(mins / 60), minutes: mins % 60 };
}

export const formatDate = (t: number) => {
  const d = new Date(t);
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
};

/** 檔名用的日期：YYYYMMDD */
export const fileDate = (d = new Date()) =>
  `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
