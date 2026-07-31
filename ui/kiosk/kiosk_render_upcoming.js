// 職責：義工櫃台頁——「未來日↔夜間調班補課」「未來預約補課」兩個清單區塊的渲染
// 不負責：RPC 呼叫、天數切換狀態（由 kiosk.js 負責）

'use strict';

function _kupDayStr(d) {
  const [y, m, dd] = d.split('-').map(Number);
  return ['週日','週一','週二','週三','週四','週五','週六'][new Date(y, m-1, dd).getDay()];
}
function _kupMD(d) {
  const [, m, dd] = d.split('-').map(Number);
  return `${m}/${dd}`;
}
function _kupGroupHeader(dateStr, timeStr) {
  const head = `${_kupMD(dateStr)}（${_kupDayStr(dateStr)}）`;
  return timeStr ? `${head} ${timeStr}` : head;
}

// ── 未來日↔夜間調班補課 ──────────────────────────────────────────
// transfers: [{transfer_id, member_name, from_class_name, to_class_name, to_date, note}]
function renderUpcomingTransfers(containerEl, transfers, days) {
  if (!containerEl) return;
  if (!transfers || !transfers.length) {
    containerEl.innerHTML = `<p class="kiosk-listempty">未來 ${days} 天內尚無調班登記。</p>`;
    return;
  }

  const groups = new Map(); // to_date -> rows[]
  transfers.forEach(t => {
    if (!groups.has(t.to_date)) groups.set(t.to_date, []);
    groups.get(t.to_date).push(t);
  });

  containerEl.innerHTML = Array.from(groups.entries()).map(([date, rows]) => `
    <div class="kiosk-listcard">
      <div class="kiosk-listcard-title">${_kupGroupHeader(date)}</div>
      ${rows.map(t => `
        <div class="kiosk-listrow">
          <strong>${t.member_name}</strong>・${t.from_class_name} → ${t.to_class_name}
          ${t.note ? `<div style="font-size:13px;color:var(--muted);margin-top:2px">備註：${t.note}</div>` : ''}
        </div>
      `).join('')}
    </div>
  `).join('');
}

// ── 未來預約補課（一般補課＋培訓補課合併分組） ──────────────────────
// makeups: [{makeup_id, member_name, class_name, session_date, planned_date, planned_slot, type:'補課'}]
// trainingMakeups: [{training_makeup_id, member_name, class_name, session_date, planned_date, planned_slot, type:'培訓補課'}]
function renderUpcomingMakeups(containerEl, makeups, trainingMakeups, days) {
  if (!containerEl) return;
  const all = [...(makeups || []), ...(trainingMakeups || [])];
  if (!all.length) {
    containerEl.innerHTML = `<p class="kiosk-listempty">未來 ${days} 天內尚無補課登記。</p>`;
    return;
  }

  all.sort((a, b) => {
    if (a.planned_date !== b.planned_date) return a.planned_date < b.planned_date ? -1 : 1;
    if (a.planned_slot !== b.planned_slot) return (a.planned_slot || '') < (b.planned_slot || '') ? -1 : 1;
    return (a.member_name || '').localeCompare(b.member_name || '', 'zh-Hant');
  });

  const groups = new Map(); // "planned_date|planned_slot" -> rows[]
  all.forEach(m => {
    const key = `${m.planned_date}|${m.planned_slot}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(m);
  });

  containerEl.innerHTML = Array.from(groups.values()).map(rows => {
    const first = rows[0];
    return `
    <div class="kiosk-listcard">
      <div class="kiosk-listcard-title">${_kupGroupHeader(first.planned_date, first.planned_slot)}</div>
      ${rows.map(m => `
        <div class="kiosk-listrow">
          <strong>${m.member_name}</strong>・${m.class_name}${m.type === '培訓補課' ? '（培訓補課）' : ''}・缺課日期 ${_kupMD(m.session_date)}
        </div>
      `).join('')}
    </div>
  `;
  }).join('');
}

if (typeof window !== 'undefined') {
  window.KioskUpcomingRender = { renderUpcomingTransfers, renderUpcomingMakeups };
}
