// 職責：將 kiosk_api.js 取回的資料 upsert 進 Supabase（classes/sessions/members/attendance）
// 不負責：呼叫 zenclass API、商業邏輯計算

'use strict';

// supabase-js 由外部載入（看板頁 CDN、或 Node 環境 require）
// 使用前需先呼叫 initSupabase(url, anonKey) 或由外部傳入 client

let _supabase = null;

/**
 * 初始化 Supabase client（瀏覽器環境在 bookmarklet/board.js 呼叫）
 * @param {string} url
 * @param {string} anonKey
 */
function initSupabase(url, anonKey) {
  // 瀏覽器：依賴全域 window.supabase（CDN 載入 supabase-js）
  if (typeof window !== 'undefined' && window.supabase) {
    _supabase = window.supabase.createClient(url, anonKey);
  } else if (typeof require !== 'undefined') {
    // Node 環境
    const { createClient } = require('@supabase/supabase-js');
    _supabase = createClient(url, anonKey);
  } else {
    throw new Error('supabase-js 尚未載入');
  }
  return _supabase;
}

function getClient() {
  if (!_supabase) throw new Error('請先呼叫 initSupabase()');
  return _supabase;
}

// ----------------------------------------------------------------
// 輔助函式
// ----------------------------------------------------------------

/**
 * 從班別名稱解析 level（程度）與 day_night（日/夜）
 * @param {string} className  例：'二夜中級班'、'三日初級班'
 * @returns {{ level: string, day_night: string|null }}
 */
function parseClassMeta(className) {
  let level = '中';  // 預設，避免 NOT NULL 報錯
  if (className.includes('初')) level = '初';
  else if (className.includes('高')) level = '高';
  else if (className.includes('研')) level = '研';
  else if (className.includes('中')) level = '中';

  let day_night = null;
  if (className.includes('夜')) day_night = '夜';
  else if (className.includes('日')) day_night = '日';

  return { level, day_night };
}

// ----------------------------------------------------------------
// 主要函式
// ----------------------------------------------------------------

/**
 * upsert 班別（classes）與當天堂次（sessions）
 * @param {string}          unitId
 * @param {string}          dateStr   YYYY-MM-DD
 * @param {ClassDateInfo}   classInfo kiosk_api.js 的回傳物件
 * @returns {Promise<{classRow: object, sessionRow: object}>}
 */
async function upsertClassAndSession(unitId, dateStr, classInfo) {
  const sb = getClient();

  // 1. upsert class
  const { level, day_night } = parseClassMeta(classInfo.className);
  const classPayload = {
    unit_id:    unitId,
    class_id:   classInfo.classId,
    class_name: classInfo.className,
    level,
    day_night,
    day_of_week: classInfo.dayOfWeek,
    start_time: classInfo.startTime || null,
    end_time:   classInfo.endTime   || null,
    period_num: classInfo.periodNum ?? null,
  };

  const { data: classRows, error: classErr } = await sb
    .from('classes')
    .upsert(classPayload, { onConflict: 'unit_id,class_id', returning: 'representation' })
    .select('id');

  if (classErr) throw new Error(`upsert classes: ${classErr.message}`);
  const classRow = classRows[0];

  // 2. upsert session（當天那堂）
  const sessionPayload = {
    class_ref: classRow.id,
    date:      dateStr,
    week_num:  classInfo.weekNum ?? null,
    is_held:   !classInfo.isCancelled,
  };

  const { data: sessionRows, error: sessionErr } = await sb
    .from('sessions')
    .upsert(sessionPayload, { onConflict: 'class_ref,date', returning: 'representation' })
    .select('id');

  if (sessionErr) throw new Error(`upsert sessions: ${sessionErr.message}`);

  return { classRow, sessionRow: sessionRows[0] };
}

/**
 * upsert 學員名冊（members）與出席紀錄（attendance）
 *
 * 防覆蓋原則：
 *   若資料庫現有 mark 是「已出席/已補課」（V/L/ML/M），且 API 回傳 null → 不蓋掉。
 *
 * 缺課補填原則：
 *   名冊有此學員、API 回傳 null（未報到）→ 填 O（缺課）。
 *
 * @param {AttendRecord[]} records    kiosk_api.js 的回傳陣列
 * @param {string}         dateStr    YYYY-MM-DD
 * @param {number}         classRefId classes.id
 * @param {number}         sessionId  sessions.id
 */
async function upsertMembersAndAttendance(records, dateStr, classRefId, sessionId) {
  const sb = getClient();

  if (records.length === 0) return { upserted: 0 };

  // 1. upsert members
  const memberPayloads = records.map(r => ({
    member_id:   r.memberId,
    name:        r.name,
    alias_name:  r.name,
    dharma_name: r.dharmaName,
    group_id:    r.groupId,
    group_num:   r.groupNum,
    class_ref:   classRefId,
  }));

  const { data: memberRows, error: memberErr } = await sb
    .from('members')
    .upsert(memberPayloads, {
      onConflict: 'class_ref,member_id',
      returning:  'representation',
    })
    .select('id,member_id');

  if (memberErr) throw new Error(`upsert members: ${memberErr.message}`);

  // 建立 memberId → members.id 的對照表
  const memberIdMap = {};
  for (const row of memberRows) memberIdMap[row.member_id] = row.id;

  // 2. 取現有 attendance，避免覆蓋「已出席/補課」的格
  const PROTECTED_MARKS = new Set(['V', 'L', 'ML', 'M']);
  const { data: existing, error: existErr } = await sb
    .from('attendance')
    .select('id,member_ref,mark,source')
    .eq('session_ref', sessionId);
  if (existErr) throw new Error(`讀現有 attendance: ${existErr.message}`);

  const existingMap = {};  // member_ref → {id, mark, source}
  for (const row of existing) existingMap[row.member_ref] = row;

  // 3. 整理要寫入的 attendance
  const attendPayloads = [];
  for (const r of records) {
    const membRef = memberIdMap[r.memberId];
    if (!membRef) continue;

    const current = existingMap[membRef];

    // Phase 2 強化保護：source=manual 的格一律不覆蓋（補課確認後不被 API 蓋回）
    if (current && current.source === 'manual' && PROTECTED_MARKS.has(current.mark)) continue;

    // Phase 1 保護：已出席/補課標記遇 API 回 null 不蓋掉
    if (current && PROTECTED_MARKS.has(current.mark) && !r.mark) continue;

    // API 沒回傳標記 → 缺課 O
    const finalMark = r.mark || 'O';

    attendPayloads.push({
      member_ref:   membRef,
      session_ref:  sessionId,
      mark:         finalMark,
      source:       'api',
      checkin_time: r.checkinTime || null,
    });
  }

  if (attendPayloads.length === 0) return { upserted: 0 };

  const { error: attendErr } = await sb
    .from('attendance')
    .upsert(attendPayloads, {
      onConflict: 'member_ref,session_ref',
    });

  if (attendErr) throw new Error(`upsert attendance: ${attendErr.message}`);

  return { upserted: attendPayloads.length };
}

// Node.js
if (typeof module !== 'undefined') {
  module.exports = { initSupabase, upsertClassAndSession, upsertMembersAndAttendance };
}
