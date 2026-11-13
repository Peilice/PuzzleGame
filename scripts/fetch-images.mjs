// 從 Wikimedia Commons 取得公有領域 / CC0 圖片作為內建圖庫。
// 用法：
//   node scripts/fetch-images.mjs candidates   # 列出並下載候選圖到 assets-raw/，產生預覽拼貼
//   node scripts/fetch-images.mjs build        # 依 scripts/picks.json 輸出 public/images、src/content/images.json、CREDITS.md
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RAW = path.join(ROOT, 'assets-raw');
const UA = 'PuzzleGameDev/0.1 (offline puzzle game asset collection)';
const API = 'https://commons.wikimedia.org/w/api.php';

const SOURCES = {
  landscape: ['Category:Featured pictures of landscapes', 'Category:Quality images of landscapes'],
  food: ['Category:Featured pictures of food', 'Category:Quality images of food'],
  // 「search:」開頭表示用 CirrusSearch；P275=Q6938433 為 CC0、P6216=Q19652 為公有領域（結構化資料）
  architecture: [
    'search:haswbstatement:P275=Q6938433 deepcat:"Featured pictures of architecture"',
    'search:haswbstatement:P275=Q6938433 deepcat:"Quality images of architecture"',
  ],
  art: ['search:haswbstatement:P6216=Q19652 deepcat:"Featured pictures of paintings"', 'Category:Featured pictures of paintings'],
  flower: [
    'Category:Featured pictures of flowers',
    'search:haswbstatement:P275=Q6938433 deepcat:"Quality images of flowers"',
    'Category:Quality images of flowers',
  ],
};
const CANDIDATES_PER_CATEGORY = 18;
const OUT_W = 1920;
const OUT_H = 1440;
/** Wikimedia 標準縮圖寬度（非標準尺寸或原圖會被嚴格限流，見 https://w.wiki/GHai） */
const STD_WIDTH = 1920;

function stdThumbUrl(url) {
  const clean = url.split('?')[0];
  if (clean.includes('/thumb/')) return clean.replace(/\/\d+px-([^/]+)$/, `/${STD_WIDTH}px-$1`);
  const m = clean.match(/^(https:\/\/upload\.wikimedia\.org\/wikipedia\/commons)\/(.+\/)([^/]+)$/);
  if (!m) return clean;
  return `${m[1]}/thumb/${m[2]}${m[3]}/${STD_WIDTH}px-${m[3]}`;
}
const THUMB_W = 400;
const THUMB_H = 300;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const stripHtml = (s = '') => s.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();

async function api(params) {
  const url = `${API}?${new URLSearchParams({ format: 'json', formatversion: '2', ...params })}`;
  for (let attempt = 0; attempt < 6; attempt++) {
    const res = await fetch(url, { headers: { 'User-Agent': UA } });
    if (res.ok) return res.json();
    if (res.status === 429 || res.status >= 500) {
      const wait = Number(res.headers.get('retry-after')) * 1000 || 5000 * (attempt + 1);
      console.log(`  API ${res.status}，等待 ${wait / 1000} 秒後重試`);
      await sleep(wait);
      continue;
    }
    throw new Error(`API ${res.status}: ${url}`);
  }
  throw new Error(`API 重試失敗: ${url}`);
}

function isFreeLicense(meta) {
  const lic = meta?.LicenseShortName?.value ?? '';
  return /^(public domain|pd\b|pd-|cc0)/i.test(lic) || /^cc0/i.test(meta?.License?.value ?? '') || /^pd/i.test(meta?.License?.value ?? '');
}

function fitsResolution(w, h) {
  const aspect = w / h;
  if (aspect < 1.15 || aspect > 1.9) return false; // 避免過度裁切
  const cropW = aspect >= 4 / 3 ? h * (4 / 3) : w;
  return cropW >= OUT_W;
}

async function listCategory(cat, want) {
  const found = [];
  let cont = {};
  for (let page = 0; page < 30 && found.length < want; page++) {
    const gen = cat.startsWith('search:')
      ? { generator: 'search', gsrsearch: cat.slice(7), gsrnamespace: '6', gsrlimit: '20' }
      : { generator: 'categorymembers', gcmtitle: cat, gcmtype: 'file', gcmlimit: '20', gcmsort: 'timestamp', gcmdir: 'desc' };
    const data = await api({
      action: 'query',
      ...gen,
      prop: 'imageinfo',
      iiprop: 'url|size|mime|extmetadata',
      ...cont,
    });
    for (const p of data.query?.pages ?? []) {
      const ii = p.imageinfo?.[0];
      if (!ii || ii.mime !== 'image/jpeg') continue;
      if (!isFreeLicense(ii.extmetadata)) continue;
      if (!fitsResolution(ii.width, ii.height)) continue;
      found.push({
        title: p.title,
        width: ii.width,
        height: ii.height,
        downloadUrl: stdThumbUrl(ii.url),
        pageUrl: ii.descriptionurl,
        license: ii.extmetadata.LicenseShortName?.value ?? 'Public domain',
        artist: stripHtml(ii.extmetadata.Artist?.value) || '不詳',
        description: stripHtml(ii.extmetadata.ObjectName?.value || ii.extmetadata.ImageDescription?.value || p.title.replace(/^File:/, '')).slice(0, 120),
      });
    }
    if (!data.continue) break;
    cont = data.continue;
    await sleep(1000);
  }
  return found;
}

async function download(url, dest) {
  try {
    await fs.access(dest);
    return;
  } catch {}
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(url, { headers: { 'User-Agent': UA } });
    if (res.ok) {
      await fs.writeFile(dest, Buffer.from(await res.arrayBuffer()));
      return;
    }
    if (res.status === 429 || res.status >= 500) {
      const wait = Number(res.headers.get('retry-after')) * 1000 || 15000 * (attempt + 1);
      console.log(`  下載 ${res.status}，等待 ${wait / 1000} 秒：${(await res.text()).replace(/s+/g, ' ').slice(0, 400)}`);
      await sleep(wait);
      continue;
    }
    throw new Error(`download ${res.status}: ${url}`);
  }
  throw new Error(`download failed: ${url}`);
}

async function candidates() {
  await fs.mkdir(RAW, { recursive: true });
  const all = {};
  for (const [catId, cats] of Object.entries(SOURCES)) {
    const cacheFile = path.join(RAW, `list-${catId}.json`);
    let picked;
    try {
      picked = JSON.parse(await fs.readFile(cacheFile, 'utf8'));
    } catch {
      const seen = new Set();
      const list = [];
      for (const c of cats) {
        for (const item of await listCategory(c, CANDIDATES_PER_CATEGORY * 2)) {
          if (seen.has(item.title)) continue;
          seen.add(item.title);
          list.push(item);
        }
        if (list.length >= CANDIDATES_PER_CATEGORY) break;
      }
      picked = list.slice(0, CANDIDATES_PER_CATEGORY).map((it, i) => ({ ...it, key: `${catId}-c${String(i).padStart(2, '0')}` }));
      await fs.writeFile(cacheFile, JSON.stringify(picked, null, 2));
    }
    console.log(`${catId}: ${picked.length} 個候選`);
    await fs.mkdir(path.join(RAW, catId), { recursive: true });
    const ok = [];
    for (const it of picked) {
      const dest = path.join(RAW, catId, `${it.key}.jpg`);
      try {
        await fs.access(dest);
        ok.push(it);
        continue;
      } catch {}
      try {
        await download(stdThumbUrl(it.downloadUrl), dest);
        ok.push(it);
      } catch (e) {
        console.log(`  略過 ${it.key}：${e.message}`);
      }
      await sleep(1500);
    }
    all[catId] = ok;
    await contactSheet(catId, ok);
  }
  await fs.writeFile(path.join(RAW, 'candidates.json'), JSON.stringify(all, null, 2));
}

async function contactSheet(catId, list) {
  const cols = 6;
  const tw = 240;
  const th = 180;
  const rows = Math.ceil(list.length / cols);
  const composites = [];
  for (let i = 0; i < list.length; i++) {
    const buf = await sharp(path.join(RAW, catId, `${list[i].key}.jpg`)).resize(tw, th, { fit: 'cover' }).jpeg().toBuffer();
    const label = Buffer.from(`<svg width="${tw}" height="24"><rect width="${tw}" height="24" fill="black" opacity="0.6"/><text x="6" y="17" font-size="15" fill="white" font-family="sans-serif">${list[i].key}</text></svg>`);
    composites.push({ input: buf, left: (i % cols) * tw, top: Math.floor(i / cols) * th });
    composites.push({ input: label, left: (i % cols) * tw, top: Math.floor(i / cols) * th });
  }
  await sharp({ create: { width: cols * tw, height: rows * th, channels: 3, background: '#222' } })
    .composite(composites)
    .jpeg({ quality: 80 })
    .toFile(path.join(RAW, `sheet-${catId}.jpg`));
}

async function readLists() {
  const all = {};
  for (const catId of Object.keys(SOURCES)) {
    try {
      all[catId] = JSON.parse(await fs.readFile(path.join(RAW, `list-${catId}.json`), 'utf8'));
    } catch {
      all[catId] = [];
    }
  }
  return all;
}

async function build() {
  const all = await readLists();
  const picks = JSON.parse(await fs.readFile(path.join(ROOT, 'scripts', 'picks.json'), 'utf8'));
  const outDir = path.join(ROOT, 'public', 'images');
  await fs.rm(outDir, { recursive: true, force: true });
  await fs.mkdir(outDir, { recursive: true });
  const images = [];
  const credits = ['# 圖片來源（CREDITS）', '', '所有內建圖片皆取自 Wikimedia Commons，授權為公有領域（Public domain）或 CC0。', ''];
  for (const [catId, entries] of Object.entries(picks)) {
    credits.push(`## ${catId}`, '', '| ID | 名稱 | 作者 | 授權 | 來源 |', '|---|---|---|---|---|');
    for (let i = 0; i < entries.length; i++) {
      const { key, name } = entries[i];
      const it = all[catId].find((c) => c.key === key);
      if (!it) throw new Error(`找不到候選 ${key}`);
      const id = `${catId}-${String(i + 1).padStart(2, '0')}`;
      const src = path.join(RAW, catId, `${key}.jpg`);
      await sharp(src).resize(OUT_W, OUT_H, { fit: 'cover', position: 'attention' }).webp({ quality: 82 }).toFile(path.join(outDir, `${id}.webp`));
      await sharp(src).resize(THUMB_W, THUMB_H, { fit: 'cover', position: 'attention' }).webp({ quality: 75 }).toFile(path.join(outDir, `${id}-thumb.webp`));
      images.push({ id, category: catId, name, src: `images/${id}.webp`, thumb: `images/${id}-thumb.webp`, artist: it.artist, license: it.license, sourceUrl: it.pageUrl });
      const esc = (s) => s.replace(/\|/g, '\\|');
      credits.push(`| ${id} | ${esc(name)} | ${esc(it.artist)} | ${esc(it.license)} | [${esc(it.title)}](${it.pageUrl}) |`);
    }
    credits.push('');
  }
  await fs.mkdir(path.join(ROOT, 'src', 'content'), { recursive: true });
  await fs.writeFile(path.join(ROOT, 'src', 'content', 'images.json'), JSON.stringify(images, null, 2) + '\n');
  await fs.writeFile(path.join(ROOT, 'CREDITS.md'), credits.join('\n'));
  console.log(`輸出 ${images.length} 張圖`);
}

async function sheets() {
  const all = await readLists();
  for (const [catId, list] of Object.entries(all)) {
    const have = [];
    for (const it of list) {
      try {
        await fs.access(path.join(RAW, catId, `${it.key}.jpg`));
        have.push(it);
      } catch {}
    }
    if (have.length) await contactSheet(catId, have);
    console.log(`${catId}: ${have.length} 張已下載`);
  }
}

// 追加候選：每個關鍵字取前幾張，增加多樣性（遠景、市集、花田等）
const CC0 = 'haswbstatement:P275=Q6938433';
const PD = 'haswbstatement:P6216=Q19652';
const EXTRA = {
  food: [
    `${CC0} Unsplash food`, `${CC0} Unsplash breakfast`, `${CC0} Unsplash dessert`, `${CC0} Unsplash coffee`,
    `${CC0} Unsplash bakery`, `${CC0} market fruit`, `${CC0} night market`, `${CC0} vegetable market`,
    `${CC0} sushi`, `${CC0} vineyard`, `${CC0} tea plantation`, `${CC0} Unsplash pizza`,
  ],
  flower: [
    `${CC0} tulip field`, `${CC0} lavender field`, `${CC0} cherry blossom`, `${CC0} sunflower field`,
    `${CC0} Unsplash flowers`, `${CC0} flower garden`, `${CC0} rapeseed field`, `${CC0} Unsplash roses`,
    `${CC0} poppy field`, `${CC0} wisteria`, `${CC0} hydrangea`, `${CC0} lotus pond`,
  ],
  landscape: [`${CC0} Unsplash mountain lake`, `${CC0} Unsplash landscape`, `${CC0} waterfall`, `${CC0} Unsplash beach sunset`, `${CC0} autumn forest`, `${CC0} aurora`],
  architecture: [`${CC0} Unsplash architecture`, `${CC0} Unsplash city skyline`, `${CC0} temple Japan`, `${CC0} castle`, `${CC0} Unsplash bridge`, `${CC0} old town street`],
  art: [`${PD} Claude Monet`, `${PD} Vincent van Gogh landscape`, `${PD} Hokusai`, `${PD} Renoir`, `${PD} Canaletto`, `${PD} Turner painting`],
};
const PER_QUERY = 4;

async function more(only) {
  for (const [catId, queries] of Object.entries(EXTRA)) {
    if (only && only !== catId) continue;
    const file = path.join(RAW, `list-${catId}.json`);
    let list = [];
    try {
      list = JSON.parse(await fs.readFile(file, 'utf8'));
    } catch {}
    const seen = new Set(list.map((i) => i.title));
    let next = list.reduce((m, i) => Math.max(m, Number(i.key.split('-c')[1])), -1) + 1;
    const added = [];
    for (const q of queries) {
      let n = 0;
      for (const item of await listCategory(`search:${q}`, PER_QUERY * 3)) {
        if (n >= PER_QUERY || seen.has(item.title)) continue;
        seen.add(item.title);
        added.push({ ...item, key: `${catId}-c${String(next++).padStart(2, '0')}` });
        n++;
      }
      await sleep(800);
    }
    list.push(...added);
    await fs.writeFile(file, JSON.stringify(list, null, 2));
    console.log(`${catId}: 追加 ${added.length} 個候選（共 ${list.length}）`);
    await fs.mkdir(path.join(RAW, catId), { recursive: true });
    for (const it of added) {
      try {
        await download(stdThumbUrl(it.downloadUrl), path.join(RAW, catId, `${it.key}.jpg`));
      } catch (e) {
        console.log(`  略過 ${it.key}：${e.message}`);
      }
      await sleep(1500);
    }
    console.log(`${catId}: 下載完成`);
  }
}

const cmd = process.argv[2];
if (cmd === 'more') await more(process.argv[3]);
else if (cmd === 'sheets') await sheets();
else if (cmd === 'candidates') await candidates();
else if (cmd === 'build') await build();
else console.log('用法：node scripts/fetch-images.mjs candidates|build');
