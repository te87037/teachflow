# TeachFlow 技術設計

## 1. 架構

目前可執行版本採無框架 PWA：`index.html + ES modules + IndexedDB + Service Worker + Google Identity Services + Google Sheets API`。核心計算放在純函式模組 `dist/engine.js`，UI、持久化與 Google 遠端介面分離。

目前架構：

1. PWA 客戶端：快記、課表、歷史、配速、匯入核對、離線佇列。
2. Apps Script Web App：以隱藏 iframe 與 postMessage 建立跨網域橋接，驗證 GitHub Pages origin、裝置保存的 TeachFlow 同步存取碼、固定試算表 ID 與請求大小。
3. Google Sheets：Apps Script 以擁有者身分將具 UUID 的 SyncOperation 追加到「TeachFlow資料」工作表；Script Properties 與後端存取碼形成授權邊界。
4. 可替換辨識介面：未來由伺服器保存 OCR 金鑰；前端不得包含供應商密鑰。

## 2. 資料模型

主要實體：User、Semester、Class、Subject、TeachingAssignment、Material、Period、ScheduleVersion、CalendarEvent、LessonException、LessonInstance、TeachingRecord、ExamTarget、ImportBatch、SyncOperation、SheetRowMapping。

穩定鍵原則：班級名稱不是主鍵；授課實例 ID 由日期、節次與授課關聯 ID 組成；紀錄以 UUID 為主鍵並對 `lesson_instance_id` 建唯一約束。刪除預設軟刪除並保留版本資訊。

## 3. 課堂計算順序

1. 在學期區間逐日展開，不先排除週末。
2. 若為補課日，取得被映射的星期或指定日期課表。
3. 依日期選擇最新且有效的 ScheduleVersion。
4. 產生基礎授課實例。
5. 套用適用年級、班級、節次的校曆影響。
6. 套用未撤銷的單次停課、加課或替換；停課上的加課必須是明確例外。
7. 依考試截止日、現在時間與完成狀態計算有效剩餘堂次。

## 4. 進度推導

目前進度取 `status=completed` 且授課日期／節次最大的紀錄。修正較早紀錄不會因 `updated_at` 較新而成為目前進度。跨教材、跨冊或非連續內容改用 progress unit，不能直接相減頁碼。

## 5. 匯入流程

檔案驗證 → 建立不可變 ImportBatch → PDF 文字擷取或逐頁影像化 → 辨識供應商介面 → JSON Schema 驗證 → 原文／來源頁對照 → 人工修正 → 顯示新增／修改／衝突／重複 → 交易式套用 → 可回滾批次。

目前部署只完成格式、大小驗證與待核對批次，不呼叫假 OCR，也不把檔案內容寫入正式課表。

## 6. 同步與衝突

IndexedDB 是離線工作集。每次本機寫入同時新增具 UUID 的 SyncOperation；Google Sheets 使用 `values.append` 與 `RAW` 輸入模式保存操作 ID、資料類型、資料 ID、動作、原始修改時間與 JSON。網路失敗會保留佇列，成功追加後才移除。本機拉取時依操作 ID 去重，再對每個實體採原始修改時間的 last-write-wins。這是雙向跨裝置同步，不是單向報表匯出。

## 7. 安全

- Google Sheets 只由 Apps Script 擁有者身分呼叫，使用者瀏覽器不取得 Google access token。
- Web App URL 與 spreadsheet ID 是公開部署設定；同步密鑰、服務帳戶私鑰與 OCR 金鑰不得進入前端、Git 或日誌。
- 上傳限制 MIME、真實檔頭、大小、頁數、加密與損壞狀態。
- CSV 公式注入防護；畫面輸出 HTML escaping；CSP 與安全標頭在 Worker 階段加入。
- 原始文件預設短期保存，正式政策與刪除入口在 OCR 上線前完成。
