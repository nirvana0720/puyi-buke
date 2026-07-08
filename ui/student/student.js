// 職責：學員頁資料取用——全部改走 RPC（get_student_view / get_makeup_rules / register_makeup）
// 不負責：DOM 渲染（render.js）、Supabase client 初始化（home/index.html）

'use strict';

const ABSENT_MARKS = new Set(['O', 'A', 'LL']);

/** 從 sessionStorage 取登入資料，查無則回 null */
function getSession() {
  const raw = sessionStorage.getItem('buke_classes');
  return raw ? JSON.parse(raw) : null;
}

/**
 * 呼叫 get_makeup_rules RPC，取補課規定（notice / earliest_mode / earliest_days / deadline_weeks）
 * 若失敗回預設值（不中斷主流程）
 */
async function fetchMakeupRulesViaRpc(sb) {
  try {
    const { data, error } = await sb.rpc('get_makeup_rules');
    if (error || !data) return { notice: '', earliest_mode: '下週一', earliest_days: 7, deadline_days: 40, time_slots: [] };
    return { time_slots: [], ...data };
  } catch (_) {
    return { notice: '', earliest_mode: '下週一', earliest_days: 7, deadline_days: 40, time_slots: [] };
  }
}

/**
 * 呼叫 get_student_view RPC，解析成前端所需結構
 * 回傳 { memberInfo, stats, absences, makeups }
 */
async function fetchStudentViewViaRpc(sb, memberDbId) {
  const { data, error } = await sb.rpc('get_student_view', { p_member_db_id: memberDbId });
  if (error) throw new Error(`get_student_view 失敗：${error.message}`);
  if (!data)  throw new Error('查無學員資料，請重新登入。');

  const rules    = window.MakeupRules;
  const settings = data.settings || { makeup_earliest_days: 7, makeup_deadline_days: 40 };
  const today    = new Date().toLocaleDateString('sv-SE');

  // 出缺勤統計
  const allAttend = data.attendance || [];
  const stats = {
    phys:   allAttend.filter(a => !ABSENT_MARKS.has(a.mark)).length,
    absent: allAttend.filter(a =>  ABSENT_MARKS.has(a.mark)).length,
    makeup: (data.makeups || []).filter(m => m.status === '已完成').length,
  };

  // 缺堂清單：mark ∈ O/A/LL 的已上堂次
  const absences = allAttend
    .filter(a => ABSENT_MARKS.has(a.mark))
    .map(a => {
      const deadline = rules.computeDeadline(a.date, settings);
      return {
        session_id:    a.session_id,
        session_date:  a.date,
        week_num:      a.week_num ?? null,
        mark:          a.mark,
        earliest_date: rules.computeEarliest(a.date, settings),
        deadline_date: deadline,
        is_overdue:    rules.isOverdue(deadline, today),
      };
    })
    .sort((a, b) => a.session_date.localeCompare(b.session_date));

  // 補課紀錄
  const makeups = (data.makeups || []).map(m => ({
    ...m,
    is_overdue:       m.status === '待補課' && m.deadline_date < today,
    attend_count:     m.attend_count     ?? 0,
    last_attended_at: m.last_attended_at ?? null,
    last_late_mark:   m.last_late_mark   ?? null,
  }));

  return {
    memberInfo: {
      id:             data.member_db_id,
      name:           data.name,
      dharma_name:    data.dharma_name,
      class_name:     data.class_name,
      total_sessions: data.total_sessions,
    },
    stats,
    absences,
    makeups,
  };
}

// ── 培訓子系統 RPC 包裝 ──────────────────────────────────────────

async function fetchTrainingClasses(sb) {
  const { data, error } = await sb.rpc('get_training_classes');
  if (error) throw new Error(error.message);
  return data || [];
}

async function fetchTrainingSessions(sb, classRef) {
  const { data, error } = await sb.rpc('get_training_sessions', { p_class_ref: classRef });
  if (error) throw new Error(error.message);
  return data || [];
}

async function fetchMyTrainingMakeups(sb, memberDbId) {
  const { data, error } = await sb.rpc('get_my_training_makeups', { p_member_db_id: memberDbId });
  if (error) throw new Error(error.message);
  return data || [];
}

async function registerTrainingMakeup(sb, memberDbId, trainingSessionRef, note, plannedDate, plannedSlot, earphone) {
  const { data, error } = await sb.rpc('register_training_makeup', {
    p_member_db_id: memberDbId, p_training_session_ref: trainingSessionRef,
    p_note: note || null, p_planned_date: plannedDate || null,
    p_planned_slot: plannedSlot || null, p_earphone: earphone ?? null,
  });
  if (error) throw new Error(error.message);
  return data;
}

async function cancelTrainingMakeup(sb, memberDbId, trainingSessionRef) {
  const { data, error } = await sb.rpc('cancel_training_makeup', {
    p_member_db_id: memberDbId, p_training_session_ref: trainingSessionRef,
  });
  if (error) throw new Error(error.message);
  if (data && data.ok === false) throw new Error(data.reason || '取消失敗');
  return data;
}

/**
 * 呼叫 register_makeup RPC（7 參數新版）送出補課登記
 * @param {object} sb
 * @param {number} memberDbId
 * @param {{ sessionRef, method, trainingName, earphone, plannedDate, plannedSlot }} formData
 */
async function submitMakeupViaRpc(sb, memberDbId, formData) {
  const { data, error } = await sb.rpc('register_makeup', {
    p_member_db_id:  memberDbId,
    p_session_ref:   formData.sessionRef,
    p_method:        formData.method,
    p_training_name: formData.trainingName  || null,
    p_earphone:      formData.earphone      ?? null,
    p_planned_date:  formData.plannedDate   || null,
    p_planned_slot:  formData.plannedSlot   || null,
  });
  if (error) throw new Error(error.message);
  return data;
}

/**
 * 呼叫 cancel_makeup RPC，取消「待補課」登記
 * @param {object} sb
 * @param {number} memberDbId
 * @param {number} sessionRef
 */
async function cancelMakeupViaRpc(sb, memberDbId, sessionRef) {
  const { data, error } = await sb.rpc('cancel_makeup', {
    p_member_db_id: memberDbId,
    p_session_ref:  sessionRef,
  });
  if (error) throw new Error(error.message);
  if (data && data.ok === false) throw new Error(data.reason || '取消失敗');
  return data;
}

if (typeof window !== 'undefined') {
  window.StudentLogic = {
    getSession, fetchMakeupRulesViaRpc, fetchStudentViewViaRpc, submitMakeupViaRpc, cancelMakeupViaRpc,
    fetchTrainingClasses, fetchTrainingSessions, fetchMyTrainingMakeups, registerTrainingMakeup, cancelTrainingMakeup,
  };
}
if (typeof module !== 'undefined') {
  module.exports = {
    getSession, fetchMakeupRulesViaRpc, fetchStudentViewViaRpc, submitMakeupViaRpc, cancelMakeupViaRpc,
    fetchTrainingClasses, fetchTrainingSessions, fetchMyTrainingMakeups, registerTrainingMakeup, cancelTrainingMakeup,
  };
}
