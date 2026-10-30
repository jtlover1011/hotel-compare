#!/usr/bin/env node
/* 极简静态服务器（零依赖）— 让手机在同一个 Wi-Fi 下访问
   用法：node serve.js            # 默认 8080
        PORT=9000 node serve.js
*/

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

const ROOT = __dirname;
const PORT = Number(process.env.PORT || 8080);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8'
};

function send(res, code, body, headers) {
  res.writeHead(code, Object.assign({ 'Cache-Control': 'no-cache' }, headers || {}));
  res.end(body);
}

/* ---------------- 地理数据代理 ----------------
   只放行固定上游，避免变成开放代理。
   用途：当浏览器直连被 CORS 挡住时，前端自动回落到这里。
   ------------------------------------------------ */

const OVERPASS_UP = 'https://overpass-api.de/api/interpreter';
const NOMINATIM_UP = 'https://nominatim.openstreetmap.org';
const UA = 'HotelCompare/2.0 (personal use)';

function json(res, code, obj) {
  send(res, code, JSON.stringify(obj), {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*'
  });
}

async function handleGeoApi(req, res, url) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  try {
    if (url.pathname === '/api/geo/overpass') {
      const data = url.searchParams.get('data') || '';
      if (!data) return json(res, 400, { error: 'missing data' });
      const up = await fetch(OVERPASS_UP, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': UA },
        body: 'data=' + encodeURIComponent(data)
      });
      const text = await up.text();
      return send(res, up.ok ? 200 : 502, text, {
        'Content-Type': 'application/json; charset=utf-8',
        'Access-Control-Allow-Origin': '*'
      });
    }

    if (url.pathname === '/api/geo/nominatim') {
      const u = new URL(NOMINATIM_UP + (url.searchParams.get('path') || '/search'));
      url.searchParams.forEach((v, k) => { if (k !== 'path') u.searchParams.set(k, v); });
      const up = await fetch(u, { headers: { 'User-Agent': UA, Accept: 'application/json' } });
      const text = await up.text();
      return send(res, up.ok ? 200 : 502, text, {
        'Content-Type': 'application/json; charset=utf-8',
        'Access-Control-Allow-Origin': '*'
      });
    }

    return json(res, 404, { error: 'unknown geo api' });
  } catch (e) {
    return json(res, 502, { error: String((e && e.message) || e) });
  }
}

const server = http.createServer((req, res) => {
  let url, pathname;
  try {
    url = new URL(req.url, 'http://localhost');
    pathname = decodeURIComponent(url.pathname);
  } catch (e) {
    return send(res, 400, 'Bad Request');
  }

  if (pathname.startsWith('/api/geo/')) return handleGeoApi(req, res, url);
  if (pathname.startsWith('/api/')) return json(res, 404, { error: 'unknown api' });

  if (pathname === '/' || pathname === '') pathname = '/index.html';

  const file = path.normalize(path.join(ROOT, pathname));
  if (!file.startsWith(ROOT + path.sep)) return send(res, 403, 'Forbidden');

  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) {
      // 单页应用回退
      const idx = path.join(ROOT, 'index.html');
      return fs.readFile(idx, (e2, buf) =>
        e2 ? send(res, 404, 'Not Found') : send(res, 200, buf, { 'Content-Type': MIME['.html'] })
      );
    }
    const type = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
    fs.readFile(file, (e3, buf) => {
      if (e3) return send(res, 500, 'Read Error');
      send(res, 200, buf, { 'Content-Type': type, 'Cache-Control': 'no-cache' });
    });
  });
});

server.listen(PORT, '0.0.0.0', () => {
  const nets = os.networkInterfaces();
  const lan = [];
  Object.keys(nets).forEach((name) => {
    (nets[name] || []).forEach((ni) => {
      if (ni.family === 'IPv4' && !ni.internal) lan.push(ni.address);
    });
  });

  console.log('\n  🏨  酒店比价助手已启动\n');
  console.log('  本机：   http://localhost:' + PORT);
  lan.forEach((ip) => console.log('  手机：   http://' + ip + ':' + PORT + '   ← 同一 Wi-Fi 下用 Safari 打开'));
  console.log('\n  Ctrl+C 停止\n');
});
