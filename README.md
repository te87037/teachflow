# TeachFlow 教學進度管家

TeachFlow 是為台灣國高中教師設計的手機優先 PWA。可執行版本包含今日課堂快記、段考配速、IndexedDB 離線保存、安全 CSV 匯出，以及透過免費 Google Apps Script 橋接服務將待同步操作追加到指定 Google Sheet 的跨裝置同步。

正式部署網址：<https://te87037.github.io/teachflow/>

## 本機啟動

此專案沒有第三方執行期依賴。請使用任一靜態 HTTP server 服務 `dist/`，不要直接以 `file://` 開啟，否則 Service Worker 不會運作。

```powershell
python -m http.server 4173 --directory dist
```

開啟 `http://localhost:4173`。測試與語法檢查：

```powershell
npm test
npm run check
```

## 部署

GitHub Actions 會在 `main` 更新時執行 `.github/workflows/pages.yml`：先跑核心測試，再將 `dist/` 上傳並部署至 GitHub Pages。部署需要在儲存庫的 **Settings → Pages → Build and deployment → Source** 選擇 **GitHub Actions**。

## 環境設定

GitHub Actions variables：

- `TEACHFLOW_SYNC_BRIDGE_URL`：部署完成的 Apps Script Web App URL。
- `GOOGLE_SHEETS_SPREADSHEET_ID`：固定允許讀寫的試算表 ID。

Apps Script 專案的 Script Properties 保存 `TEACHFLOW_SYNC_SECRET` 與 `GOOGLE_SHEETS_SPREADSHEET_ID`。Web App 以擁有者身分執行，並只透過驗證 GitHub Pages origin 的 iframe 橋接接受同步要求。前端不含 Google 私鑰、OAuth secret 或固定後端同步密鑰。

## 教師快速入門

1. 第一次開啟會載入明確標記的示範班級與課表。
2. 在「今日」選日期並按「記錄這堂」。輸入章節、已完成頁碼、狀態與備忘後儲存。
3. 在「配速」核對段考前有效堂數與每堂建議頁數，可展開日期明細。
4. 在「紀錄」搜尋及核對歷史，右上角可匯出 UTF-8 BOM CSV。
5. 在「設定」可查看週課表；上傳文件只建立待核對批次，不會直接套用。
6. 按雲端狀態，第一次輸入 TeachFlow 同步存取碼；同一裝置之後會自動同步，不必重複登入 Google。

## 維護與資料

- IndexedDB 名稱為 `teachflow`；資料庫版本目前為 1。
- Service Worker cache 名稱為 `teachflow-v8`，安裝後立即接管既有分頁。更新靜態資源時應同步增加 cache 版本。
- 資料模型變更必須先新增遷移，不得刪除 `syncQueue` 中尚未同步的操作。
- 核心計算規則修改時，同步更新 spec.md、design.md、tests 與 acceptance.md。

## 已知限制

- 首版固定為單一教師與單一 Google Sheet；瀏覽器以可輪替同步存取碼連線 Apps Script，沒有多使用者帳號或管理後台。
- 匯入只完成前端檔案驗證與批次建立，沒有呼叫模擬或真實 OCR。
- 課表目前只讀；尚未提供版本編輯、原子對調與撤銷 UI。
- 同步存取碼保存在該裝置的 localStorage；共用或遺失的裝置應按「忘記存取碼」，必要時輪替 Apps Script 的 Script Property。
- 追加式同步保留操作歷史，跨裝置同一筆資料以原始修改時間較新者為準；尚未提供人工衝突選擇 UI。
- PWA 圖示目前為 SVG；正式 iOS 發佈前補 192px／512px PNG 與 Apple touch icon。
