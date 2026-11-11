// 離線測試：node test.mjs（不連網路）。真實資料走不到的路線（升息、降息、被擋、格式改版）用假資料測。
import assert from "node:assert/strict";
import { parseRss, parsePttIndex, titleKey, hashId } from "./lib/core.mjs";
import { parseFiveBank, parseDecision, parseRocDate, nextRelease } from "./lib/rates.mjs";
import { CATS, OFFICIAL } from "./lib/sources.mjs";

let n = 0;
const t = (name, fn) => { fn(); n++; };

t("不是 RSS 回 null，是 RSS 但沒有項目回 []（讀不到 ≠ 沒有）", () => {
  assert.equal(parseRss("<html>captcha</html>"), null);
  assert.equal(parseRss(""), null);
  assert.deepEqual(parseRss('<rss version="2.0"><channel><title>x</title></channel></rss>'), []);
});

t("RSS 解析：CDATA、實體、日期", () => {
  const x = parseRss(`<rss><channel><item><title><![CDATA[房地合一 &amp; 囤房稅]]></title><link>https://a.tw/1</link><pubDate>Tue, 10 Nov 2026 05:50:26 GMT</pubDate></item><item><title>沒有連結</title></item></channel></rss>`);
  assert.equal(x.length, 1);
  assert.equal(x[0].t, "房地合一 & 囤房稅");
  assert.equal(x[0].at, Date.parse("2026-11-10T05:50:26Z"));
});

t("PTT：被擋回 null、刪除文跳過、置底文不算", () => {
  assert.equal(parsePttIndex("<html>blocked</html>"), null);
  const html = `<div class="r-ent"><div class="nrec"><span class="hl f3">13</span></div><div class="title"><a href="/bbs/home-sale/M.1794320995.A.C26.html">[閒聊] 人口統計</a></div><div class="date">11/10</div><div class="mark"></div></div>
  <div class="r-ent"><div class="nrec"></div><div class="title">(本文已被刪除) [x]</div><div class="mark"></div></div>
  <div class="r-list-sep"></div><div class="r-ent"><div class="title"><a href="/bbs/home-sale/M.1.A.1.html">[公告] 置底</a></div><div class="mark"></div></div>
  <a href="/bbs/home-sale/index5003.html">&lsaquo; 上頁</a>`;
  const r = parsePttIndex(html);
  assert.equal(r.items.length, 1);
  assert.equal(r.items[0].push, "13");
  assert.equal(r.items[0].at, 1794320995000);
  assert.equal(r.prev, "/bbs/home-sale/index5003.html");
});

t("同一則被不同媒體轉載：標點空白不同仍是同一個 id", () => {
  assert.equal(hashId(titleKey("央行鬆綁！房市 2 件事")), hashId(titleKey("央行鬆綁 房市2件事")));
  assert.notEqual(hashId(titleKey("央行鬆綁房市")), hashId(titleKey("央行緊縮房市")));
});

t("五大銀行附表：年度列不算、第一個月份列帶年份、遇到「較上月」就停", () => {
  const rows = [
    { A: "民  國 年/月", B: "購屋貸款", C: "" },
    { A: "       91", B: "237458", C: "4.401" },
    { A: "     114", B: "700000", C: "2.3" },
    { A: "114   12", B: "63540", C: "2.298" },
    { A: "115   1", B: "56766", C: "2.327" },
    { A: "        2", B: "36764", C: "2.3220000000000001" },
    { A: "較上月增減", B: "12618", C: "-0.006" },
    { A: "3", B: "1", C: "9.9" },
  ];
  const m = parseFiveBank(rows);
  assert.deepEqual(m.map((x) => x.ym), ["2025-12", "2026-01", "2026-02"]);
  assert.equal(m[2].rate, 2.322);
  assert.equal(m[1].amount, 56766);
});

t("理監事會：維持不變", () => {
  const p = parseDecision("<p>本行重貼現率、擔保放款融通利率及短期融通利率，分別維持年息2%、2.375%及4.25%。</p>");
  assert.equal(p.rediscount, 2); assert.equal(p.secured, 2.375); assert.equal(p.shortTerm, 4.25);
  assert.equal(p.action, "維持不變");
});

t("理監事會：升息 1 碼（真實資料目前走不到，用假資料）", () => {
  const p = parseDecision("<p>本行重貼現率、擔保放款融通利率及短期融通利率，分別由年息2%、2.375%及4.25%調升為2.125%、2.5%及4.375%。</p>");
  assert.equal(p.rediscount, 2.125);
  assert.equal(p.before.rediscount, 2);
  assert.equal(p.action, "升息 1 碼（12.5 個基點）");
});

t("理監事會：降息半碼", () => {
  const p = parseDecision("<p>本行重貼現率、擔保放款融通利率及短期融通利率，分別由年息2%、2.375%及4.25%調降為1.9375%、2.3125%及4.1875%。</p>");
  assert.equal(p.rediscount, 1.9375);
  assert.equal(p.action, "降息 0.5 碼（6.25 個基點）");
});

t("理監事會：找不到那一句時重貼現率是 null（不可以變成 0）", () => {
  assert.equal(parseDecision("<p>格式改版了</p>").rediscount, null);
});

t("信用管制表：只留修正前後不同的列，合併儲存格的「自然人」不影響", () => {
  const html = `<p>本行理事同意調整選擇性信用管制措施</p><table><tr><td>貸款項目</td><td>修正前</td><td>修正後</td></tr>
    <tr><td>公司法人購置住宅貸款</td><td>3成</td><td>維持不變</td></tr>
    <tr><td rowspan="2">自然人</td><td>第2戶購屋貸款</td><td>6成，無寬限期</td><td>7成，無寬限期</td></tr>
    <tr><td>第3戶以上購屋貸款</td><td>3成</td><td>維持不變</td></tr></table>`;
  const p = parseDecision(html);
  assert.equal(p.credit.headline, "本行理事同意調整選擇性信用管制措施");
  assert.deepEqual(p.credit.changes, [{ item: "第2戶購屋貸款", before: "6成，無寬限期", after: "7成，無寬限期" }]);
});

t("民國日期與下次發布日", () => {
  assert.equal(parseRocDate("115年11月20日下午4時20分"), "2026-11-20");
  assert.equal(nextRelease("<p>本新聞稿下一次發布時間為115年11月20日下午4時20分</p>"), "2026-11-20");
  assert.equal(nextRelease("<p>沒寫</p>"), null);
});

t("來源設定：每個分類都有搜尋字或專屬來源、官方過濾式不會整個收", () => {
  for (const c of CATS) assert.ok(c.ptt || c.google?.length, c.id);
  for (const o of OFFICIAL) {
    assert.ok(!o.re.test("基隆關通關服務宣導團赴台北市進出口商業同業公會"), o.id + " 不該收海關新聞");
    assert.ok(o.cats("x").length >= 1);
  }
  assert.ok(OFFICIAL.find((o) => o.id === "mof").re.test("出售105年1月1日以後取得之房地，未獲利者仍應申報房地合一稅"));
});

console.log(`✓ ${n} 項全部通過`);
