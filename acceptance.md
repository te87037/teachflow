# TeachFlow 驗收追溯

日期：2026-11-10

| 驗收 | 對應需求 | 測試 | 結果 |
|---|---|---|---|
| AC-001 同班同日兩節分開記錄 | FR-002、FR-003 | `engine.test.js` 唯一授課 ID | 已實測通過 |
| AC-002 單次停課不改常規課表 | FR-006、FR-007 | `engine.test.js` 單次停課 | 已實測通過 |
| AC-003 課表改版不改歷史 | FR-006 | `engine.test.js` 版本邊界 | 已實測通過 |
| AC-004 週六補週一課表 | FR-007 | `engine.test.js` 補課映射 | 已實測通過 |
| AC-005 年級事件隔離 | FR-008 | `engine.test.js` 年級範圍 | 已實測通過 |
| AC-006 部分節次與重疊事件 | FR-008 | `engine.test.js` 節次範圍 | 已實測通過 |
| AC-007 配速與零堂警示 | FR-009 | `engine.test.js` 配速公式 | 已實測通過 |
| AC-008 歷史修正不依編輯時間 | FR-004 | `engine.test.js` 進度排序 | 已實測通過 |
| AC-009 離線重開保留 | FR-011 | 瀏覽器 IndexedDB／Service Worker | 尚未驗證（待部署後瀏覽器測試） |
| AC-010 匯入失敗可恢復 | FR-010 | 前端 MIME／15 MB 驗證 | 部分通過；真實辨識尚未驗證 |
| AC-011 CSV BOM 與公式注入 | FR-014 | 程式碼檢查；下載檔人工核對 | 尚未驗證 |
| AC-012 單一教師後端授權 | FR-015 | 無效存取碼、錯誤 Sheet ID 與雙裝置整合測試 | 程式驗證完成；待正式瀏覽器實測 |
| AC-013 Google Sheet 遠端保存 | FR-011～FR-013 | Apps Script 驗證、追加、重送去重與雙裝置拉取 | Web App 已部署且端點檢查通過；待正式瀏覽器寫入實測 |

## 部署驗證

- GitHub：`main` 已推送；首版實作 commit 為 `06d1bf91784e990fa7a96e5762d3e99568c04510`。
- GitHub Pages：workflow 已成功執行，公開網址已由瀏覽器驗證。
- 正式網址：<https://te87037.github.io/teachflow/>。
- Google Sheet：Apps Script Web App 第 2 版、Script Properties 與 GitHub Pages 橋接設定均已完成；仍需做真實寫入、重送去重與雙裝置驗證。

「測試已撰寫」不等同通過；表格只在實際執行成功後標為已實測通過。
