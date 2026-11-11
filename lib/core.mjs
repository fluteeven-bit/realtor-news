// 共用小工具：抓網頁、解析 RSS／PTT／xlsx、標題正規化、Google 連結還原。
// 沒有任何外部套件，GitHub Actions 上 node 直接跑。
import zlib from "node:zlib";

export const UA = "Mozilla/5.0 (compatible; realtor-news/1.0)";
export const TIMEOUT_MS = 15000;

const ENT = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
export function decodeEntities(s) {
  return String(s ?? "")
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&([a-z]+);/gi, (m, n) => (n.toLowerCase() in ENT ? ENT[n.toLowerCase()] : m));
}
export const stripTags = (h) => decodeEntities(String(h ?? "").replace(/<!\[CDATA\[|\]\]>/g, "").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();

/** 標題正規化：同一則新聞被兩家轉載時，用這個判斷是不是同一則 */
export function titleKey(t) {
  return String(t).toLowerCase().replace(/[\s\p{P}\p{S}]/gu, "").slice(0, 40);
}

/** 短 id（FNV-1a 32 位元），存檔與前端都用它 */
export function hashId(s) {
  let h = 0x811c9dc5;
  for (const ch of String(s)) { h ^= ch.codePointAt(0); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(36);
}

export async function getText(url, { timeout = TIMEOUT_MS, headers = {} } = {}) {
  const r = await fetch(url, {
    headers: { "user-agent": UA, "accept-language": "zh-TW,zh;q=0.9", ...headers },
    signal: AbortSignal.timeout(timeout),
    redirect: "follow",
  });
  const body = await r.text();
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return body;
}
export async function getBuffer(url) {
  const r = await fetch(url, { headers: { "user-agent": UA }, signal: AbortSignal.timeout(TIMEOUT_MS), redirect: "follow" });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return Buffer.from(await r.arrayBuffer());
}

export function errText(e) {
  const m = String(e?.message || e);
  if (/abort|timeout/i.test(m)) return `超過 ${TIMEOUT_MS / 1000} 秒沒有回應`;
  if (/fetch failed/i.test(m)) return "連不上（" + (e?.cause?.code || "網路錯誤") + "）";
  return m.slice(0, 120);
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 同時最多跑 n 個 */
export async function pool(list, n, fn) {
  const out = new Array(list.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, list.length) }, async () => {
    while (i < list.length) { const k = i++; out[k] = await fn(list[k], k); }
  }));
  return out;
}

/* ── RSS（Google 新聞與政府網站共用）──────────────────── */

/**
 * 回 null ＝「這不是 RSS」（被擋、驗證頁、改版）；回 [] ＝「是 RSS，只是沒有項目」。兩者不可以混。
 */
export function parseRss(xml) {
  if (typeof xml !== "string" || !/<rss[\s>]/i.test(xml) || !/<channel[\s>]/i.test(xml)) return null;
  const out = [];
  for (const m of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const b = m[1];
    const pick = (tag) => { const x = b.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`)); return x ? x[1] : ""; };
    const t = stripTags(pick("title"));
    const u = decodeEntities(pick("link")).replace(/<!\[CDATA\[|\]\]>/g, "").trim();
    const src = stripTags(pick("source"));
    const at = Date.parse(decodeEntities(pick("pubDate")).trim());
    if (!t || !/^https?:\/\//.test(u)) continue;
    out.push({ t, u, src, at: Number.isFinite(at) ? at : null, desc: pick("description") });
  }
  return out;
}

export function googleUrl(q) {
  return "https://news.google.com/rss/search?q=" + encodeURIComponent(q) + "&hl=zh-TW&gl=TW&ceid=TW:zh-Hant";
}

export async function googleQuery(q) {
  const items = parseRss(await getText(googleUrl(q)));
  if (items === null) throw new Error("回應不是新聞清單（可能被擋或改版）");
  return items.map(({ t, u, src, at }) => {
    // Google 會在標題後面加「 - 來源」，來源另外有欄位，標題就把它拿掉
    if (src && t.endsWith(" - " + src)) t = t.slice(0, -(src.length + 3)).trim();
    return { t, u, src, at };
  });
}

/* ── Google 新聞連結 → 原始報導網址 ─────────────────────
   RSS 給的是 news.google.com 的轉址，有的長達上千字。做法跟瀏覽器點下去一樣：
   開文章頁拿簽章，再問 Google 原始網址。一則約 1.2 秒，所以每次只換新進來的幾十則。 */
export function googleArticleId(u) {
  const m = String(u || "").match(/^https:\/\/news\.google\.com\/rss\/articles\/([A-Za-z0-9_-]{20,3000})(?:\?|$)/);
  return m ? m[1] : null;
}
export async function resolveGoogle(u) {
  const id = googleArticleId(u);
  if (!id) return null;
  const html = await getText(`https://news.google.com/rss/articles/${id}`);
  const sg = (html.match(/data-n-a-sg="([^"]+)"/) || [])[1];
  const ts = (html.match(/data-n-a-ts="([^"]+)"/) || [])[1];
  if (!sg || !ts) throw new Error("文章頁沒有簽章（可能改版）");
  const inner = ["garturlreq", [["X", "X", ["X", "X"], null, null, 1, 1, "US:en", null, 1, null, null, null, null, null, 0, 1], "X", "X", 1, [1, 1, 1], 1, 1, null, 0, 0, null, 0], id, Number(ts), sg];
  const r = await fetch("https://news.google.com/_/DotsSplashUi/data/batchexecute", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded;charset=UTF-8", "user-agent": UA },
    body: "f.req=" + encodeURIComponent(JSON.stringify([[["Fbv4je", JSON.stringify(inner), null, "generic"]]])),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const txt = await r.text();
  let url = "";
  try {
    const outer = JSON.parse(txt.slice(txt.indexOf("[")));
    const row = outer.find((x) => Array.isArray(x) && x[1] === "Fbv4je");
    const res = JSON.parse(row[2]);
    if (res[0] === "garturlres") url = res[1];
  } catch { /* 格式不對就當沒拿到 */ }
  if (!/^https?:\/\//.test(url) || /^https?:\/\/[^/]*google\./.test(url)) throw new Error("沒有拿到原始網址");
  return url;
}

/* ── PTT 房屋板 ─────────────────────────────────────── */
export const PTT_BASE = "https://www.ptt.cc";
/** 回 null ＝「這不是看板列表」；置底文不算；已刪除的文章沒有連結所以會跳過 */
export function parsePttIndex(html) {
  if (typeof html !== "string" || !html.includes('class="r-ent"')) return null;
  const main = html.split('class="r-list-sep"')[0];
  const items = [];
  for (const m of main.matchAll(/<div class="r-ent">([\s\S]*?)<div class="mark">/g)) {
    const b = m[1];
    const a = b.match(/<a href="(\/bbs\/home-sale\/M\.(\d+)\.[^"]+)">([^<]*)<\/a>/);
    if (!a) continue;
    const nrec = (b.match(/<div class="nrec">(?:<span[^>]*>)?([^<]*)/) || [])[1] || "";
    items.push({ t: decodeEntities(a[3]).trim(), u: PTT_BASE + a[1], src: "PTT 房屋板", at: Number(a[2]) * 1000, push: nrec.trim() });
  }
  const prev = (html.match(/href="(\/bbs\/home-sale\/index\d+\.html)">&lsaquo; 上頁/) || [])[1] || null;
  return { items, prev };
}
export async function pttPages(pages) {
  let url = PTT_BASE + "/bbs/home-sale/index.html";
  const all = [];
  for (let i = 0; i < pages && url; i++) {
    const r = parsePttIndex(await getText(url));
    if (r === null) throw new Error("回應不是看板列表（可能被擋或改版）");
    all.push(...r.items);
    url = r.prev ? PTT_BASE + r.prev : null;
    if (pages > 2) await sleep(400);
  }
  return all;
}

/* ── 最小 xlsx 讀取（央行的統計表）──────────────────── */
export function unzip(buf) {
  const eocd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (eocd < 0) throw new Error("不是 zip／xlsx 檔");
  const n = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const files = {};
  for (let i = 0; i < n; i++) {
    const method = buf.readUInt16LE(p + 10);
    const csize = buf.readUInt32LE(p + 20);
    const nlen = buf.readUInt16LE(p + 28), elen = buf.readUInt16LE(p + 30), clen = buf.readUInt16LE(p + 32);
    const off = buf.readUInt32LE(p + 42);
    const name = buf.toString("utf8", p + 46, p + 46 + nlen);
    const lnlen = buf.readUInt16LE(off + 26), lelen = buf.readUInt16LE(off + 28);
    const data = buf.subarray(off + 30 + lnlen + lelen, off + 30 + lnlen + lelen + csize);
    files[name] = method === 8 ? zlib.inflateRawSync(data) : data;
    p += 46 + nlen + elen + clen;
  }
  return files;
}
/** 回第一張表：[{A:"...", B:"..."}, ...]（數字仍是字串） */
export function readXlsxRows(buf) {
  const f = unzip(buf);
  const ss = [...(f["xl/sharedStrings.xml"]?.toString("utf8") || "").matchAll(/<si>([\s\S]*?)<\/si>/g)]
    .map((m) => decodeEntities([...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((x) => x[1]).join("")));
  const sheet = (f["xl/worksheets/sheet1.xml"] || Buffer.from("")).toString("utf8");
  return [...sheet.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)].map((r) => {
    const row = {};
    for (const c of r[1].matchAll(/<c r="([A-Z]+)\d+"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const v = (c[3] || "").match(/<v>([\s\S]*?)<\/v>/);
      const isStr = /t="s"/.test(c[2]);
      const inl = (c[3] || "").match(/<is>[\s\S]*?<t[^>]*>([\s\S]*?)<\/t>/);
      row[c[1]] = inl ? decodeEntities(inl[1]) : v ? (isStr ? ss[Number(v[1])] : v[1]) : "";
    }
    return row;
  });
}
