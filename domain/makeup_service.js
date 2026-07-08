// 職責：補課登記的 Supabase 存取邏輯（getStudentAbsences/registerMakeup/listPendingMakeups/confirmMakeup）
// 不負責：日期計算（makeup_rules.js）、DOM 渲染、Supabase client 初始化

'use strict';

// makeup_rules 由外部載入（瀏覽器 CDN script tag，或 Node require）
function getRules() {
  if (typeof MakeupRules !== 'undefined') return MakeupRules;
  if (typeof require !== 'undefined') return require('./makeup_rules');
  throw new Error('MakeupRules 尚未載入');
}

// ── 設定載入 ─────────────────────────────────────────────────

async function getSettings(sb, classRef) {
  // 先找班級設定，再 fallback 全域
  const { data } = await sb
    .from('settings')
    .select('makeup_earliest_days,makeup_deadline_weeks')
    .or(`class_ref.eq.${classRef},class_ref.is.null`)
    .order('class_ref', { nullsFirst: false });

  return data?.[0] ?? { makeup_earliest_days: 7, makeup_deadline_weeks: 4 };
}

// ── 主要函式 ─────────────────────────────────────────────────

/**
 * 取學員「可補的缺堂」清單（mark ∈ {O,A,LL} 且 session is_held=true）
 * 附每堂的 earliest / deadline / 是否逾期
 *
 * @param {object} sb         supabase client
 * @param {number} memberRef  members.id
 * @returns {Promise<AbsenceRow[]>}
 */
async function getStudentAbsences(sb, memberRef) {
  const rules = getRules();

  // 取學員所屬班，以便查設定
  const { data: member, error: mErr } = await sb
    .from('members')
    .select('class_ref')
    .eq('id', memberRef)
    .single();
  if (mErr) throw new Error(`取學員資料失敗：${mErr.message}`);

  const settings = await getSettings(sb, member.class_ref);

  const { data, error } = await sb
    .from('attendance')
    .select('id, mark, session_ref, sessions(id, date, is_held, class_ref)')
    .eq('member_ref', memberRef)
    .in('mark', ['O', 'A', 'LL']);

  if (error) throw new Error(`取缺堂記錄失敗：${error.message}`);

  const today = new Date().toLocaleDateString('sv-SE');

  return (data || [])
    .filter(r => r.sessions?.is_held)
    .map(r => {
      const sessionDate = r.sessions.date;
      const earliest = rules.computeEarliest(sessionDate, settings);
      const deadline = rules.computeDeadline(sessionDate, settings);
      const overdue  = rules.isOverdue(deadline, today);
      return {
        attendance_id: r.id,
        session_id:    r.sessions.id,
        session_date:  sessionDate,
        mark:          r.mark,
        earliest_date: earliest,
        deadline_date: deadline,
        is_overdue:    overdue,
      };
    })
    .sort((a, b) => a.session_date.localeCompare(b.session_date));
}

/**
 * 登記補課
 * @param {object} sb
 * @param {{ memberRef, sessionRef, method, plannedDate, plannedSlot, registeredBy }} params
 * @returns {Promise<object>} 新建的 makeup 列
 */
async function registerMakeup(sb, { memberRef, sessionRef, method, plannedDate, plannedSlot, registeredBy }) {
  const rules = getRules();

  // 取 session 日期與班別
  const { data: session, error: sErr } = await sb
    .from('sessions')
    .select('date, class_ref')
    .eq('id', sessionRef)
    .single();
  if (sErr) throw new Error(`取堂次資料失敗：${sErr.message}`);

  const settings = await getSettings(sb, session.class_ref);
  const today    = new Date().toLocaleDateString('sv-SE');
  const earliest = rules.computeEarliest(session.date, settings);
  const deadline = rules.computeDeadline(session.date, settings);

  // 防呆：逾期不准登記
  if (rules.isOverdue(deadline, today)) {
    throw new Error(`該堂補課期限（${deadline}）已過，無法登記。`);
  }
  // 防呆：預定補課日不得早於最早可補日
  if (plannedDate && plannedDate < earliest) {
    throw new Error(`預定補課日（${plannedDate}）早於最早可補日（${earliest}）。`);
  }

  const { data, error } = await sb
    .from('makeups')
    .upsert({
      member_ref:    memberRef,
      session_ref:   sessionRef,
      method,
      planned_date:  plannedDate || null,
      planned_slot:  plannedSlot || null,
      earliest_date: earliest,
      deadline_date: deadline,
      status:        '待補課',
      registered_by: registeredBy || '本人',
      completed_date: null,
    }, { onConflict: 'member_ref,session_ref' })
    .select()
    .single();

  if (error) throw new Error(`登記補課失敗：${error.message}`);
  return data;
}

/**
 * 取待補課清單（精舍/學長用）
 * @param {object}      sb
 * @param {number}      classRef   classes.id（必填）
 * @param {string|null} groupId    過濾組別（null=整班）
 * @returns {Promise<PendingMakeupRow[]>}
 */
async function listPendingMakeups(sb, classRef, groupId) {
  // 先取該班學員 id
  let memberQuery = sb
    .from('members')
    .select('id, name, dharma_name, group_id, group_num')
    .eq('class_ref', classRef);
  if (groupId) memberQuery = memberQuery.eq('group_id', groupId);

  const { data: members, error: mErr } = await memberQuery;
  if (mErr) throw new Error(`取學員失敗：${mErr.message}`);
  if (!members?.length) return [];

  const memberIds = members.map(m => m.id);
  const memberMap = Object.fromEntries(members.map(m => [m.id, m]));

  const { data, error } = await sb
    .from('makeups')
    .select('id, member_ref, session_ref, method, planned_date, planned_slot, earliest_date, deadline_date, status, registered_by, completed_date, created_at, sessions(date)')
    .in('member_ref', memberIds)
    .eq('status', '待補課')
    .order('deadline_date');

  if (error) throw new Error(`取待補清單失敗：${error.message}`);

  const today = new Date().toLocaleDateString('sv-SE');
  return (data || []).map(r => ({
    ...r,
    member: memberMap[r.member_ref] || null,
    session_date: r.sessions?.date || null,
    is_overdue: r.deadline_date < today,
  }));
}

/**
 * 確認補課完成（精舍後台用）
 * O → M、LL → ML、A → M；source 改 manual（防重抓覆蓋）
 *
 * @param {object} sb
 * @param {number} makeupId  makeups.id
 * @returns {Promise<void>}
 */
async function confirmMakeup(sb, makeupId) {
  // 取 makeup 及對應 attendance 資訊
  const { data: makeup, error: mErr } = await sb
    .from('makeups')
    .select('id, member_ref, session_ref, status')
    .eq('id', makeupId)
    .single();
  if (mErr) throw new Error(`找不到補課紀錄：${mErr.message}`);
  if (makeup.status === '已完成') throw new Error('此補課紀錄已確認過。');

  const { data: att, error: aErr } = await sb
    .from('attendance')
    .select('id, mark')
    .eq('member_ref', makeup.member_ref)
    .eq('session_ref', makeup.session_ref)
    .single();
  if (aErr) throw new Error(`找不到出席紀錄：${aErr.message}`);

  // 標記流轉：O→M、A→M、LL→ML
  const MARK_MAP = { O: 'M', A: 'M', LL: 'ML' };
  const newMark = MARK_MAP[att.mark];
  if (!newMark) throw new Error(`出席標記 "${att.mark}" 不需要補課流轉。`);

  const today = new Date().toLocaleDateString('sv-SE');

  // 1. 更新 attendance（source=manual，受 push_supabase.js 保護）
  const { error: attUpdErr } = await sb
    .from('attendance')
    .update({ mark: newMark, source: 'manual' })
    .eq('id', att.id);
  if (attUpdErr) throw new Error(`更新出席紀錄失敗：${attUpdErr.message}`);

  // 2. 更新 makeups
  const { error: mkUpdErr } = await sb
    .from('makeups')
    .update({ status: '已完成', completed_date: today })
    .eq('id', makeupId);
  if (mkUpdErr) throw new Error(`更新補課狀態失敗：${mkUpdErr.message}`);
}

// Node.js
if (typeof module !== 'undefined') {
  module.exports = { getStudentAbsences, registerMakeup, listPendingMakeups, confirmMakeup };
}
// 瀏覽器
if (typeof window !== 'undefined') {
  window.MakeupService = { getStudentAbsences, registerMakeup, listPendingMakeups, confirmMakeup };
}
