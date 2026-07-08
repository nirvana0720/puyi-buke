// 職責：在本機開一個靜態檔案伺服器，讓補課系統前台頁能正確載入 config/JS（避開 file:// 限制）
// 不負責：商業邏輯、資料存取
// 用法：node tools/serve.js  （或雙擊 tools/start_server.bat）

'use strict';

const http = require('http');
const fs   = require('fs');
const path = require('path');
const { exec } = require('child_process');

const ROOT = path.join(__dirname, '..');      // 專案根目錄
const PORT = 8000;
const OPEN_PATH = '/ui/student/index.html';    // 啟動後自動打開的頁

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'text/javascript; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg':  'image/svg+xml',
  '.png':  'image/png',
  '.ico':  'image/x-icon',
};

const server = http.createServer((req, res) => {
  // 去掉查詢字串、解碼中文路徑
  let urlPath = decodeURIComponent(req.url.split('?')[0]);
  if (urlPath === '/') urlPath = OPEN_PATH;
  // 資料夾路徑（結尾為 /）自動補 index.html，讓 /ui/login/、/ui/home/ 等可正常開
  if (urlPath.endsWith('/')) urlPath += 'index.html';

  // 防目錄穿越
  const filePath = path.join(ROOT, path.normalize(urlPath).replace(/^(\.\.[/\\])+/, ''));
  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403); res.end('Forbidden'); return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('404 找不到：' + urlPath);
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  });
});

server.listen(PORT, () => {
  const base = `http://localhost:${PORT}`;
  console.log('補課系統本機伺服器已啟動：');
  console.log('  學員頁： ' + base + '/ui/student/index.html?member=學員編號');
  console.log('  看板頁： ' + base + '/ui/leader/index.html');
  console.log('  後台頁： ' + base + '/ui/admin/index.html');
  console.log('（要關閉：把這個黑色視窗關掉即可）');
  // 自動打開瀏覽器（Windows）
  if (process.platform === 'win32') exec('start "" ' + base + OPEN_PATH);
});
