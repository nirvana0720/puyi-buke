'use strict';
// 職責：現場排程同步器（Node 版）── 自帶 Node/OpenSSL 引擎，不依賴機器的 PowerShell/.NET/TLS。
//   邏輯沿用 grabber/bookmarklet.js 與 schedule_sync.ps1：算今日/星期 → list_audit_classes
//   → 篩今天有課的班 → GET zenclass class_attend_records → 組 p_class/p_records
//   → 呼叫 ingest_kiosk_attendance RPC → 寫 sync_log.txt 與 cron_sync_log。
//   只用 Node 內建模組（https/http/fs/url），不裝任何 npm 套件。
const fs   = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const { URL } = require('url');

// ── 設定 ─────────────────────────────────────────────
const CFG = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8'));
const SUPABASE_URL      = CFG.SUPABASE_URL;
const SUPABASE_ANON_KEY = CFG.SUPABASE_ANON_KEY;
const UNIT_ID           = CFG.UNIT_ID;
const API_BASE          = CFG.API_BASE;
const UA = 'Mozilla/5.0 (Windows NT 6.1) puyi-node-syncer';

// ── 台北時間（UTC+8 固定、無日光節約，純算術避開舊 Node 的 ICU/locale 問題）──
function taipeiParts() {
  const t = new Date(Date.now() + 8 * 3600 * 1000); // 位移到台北牆上時間，取 UTC 欄位
  const p2 = n => String(n).padStart(2, '0');
  return {
    dateStr: t.getUTCFullYear() + '-' + p2(t.getUTCMonth() + 1) + '-' + p2(t.getUTCDate()),
    timeStr: p2(t.getUTCHours()) + ':' + p2(t.getUTCMinutes()) + ':' + p2(t.getUTCSeconds()),
    dow:     t.getUTCDay(), // 0=日 .. 6=六
  };
}
const DOW_CHARS = ['日', '一', '二', '三', '四', '五', '六'];

// ── 記錄 ─────────────────────────────────────────────
const LOG_FILE = path.join(__dirname, 'sync_log.txt');
function log(msg) {
  const line = '[' + taipeiParts().dateStr + ' ' + taipeiParts().timeStr + '] ' + msg;
  console.log(line);
  try { fs.appendFileSync(LOG_FILE, line + '\n', 'utf8'); } catch (e) { /* 記錄失敗不影響主流程 */ }
}

// ── 共用 HTTP（Node 內建 https，自帶 TLS 1.2/1.3）──
function httpRequest(urlStr, method, headers, bodyBuf, timeoutMs) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlStr);
    const lib = u.protocol === 'http:' ? http : https;
    const opts = {
      protocol: u.protocol, hostname: u.hostname,
      port: u.port || (u.protocol === 'http:' ? 80 : 443),
      path: u.pathname + u.search, method: method, headers: headers || {},
    };
    const req = lib.request(opts, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, text: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    req.setTimeout(timeoutMs || 30000, () => req.destroy(new Error('連線逾時')));
    if (bodyBuf) req.write(bodyBuf);
    req.end();
  });
}

async function supabaseRpc(fn, params) {
  const body = Buffer.from(JSON.stringify(params || {}), 'utf8');
  const res = await httpRequest(SUPABASE_URL + '/rest/v1/rpc/' + fn, 'POST', {
    'apikey': SUPABASE_ANON_KEY,
    'Authorization': 'Bearer ' + SUPABASE_ANON_KEY,
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': body.length,
  }, body, 30000);
  if (res.status < 200 || res.status >= 300) throw new Error('Supabase HTTP ' + res.status + '：' + res.text.slice(0, 200));
  return res.text ? JSON.parse(res.text) : null;
}

async function zenclassGet(url) {
  const res = await httpRequest(url, 'GET', { 'Accept': 'application/json', 'User-Agent': UA }, null, 20000);
  if (res.status < 200 || res.status >= 300) throw new Error('zenclass HTTP ' + res.status);
  return JSON.parse(res.text);
}

async function writeCronLog(row) {
  try {
    const body = Buffer.from(JSON.stringify(row), 'utf8');
    await httpRequest(SUPABASE_URL + '/rest/v1/cron_sync_log', 'POST', {
      'apikey': SUPABASE_ANON_KEY,
      'Authorization': 'Bearer ' + SUPABASE_ANON_KEY,
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Length': body.length,
    }, body, 15000);
  } catch (e) { console.log('（cron_sync_log 寫入失敗，不影響同步結果：' + e.message + '）'); }
}

// ── 純函式：把 zenclass 回應組成 p_class / p_records（可單獨測試）──
const INCLUDES = ['attendMark', 'memberId', 'aliasName', 'ctDharmaName', 'classGroupId',
  'memberGroupNum', 'attendCheckinDtTm', 'classId', 'className', 'classStartTime',
  'classEndTime', 'dayOfWeek', 'isDroppedClass'].join(',');

function buildPClass(cls) {
  return {
    class_id: cls.class_id, class_name: cls.class_name,
    level: cls.level || null, day_night: cls.day_night || null,
    day_of_week: cls.day_of_week || null,
    start_time: cls.start_time || null, end_time: cls.end_time || null,
    period_num: null, week_num: null, is_cancelled: false,
  };
}
function buildPRecords(records) {
  return (records || [])
    .filter(r => r.isDroppedClass !== true) // 已退班不寫入
    .map(r => ({
      member_id: r.memberId, name: r.aliasName || '', dharma_name: r.ctDharmaName || '',
      group_id: r.classGroupId || '', group_num: r.memberGroupNum || '',
      mark: r.attendMark || null, checkin_time: r.attendCheckinDtTm || null,
      is_dropped: r.isDroppedClass === true,
    }));
}

async function main() {
  const tp = taipeiParts();
  const dowStr = DOW_CHARS[tp.dow];
  log('===== 開始同步 ' + tp.dateStr + '（星期' + dowStr + '）=====');
  log('（Node 版本：' + process.version + '）');

  let classes;
  try { classes = await supabaseRpc('list_audit_classes', {}); }
  catch (e) { log('X 取班別清單失敗：' + e.message); process.exit(1); }
  classes = Array.isArray(classes) ? classes : [];
  if (!classes.length) { log('(略) 目前沒有已建檔的班別，結束。'); return; }

  const matched = classes.filter(c =>
    c.status === '進行中' &&
    c.day_of_week === dowStr &&
    !String(c.class_id || '').startsWith('MANUAL-'));
  if (!matched.length) { log('(略) 今天（星期' + dowStr + '）沒有符合條件的班，結束。'); return; }
  log('找到 ' + matched.length + ' 個班別：' + matched.map(c => c.class_name).join('、'));

  for (const cls of matched) {
    try {
      const url = API_BASE + '/meditation/api/kiosk/class_attend_records'
        + '?classDate=' + encodeURIComponent(tp.dateStr)
        + '&classId=' + encodeURIComponent(cls.class_id)
        + '&includes=' + encodeURIComponent(INCLUDES);
      const attend = await zenclassGet(url);
      if (attend.errCode !== 200) throw new Error('取報到名單失敗（errCode ' + attend.errCode + '）');
      const result = await supabaseRpc('ingest_kiosk_attendance', {
        p_unit_id: UNIT_ID, p_date: tp.dateStr,
        p_class: buildPClass(cls), p_records: buildPRecords(attend.items),
      });
      const synced = (result && result.synced != null) ? result.synced : 0;
      log('OK ' + cls.class_name + '：同步成功，' + synced + ' 筆');
      await writeCronLog({ class_id: cls.class_id, class_name: cls.class_name, ok: true, synced: synced });
    } catch (e) {
      log('X ' + cls.class_name + '：同步失敗 - ' + e.message);
      await writeCronLog({ class_id: cls.class_id, class_name: cls.class_name, ok: false, error_msg: e.message });
    }
  }
  log('===== 同步結束 =====');
}

module.exports = { taipeiParts, buildPClass, buildPRecords, supabaseRpc, zenclassGet, DOW_CHARS, INCLUDES };
if (require.main === module) main();
