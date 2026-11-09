# TeachFlow 教學進度管家

TeachFlow 是為台灣國高中教師設計的手機優先 PWA。可執行版本包含今日課堂快記、歷史查詢、段考配速、IndexedDB 離線保存、安全 CSV 匯出，以及以 Google OAuth 將待同步操作追加到指定 Google Sheet 的跨裝置同步。

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

請在 GitHub 儲存庫 **Settings → Secrets and variables → Actions → Variables** 建立：

- `GOOGLE_OAUTH_CLIENT_ID`：Google Cloud 的「網頁應用程式」OAuth 用戶端 ID；其 Authorized JavaScript origin 必須包含 `https://te87037.github.io`。網頁用戶端不使用 client secret。
- `GOOGLE_SHEETS_SPREADSHEET_ID`：資料要寫入的試算表 ID（網址 `/d/` 與下一個 `/` 之間）。也可由教師在畫面輸入另一份 Sheet。

Google Cloud 專案需啟用 Google Sheets API，並設定 OAuth 同意畫面。部署 workflow 只把上述公開設定寫進 `remote-config.js`；不得加入 client secret、服務帳戶私鑰或 API 金鑰。GitHub Pages 本身只託管靜態網站，真正的遠端資料位於 Google Sheet。

## 教師快速入門

1. 第一次開啟會載入明確標記的示範班級與課表。
2. 在「今日」選日期並按「記錄這堂」。輸入章節、已完成頁碼、狀態與備忘後儲存。
3. 在「配速」核對段考前有效堂數與每堂建議頁數，可展開日期明細。
4. 在「紀錄」搜尋及核對歷史，右上角可匯出 UTF-8 BOM CSV。
5. 在「設定」可查看週課表；上傳文件只建立待核對批次，不會直接套用。
6. 按「連接 Google Sheet」，確認試算表網址後使用 Google 登入；第一次同步會自動建立「TeachFlow資料」工作表。

## 維護與資料

- IndexedDB 名稱為 `teachflow`；資料庫版本目前為 1。
- Service Worker cache 名稱為 `teachflow-v6`，安裝後立即接管既有分頁。更新靜態資源時應同步增加 cache 版本。
- 資料模型變更必須先新增遷移，不得刪除 `syncQueue` 中尚未同步的操作。
- 核心計算規則修改時，同步更新 spec.md、design.md、tests 與 acceptance.md。

## 已知限制

- Google 存取權由該試算表的 Drive 權限控制；目前沒有產品自己的多使用者帳號或管理後台。
- 匯入只完成前端檔案驗證與批次建立，沒有呼叫模擬或真實 OCR。
- 課表目前只讀；尚未提供版本編輯、原子對調與撤銷 UI。
- OAuth access token 到期後需再次按 Google 登入；應用程式不保存 refresh token。
- 追加式同步保留操作歷史，跨裝置同一筆資料以原始修改時間較新者為準；尚未提供人工衝突選擇 UI。
- PWA 圖示目前為 SVG；正式 iOS 發佈前補 192px／512px PNG 與 Apple touch icon。
