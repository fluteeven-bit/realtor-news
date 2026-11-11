// 房市最新情報：掃描並累積成資料庫。
//
//   node scan.mjs                 一般掃描（GitHub Actions 每 2 小時跑一次）
//   node scan.mjs --backfill 12   往回補 12 個月的新聞（第一次建庫用）
//
// 產出（全部在 data/ 底下，GitHub Pages 直接當網站的資料）：
//   data/archive/YYYY-MM.json   每月一份，永久累積，一行一則（git 只存差異，容量很省）
//   data/latest.json            最近 10 天，網頁一打開先讀這份
//   data/index.json             有哪些月份、各幾則
//   data/rates.json             利率看板（央行官方）
//   data/status.json            這一次每個來源有沒有讀到
//
// 規矩：「這次讀不到」與「真的沒有」分開記；讀不到的來源不可以把舊資料洗掉。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CATS, OFFICIAL, CAT_ORDER } from "./lib/sources.mjs";
import { googleQuery, parseRss, getText, pttPages, resolveGoogle, googleArticleId, titleKey, hashId, errText, pool, sleep } from "./lib/core.mjs";
import { updateRates } from "./lib/rates.mjs";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.join(ROOT, "data");
const ARCH = path.join(DATA, "archive");
const LATEST_DAYS = 10;
const RESOLVE_MAX = 120;
const DAY = 864e5;

const args = process.argv.slice(2);
const backfillMonths = args.includes("--backfill") ? Number(args[args.indexOf("--backfill") + 1] || 12) : 0;
const now = Date.now();
const t0 = now;

const tpMonth = (ms) => new Date(ms + 8 * 3600e3).toISOString().slice(0, 7); // 台北的月份
const readJSON = (p, d) => { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return d; } };
function writeArr(p, arr) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, "[\n" + arr.map((x) => JSON.stringify(x)).join(",\n") + "\n]\n");
}
const writeObj = (p, o) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, JSON.stringify(o, null, 1) + "\n"); };

/* ── 1. 收集 ─────────────────────────────────────────── */

/** 每個來源一筆狀態：讀到幾則、哪幾組沒讀到 */
const status = { scannedAt: new Date(now).toISOString(), mode: backfillMonths ? `backfill ${backfillMonths}` : "scan", cats: {}, official: {}, ms: 0 };
const found = []; // { key, item }

function addFound(raw, cat, extra = {}) {
  if (!raw.t || !raw.u || !raw.at) return;
  const at = Math.min(raw.at, now + DAY); // 政府網站偶爾給未來日期
  const byUrl = extra.off || cat === "ptt";
  const key = byUrl ? "u:" + raw.u : "t:" + titleKey(raw.t);
  found.push({ key, item: { t: raw.t, u: raw.u, src: raw.src || "", at, cats: [cat], ...extra, ...(raw.push ? { push: raw.push } : {}) } });
}

/** 一般掃描：when:7d；往回補：換成 after/before 一個月一個月 */
function windows() {
  if (!backfillMonths) return [null];
  const out = [];
  const d = new Date(now);
  for (let i = 0; i < backfillMonths; i++) {
    const a = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - i, 1));
    const b = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - i + 1, 1));
    out.push(`after:${a.toISOString().slice(0, 10)} before:${b.toISOString().slice(0, 10)}`);
  }
  return out;
}
const withWindow = (q, w) => (w ? q.replace(/\s*when:\d+d\s*$/, "") + " " + w : q);

const keywords = readJSON(path.join(ROOT, "config", "keywords.json"), []).filter((k) => typeof k === "string" && k.trim());

const jobs = [];
for (const w of windows()) {
  for (const c of CATS) for (const q of c.google || []) jobs.push({ cat: c.id, q: withWindow(q, w) });
  for (const k of keywords) jobs.push({ cat: "kw", q: withWindow(`${k} when:14d`, w), kw: k });
}
for (const c of [...CATS.map((c) => c.id), "kw"]) status.cats[c] = { queries: 0, failed: 0, items: 0, why: [] };

await pool(jobs, 3, async (j) => {
  const st = status.cats[j.cat];
  st.queries++;
  try {
    const items = await googleQuery(j.q);
    st.items += items.length;
    for (const it of items) addFound(it, j.cat, j.kw ? { kw: j.kw } : {});
  } catch (e) {
    st.failed++;
    if (st.why.length < 3) st.why.push(errText(e));
  }
  if (backfillMonths) await sleep(250);
});

// PTT：平常抓最新 2 頁（約 40 篇），往回補時多抓。
// ⚠ PTT 會擋雲端機房（2026-11-11 第一次排程實測 GitHub Actions 回 HTTP 403），
//   這是對方的封鎖，不繞過 —— 排程上直接不抓，畫面上講清楚；本機手動跑時照抓。
{
  const st = status.cats.ptt;
  st.queries = 1;
  if (process.env.GITHUB_ACTIONS) {
    st.skipped = "PTT 會擋雲端機房（HTTP 403），排程不抓；已存的照常可看";
  } else try {
    const items = await pttPages(backfillMonths ? 60 : 2);
    st.items = items.length;
    for (const it of items) addFound(it, "ptt");
  } catch (e) { st.failed = 1; st.why.push(errText(e)); }
}

// 政府官方 RSS
let cbcItems = null;
await pool(OFFICIAL, 3, async (o) => {
  const st = (status.official[o.id] = { src: o.src, ok: false, items: 0, matched: 0, why: null });
  try {
    const items = parseRss(await getText(o.url, { timeout: 30000 }));
    if (items === null) throw new Error("回應不是 RSS（可能被擋或改版）");
    st.ok = true;
    st.items = items.length;
    if (o.id === "cbc") cbcItems = items;
    for (const it of items) {
      if (!o.re.test(it.t)) continue;
      st.matched++;
      const cats = o.cats(it.t);
      addFound({ ...it, src: o.src }, cats[0], { off: 1 });
      if (cats.length > 1) found.at(-1).item.cats = cats;
    }
  } catch (e) { st.why = errText(e); }
});

/* ── 2. 併進資料庫 ───────────────────────────────────── */

const shards = new Map(); // "YYYY-MM" → Map(id → item)
const dirty = new Set();
function shard(m) {
  if (!shards.has(m)) {
    const arr = readJSON(path.join(ARCH, m + ".json"), []);
    shards.set(m, new Map(arr.map((x) => [x.id, x])));
  }
  return shards.get(m);
}

// 同一批裡同一則被幾家報導（不同來源才算）
const batch = new Map();
for (const f of found) {
  const id = hashId(f.key);
  const b = batch.get(id);
  if (!b) batch.set(id, { ...f.item, id, _srcs: new Set([f.item.src]) });
  else {
    for (const c of f.item.cats) if (!b.cats.includes(c)) b.cats.push(c);
    if (f.item.kw && !b.kw) b.kw = f.item.kw;
    if (f.item.at < b.at && !b.off) { b.at = f.item.at; b.u = f.item.u; b.src = f.item.src; } // 留最早那一家（原始報導）
    b._srcs.add(f.item.src);
  }
}

let added = 0, merged = 0;
for (const b of batch.values()) {
  const { _srcs, ...item } = b;
  const dup = _srcs.size - 1;
  if (dup > 0) item.dup = dup;
  item.cats.sort((x, y) => CAT_ORDER.indexOf(x) - CAT_ORDER.indexOf(y));
  // 同一則可能已經在上個月或這個月的檔裡
  const m = tpMonth(item.at);
  const prevM = tpMonth(item.at - 20 * DAY);
  const host = shard(m).has(item.id) ? m : shard(prevM).has(item.id) ? prevM : null;
  if (host) {
    const old = shard(host).get(item.id);
    let changed = false;
    for (const c of item.cats) if (!old.cats.includes(c)) { old.cats.push(c); changed = true; }
    if (changed) old.cats.sort((x, y) => CAT_ORDER.indexOf(x) - CAT_ORDER.indexOf(y));
    if ((item.dup || 0) > (old.dup || 0)) { old.dup = item.dup; changed = true; }
    if (item.kw && !old.kw) { old.kw = item.kw; changed = true; }
    if (item.push && item.push !== old.push) { old.push = item.push; changed = true; }
    if (changed) { dirty.add(host); merged++; }
  } else {
    shard(m).set(item.id, item);
    dirty.add(m);
    added++;
  }
}

/* ── 3. 新進來的 Google 連結換成原始網址（往回補時不做，太慢）── */
let resolved = 0, resolveFailed = 0;
if (!backfillMonths) {
  const recent = [tpMonth(now), tpMonth(now - 20 * DAY)];
  const todo = [];
  for (const m of new Set(recent)) for (const it of shard(m).values()) {
    if (googleArticleId(it.u) && it.at >= now - 3 * DAY && (it.rf || 0) < 2) todo.push([m, it]);
  }
  todo.sort((a, b) => b[1].at - a[1].at);
  await pool(todo.slice(0, RESOLVE_MAX), 3, async ([m, it]) => {
    try {
      const url = await resolveGoogle(it.u);
      if (url) { it.u = url; delete it.rf; resolved++; }
    } catch { it.rf = (it.rf || 0) + 1; resolveFailed++; }
    dirty.add(m);
  });
}

/* ── 4. 利率看板（央行官方）──────────────────────────── */
const ratesPath = path.join(DATA, "rates.json");
const prevRates = readJSON(ratesPath, {});
let rates = prevRates;
if (cbcItems) {
  rates = await updateRates(cbcItems, prevRates);
} else {
  rates = { ...prevRates, errors: ["中央銀行 RSS 這次讀不到，利率看板沿用上一次的數字"], checkedAt: new Date().toISOString() };
}
writeObj(ratesPath, rates);

/* ── 5. 寫檔 ─────────────────────────────────────────── */
for (const m of dirty) {
  const arr = [...shards.get(m).values()].sort((a, b) => b.at - a.at);
  writeArr(path.join(ARCH, m + ".json"), arr);
}

// index：所有月份
const months = fs.existsSync(ARCH) ? fs.readdirSync(ARCH).filter((f) => /^\d{4}-\d{2}\.json$/.test(f)).map((f) => f.slice(0, 7)).sort().reverse() : [];
const index = { updatedAt: new Date().toISOString(), months: months.map((m) => ({ m, n: (shards.get(m)?.size) ?? readJSON(path.join(ARCH, m + ".json"), []).length })) };
index.total = index.months.reduce((s, x) => s + x.n, 0);
index.since = months.at(-1) || null;
writeObj(path.join(DATA, "index.json"), index);

// latest：最近 10 天
const latestItems = [];
for (const m of new Set([tpMonth(now), tpMonth(now - LATEST_DAYS * DAY)])) {
  for (const it of shard(m).values()) if (it.at >= now - LATEST_DAYS * DAY) latestItems.push(it);
}
latestItems.sort((a, b) => b.at - a.at);
writeObj(path.join(DATA, "latest.json"), {
  scannedAt: status.scannedAt, days: LATEST_DAYS, keywords,
  cats: CATS.map(({ id, label, icon }) => ({ id, label, icon })),
  items: latestItems.map(({ rf, ...x }) => x),
});

status.ms = Date.now() - t0;
status.added = added; status.merged = merged; status.resolved = resolved; status.resolveFailed = resolveFailed;
status.total = index.total;
writeObj(path.join(DATA, "status.json"), status);

console.log(`掃描完成 ${(status.ms / 1000).toFixed(1)} 秒：新增 ${added}、更新 ${merged}、換短網址 ${resolved}（失敗 ${resolveFailed}），資料庫共 ${index.total} 則，${months.length} 個月`);
for (const [c, s] of Object.entries(status.cats)) console.log(`  ${c.padEnd(8)} 搜尋 ${s.queries} 組、讀到 ${s.items} 則${s.failed ? `、⚠ ${s.failed} 組讀不到：${s.why.join("；")}` : ""}`);
for (const [id, s] of Object.entries(status.official)) console.log(`  ${id.padEnd(9)} ${s.ok ? `✓ ${s.items} 則、相關 ${s.matched}` : "⚠ 讀不到：" + s.why}`);
if (rates.errors?.length) console.log("  利率看板 ⚠ " + rates.errors.join("；"));
else console.log(`  利率看板 ✓ 房貸 ${rates.mortgage?.months?.at(-1)?.ym} ${rates.mortgage?.months?.at(-1)?.rate}%、重貼現率 ${rates.policy?.rediscount}%（${rates.policy?.action}）`);
