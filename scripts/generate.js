import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "index.html");
const ARCHIVE_PATH = join(ROOT, "archive.json");
const MAX_DAYS = 60;
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

const YOKOHAMA = { lat: 35.4437, lon: 139.6380 };
const WEEKDAYS = "日月火水木金土";

const HEAVY = /死亡|死去|遺体|殺人|自殺|殺害|殺傷|射殺|刺傷|虐待|性的|暴行|爆発|テロ|戦争|空爆|ミサイル|地震|津波|火災|焼死|事故死|重体|行方不明|逮捕|起訴|裁判|実刑|判決|洪水|ひき逃げ|懸賞金/;
const AWKWARD = /政党|選挙|国会|交付金|領土|不信任|首相|解散|入閣|内閣|維新|安倍|正恩|給付/;
const WEATHER_DUP = /天気|予報|気象|雨雲/;

const FEEDS = {
  kanagawa: "https://news.google.com/rss/search?q=%E7%A5%9E%E5%A5%88%E5%B7%9D&hl=ja&gl=JP&ceid=JP:ja",
  domestic: "https://news.yahoo.co.jp/rss/topics/domestic.xml",
  domesticExtra: "https://news.google.com/rss?hl=ja&gl=JP&ceid=JP:ja",
  world: "https://news.yahoo.co.jp/rss/topics/world.xml",
  worldExtra: "https://news.google.com/rss/search?q=%E6%B5%B7%E5%A4%96%20OR%20%E5%9B%BD%E9%9A%9B%20-戦争%20-ミサイル&hl=ja&gl=JP&ceid=JP:ja",
  health: "https://news.google.com/rss/search?q=%E7%BE%8E%E5%AE%B9%20OR%20%E7%9D%A1%E7%9C%A0%20OR%20%E3%82%B9%E3%82%AD%E3%83%B3%E3%82%B1%E3%82%A2%20OR%20%E6%A0%84%E9%A4%8A%20-死亡%20-事故&hl=ja&gl=JP&ceid=JP:ja",
  life: "https://news.yahoo.co.jp/rss/categories/life.xml",
};

const WEATHER_JA = {
  0: "快晴",
  1: "晴れ",
  2: "晴れ時々くもり",
  3: "くもり",
  45: "霧",
  48: "霧",
  51: "霧雨",
  61: "雨",
  63: "雨",
  65: "強い雨",
  71: "雪",
  80: "にわか雨",
  81: "にわか雨",
  95: "雷雨",
};

function weatherLabel(code) {
  if (WEATHER_JA[code]) return WEATHER_JA[code];
  if (code >= 51 && code < 68) return "雨";
  if (code >= 71 && code < 87) return "雪";
  if (code >= 80 && code < 83) return "にわか雨";
  if (code >= 95) return "雷雨";
  return "くもり";
}

function strip(html) {
  return String(html || "")
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tag(block, name) {
  const m = block.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, "i"));
  return m ? strip(m[1]) : "";
}

function parseRss(xml) {
  return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/gi)].map((m) => {
    const b = m[1];
    const title = tag(b, "title");
    const link = tag(b, "link") || strip((b.match(/<link[^>]*href="([^"]+)"/i) || [])[1] || "");
    const desc = tag(b, "description") || tag(b, "content:encoded");
    return { title, link, desc };
  }).filter((x) => x.title && x.link);
}

function isHeavy(item) {
  return HEAVY.test(`${item.title} ${item.desc}`);
}

function cleanTitle(title) {
  return title
    .replace(/\s*[-|｜].*$/, "")
    .replace(/（[^）]*）\s*$/, "")
    .replace(/\([^)]*\)\s*$/, "")
    .replace(/^【[^】]*】/g, "")
    .replace(/＃\S+/g, "")
    .replace(/\s+/g, " ")
    .trim() || title;
}

function shortenTitle(title, max = 22) {
  const t = cleanTitle(title);
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  const p = Math.max(cut.lastIndexOf("、"), cut.lastIndexOf(" "), cut.lastIndexOf("。"), cut.lastIndexOf("！"));
  return `${(p >= 8 ? cut.slice(0, p) : cut).trim()}…`;
}

function stripKanagawaFromTitle(title) {
  return title
    .replace(/神奈川県警/g, "県警")
    .replace(/神奈川県/g, "")
    .replace(/神奈川/g, "")
    .replace(/^[、。・\s]+/, "")
    .replace(/\s+/g, " ")
    .trim();
}

function displayTitle(title, dropKanagawa = false) {
  const base = dropKanagawa ? stripKanagawaFromTitle(title) : title;
  return shortenTitle(base || title);
}

function titlePhrases(title) {
  return [...new Set(
    title
      .replace(/[【】\[\]「」『』（）()]/g, " ")
      .split(/[\s、。！？!?,，・\/／：:]+/)
      .map((p) => p.trim())
      .filter((p) => p.length >= 3)
  )].sort((a, b) => b.length - a.length);
}

function overlapRatio(text, title) {
  const phrases = titlePhrases(title).filter((p) => p.length >= 3);
  if (!phrases.length) return 0;
  const hit = phrases.filter((p) => text.includes(p)).length;
  return hit / phrases.length;
}

function stripTitlePhrases(text, title) {
  let s = ` ${strip(text)} `;
  for (const p of titlePhrases(title)) {
    if (p.length < 3) continue;
    s = s.split(p).join(" ");
  }
  return s.replace(/\s+/g, " ").replace(/^[、。・\s]+/, "").trim();
}

function clipLine(s) {
  s = s.replace(/\s+/g, " ").trim();
  if (s.length > 72) {
    const cut = s.slice(0, 69);
    const lastPunct = Math.max(cut.lastIndexOf("、"), cut.lastIndexOf(" "));
    s = `${cut.slice(0, lastPunct > 24 ? lastPunct : 69)}…`;
  }
  if (s.length < 12) return "";
  return /[。！？…]$/.test(s) ? s : `${s}。`;
}

function sentencesOf(text) {
  return strip(text)
    .split(/(?<=[。！？])/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function compact(s) {
  return String(s)
    .replace(/[【】\[\]「」『』（）()\s、。！？!?,，・\/／：:＃#]/g, "")
    .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xFEE0));
}

function trigrams(s) {
  const c = compact(s);
  const t = new Set();
  for (let i = 0; i <= c.length - 3; i += 1) t.add(c.slice(i, i + 3));
  return t;
}

function jaccard(a, b) {
  const A = trigrams(a);
  const B = trigrams(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const x of A) if (B.has(x)) inter += 1;
  return inter / Math.min(A.size, B.size);
}

function tooSimilar(a, b) {
  const na = compact(a);
  const nb = compact(b);
  if (na.length < 8 || nb.length < 8) return false;
  const shorter = na.length <= nb.length ? na : nb;
  const longer = na.length <= nb.length ? nb : na;
  if (longer.includes(shorter)) return true;
  let i = 0;
  while (i < shorter.length && shorter[i] === longer[i]) i += 1;
  if (i >= Math.min(16, Math.floor(shorter.length * 0.55))) return true;
  if (overlapRatio(a, b) >= 0.45) return true;
  return jaccard(a, b) >= 0.32;
}

function isBroken(s) {
  return /^[）」』、】のうち]/.test(s) || /「\s*」/.test(s);
}

function distinctFacts(text, title) {
  const blob = strip(text);
  const bits = [];
  for (const m of blob.matchAll(/[^。]{0,12}(?:\d{1,4}[%％倍人日年円ドル]|[0-9０-９]{1,2}日|[0-9０-９]{4}年)[^。]{0,24}/g)) {
    const chunk = m[0].replace(/\s+/g, " ").trim();
    if (chunk.length >= 12 && !tooSimilar(chunk, title) && !isBroken(chunk) && !/プレスリリース|記事一覧|ロイター|ワシントン|^[A-Za-z]/.test(chunk)) bits.push(chunk);
  }
  return bits[0] ? clipLine(bits[0]) : "";
}

function makeDetail(texts, title) {
  const junk = /報道サイト|ハブとなり|プレスリリース|cookie|ログイン|コメント\s*\d+|記事全文|ALL RIGHTS|写真番号|©|copyright|PR TIMES|高校野球情報を公開|ロイター|記事一覧|ドットコム|ワシントン|ogage/i;
  const sents = texts
    .filter(Boolean)
    .flatMap((t) => sentencesOf(t))
    .map((s) => s.replace(/\s+/g, " ").trim())
    .filter((s) => s.length >= 16 && !junk.test(s) && !isBroken(s) && !tooSimilar(s, title));
  if (sents.length) {
    const scored = sents.map((sent, i) => ({ sent, i, jac: jaccard(sent, title) }));
    scored.sort((a, b) => a.jac - b.jac || a.i - b.i);
    return clipLine(scored[0].sent);
  }
  return distinctFacts(texts.filter(Boolean).join("。"), title);
}

function pickCandidates(items, extraSkip = () => false, limit = 8) {
  const seen = new Set();
  const out = [];
  for (const item of items) {
    const title = cleanTitle(item.title);
    if (title.length < 8 || title === "報道発表") continue;
    if (isHeavy(item) || extraSkip(item)) continue;
    const key = item.title.replace(/\s+/g, "").slice(0, 24);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      title,
      detail: "",
      link: item.link,
      desc: "",
    });
    if (out.length >= limit) break;
  }
  return out;
}

async function fetchText(url) {
  const res = await fetch(url, {
    headers: { "User-Agent": UA, Accept: "text/html,application/xhtml+xml" },
    redirect: "follow",
    signal: AbortSignal.timeout(12000),
  });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.text();
}

function metaDescription(html) {
  const og =
    html.match(/property=["']og:description["'][^>]*content=["']([^"']+)/i)?.[1] ||
    html.match(/content=["']([^"']+)["'][^>]*property=["']og:description["']/i)?.[1] ||
    "";
  const md =
    html.match(/name=["']description["'][^>]*content=["']([^"']+)/i)?.[1] ||
    html.match(/content=["']([^"']+)["'][^>]*name=["']description["']/i)?.[1] ||
    "";
  const raw = strip(og || md);
  if (!raw || /Google ニュース|Google News|Comprehensive up-to-date/.test(raw)) return "";
  return raw;
}

async function resolveGoogleUrl(googleUrl) {
  const articleId = googleUrl.split("/articles/")[1]?.split("?")[0];
  if (!articleId) return googleUrl;
  const html = await fetchText(`https://news.google.com/rss/articles/${articleId}?oc=5`);
  const signature = html.match(/data-n-a-sg="([^"]+)"/)?.[1];
  const timestamp = html.match(/data-n-a-ts="([^"]+)"/)?.[1];
  if (!signature || !timestamp) return googleUrl;
  const rpcInner = JSON.stringify([
    "garturlreq",
    [
      ["X", "X", ["X", "X"], null, null, 1, 1, "US:en", null, 1, null, null, null, null, null, 0, 1],
      "X",
      "X",
      1,
      [1, 1, 1],
      1,
      1,
      null,
      0,
      0,
      null,
      0,
    ],
    articleId,
    Number(timestamp),
    signature,
  ]);
  const fReq = JSON.stringify([[["Fbv4je", rpcInner, null, "generic"]]]);
  const res = await fetch("https://news.google.com/_/DotsSplashUi/data/batchexecute", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
      Referer: "https://news.google.com/",
      "User-Agent": UA,
    },
    body: new URLSearchParams({ "f.req": fReq }).toString(),
    signal: AbortSignal.timeout(12000),
  });
  let body = await res.text();
  if (body.startsWith(")]}'")) body = body.split("\n").slice(1).join("\n");
  const envelopes = JSON.parse(body.trim());
  for (const env of envelopes) {
    if (Array.isArray(env) && env[0] === "wrb.fr" && env[1] === "Fbv4je") {
      const payload = JSON.parse(env[2]);
      if (payload && payload[0] === "garturlres" && payload[1]) return payload[1];
    }
  }
  return googleUrl;
}

function sourceLabel(url) {
  let host = "";
  try {
    host = new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "出典";
  }
  const table = [
    ["news.yahoo.co.jp", "Yahoo"],
    ["yahoo.co.jp", "Yahoo"],
    ["news.google.com", "Google"],
    ["google.com", "Google"],
    ["jma.go.jp", "気象庁"],
    ["kanaloco.jp", "カナロコ"],
    ["hb-nippon.com", "高校野球"],
    ["prtimes.jp", "PR TIMES"],
    ["47news.jp", "47NEWS"],
    ["nhk.or.jp", "NHK"],
    ["asahi.com", "朝日"],
    ["mainichi.jp", "毎日"],
    ["yomiuri.co.jp", "読売"],
    ["nikkei.com", "日経"],
    ["tenki.jp", "tenki"],
    ["weathernews.jp", "WNI"],
    ["mi-mollet.com", "mi-mollet"],
    ["nippon-foundation.or.jp", "日本財団"],
    ["kyodo.co.jp", "共同"],
    ["jiji.com", "時事"],
    ["reuters.com", "ロイター"],
    ["bbc.", "BBC"],
    ["cnn.com", "CNN"],
  ];
  for (const [key, label] of table) {
    if (host.includes(key.replace(/^\./, "")) || host.endsWith(key) || host.includes(key)) return label;
  }
  const main = host.split(".")[0];
  if (!main) return "出典";
  return main.length <= 10 ? main : `${main.slice(0, 8)}…`;
}

function isHttpUrl(url) {
  try {
    const u = new URL(url);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

async function summarizeItem(item, dropKanagawa = false) {
  if (!isHttpUrl(item.link)) return { title: displayTitle(item.title, dropKanagawa), detail: "", link: "" };
  try {
    let url = item.link;
    if (url.includes("news.google.com")) {
      url = await resolveGoogleUrl(url);
      if (url.includes("news.google.com")) {
        return { title: displayTitle(item.title, dropKanagawa), detail: "", link: item.link };
      }
    }
    const html = await fetchText(url);
    const summary = makeDetail([metaDescription(html)], item.title);
    const detail = summary && !tooSimilar(summary, item.title) ? summary : "";
    return {
      title: displayTitle(item.title, dropKanagawa),
      link: url,
      detail,
    };
  } catch (err) {
    console.error("summary failed:", item.title, err.message);
    return {
      title: displayTitle(item.title, dropKanagawa),
      link: item.link,
      detail: "",
    };
  }
}

async function summarizeList(items, dropKanagawa = false) {
  const out = [];
  for (const item of items) {
    out.push(await summarizeItem(item, dropKanagawa));
    if (out.length >= 3) break;
  }
  return out.slice(0, 3);
}

async function fetchFeed(url) {
  try {
    return parseRss(await fetchText(url));
  } catch (err) {
    console.error("feed failed:", url, err.message);
    return [];
  }
}

async function pickThreeFromFeeds(urls, extraSkip = () => false) {
  const bags = [];
  for (const url of urls) bags.push(...(await fetchFeed(url)));
  return pickCandidates(bags, extraSkip, 8);
}

function tokyoNow() {
  return new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Tokyo" }));
}

function dateHeading(d = tokyoNow()) {
  const m = d.getMonth() + 1;
  const day = d.getDate();
  const w = WEEKDAYS[d.getDay()];
  return `${m}月${day}日（${w}曜日）`;
}

async function weatherItems() {
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${YOKOHAMA.lat}&longitude=${YOKOHAMA.lon}&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max&timezone=Asia%2FTokyo&forecast_days=7`;
  const data = JSON.parse(await fetchText(url));
  const daily = data.daily;
  const link = "https://www.jma.go.jp/bosai/forecast/#area_type=offices&area_code=140000";

  const row = (i) => {
    const code = daily.weather_code[i];
    const tmax = Math.round(daily.temperature_2m_max[i]);
    const tmin = Math.round(daily.temperature_2m_min[i]);
    const pop = daily.precipitation_probability_max[i];
    const label = weatherLabel(code);
    return { label, tmax, tmin, pop, date: daily.time[i] };
  };

  const today = row(0);
  const tomorrow = row(1);
  const tomorrowDow = new Date(`${daily.time[1]}T12:00:00`).getDay();
  const thirdIdx = daily.time.findIndex((t, i) => {
    if (i < 2) return false;
    const dow = new Date(`${t}T12:00:00`).getDay();
    if (tomorrowDow === 6) return dow === 0;
    return dow === 6;
  });
  const weekend = row(thirdIdx >= 0 ? thirdIdx : Math.min(2, daily.time.length - 1));
  const weekendDate = new Date(`${weekend.date}T12:00:00`);
  const weekendLabel = `${weekendDate.getMonth() + 1}/${weekendDate.getDate()}（${WEEKDAYS[weekendDate.getDay()]}）`;

  return [
    {
      title: `今日は${today.label}`,
      detail: `最高${today.tmax}℃／最低${today.tmin}℃、降水確率${today.pop}%。神奈川（横浜）の目安です。`,
      link,
    },
    {
      title: `明日は${tomorrow.label}`,
      detail: `最高${tomorrow.tmax}℃／最低${tomorrow.tmin}℃、降水確率${tomorrow.pop}%。`,
      link,
    },
    {
      title: `週末（${weekendLabel}）は${weekend.label}`,
      detail: `最高${weekend.tmax}℃／最低${weekend.tmin}℃、降水確率${weekend.pop}%。お出かけの話のきっかけに。`,
      link,
    },
  ];
}

function placeholder(kind) {
  return [{
    title: `${kind}の話題を取得できませんでした`,
    detail: "",
    link: "",
  }];
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const TONE_BORDER = {
  weather: "border-[#5aa6e8]",
  kanagawa: "border-[#2aa39a]",
  domestic: "border-[#e89b5a]",
  world: "border-[#b57ae8]",
  health: "border-[#6db56a]",
};

function card(section) {
  const items = section.items
    .map((it, i) => {
      const href = isHttpUrl(it.link) ? escapeHtml(it.link) : "";
      const label = href ? sourceLabel(it.link) : "";
      const source = href
        ? `<a class="inline-flex h-11 min-w-11 shrink-0 items-center justify-center whitespace-nowrap rounded-lg border border-sky-200 bg-sky-50 px-2 text-xs font-bold text-sky-800 focus:outline-none focus:ring-2 focus:ring-sky-400" href="${href}" target="_blank" rel="noopener" aria-label="${escapeHtml(label)}：${escapeHtml(it.title)}">${escapeHtml(label)}</a>`
        : "";
      const extra = it.detail
        ? `<p class="mt-1 text-[13px] font-normal leading-relaxed text-neutral-500">${escapeHtml(it.detail)}</p>`
        : "";
      return `
      <li class="flex items-start gap-2">
        <div class="min-w-0 flex-1">
          <p class="font-udb text-base font-bold leading-snug text-neutral-900">${i + 1}. ${escapeHtml(it.title)}</p>
          ${extra}
        </div>
        ${source}
      </li>`;
    })
    .join("");

  const border = TONE_BORDER[section.tone] || "border-neutral-300";
  return `
  <article class="rounded-[28px] border-[3px] ${border} bg-[#fffefb] px-[18px] pt-[18px] pb-3">
    <h2 class="mb-3 font-udb text-lg font-bold text-neutral-900">${escapeHtml(section.label)}</h2>
    <ol class="grid list-none gap-3">${items}</ol>
  </article>`;
}

function isoDate(d = tokyoNow()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

async function loadArchive() {
  try {
    const raw = JSON.parse(await readFile(ARCHIVE_PATH, "utf8"));
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}

function render(archive) {
  const payload = JSON.stringify(archive).replace(/</g, "\\u003c");
  const latest = archive[0];
  const heading = latest?.heading || dateHeading();
  const nav = archive
    .map((day, i) => {
      const on = i === 0 ? "bg-[#1b5e3b] text-white" : "bg-neutral-100 text-neutral-700";
      const mark = i === 0 ? "今日　" : "";
      return `<button type="button" data-day="${escapeHtml(day.id)}" class="day-btn shrink-0 rounded-full px-3 py-2 text-sm font-bold ${on}">${mark}${escapeHtml(day.heading)}</button>`;
    })
    .join("");
  const board = latest ? latest.sections.map(card).join("") : "<p class=\"text-center text-sm text-neutral-500\">まだ話題がありません。</p>";

  return `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="apple-mobile-web-app-capable" content="yes" />
  <meta name="mobile-web-app-capable" content="yes" />
  <title>お客さまとの今日の話題</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <script>
    tailwind.config = {
      theme: {
        extend: {
          fontFamily: {
            ud: ['"BIZ UDGothic"', '"Yu Gothic"', "sans-serif"],
            udb: ['"UD Digi Kyokasho NK-B"', '"UDデジタル教科書体NK-B"', '"BIZ UDGothic"', '"Yu Gothic"', "sans-serif"]
          }
        }
      }
    }
  </script>
</head>
<body class="bg-white px-3 pb-10 pt-4 font-ud text-neutral-900">
  <div class="mx-auto grid max-w-[560px] gap-4">
    <header class="text-center">
      <h1 class="font-udb text-lg font-bold text-neutral-900">お客さまとの今日の話題</h1>
      <p id="current-date" class="mt-1 text-sm text-neutral-500">${escapeHtml(heading)}</p>
    </header>
    <div class="sticky top-0 z-10 -mx-3 bg-white/95 px-3 py-2 backdrop-blur">
      <div id="day-nav" class="flex gap-2 overflow-x-auto pb-1">${nav}</div>
    </div>
    <div id="board" class="grid gap-4">${board}</div>
    <footer class="mt-2 text-center text-xs text-neutral-500">日付を選ぶと、その日の話題が見られます</footer>
  </div>
  <script>
    const ARCHIVE = ${payload};
    const TONE = {
      weather: "border-[#5aa6e8]",
      kanagawa: "border-[#2aa39a]",
      domestic: "border-[#e89b5a]",
      world: "border-[#b57ae8]",
      health: "border-[#6db56a]"
    };
    function esc(s) {
      return String(s || "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
    }
    function isHttp(url) {
      try { const u = new URL(url); return u.protocol === "http:" || u.protocol === "https:"; } catch { return false; }
    }
    function sourceLabel(url) {
      try {
        const host = new URL(url).hostname.replace(/^www\\./, "").toLowerCase();
        const table = [["yahoo","Yahoo"],["google","Google"],["jma.go.jp","気象庁"],["kanaloco","カナロコ"],["hb-nippon","高校野球"],["prtimes","PR TIMES"],["47news","47NEWS"],["nhk","NHK"],["asahi","朝日"],["mainichi","毎日"],["yomiuri","読売"],["nikkei","日経"],["mi-mollet","mi-mollet"],["nippon-foundation","日本財団"]];
        for (const [k,v] of table) if (host.includes(k)) return v;
        return host.split(".")[0] || "出典";
      } catch { return "出典"; }
    }
    function cardHtml(section) {
      const items = (section.items || []).map((it, i) => {
        const href = isHttp(it.link) ? esc(it.link) : "";
        const label = href ? sourceLabel(it.link) : "";
        const source = href ? '<a class="inline-flex h-11 min-w-11 shrink-0 items-center justify-center whitespace-nowrap rounded-lg border border-sky-200 bg-sky-50 px-2 text-xs font-bold text-sky-800" href="'+href+'" target="_blank" rel="noopener">'+esc(label)+'</a>' : "";
        const extra = it.detail ? '<p class="mt-1 text-[13px] font-normal leading-relaxed text-neutral-500">'+esc(it.detail)+'</p>' : "";
        return '<li class="flex items-start gap-2"><div class="min-w-0 flex-1"><p class="font-udb text-base font-bold leading-snug text-neutral-900">'+(i+1)+'. '+esc(it.title)+'</p>'+extra+'</div>'+source+'</li>';
      }).join("");
      const border = TONE[section.tone] || "border-neutral-300";
      return '<article class="rounded-[28px] border-[3px] '+border+' bg-[#fffefb] px-[18px] pt-[18px] pb-3"><h2 class="mb-3 font-udb text-lg font-bold text-neutral-900">'+esc(section.label)+'</h2><ol class="grid list-none gap-3">'+items+'</ol></article>';
    }
    function show(id) {
      const day = ARCHIVE.find((d) => d.id === id) || ARCHIVE[0];
      if (!day) return;
      document.getElementById("current-date").textContent = day.heading;
      document.getElementById("board").innerHTML = (day.sections || []).map(cardHtml).join("");
      document.querySelectorAll(".day-btn").forEach((btn) => {
        const on = btn.getAttribute("data-day") === day.id;
        btn.className = "day-btn shrink-0 rounded-full px-3 py-2 text-sm font-bold " + (on ? "bg-[#1b5e3b] text-white" : "bg-neutral-100 text-neutral-700");
      });
    }
    document.getElementById("day-nav").addEventListener("click", (e) => {
      const btn = e.target.closest(".day-btn");
      if (btn) show(btn.getAttribute("data-day"));
    });
  </script>
</body>
</html>
`;
}

const sectionsSpec = [
  { id: "weather", label: "天気", tone: "weather" },
  { id: "kanagawa", label: "神奈川", tone: "kanagawa" },
  { id: "domestic", label: "全般・国内", tone: "domestic" },
  { id: "world", label: "全般・海外", tone: "world" },
  { id: "health", label: "健康と美容", tone: "health" },
];

const heading = dateHeading();

let weather;
try {
  weather = await weatherItems();
} catch (err) {
  console.error("weather failed:", err.message);
  weather = placeholder("天気");
}

const [kanagawa, domestic, world, health] = await Promise.all([
  pickThreeFromFeeds([FEEDS.kanagawa], (it) => WEATHER_DUP.test(it.title)),
  pickThreeFromFeeds([FEEDS.domestic, FEEDS.domesticExtra], (it) => AWKWARD.test(it.title) || WEATHER_DUP.test(it.title) || /真夏日|雷雨/.test(it.title)),
  pickThreeFromFeeds([FEEDS.world, FEEDS.worldExtra], (it) => AWKWARD.test(it.title)),
  pickThreeFromFeeds([FEEDS.health, FEEDS.life], (it) => AWKWARD.test(it.title) || /セミナー|募集|施設公開/.test(it.title)),
]);

const byId = {
  weather,
  kanagawa: (await summarizeList(kanagawa, true)).slice(0, 3),
  domestic: (await summarizeList(domestic)).slice(0, 3),
  world: (await summarizeList(world)).slice(0, 3),
  health: (await summarizeList(health)).slice(0, 3),
};

const sections = sectionsSpec.map((s) => ({
  label: s.label,
  tone: s.tone,
  items: byId[s.id],
}));

const todayId = isoDate();
const todayEntry = { id: todayId, heading, sections };
const archive = (await loadArchive()).filter((d) => d.id !== todayId);
archive.unshift(todayEntry);
const kept = archive.slice(0, MAX_DAYS);
await writeFile(ARCHIVE_PATH, JSON.stringify(kept, null, 2), "utf8");
await writeFile(OUT, render(kept), "utf8");
console.log("wrote", OUT, "days", kept.length);
