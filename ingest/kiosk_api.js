// 職責：呼叫 zenclass kiosk JSON API、整理成標準物件（純函式，只 GET，不寫資料庫）
// 不負責：Supabase 存取、任何寫入操作

'use strict';

const API_BASE = (typeof CONFIG !== 'undefined')
  ? CONFIG.API_BASE
  : 'https://zenclass.ctcm.org.tw';

/**
 * 取當日（或指定日）該精舍所有班別資訊
 * @param {string} unitId   精舍代號，例 UNIT01071
 * @param {string} dateStr  日期字串 YYYY-MM-DD
 * @returns {Promise<ClassDateInfo[]>}
 */
async function fetchTodayClasses(unitId, dateStr) {
  const url = `${API_BASE}/meditation/api/kiosk/class_date_infos`
    + `?unitId=${encodeURIComponent(unitId)}&classDate=${encodeURIComponent(dateStr)}`;

  const res = await fetch(url, { credentials: 'include' });
  if (!res.ok) throw new Error(`fetchTodayClasses HTTP ${res.status}`);

  const json = await res.json();
  if (json.errCode !== 200) throw new Error(`fetchTodayClasses errCode ${json.errCode}`);

  return (json.items || []).map(normalizeClassInfo);
}

/**
 * 取指定班別、指定日期的報到名單
 * @param {string} classId  zenclass classId，例 CLS115031900005
 * @param {string} dateStr  日期字串 YYYY-MM-DD
 * @returns {Promise<AttendRecord[]>}
 */
async function fetchAttendRecords(classId, dateStr) {
  const includes = [
    'attendMark',
    'memberId',
    'aliasName',
    'ctDharmaName',
    'classGroupId',
    'memberGroupNum',
    'attendCheckinDtTm',
    'classId',
    'className',
    'classStartTime',
    'classEndTime',
    'dayOfWeek',
    'isDroppedClass',
  ].join(',');

  const url = `${API_BASE}/meditation/api/kiosk/class_attend_records`
    + `?classDate=${encodeURIComponent(dateStr)}`
    + `&classId=${encodeURIComponent(classId)}`
    + `&includes=${encodeURIComponent(includes)}`;

  const res = await fetch(url, { credentials: 'include' });
  if (!res.ok) throw new Error(`fetchAttendRecords HTTP ${res.status}`);

  const json = await res.json();
  if (json.errCode !== 200) throw new Error(`fetchAttendRecords errCode ${json.errCode}`);

  return (json.items || []).map(normalizeAttendRecord);
}

// ----------------------------------------------------------------
// 標準化函式（欄位對齊 db/schema.sql）
// ----------------------------------------------------------------

/**
 * @typedef {Object} ClassDateInfo
 * @property {string} classId
 * @property {string} className
 * @property {number} weekNum        classWeeksNum
 * @property {number} periodNum      classPeriodNum
 * @property {string} dayOfWeek
 * @property {string} startTime      HH:MM:SS
 * @property {string} endTime        HH:MM:SS
 * @property {boolean} isCancelled
 * @property {number} attendCount
 */
function normalizeClassInfo(raw) {
  return {
    classId:     raw.classId      || '',
    className:   raw.className    || '',
    weekNum:     raw.classWeeksNum   ?? null,
    periodNum:   raw.classPeriodNum  ?? null,
    dayOfWeek:   raw.dayOfWeek    || '',
    startTime:   raw.classStartTime  || '',
    endTime:     raw.classEndTime    || '',
    isCancelled: !!raw.isCancelled,
    attendCount: raw.attendCount  ?? 0,
  };
}

/**
 * @typedef {Object} AttendRecord
 * @property {string}      memberId
 * @property {string}      name          aliasName
 * @property {string}      dharmaName    ctDharmaName
 * @property {string}      groupId       classGroupId（例 "組1"）
 * @property {string}      groupNum      memberGroupNum（例 "1-2"）
 * @property {string|null} mark          attendMark（V/L/LL/A/M/ML/O/null）
 * @property {string|null} checkinTime   attendCheckinDtTm
 * @property {string}      classId
 * @property {string}      className
 * @property {string}      startTime
 * @property {string}      endTime
 * @property {string}      dayOfWeek
 * @property {boolean}     isDropped
 */
function normalizeAttendRecord(raw) {
  return {
    memberId:    raw.memberId          || '',
    name:        raw.aliasName         || '',
    dharmaName:  raw.ctDharmaName      || '',
    groupId:     raw.classGroupId      || '',
    groupNum:    raw.memberGroupNum    || '',
    mark:        raw.attendMark        ?? null,
    checkinTime: raw.attendCheckinDtTm ?? null,
    classId:     raw.classId           || '',
    className:   raw.className         || '',
    startTime:   raw.classStartTime    || '',
    endTime:     raw.classEndTime      || '',
    dayOfWeek:   raw.dayOfWeek         || '',
    isDropped:   !!raw.isDroppedClass,
  };
}

// Node.js
if (typeof module !== 'undefined') {
  module.exports = { fetchTodayClasses, fetchAttendRecords };
}
