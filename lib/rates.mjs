// 利率看板：全部從中央銀行官方來源讀，不用任何人的二手數字。
//  ① 五大銀行新承做購屋貸款利率（每月）── 央行新聞稿附的 xlsx
//  ② 政策利率（重貼現率等）與選擇性信用管制 ── 每季理監事會決議新聞稿
import { getText, getBuffer, readXlsxRows, stripTags, decodeEntities } from "./core.mjs";

const rocToYear = (y) => Number(y) + 1911;

/** 「115年11月20日下午4時20分」→ "2026-11-20" */
export function parseRocDate(s) {
  const m = String(s || "").match(/(\d{2,3})年(\d{1,2})月(\d{1,2})日/);
  if (!m) return null;
  return `${rocToYear(m[1])}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
}

/**
 * 五大銀行新承做放款金額與利率統計表 → 每月購屋貸款利率與金額。
 * 表的上半是年度（91、92…），下半才是月份：第一個月份列長得像「115   1」，之後只寫「2」「3」…。
 */
export function parseFiveBank(rows) {
  const out = [];
  let year = null;
  for (const r of rows) {
    const a = String(r.A ?? "").trim();
    if (/較上月|^\*/.test(a)) { if (year) break; else continue; }
    let m = a.match(/^(\d{2,3})\s+(\d{1,2})$/);
    let month;
    if (m) { year = rocToYear(m[1]); month = Number(m[2]); }
    else if (year && /^\d{1,2}$/.test(a)) month = Number(a);
    else continue;
    const rate = Number(r.C), amount = Number(r.B);
    if (!(month >= 1 && month <= 12) || !Number.isFinite(rate) || rate <= 0 || rate > 20) continue;
    out.push({ ym: `${year}-${String(month).padStart(2, "0")}`, rate: Math.round(rate * 1000) / 1000, amount: Number.isFinite(amount) ? amount : null });
  }
  return out;
}

/** 理監事會決議新聞稿 → 政策利率與信用管制 */
export function parseDecision(descHtml) {
  const text = stripTags(descHtml);
  const res = { rediscount: null, secured: null, shortTerm: null, before: null, action: null, credit: null };
  // 「本行重貼現率、擔保放款融通利率及短期融通利率，分別維持年息2%、2.375%及4.25%。」
  // 調整時長這樣：「…分別由年息2%、2.375%及4.25%調升為2.125%、2.5%及4.375%」
  const s = text.match(/重貼現率、擔保放款融通利率及短期融通利率[^。]*。/);
  if (s) {
    const nums = [...s[0].matchAll(/(\d+(?:\.\d+)?)\s*%/g)].map((x) => Number(x[1]));
    if (nums.length >= 6) {
      res.before = { rediscount: nums[0], secured: nums[1], shortTerm: nums[2] };
      [res.rediscount, res.secured, res.shortTerm] = nums.slice(-3);
    } else if (nums.length >= 3) {
      [res.rediscount, res.secured, res.shortTerm] = nums.slice(0, 3);
    }
    if (/維持/.test(s[0]) && nums.length < 6) res.action = "維持不變";
    else if (res.before) {
      const d = Math.round((res.rediscount - res.before.rediscount) * 1e6) / 1e6; // 半碼是 0.0625，不可以捨到三位
      const ma = Math.round((Math.abs(d) / 0.125) * 100) / 100; // 1 碼＝0.125 個百分點
      const bp = Math.round(Math.abs(d) * 10000) / 100;        // 1 個基點＝0.01 個百分點
      res.action = d > 0 ? `升息 ${ma} 碼（${bp} 個基點）` : d < 0 ? `降息 ${ma} 碼（${bp} 個基點）` : "維持不變";
    }
  }
  // 信用管制：段落標題＋表格裡「修正前」與「修正後」不一樣的那幾列
  const head = text.match(/本行理事(?:會)?同意[^。\s]{0,20}選擇性信用管制[^。\s]{0,12}/);
  const changes = [];
  for (const tb of String(descHtml).match(/<table[\s\S]*?<\/table>/g) || []) {
    if (!/修正前/.test(tb) || !/修正後/.test(tb)) continue;
    for (const tr of tb.match(/<tr[\s\S]*?<\/tr>/g) || []) {
      const cells = [...tr.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/g)].map((c) => stripTags(c[1]).replace(/\s+/g, ""));
      if (cells.length < 3 || /修正前/.test(cells.join(""))) continue;
      const [item, before, after] = cells.slice(-3); // 前面可能多一格合併的「自然人」
      if (!after || /維持不變/.test(after) || after === before) continue;
      changes.push({ item, before, after });
    }
  }
  if (head || changes.length) res.credit = { headline: head ? head[0] : null, changes };
  return res;
}

/** 新聞稿裡「本新聞稿下一次發布時間為115年11月20日…」 */
export function nextRelease(descHtml) {
  const m = stripTags(descHtml).match(/下一次發布時間為\s*(\d{2,3}年\d{1,2}月\d{1,2}日)/);
  return m ? parseRocDate(m[1]) : null;
}

/** 從新聞稿頁面找附表 xlsx 的下載連結 */
async function findXlsx(pageUrl, re) {
  const html = await getText(pageUrl);
  for (const m of html.matchAll(/href="(https:\/\/www\.cbc\.gov\.tw\/tw\/dl-[^"]+)"[^>]*title="([^"]+)"/g)) {
    if (/\.xlsx?$/i.test(m[2]) && re.test(m[2])) return { url: m[1], name: decodeEntities(m[2]) };
  }
  return null;
}

/**
 * 依央行 RSS 項目更新利率看板。prev 是上一次存的 rates.json：
 * 來源沒變就不重抓；抓失敗就保留上一次的數字並記下原因（不可以用空的蓋掉）。
 */
export async function updateRates(cbcItems, prev = {}) {
  const out = { ...prev, errors: [] };
  // ① 五大銀行
  const five = cbcItems.filter((i) => /五大銀行新承做放款平均利率/.test(i.t)).sort((a, b) => b.at - a.at)[0];
  if (five && (!prev.mortgage || prev.mortgage.source !== five.u || !prev.mortgage.months?.length)) {
    try {
      const x = await findXlsx(five.u, /五大銀行/);
      if (!x) throw new Error("新聞稿頁面上找不到附表 xlsx");
      const months = parseFiveBank(readXlsxRows(await getBuffer(x.url)));
      if (months.length < 12) throw new Error(`附表只讀到 ${months.length} 個月，格式可能改了`);
      out.mortgage = {
        months: months.slice(-60),
        source: five.u, file: x.url, title: five.t,
        published: new Date(five.at).toISOString(),
        next: nextRelease(five.desc),
      };
    } catch (e) { out.errors.push("五大銀行房貸利率：" + (e.message || e)); }
  }
  // ② 理監事會
  const dec = cbcItems.filter((i) => /理監事聯席會議決議/.test(i.t)).sort((a, b) => b.at - a.at)[0];
  if (dec && (!prev.policy || prev.policy.source !== dec.u)) {
    const p = parseDecision(dec.desc);
    if (p.rediscount == null) out.errors.push("理監事會決議：新聞稿裡找不到重貼現率那一句，格式可能改了");
    else out.policy = { ...p, source: dec.u, date: new Date(dec.at).toISOString(), title: dec.t };
  }
  out.checkedAt = new Date().toISOString();
  return out;
}
