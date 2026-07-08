// 職責：補課期限的純函式計算（無副作用，可單獨測試）
// 不負責：Supabase 存取、UI 渲染

'use strict';

/**
 * 取某日期所在週的週一（ISO：週一為一週起點）
 * @param {Date} d
 * @returns {Date}
 */
function getWeekMonday(d) {
  const date = new Date(d);
  // getDay(): 0=日,1=一...6=六；把週日視為第 7 天
  const day = date.getDay() || 7;
  date.setDate(date.getDate() - day + 1);
  date.setHours(0, 0, 0, 0);
  return date;
}

/**
 * 日期加 N 天
 * @param {Date}   d
 * @param {number} days
 * @returns {Date}
 */
function addDays(d, days) {
  const result = new Date(d);
  result.setDate(result.getDate() + days);
  return result;
}

/**
 * Date → 'YYYY-MM-DD'
 * @param {Date} d
 * @returns {string}
 */
function toDateStr(d) {
  return d.toLocaleDateString('sv-SE');  // sv-SE locale 輸出 YYYY-MM-DD
}

/**
 * 計算最早可補課日
 * = sessionDate + makeup_earliest_days（預設 7 天，即下週同日）
 *
 * @param {string|Date} sessionDate  上課日期
 * @param {object}      settings     { makeup_earliest_days: number }
 * @returns {string}  'YYYY-MM-DD'
 */
function computeEarliest(sessionDate, settings) {
  const base = new Date(sessionDate);
  const days = (settings && settings.makeup_earliest_days != null)
    ? settings.makeup_earliest_days
    : 7;
  return toDateStr(addDays(base, days));
}

/**
 * 計算補課截止日
 * = 缺課日 + makeup_deadline_days（預設 40 天）
 *
 * @param {string|Date} sessionDate
 * @param {object}      settings  { makeup_deadline_days: number }
 * @returns {string}  'YYYY-MM-DD'
 */
function computeDeadline(sessionDate, settings) {
  const base = new Date(sessionDate);
  const days = (settings && settings.makeup_deadline_days != null)
    ? settings.makeup_deadline_days
    : 40;
  return toDateStr(addDays(base, days));
}

/**
 * 判斷是否逾期
 * @param {string} deadlineDate  'YYYY-MM-DD'
 * @param {string|Date} today
 * @returns {boolean}
 */
function isOverdue(deadlineDate, today) {
  return new Date(today) > new Date(deadlineDate);
}

// Node.js
if (typeof module !== 'undefined') {
  module.exports = { computeEarliest, computeDeadline, isOverdue, toDateStr, addDays };
}
// 瀏覽器
if (typeof window !== 'undefined') {
  window.MakeupRules = { computeEarliest, computeDeadline, isOverdue, toDateStr };
}
