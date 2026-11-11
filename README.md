# 📰 房市最新情報

全台房地產的利率、政策、稅務、行情、建案、在地（新北）、糾紛與 PTT 房屋板，每 2 小時自動掃一次並永久存檔。

網址：https://fluteeven-bit.github.io/realtor-news/

## 資料從哪裡來（全部免費、不用金鑰）

| 來源 | 內容 |
|---|---|
| 中央銀行 RSS ＋附表 | 理監事會決議（重貼現率、信用管制）、五大銀行新承做購屋貸款利率（每月） |
| 財政部、賦稅署 RSS | 房地合一、房屋稅、地價稅、土增稅、遺贈稅等官方說明 |
| 內政部 RSS | 新聞、草案預告、法規發布（只留跟不動產有關的） |
| Google 新聞 RSS | 各分類的搜尋字，見 `lib/sources.mjs` |
| PTT home-sale | 最新討論 |

## 檔案

- `scan.mjs`：掃描並累積。`node scan.mjs` 一般掃描；`node scan.mjs --backfill 12` 往回補 12 個月。
- `lib/sources.mjs`：分類與搜尋字（要加減來源只改這裡）。
- `config/keywords.json`：固定追蹤字（每次掃描都多搜一輪）。
- `data/archive/YYYY-MM.json`：每月一份、一行一則，永久累積。
- `data/latest.json`：最近 10 天；`data/rates.json`：利率看板；`data/status.json`：這次各來源有沒有讀到。
- `test.mjs`：離線測試（排程每次掃描前先跑）。
- `.github/workflows/scan.yml`：排程（每 2 小時）。

## 規矩

- 「這次讀不到」和「真的沒有」分開記，讀不到不可以把舊資料洗掉。
- 只存標題、來源、時間與連結，不轉載內文。
