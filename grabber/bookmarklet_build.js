// 職責：讀 bookmarklet.js，將設定值注入後壓縮成可存書籤的 javascript: 字串
// 不負責：API 呼叫、Supabase 存取
// 使用方式：node grabber/bookmarklet_build.js

'use strict';

const fs   = require('fs');
const path = require('path');

// 讀 config.js（良師父自填的真實設定）
const configPath = path.resolve(__dirname, '../config/config.js');
if (!fs.existsSync(configPath)) {
  console.error('❌ 找不到 config/config.js，請先複製 config.example.js 並填入金鑰。');
  process.exit(1);
}

// eslint-disable-next-line import/no-dynamic-require
const CONFIG = require(configPath);

const srcFile = process.argv[2] || 'bookmarklet.js';
const outFile = srcFile.replace(/\.js$/, '.min.txt');

let code = fs.readFileSync(path.join(__dirname, srcFile), 'utf8');

// 注入真實設定值
code = code
  .replace("'REPLACE_YOUR_PROJECT_URL'",  JSON.stringify(CONFIG.SUPABASE_URL))
  .replace("'REPLACE_YOUR_ANON_KEY'",     JSON.stringify(CONFIG.SUPABASE_ANON_KEY))
  .replace("'UNIT01071'",                 JSON.stringify(CONFIG.UNIT_ID || 'UNIT01071'));

// 最簡壓縮：去多餘空白、移除註解（獨立行 // 註解 ＋ 行尾 // 註解；
// 用「前面要有空白」判斷是不是註解，才不會誤砍 https:// 這種網址）
const minified = code
  .split('\n')
  .map(l => l.replace(/\s\/\/.*$/, ''))     // 去掉行尾註解（前面必須有空白，避開 https://）
  .filter(l => !l.trim().startsWith('//'))  // 移除獨立行注解
  .join(' ')
  .replace(/\s{2,}/g, ' ')
  .trim();

const bookmarklet = 'javascript:' + encodeURIComponent(minified);

console.log('\n=== 複製以下整段文字，存成 Chrome 書籤的「網址」欄位 ===\n');
console.log(bookmarklet);
console.log('\n=== 結束 ===\n');

const outPath = path.join(__dirname, outFile);
fs.writeFileSync(outPath, bookmarklet, 'utf8');
console.log(`已同步輸出至：${outPath}`);
