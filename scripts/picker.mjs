// 本機選圖工具：瀏覽 assets-raw/ 的候選圖，勾選每類 10 張並命名，存成 scripts/picks.json，可直接產生圖庫。
// 用法：node scripts/picker.mjs  →  開啟 http://localhost:5174
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import sharp from 'sharp';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RAW = path.join(ROOT, 'assets-raw');
const PICKS = path.join(ROOT, 'scripts', 'picks.json');
const CATS = [
  ['landscape', '風景'],
  ['food', '美食'],
  ['architecture', '建築'],
  ['art', '藝術'],
  ['flower', '花卉'],
];
const PORT = 5174;

async function candidates() {
  const out = {};
  for (const [id] of CATS) {
    let list = [];
    try {
      list = JSON.parse(await fs.readFile(path.join(RAW, `list-${id}.json`), 'utf8'));
    } catch {}
    const have = [];
    for (const it of list) {
      try {
        await fs.access(path.join(RAW, id, `${it.key}.jpg`));
        have.push({ key: it.key, title: it.title.replace(/^File:/, ''), artist: it.artist, license: it.license, pageUrl: it.pageUrl, description: it.description });
      } catch {}
    }
    out[id] = have;
  }
  return out;
}

const thumbCache = new Map();
async function thumb(cat, key) {
  const k = `${cat}/${key}`;
  if (!thumbCache.has(k)) {
    const buf = await sharp(path.join(RAW, cat, `${key}.jpg`)).resize(480, 360, { fit: 'cover', position: 'attention' }).jpeg({ quality: 80 }).toBuffer();
    thumbCache.set(k, buf);
  }
  return thumbCache.get(k);
}

function runBuild() {
  return new Promise((resolve) => {
    execFile(process.execPath, [path.join(ROOT, 'scripts', 'fetch-images.mjs'), 'build'], { cwd: ROOT }, (err, stdout, stderr) =>
      resolve({ ok: !err, output: (stdout + stderr).trim() }),
    );
  });
}

const PAGE = `<!doctype html><html lang="zh-Hant-TW"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>選圖工具</title><style>
:root{--bg:#f6f1e8;--card:#fff;--ink:#2f2418;--soft:#7a6a58;--accent:#c8642f;--ok:#4f8a5b;--line:#e3d7c3}
*{box-sizing:border-box}body{margin:0;font-family:'Microsoft JhengHei','PingFang TC',system-ui,sans-serif;background:var(--bg);color:var(--ink)}
header{position:sticky;top:0;z-index:5;background:#3b2a1a;color:#fff8ef;padding:12px 16px;display:flex;flex-wrap:wrap;gap:10px;align-items:center}
header h1{font-size:18px;margin:0 12px 0 0}
.tab{border:1px solid #ffffff55;background:transparent;color:inherit;border-radius:999px;padding:6px 14px;font:inherit;cursor:pointer}
.tab.active{background:#fff8ef;color:#3b2a1a}.tab .n{font-size:12px;opacity:.8;margin-left:4px}.tab .n.full{color:#7fd18d;opacity:1}
.spacer{flex:1}.btn{border:none;border-radius:999px;padding:8px 16px;font:inherit;cursor:pointer;background:#fff8ef;color:#3b2a1a}
.btn.primary{background:var(--accent);color:#fff}
main{padding:16px;max-width:1400px;margin:0 auto}.hint{color:var(--soft);margin:0 0 12px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:14px}
.card{background:var(--card);border-radius:12px;overflow:hidden;box-shadow:0 2px 8px #0002;border:3px solid transparent;display:flex;flex-direction:column}
.card.sel{border-color:var(--ok)}.card img{width:100%;aspect-ratio:4/3;object-fit:cover;display:block;cursor:pointer;background:#ddd}
.body{padding:8px 10px;display:flex;flex-direction:column;gap:6px;font-size:13px}
.meta{color:var(--soft);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.row{display:flex;gap:6px;align-items:center}.row input[type=text]{flex:1;font:inherit;padding:6px 8px;border:1px solid var(--line);border-radius:8px}
.row input[type=text]:disabled{background:#f3efe8}.badge{background:var(--ok);color:#fff;border-radius:999px;padding:1px 8px;font-size:12px}
#log{white-space:pre-wrap;background:#2b2b2b;color:#ddd;padding:12px;border-radius:10px;font-size:12px;display:none;margin-top:16px}
a{color:var(--accent)}
</style></head><body>
<header><h1>選圖工具</h1><div id="tabs"></div><span class="spacer"></span>
<button class="btn" id="save">儲存選擇</button><button class="btn primary" id="build">儲存並產生圖庫</button></header>
<main><p class="hint">點圖片勾選（每類 10 張，順序依勾選先後）。新抓的候選排在最前面。名稱可以留白，之後由 Claude 依圖片命名。預覽即為實際裁切的 4:3 範圍。授權皆已確認為公有領域或 CC0。</p>
<div class="grid" id="grid"></div><div id="log"></div></main>
<script>
const CATS=${JSON.stringify(CATS)};let data={},picks={},cur=CATS[0][0];
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);
async function load(){data=await (await fetch('/api/candidates')).json();picks=await (await fetch('/api/picks')).json();for(const [id] of CATS)picks[id]=picks[id]||[];render();}
function tabs(){document.getElementById('tabs').innerHTML=CATS.map(([id,n])=>{const c=picks[id].length;return '<button class="tab '+(id===cur?'active':'')+'" data-id="'+id+'">'+n+'<span class="n '+(c===10?'full':'')+'">'+c+'/10</span></button>'}).join('');
document.querySelectorAll('.tab').forEach(t=>t.onclick=()=>{cur=t.dataset.id;render()});}
function render(){tabs();const g=document.getElementById('grid');const list=[...(data[cur]||[])].reverse();
if(!list.length){g.innerHTML='<p class="hint">這一類還沒有下載好的候選圖。</p>';return;}
g.innerHTML=list.map(it=>{const i=picks[cur].findIndex(p=>p.key===it.key);const s=i>=0;
return '<div class="card '+(s?'sel':'')+'" data-key="'+it.key+'"><img loading="lazy" src="/thumb/'+cur+'/'+it.key+'.jpg" title="點擊勾選 / 取消"><div class="body">'+
'<div class="row">'+(s?'<span class="badge">#'+(i+1)+'</span>':'')+'<input type="text" placeholder="中文名稱" value="'+(s?esc(picks[cur][i].name):'')+'" '+(s?'':'disabled')+'></div>'+
'<div class="meta" title="'+esc(it.description)+'">'+esc(it.description)+'</div><div class="meta">'+esc(it.artist)+' · '+esc(it.license)+' · <a href="'+esc(it.pageUrl)+'" target="_blank" rel="noopener">Commons</a></div></div></div>'}).join('');
g.querySelectorAll('.card').forEach(c=>{const key=c.dataset.key;
c.querySelector('img').onclick=()=>{const arr=picks[cur];const i=arr.findIndex(p=>p.key===key);
if(i>=0)arr.splice(i,1);else{if(arr.length>=10){alert('這一類已選滿 10 張，請先取消一張');return;}arr.push({key,name:''});}render();
if(i<0)setTimeout(()=>document.querySelector('.card[data-key="'+key+'"] input').focus(),0);};
c.querySelector('input').oninput=e=>{const p=picks[cur].find(p=>p.key===key);if(p)p.name=e.target.value.trim();};});}
async function save(){const r=await fetch('/api/picks',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(picks)});return r.ok;}
document.getElementById('save').onclick=async()=>{alert(await save()?'已儲存到 scripts/picks.json':'儲存失敗');};
document.getElementById('build').onclick=async()=>{
const problems=CATS.filter(([id])=>picks[id].length!==10).map(([,n])=>n);
if(problems.length&&!confirm('以下分類未滿 10 張：'+problems.join('、')+'\\n仍要產生圖庫嗎？（遊戲會只顯示有圖的分類）'))return;
await save();const log=document.getElementById('log');log.style.display='block';log.textContent='產生中…';
const r=await (await fetch('/api/build',{method:'POST'})).json();log.textContent=(r.ok?'完成\\n':'失敗\\n')+r.output;};
load();
</script></body></html>`;

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://localhost:${PORT}`);
    if (url.pathname === '/') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      return res.end(PAGE);
    }
    if (url.pathname === '/api/candidates') {
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify(await candidates()));
    }
    if (url.pathname === '/api/picks' && req.method === 'GET') {
      let body = '{}';
      try {
        body = await fs.readFile(PICKS, 'utf8');
      } catch {}
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(body);
    }
    if (url.pathname === '/api/picks' && req.method === 'POST') {
      let body = '';
      for await (const chunk of req) body += chunk;
      const picks = JSON.parse(body);
      const clean = {};
      for (const [id] of CATS) {
        const arr = Array.isArray(picks[id]) ? picks[id] : [];
        clean[id] = arr.filter((p) => typeof p?.key === 'string' && /^[a-z]+-c\d+$/.test(p.key)).slice(0, 10).map((p) => ({ key: p.key, name: String(p.name ?? '').slice(0, 30) }));
      }
      await fs.writeFile(PICKS, JSON.stringify(clean, null, 2) + '\n');
      res.writeHead(200);
      return res.end('ok');
    }
    if (url.pathname === '/api/build' && req.method === 'POST') {
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify(await runBuild()));
    }
    const m = url.pathname.match(/^\/thumb\/([a-z]+)\/([a-z]+-c\d+)\.jpg$/);
    if (m && CATS.some(([id]) => id === m[1])) {
      res.writeHead(200, { 'content-type': 'image/jpeg', 'cache-control': 'max-age=3600' });
      return res.end(await thumb(m[1], m[2]));
    }
    res.writeHead(404);
    res.end('not found');
  } catch (e) {
    res.writeHead(500);
    res.end(String(e));
  }
});

server.listen(PORT, '127.0.0.1', () => console.log(`選圖工具：http://localhost:${PORT}`));
