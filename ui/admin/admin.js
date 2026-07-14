// 職責：後台管理頁純資料層——班別、學員、角色指派的 CRUD
// 不負責：DOM 渲染（各 panel_*.js）、Auth（index.html）

'use strict';

// ── 工具 ─────────────────────────────────────────────────────

/** 從班名自動判讀程度（含初/中/高/研 → 對應值） */
function detectLevel(className) {
  if (className.includes('研')) return '研';
  if (className.includes('高')) return '高';
  if (className.includes('中')) return '中';
  if (className.includes('初')) return '初';
  return '初'; // 預設
}

// ── 班別 ─────────────────────────────────────────────────────

/** 取所有班別（含 status），供面板分組用 */
async function fetchClasses(sb) {
  const { data, error } = await sb
    .from('classes')
    .select('id,class_name,level,day_of_week,day_night,total_sessions,teacher,status,unit_id,class_id')
    .order('status').order('class_name');
  if (error) throw new Error(`取班別失敗：${error.message}`);
  return data || [];
}

/** 組別排序 key：男生組在前、女生組在後，各自依組號數字排序；
 *  舊格式（純數字，尚未轉換成「男1組」/「女1組」）排在最後，維持字串排序 */
function groupSortKey(g) {
  const m = String(g || '').match(/^(男|女)(\d+)組$/);
  if (m) return [m[1] === '男' ? 0 : 1, Number(m[2]), g];
  return [2, 0, g];
}
function compareGroupNames(a, b) {
  const ka = groupSortKey(a), kb = groupSortKey(b);
  for (let i = 0; i < ka.length; i++) {
    if (ka[i] < kb[i]) return -1;
    if (ka[i] > kb[i]) return 1;
  }
  return 0;
}

/** 班別課表排序：依星期一～日排列，同星期則日間排在夜間前面；
 *  查不到星期資料（day_of_week 為空）的排在最後，維持原相對順序 */
const WEEKDAY_ORDER = ['一', '二', '三', '四', '五', '六', '日'];
const DAY_NIGHT_ORDER = ['日', '夜'];
function classScheduleSortKey(cls) {
  const dowIdx = WEEKDAY_ORDER.indexOf(cls && cls.day_of_week);
  const dnIdx  = DAY_NIGHT_ORDER.indexOf(cls && cls.day_night);
  return [dowIdx === -1 ? 99 : dowIdx, dnIdx === -1 ? 99 : dnIdx];
}
function compareClassSchedule(a, b) {
  const ka = classScheduleSortKey(a), kb = classScheduleSortKey(b);
  for (let i = 0; i < ka.length; i++) {
    if (ka[i] !== kb[i]) return ka[i] - kb[i];
  }
  return 0;
}

/** 取指定班的組別清單（男生組在前、女生組在後，依組號排序）
 *  ⚠️ 只取「在學」學員的組別——已休學學員的舊組別（可能是重構26 轉換前的殘留格式，例如純數字
 *  「1」「2」）不需要出現在角色指派/篩選下拉，反正休學學員不能被設為學長/班長，也不列入任何統計 */
async function fetchGroups(sb, classRef) {
  const { data } = await sb
    .from('members').select('group_id').eq('class_ref', classRef).eq('status', '在學');
  return [...new Set((data || []).map(r => r.group_id).filter(Boolean))].sort(compareGroupNames);
}

/** 更新班別基本資料 */
async function updateClass(sb, id, fields) {
  const level = detectLevel(fields.class_name || '');
  const { error } = await sb
    .from('classes')
    .update({ ...fields, level })
    .eq('id', id);
  if (error) throw new Error(`更新班別失敗：${error.message}`);
}

/** 新增班別（status 預設 '準備中'）
 *  ⚠️ unit_id／class_id 是資料庫必填欄位。unit_id 用 CONFIG.UNIT_ID（本分院代號，固定）；
 *  class_id 是 zenclass 官方班級代碼，手動新增當下還沒有真實代碼，先給一個帶「MANUAL-」前綴的
 *  暫時值佔位（不會跟真實 zenclass classId 撞到）。等這個班之後真的開始被刷卡同步／稽核抓到時，
 *  要注意刷卡系統可能會用真實 classId 另外建一筆新班別，而不是自動合併到這筆手動建的——
 *  這是已知限制，目前沒有自動合併機制，須留意是否出現同名的兩筆班別。 */
async function insertClass(sb, fields) {
  const level = detectLevel(fields.class_name || '');
  const unitId  = (typeof CONFIG !== 'undefined' && CONFIG.UNIT_ID) || 'UNIT_UNKNOWN';
  const classId = `MANUAL-${Date.now()}`;
  const { error } = await sb
    .from('classes')
    .insert({ ...fields, level, status: '準備中', unit_id: unitId, class_id: classId });
  if (error) throw new Error(`新增班別失敗：${error.message}`);
}

/** 綁定 zenclass 真代碼（只改 class_id，不動 class_name/level 等其他欄位，避免誤觸 updateClass 的 level 重算） */
async function bindClassId(sb, id, classId) {
  const { error } = await sb.from('classes').update({ class_id: classId }).eq('id', id);
  if (error) throw new Error(`綁定失敗：${error.message}`);
}

/** 查同一 unit_id 底下是否已有另一筆班別使用這個 zenclass class_id（供「綁定真代碼」判斷是否需要走合併流程） */
async function findClassByClassId(sb, unitId, classId) {
  const { data, error } = await sb
    .from('classes')
    .select('id,class_name,status')
    .eq('unit_id', unitId)
    .eq('class_id', classId);
  if (error) throw new Error(`查班別失敗：${error.message}`);
  return data || [];
}

/** 結業封存：單班 → status='已結業' */
async function archiveClass(sb, id) {
  const { error } = await sb
    .from('classes').update({ status: '已結業' }).eq('id', id);
  if (error) throw new Error(`結業封存失敗：${error.message}`);
}

/**
 * 新班啟用：
 *  1. 把目標班 status → '進行中'
 *  2. 同 unit_id + 同 level + 同「星期幾／日夜」（同一個時段換下一期）的其他「進行中」班 → '已結業'
 *  ⚠️ 只比對 level 不夠：同一級別（例如「初」）精舍常同時開好幾班（三日初級班、三夜初級班…），
 *  彼此是不同時段各自獨立的班，要一起進行中，不能因為同級別就互相封存。
 */
async function activateClass(sb, cls) {
  // 先找同 unit + 同 level + 同星期幾/日夜 進行中的舊班（＝同一時段換下一期）
  const { data: old } = await sb
    .from('classes')
    .select('id')
    .eq('unit_id', cls.unit_id)
    .eq('level', cls.level)
    .eq('day_of_week', cls.day_of_week)
    .eq('day_night', cls.day_night)
    .eq('status', '進行中')
    .neq('id', cls.id);

  // 啟用新班
  const { error: e1 } = await sb
    .from('classes').update({ status: '進行中' }).eq('id', cls.id);
  if (e1) throw new Error(`啟用失敗：${e1.message}`);

  // 結業舊班
  if (old && old.length) {
    const ids = old.map(r => r.id);
    const { error: e2 } = await sb
      .from('classes').update({ status: '已結業' }).in('id', ids);
    if (e2) throw new Error(`封存舊班失敗：${e2.message}`);
  }
}

// ── 堂次 ─────────────────────────────────────────────────────

/** 取某班全部堂次（依 week_num 排序） */
async function fetchSessions(sb, classRef) {
  const { data, error } = await sb
    .from('sessions')
    .select('id,date,week_num,is_held')
    .eq('class_ref', classRef)
    .order('week_num');
  if (error) throw new Error(`取堂次失敗：${error.message}`);
  return data || [];
}

/** 更新單一堂次（改日期／切換是否已上課） */
async function updateSession(sb, id, fields) {
  const { error } = await sb.from('sessions').update(fields).eq('id', id);
  if (error) throw new Error(`更新堂次失敗：${error.message}`);
}

/** 刪除單一堂次（ON DELETE CASCADE 會一併刪除該堂的 attendance／makeups，前端呼叫前務必先確認） */
async function deleteSession(sb, id) {
  const { error } = await sb.from('sessions').delete().eq('id', id);
  if (error) throw new Error(`刪除堂次失敗：${error.message}`);
}

// ── 學員 ─────────────────────────────────────────────────────

/** 取指定班所有學員（含休學），依組別/組號排列 */
async function fetchMembersWithStatus(sb, classRef) {
  const { data, error } = await sb
    .from('members')
    .select('id,member_id,name,dharma_name,group_id,group_num,status')
    .eq('class_ref', classRef).order('group_id').order('group_num');
  if (error) throw new Error(`取學員清單失敗：${error.message}`);
  return data || [];
}

/** 設定學員在學/休學 */
async function setMemberStatusLocal(sb, memberId, newStatus) {
  const { error } = await sb
    .from('members').update({ status: newStatus }).eq('id', memberId);
  if (error) throw new Error(`切換狀態失敗：${error.message}`);
}

// ── 角色指派 ─────────────────────────────────────────────────

/** 取指定班目前的角色指派清單（學長/班長，不含一般學員） */
async function fetchAssignments(sb, classRef) {
  const { data, error } = await sb
    .from('assignments')
    .select('member_id,role,scope_group')
    .eq('class_ref', classRef);
  if (error) throw new Error(`取角色指派失敗：${error.message}`);
  return data || [];
}

/**
 * 設定/移除基本身分（學員/學長/班長，三者互斥）
 * 先刪掉這個學員在這班原本的基本身分那一筆，role 有值才補插入新的一筆，
 * 不會動到「點名」那一筆（點名是獨立可疊加的職務，見 toggleRollcallRole）。
 * @param {string|null} role  '學長' | '班長' | null（null＝移除，恢復為一般學員）
 */
async function setBaseRole(sb, { member_id, class_ref, role, scope_group }) {
  const { error: delErr } = await sb
    .from('assignments')
    .delete()
    .eq('member_id', member_id)
    .eq('class_ref', class_ref)
    .in('role', ['學員', '學長', '班長']);
  if (delErr) throw new Error(`寫入指派失敗：${delErr.message}`);

  if (role) {
    const { error: insErr } = await sb
      .from('assignments')
      .insert({ member_id, class_ref, role, scope_group: scope_group || null });
    if (insErr) throw new Error(`寫入指派失敗：${insErr.message}`);
  }
}

/** 設定/取消「兼點名」職務，只動 role='點名' 那一筆，不影響基本身分 */
async function toggleRollcallRole(sb, { member_id, class_ref, on }) {
  if (on) {
    const { error } = await sb
      .from('assignments')
      .upsert({ member_id, class_ref, role: '點名', scope_group: null },
               { onConflict: 'member_id,class_ref,role' });
    if (error) throw new Error(`設定兼點名失敗：${error.message}`);
  } else {
    const { error } = await sb
      .from('assignments')
      .delete()
      .eq('member_id', member_id)
      .eq('class_ref', class_ref)
      .eq('role', '點名');
    if (error) throw new Error(`取消兼點名失敗：${error.message}`);
  }
}

if (typeof window !== 'undefined') {
  window.AdminData = {
    detectLevel,
    fetchClasses, fetchGroups, compareGroupNames, compareClassSchedule,
    updateClass, insertClass, archiveClass, activateClass,
    bindClassId, findClassByClassId,
    fetchSessions, updateSession, deleteSession,
    fetchMembersWithStatus, setMemberStatusLocal,
    fetchAssignments, setBaseRole, toggleRollcallRole,
  };
}
