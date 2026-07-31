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

// 日期分組標題列：預設全部收合，沿用頁面既有 .kiosk-collapse-toggle／.kiosk-collapse-arrow
// 樣式與收合邏輯（箭頭 ▼、collapsed 時旋轉 -90 度），右側加「N 筆」。點擊只切換該組（body 為
// header 的 nextElementSibling，不用另外做 id 對照表）。
function _kupGroupHtml(headerLabel, rowsHtml, count) {
  return `
    <div class="kiosk-listcard">
      <div class="kiosk-listcard-title kiosk-collapse-toggle collapsed" data-kup-header>
        <span class="kiosk-collapse-arrow">▼</span>
        <span>${headerLabel}</span>
        <span style="margin-left:auto;font-weight:400;font-size:13px">${count} 筆</span>
      </div>
      <div data-kup-body style="display:none">${rowsHtml}</div>
    </div>
  `;
}
function _kupBindCollapse(containerEl) {
  containerEl.querySelectorAll('[data-kup-header]').forEach(header => {
    header.addEventListener('click', () => {
      const body = header.nextElementSibling;
      if (!body) return;
      const collapsing = body.style.display !== 'none';
      body.style.display = collapsing ? 'none' : '';
      header.classList.toggle('collapsed', collapsing);
    });
  });
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

  containerEl.innerHTML = Array.from(groups.entries()).map(([date, rows]) => {
    const rowsHtml = rows.map(t => `
      <div class="kiosk-listrow">
        <strong>${t.member_name}</strong>・${t.from_class_name} → ${t.to_class_name}
        ${t.note ? `<div style="font-size:13px;color:var(--muted);margin-top:2px">備註：${t.note}</div>` : ''}
      </div>
    `).join('');
    return _kupGroupHtml(_kupGroupHeader(date), rowsHtml, rows.length);
  }).join('');

  _kupBindCollapse(containerEl);
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

  const groups = new Map(); // planned_date -> rows[]（同一天不同時段合併在同一組，比照調班區塊只依日期分組）
  all.forEach(m => {
    if (!groups.has(m.planned_date)) groups.set(m.planned_date, []);
    groups.get(m.planned_date).push(m);
  });

  containerEl.innerHTML = Array.from(groups.entries()).map(([date, rows]) => {
    const rowsHtml = rows.map(m => `
      <div class="kiosk-listrow">
        <strong>${m.member_name}</strong>・${m.class_name}${m.type === '培訓補課' ? '（培訓補課）' : ''}・預約時間 ${m.planned_slot || ''}・缺課日期 ${_kupMD(m.session_date)}
      </div>
    `).join('');
    return _kupGroupHtml(_kupGroupHeader(date), rowsHtml, rows.length);
  }).join('');

  _kupBindCollapse(containerEl);
}

if (typeof window !== 'undefined') {
  window.KioskUpcomingRender = { renderUpcomingTransfers, renderUpcomingMakeups };
}
