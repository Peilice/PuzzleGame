# 百景日常

單機離線拼圖遊戲（PWA）：5 大圖片分類、4 種難度（150 / 250 / 400 / 600 片），以及資料驅動的稱號系統。完整規格見 [`SPEC.md`](SPEC.md)。

## 開發

```bash
npm install
npm run dev        # 開發伺服器 http://localhost:5173
npm test           # 核心邏輯單元測試（Vitest）
npm run typecheck  # 型別檢查（含測試檔）
npm run lint       # ESLint
npm run e2e        # 端對端測試（自動啟動伺服器，使用本機 Chrome / Edge）
npm run check      # 以上全部
npm run build      # 產生 dist/（含 Service Worker，可離線）
npm run preview    # 預覽建置結果
```

端對端測試可只跑指定的腳本，例如 `npm run e2e -- smoke pan`；`npm run e2e -- perf` 為效能量測。
找不到瀏覽器時以環境變數 `CHROME_PATH` 指定執行檔。截圖輸出到 `e2e-shots/`（不進版控）。

## 安裝到裝置

`dist/` 部署到任一 HTTPS 靜態主機（或區網內的本機伺服器）後，用瀏覽器開啟：

- Windows（Chrome / Edge）：網址列的「安裝」圖示。
- iPad / iPhone（Safari）：分享 →「加入主畫面」。
- Android（Chrome）：選單 →「安裝應用程式」。

安裝後完全離線可玩。圖庫約 59 張 1920×1440 WebP，預快取總量約 20～30 MB。

## 圖庫

圖片取自 Wikimedia Commons，只收公有領域 / CC0。出處見 [`CREDITS.md`](CREDITS.md)。
「異型」分類例外：圖片由 `scripts/shaped-art.mjs` 程式生成（固定種子，授權 CC0），`build` 時一併輸出。
預覽單獨輸出：`node scripts/shaped-art.mjs <輸出資料夾>`。

```bash
node scripts/fetch-images.mjs candidates   # 下載候選圖到 assets-raw/ 並產生預覽拼貼
# 編輯 scripts/picks.json 挑選每類 10 張並命名
node scripts/fetch-images.mjs build        # 輸出 public/images、src/content/images.json、CREDITS.md
```

## 專案結構

| 路徑 | 內容 |
|---|---|
| `src/core/content.ts` | 分類、難度、稱號名稱設定（新增內容只改這裡與 `images.json`） |
| `src/core/titles.ts` | 稱號定義產生與解鎖 / 可見判定 |
| `src/core/save.ts` / `stats.ts` | 存檔結構、版本遷移、統計推導 |
| `src/core/puzzle.ts` | 拼片幾何（`PieceGeom`）、經典格狀切割、吸附合併、鎖定、散片排列 |
| `src/core/irregular.ts` | 異型切割：Voronoi 不規則拼片與拼盤輪廓 |
| `src/core/storage.ts` | 存檔與進度的儲存層（IndexedDB，無法使用時改用記憶體）、匯出 / 匯入 |
| `src/game/game.ts` | Canvas 遊戲（繪製、觸控 / 滑鼠操作） |
| `src/ui/app.ts` / `nav.ts` | 啟動流程與畫面導覽 |
| `src/ui/screens/` | 各畫面：主畫面、選圖、遊戲與結算、稱號圖鑑、統計、設定 |
| `src/ui/state.ts` | 目前的存檔、內容與稱號定義；寫入存檔的統一入口 |
| `src/ui/dom.ts` | 建立元素、切換畫面、對話框、通知 |
| `src/ui/strings.ts` | 所有介面文字（含稱號條件說明、錯誤訊息） |
| `tests/` | 單元測試；`tests/e2e/` 為端對端測試 |
| `src/audio.ts` | Web Audio 合成音效 |

## 擴充

- **新增分類**：在 `CATEGORIES` 加一筆（`original: false`、10 個稱號名稱、收藏家名稱），再加入圖片。稱號線、統計、「萬象通曉」會自動出現。
- **新增圖片**：加入 `images.json`。分類線第 8～10 級會在內容足夠時自動顯示；已解鎖的「全部完成」類稱號保留並標示「有新內容尚未完成」。
- **待辦**：提示、底圖淡影、旋轉模式、趣味稱號、上架 / 打包（見 `SPEC.md` §7）。
