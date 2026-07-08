// 職責：從 Supabase 取數、計算出席統計與結業狀態
// Phase 3b：學長/班長一律改走 RPC（get_group_view / get_class_view）
// 不負責：DOM 渲染（render.js）、Supabase client 初始化（index.html）

'use strict';

/** 從 sessionStorage 取登入資料，查無則回 null */
function getSession() {
  const raw = sessionStorage.getItem('buke_classes');
  return raw ? JSON.parse(raw) : null;
}

// ── 結業計算邏輯（純函式，render.js 也會用到）────────────────

/**
 * 計算單一學員的出席統計
 * @param {string[]} marks                 已上堂次的 mark 陣列
 * @param {number}   total                 總堂數
 * @param {Array}    unregisteredAbsences  RPC 回傳的 unregistered_absences（無補課登記的缺課，含 deadline_date）
 * @param {Array}    makeups                RPC 回傳的 makeups（已登記但未完成的補課，含 is_overdue）
 * @returns {StudentStats}
 */
function calcStats(marks, total, unregisteredAbsences = [], makeups = []) {
  const PHYSICAL = new Set(['V', 'L', 'ML']);
  const ABSENT   = new Set(['A', 'O', 'LL']);
  const MAKEUP   = new Set(['M']);

  let physical = 0, absent = 0, makeup = 0, mlMakeup = 0;
  for (const m of marks) {
    if (m === 'ML') mlMakeup++;
    if (PHYSICAL.has(m))    physical++;
    else if (ABSENT.has(m)) absent++;
    else if (MAKEUP.has(m)) makeup++;
  }
  const total_credit = physical + makeup;
  const total_absent = absent + makeup + mlMakeup;   // 缺課總數（含已補）

  // 逾期未補（已經過補課期限、永久救不回來的堂數）：
  // 沒登記補課的缺課看 deadline_date 有沒有過期；已登記但還沒完成的補課看 RPC 算好的 is_overdue。
  // 跟後台 admin_student_stats 的 overdue_absent 是同一套邏輯，只是資料來源不同（這裡用前端已有的兩個陣列）。
  const today = new Date().toLocaleDateString('sv-SE');
  const overdueUnregistered = unregisteredAbsences.filter(a => a.deadline_date < today).length;
  const overdueRegistered   = makeups.filter(mk => mk.is_overdue).length;
  const overdue_absent = overdueUnregistered + overdueRegistered;

  const cap           = Math.min(total, 20);
  const need_physical = Math.ceil(cap / 2);
  const need_credit   = cap - 3;
  const max_absent    = 3;

  // 結業達標：官方原始公式，缺課門檻只看「目前還沒補的」（absent），不看缺課總數
  // （跟下面「勤學狀態」是不同標準：勤學看這學期總共缺過幾次，結業達標看目前手上還欠補幾堂）
  const can_graduate = physical >= need_physical
    && absent <= max_absent
    && total_credit >= need_credit;

  const held        = marks.length;
  const remaining   = total - held;
  const stillFixable = absent - overdue_absent; // 目前還沒補、但還沒過期、還救得回來的堂數
  // 結業不可逆：改用「逾期未補」（overdue_absent）判斷，不再用「目前還沒補的>3」無條件觸發
  // （還沒過期的缺課本來就還能去補，跟後台 panel_risk.js 的 isUnrecoverable 同一套公式）
  const red_light = !can_graduate
    && ((physical + remaining) < need_physical
        || overdue_absent > max_absent
        || (total_credit + remaining + stillFixable) < need_credit);

  // 全勤：有出席紀錄且全是 V
  const perfect = held > 0 && marks.every(m => m === 'V');

  // 勤學四態（維持不變，跟結業達標是不同標準）
  let diligent;
  if (total_absent === 0)                        diligent = '目前全勤';
  else if (total_absent <= 3 && absent === 0)     diligent = '已勤學';
  else if (total_absent <= 3 && absent > 0)       diligent = '可勤學';
  else                                            diligent = '無法勤學';

  return {
    physical, absent, makeup, total_credit, total_absent, overdue_absent,
    can_graduate, red_light,
    need_physical, need_credit, max_absent,
    held, total,
    perfect, diligent,
  };
}

// ── RPC 資料取用 ─────────────────────────────────────────────

/**
 * 呼叫 get_group_view 或 get_class_view RPC，
 * 將回傳的 members[] + marks[] 轉成 render.js 所需的 StudentRow[]
 *
 * @param {object} sb
 * @param {number} memberDbId  登入者的 members.id
 * @param {string} role        '學長' | '班長'
 * @returns {Promise<StudentRow[]>}
 */
async function fetchStudentStatsViaRpc(sb, memberDbId, role) {
  const fnName = role === '班長' ? 'get_class_view' : 'get_group_view';
  const { data, error } = await sb.rpc(fnName, { p_member_db_id: memberDbId });
  if (error) throw new Error(`${fnName} 失敗：${error.message}`);
  if (!data)  throw new Error('查無班級資料，請確認角色指派是否已設定。');

  const { class_name, total_sessions, members } = data;
  const total = total_sessions || 0;

  return (members || []).map(m => {
    const marks = (m.marks || []).filter(Boolean);
    const stats = calcStats(marks, total, m.unregistered_absences || [], m.makeups || []);
    return {
      id:                    m.id,
      member_id:             m.member_id,
      name:                  m.name,
      dharma_name:           m.dharma_name,
      group_id:              m.group_id,
      group_num:             m.group_num,
      status:                m.status || '在學',
      class_name,
      makeups:               m.makeups               || [],
      unregistered_absences: m.unregistered_absences || [],
      ...stats,
    };
  });
}

if (typeof window !== 'undefined') {
  window.BoardLogic = { getSession, fetchStudentStatsViaRpc, calcStats };
}
if (typeof module !== 'undefined') {
  module.exports = { getSession, fetchStudentStatsViaRpc, calcStats };
}
