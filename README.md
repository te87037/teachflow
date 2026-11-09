# TeachFlow 教學進度管家

TeachFlow 是為台灣國高中教師設計的手機優先 PWA。現在的可執行版本聚焦今日課堂快記、歷史查詢、段考配速、離線保存與安全 CSV 匯出；雲端登入、真實 OCR、跨裝置同步與 Google Sheets 仍明確列為待整合。

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

目前靜態版本不需環境變數。正式伺服器整合預計使用：

- `OCR_PROVIDER_API_KEY`：僅限 Worker，絕不可出現在前端。
- `GOOGLE_OAUTH_CLIENT_ID`／`GOOGLE_OAUTH_CLIENT_SECRET`：Google Sheets 授權。
- 後端資料庫與檔案儲存尚未選定；GitHub Pages 本身只提供靜態網站託管。

## 教師快速入門

1. 第一次開啟會載入明確標記的示範班級與課表。
2. 在「今日」選日期並按「記錄這堂」。輸入章節、已完成頁碼、狀態與備忘後儲存。
3. 在「配速」核對段考前有效堂數與每堂建議頁數，可展開日期明細。
4. 在「紀錄」搜尋及核對歷史，右上角可匯出 UTF-8 BOM CSV。
5. 在「設定」可查看週課表；上傳文件只建立待核對批次，不會直接套用。

## 維護與資料

- IndexedDB 名稱為 `teachflow`；資料庫版本目前為 1。
- Service Worker cache 名稱為 `teachflow-v1`。更新靜態資源時應同步增加 cache 版本。
- 資料模型變更必須先新增遷移，不得刪除 `syncQueue` 中尚未同步的操作。
- 核心計算規則修改時，同步更新 spec.md、design.md、tests 與 acceptance.md。

## 已知限制

- 尚未建立伺服器帳號、雲端資料庫與真正的帳號隔離；私人 Sites 存取不等同多使用者產品登入。
- 匯入只完成前端檔案驗證與批次建立，沒有呼叫模擬或真實 OCR。
- 課表目前只讀；尚未提供版本編輯、原子對調與撤銷 UI。
- 同步佇列已建立，但尚未有遠端端點，因此狀態會保持 pending。
- PWA 圖示目前為 SVG；正式 iOS 發佈前補 192px／512px PNG 與 Apple touch icon。
