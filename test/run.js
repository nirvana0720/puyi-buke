'use strict';
// 職責：補課系統自動化測試 runner ── 呼叫「測試 Supabase 專案」的 RPC，比對預期結果。
// 執行：本機雙擊 run.bat（或指令 node run.js）
// 只用 Node 內建 https 模組，不裝任何 npm 套件（比照 grabber/node_syncer/sync.js 的寫法）。
//
// ⚠️ 這支腳本只能對著「測試專案」跑，絕對不能對正式環境跑！
//    config.json 指向哪個專案由 test/config.json 決定，下面會自動擋掉正式環境的網址。
//
// 前提（第一次用，或測試專案重建過，才需要重做）：
//   1) 到測試專案的 SQL Editor 貼過 db/full_setup_all_in_one.sql（建表 + 建函式）
//   2) 到測試專案的 SQL Editor 貼過 test/seed.sql（灌測試資料 + 建測試輔助 RPC）
//   3) test/config.json 填的是測試專案的 URL/anon key（不是正式環境的）
//
// 以後要加新測試案例：抄下面 test(...) 的寫法，複製一段改內容即可，
// 需要新的種子資料就去改 test/seed.sql 的 test_get_seed_ids()，把新欄位加進去。

const fs = require('fs');
const path = require('path');
const https = require('https');
const { URL } = require('url');

const CFG = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8'));
const SUPABASE_URL = CFG.SUPABASE_URL;
const SUPABASE_ANON_KEY = CFG.SUPABASE_ANON_KEY;

// ── 安全防呆：擋掉正式環境（普宜精舍正式專案 ID 的固定字串）──────────
if (!SUPABASE_URL || SUPABASE_URL.includes('yiowkvxwvwpzebdriksu')) {
  console.error('❌ config.json 指向的不是測試專案（疑似正式環境），已中止執行！');
  console.error('   測試絕對不能跑在正式環境的 Supabase 專案上。');
  process.exit(1);
}

// ── 共用：呼叫 Supabase RPC ──────────────────────────────
function rpc(name, params) {
  return new Promise((resolve, reject) => {
    const u = new URL(SUPABASE_URL + '/rest/v1/rpc/' + name);
    const body = Buffer.from(JSON.stringify(params || {}), 'utf8');
    const req = https.request({
      hostname: u.hostname,
      path: u.pathname,
      method: 'POST',
      headers: {
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': 'Bearer ' + SUPABASE_ANON_KEY,
        'Content-Type': 'application/json',
        'Content-Length': body.length,
      },
    }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let json;
        try { json = JSON.parse(text); } catch (e) { json = text; }
        if (res.statusCode >= 400) {
          reject(new Error(`RPC ${name} 回傳 ${res.statusCode}：${text}`));
        } else {
          resolve(json);
        }
      });
    });
    req.on('error', reject);
    req.setTimeout(15000, () => req.destroy(new Error('連線逾時（15 秒）')));
    req.write(body);
    req.end();
  });
}

// ── 共用：日期小工具（台北時間，跟 sync.js 同樣算法）──────────────
function todayStr() {
  const t = new Date(Date.now() + 8 * 3600 * 1000);
  const p2 = n => String(n).padStart(2, '0');
  return t.getUTCFullYear() + '-' + p2(t.getUTCMonth() + 1) + '-' + p2(t.getUTCDate());
}
function addDays(dateStr, days) {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  const p2 = n => String(n).padStart(2, '0');
  return d.getUTCFullYear() + '-' + p2(d.getUTCMonth() + 1) + '-' + p2(d.getUTCDate());
}

// ── 測試小工具 ──────────────────────────────
let pass = 0, fail = 0;
async function test(name, fn) {
  try {
    await fn();
    pass++;
    console.log('✅ ' + name);
  } catch (e) {
    fail++;
    console.log('❌ ' + name);
    console.log('   ' + e.message);
  }
}
function assertEqual(actual, expected, label) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a !== e) throw new Error((label || '') + ' 預期 ' + e + '，實際拿到 ' + a);
}

// ── 主流程 ──────────────────────────────
(async () => {
  console.log('=== 補課系統自動化測試 ===');
  console.log('對象專案：' + SUPABASE_URL);
  console.log('');

  let seed = null;

  await test('連線 + 讀取種子資料（test_get_seed_ids）', async () => {
    seed = await rpc('test_get_seed_ids', {});
    if (!seed || !seed.staff_id) {
      throw new Error('找不到 test_staff，請先到測試專案 SQL Editor 貼過 test/seed.sql');
    }
    if (!seed.member_甲_id || !seed.session_absent_id || !seed.session_today_id) {
      throw new Error('種子資料不完整，請重新貼一次 test/seed.sql（可重複執行）');
    }
  });

  // 只有種子資料就緒才繼續跑後面的測試，避免連鎖噴一堆看不懂的錯誤
  if (seed && seed.staff_id) {

    await test('kiosk_lookup_member：補課期限＝缺課日＋40天（不是舊的週數公式）', async () => {
      const r = await rpc('kiosk_lookup_member', {
        p_staff_id: seed.staff_id,
        p_member_code: seed.member_甲_code,
      });
      if (!r.found) throw new Error('查無測試學員甲，種子資料可能沒建好');
      const cls = (r.classes || []).find(c => c.class_ref === seed.class_id);
      if (!cls) throw new Error('回傳資料裡找不到測試班（class_ref 對不上）');
      const absence = (cls.absences || [])[0];
      if (!absence) throw new Error('回傳資料裡沒有缺課紀錄（可能已經過期，或種子資料日期需要調整）');
      const expected = addDays(seed.absence_date, 40);
      assertEqual(absence.deadline_date, expected, '補課截止日');
    });

    await test('ingest_kiosk_attendance：刷卡同步不能覆蓋既有 group_id', async () => {
      const before = await rpc('test_get_member_group', { p_member_id: '900000001' });
      if (before !== '男1組') throw new Error('種子資料的 group_id 不是預期的「男1組」，可能被之前跑過的測試污染，重貼一次 seed.sql 再試');

      await rpc('ingest_kiosk_attendance', {
        p_unit_id: 'TESTUNIT',
        p_date: todayStr(),
        p_class: {
          class_id: 'TEST-CLASS-01', class_name: '測試班', level: '中',
          day_night: '夜', day_of_week: '三', start_time: '19:00', end_time: '21:00',
          period_num: 1, week_num: 2, is_cancelled: false,
        },
        p_records: [{
          member_id: '900000001', name: '測試甲', dharma_name: '傳測',
          group_id: '刷卡系統給的錯誤組別',  // 故意給一個跟種子資料不同的值，驗證不會被寫進去
          group_num: '1-1', mark: 'V', checkin_time: null, is_dropped: false,
        }],
      });

      const after = await rpc('test_get_member_group', { p_member_id: '900000001' });
      assertEqual(after, before, 'group_id 不應該被刷卡同步覆蓋');
    });

  }

  console.log('');
  console.log('=== 結果：' + pass + ' 過、' + fail + ' 沒過 ===');
  if (fail > 0) {
    console.log('（有測試沒過，先不要把對應的 SQL 貼到正式環境，回報給 Claude 一起看）');
  }
  process.exit(fail > 0 ? 1 : 0);
})().catch(e => {
  console.error('測試腳本本身出錯：', e);
  process.exit(1);
});
