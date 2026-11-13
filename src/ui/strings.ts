// 所有介面文字集中於此，日後擴充語系只需替換這個檔案。
// （圖片、分類與稱號的「名稱」屬於內容資料，放在 core/content.ts、core/titles.ts 與 images.json。）
import type { SaveErrorCode } from '../core/save';
import type { SaveIssue } from '../core/storage';
import type { Rarity, TitleCondition, TitleLine } from '../core/titles';
import { formatNumber, splitDuration } from './format';

const SPEED_TIERS = ['銅', '銀', '金'];

const saveError: Record<SaveErrorCode, string> = {
  'not-json': '檔案不是有效的 JSON',
  'not-ours': '這不是本遊戲的存檔檔案',
  format: '存檔格式錯誤',
  'no-version': '存檔缺少版本資訊',
  newer: '存檔版本比遊戲新，請更新遊戲',
};

const saveIssue: Record<SaveIssue, string> = {
  unavailable: '這個瀏覽器無法儲存資料（可能是無痕模式），本次遊玩的進度不會保留。',
  newer: '裝置上的存檔來自較新版本的遊戲。為了不覆蓋它，本次遊玩的進度不會保留；請重新整理以更新遊戲。',
  corrupt: '原本的存檔無法讀取，已另外備份並改用新的存檔。',
};

const lineNames: Record<TitleLine, string> = {
  category: '分類',
  difficulty: '難度',
  speed: '速度',
  collection: '蒐集',
  progress: '總進度',
};

const rarityNames: Record<Rarity, string> = {
  common: '普通',
  rare: '稀有',
  epic: '史詩',
  legendary: '傳說',
};

/** 桌面顏色名稱（id 見 theme.ts） */
const tableNames: Record<string, string> = {
  oak: '橡木',
  walnut: '胡桃木',
  felt: '綠絨布',
  slate: '石板灰',
};

function titleCondition(c: TitleCondition): string {
  switch (c.kind) {
    case 'category':
      return `完成 ${c.count} 組「${c.category}」拼圖（不同圖片或難度）`;
    case 'difficulty':
      return c.count === 1 ? `首次完成 ${c.label} 片拼圖` : `完成 ${c.label} 片拼圖 ${c.count} 次`;
    case 'speed':
      return `${c.minutes} 分鐘內完成 ${c.label} 片拼圖（${SPEED_TIERS[c.tier]}）`;
    case 'each-category':
      return `${c.categories.join('、')}各完成至少 1 組`;
    case 'all-categories':
      return '所有分類各完成至少 1 組';
    case 'collector':
      return `完成「${c.category}」所有圖片的所有難度`;
    case 'all-images':
      return '每張圖片都至少完成一次（任意難度）';
    case 'perfect':
      return '完成所有圖片的所有難度';
    case 'progress':
      return c.pieces === 0 ? '初始稱號' : `累計拼上 ${formatNumber(c.pieces)} 片`;
  }
}

/** 較長的時間：「3 小時 5 分」或「12 分鐘」 */
function duration(ms: number) {
  const { hours, minutes } = splitDuration(ms);
  return hours > 0 ? `${hours} 小時 ${minutes} 分` : `${minutes} 分鐘`;
}

export const S = {
  appName: '拼圖工坊',
  appTagline: '一片一片，拼出好風景',
  equipped: '目前稱號',
  play: '開始拼圖',
  continueLast: '繼續上一局',
  titles: '稱號圖鑑',
  stats: '統計',
  settings: '設定',
  back: '返回',
  home: '主畫面',
  chooseCategory: '選擇分類',
  chooseDifficulty: '選擇難度',
  pieces: (n: number) => `${n} 片`,
  combosDone: (a: number, b: number) => `已完成 ${a} / ${b} 組`,
  bestTime: '最佳時間',
  noRecord: '尚無紀錄',
  inProgress: (pct: number) => `進行中 ${pct}%`,
  resume: '繼續',
  restart: '重新開始',
  start: '開始',
  confirmRestart: '要放棄目前進度重新開始嗎？',
  duration,
  // 遊戲中
  preview: '預覽',
  edgeOnly: '邊框',
  arrange: '整理',
  resetView: '全覽',
  zoomIn: '放大',
  zoomOut: '縮小',
  pause: '暫停',
  help: '說明',
  hintTitle: '操作方式',
  hintClose: '關閉操作提示',
  hintMouse: [
    ['左鍵拖曳', '移動拼片'],
    ['右鍵拖曳', '移動畫面'],
    ['滾輪', '縮放'],
  ] as [string, string][],
  hintTouch: [
    ['單指拖曳', '移動拼片'],
    ['雙指拖動', '移動畫面'],
    ['雙指捏合', '縮放'],
  ] as [string, string][],
  paused: '已暫停',
  resumeGame: '繼續拼圖',
  leaveGame: '離開（自動存檔）',
  rotateDevice: '請將裝置轉為橫向',
  rotateDeviceHint: '拼圖畫面需要橫向顯示',
  loadingImage: '正在準備拼片…',
  imageLoadFailed: '圖片載入失敗',
  gameStartFailed: '無法開始遊戲：這個瀏覽器不支援所需的繪圖功能',
  // 結算
  completeTitle: '完成！',
  timeUsed: '使用時間',
  newRecord: '新紀錄！',
  previousBest: (t: string) => `先前最佳 ${t}`,
  newTitles: '解鎖新稱號',
  equip: '裝備',
  equippedLabel: '裝備中',
  backToImages: '回到圖片列表',
  playAgain: '再拼一次',
  // 稱號
  titleUnlocked: '解鎖稱號',
  moreTitles: (n: number) => `還有 ${n} 個新稱號`,
  locked: '尚未解鎖',
  hiddenTitle: '???',
  hiddenCondition: '隱藏稱號：達成條件後揭曉',
  hasNewContent: '有新內容尚未完成',
  unlockedOn: (d: string) => `${d} 解鎖`,
  titleCount: (a: number, b: number) => `已解鎖 ${a} / ${b}`,
  all: '全部',
  lineNames,
  rarityNames,
  titleCondition,
  // 統計
  overview: '總覽',
  totalPlayTime: '總遊玩時間',
  totalPieces: '累計片數',
  totalCompletions: '完成局數',
  titlesUnlocked: '已解鎖稱號',
  byCategory: '各分類完成組合',
  byDifficulty: '各難度完成組合',
  bestTimes: '最佳時間表',
  image: '圖片',
  // 設定
  sound: '音效',
  on: '開',
  off: '關',
  tableColor: '桌面顏色',
  tableNames,
  saveData: '存檔',
  exportSave: '匯出存檔',
  importSave: '匯入存檔',
  importConfirm: '匯入會覆蓋目前所有進度與稱號，確定要匯入嗎？',
  importDone: '匯入完成',
  importFailed: (m: string) => `匯入失敗：${m}`,
  saveError,
  saveIssue,
  saveFailed: '存檔失敗，最近的進度可能沒有保留（儲存空間可能已滿）。',
  exportHint: '清除瀏覽器資料會讓存檔消失，建議定期匯出備份；也可用來換裝置。',
  credits: '圖片來源',
  creditsHint: '所有圖片取自 Wikimedia Commons，授權為公有領域或 CC0。',
  cancel: '取消',
  ok: '確定',
};
