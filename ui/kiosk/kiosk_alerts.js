// 職責：義工櫃台「查詢/顯示」性質的兩個區塊——B 到場提醒（站內警示）、G 今日登記清單
// 純顯示，不含任何操作按鈕；資料來源見 kiosk.js 的 RPC 包裝

'use strict';

function _fmtTime(ts) {
  if (!ts) return '—';
  return new Date(ts).toLocaleString('zh-TW', { hour12: false, month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

// ── B. 到場提醒 ──────────────────────────────────────────────────
function renderAttendanceAlerts(alerts) {
  const el = document.getElementById('kiosk-attendance-alerts');
  if (!el) return;

  const overdue = alerts?.overdue_attendance || [];
  const noShow  = alerts?.no_show || [];

  if (!overdue.length && !noShow.length) { el.innerHTML = ''; return; }

  const overdueHtml = overdue.length ? `
    <div class="buke-section-block care">
      <div class="buke-section">⚠️ 到場中超過 3 小時尚未結案（${overdue.length} 筆）</div>
      ${overdue.map(a => `
        <div style="font-size:14px;padding:4px 0">
          <span style="font-weight:500">${a.member_name}</span>
          <span style="color:var(--muted)">　${a.class_name}　到場時間：${_fmtTime(a.attended_at)}</span>
        </div>`).join('')}
    </div>` : '';

  const noShowHtml = noShow.length ? `
    <div class="buke-section-block care">
      <div class="buke-section">⚠️ 已登記補課但預約時段已過、完全沒有到場（${noShow.length} 筆）</div>
      ${noShow.map(a => `
        <div style="font-size:14px;padding:4px 0">
          <span style="font-weight:500">${a.member_name}</span>
          <span style="color:var(--muted)">　${a.class_name}　預約：${a.planned_date || ''} ${a.planned_slot || ''}</span>
        </div>`).join('')}
    </div>` : '';

  el.innerHTML = overdueHtml + noShowHtml;
}

// ── G. 今日登記清單 ──────────────────────────────────────────────
function renderTodayRegistrations(regs) {
  const el = document.getElementById('kiosk-today-registrations');
  if (!el) return;

  const makeups   = regs?.makeups   || [];
  const transfers = regs?.transfers || [];

  if (!makeups.length && !transfers.length) {
    el.innerHTML = '<p class="buke-empty">今日尚無新登記。</p>';
    return;
  }

  const mkHtml = makeups.map(m => `
    <div style="font-size:14px;padding:4px 0;border-bottom:1px solid var(--line)">
      <span style="font-weight:500">${m.member_name}</span>
      <span style="color:var(--muted)">　${m.class_name}　缺課日：${m.session_date}　預約：${m.planned_date || ''} ${m.planned_slot || ''}　狀態：${m.status}</span>
    </div>`).join('');

  const trHtml = transfers.map(t => `
    <div style="font-size:14px;padding:4px 0;border-bottom:1px solid var(--line)">
      <span style="font-weight:500">${t.member_name}</span>
      <span style="color:var(--muted)">　${t.from_class_name} → ${t.to_class_name}　去上課日：${t.to_date}　狀態：${t.status}</span>
    </div>`).join('');

  el.innerHTML = `
    ${makeups.length ? `<div class="buke-section" style="margin-bottom:4px">補課（${makeups.length}）</div>${mkHtml}` : ''}
    ${transfers.length ? `<div class="buke-section" style="margin:10px 0 4px">日↔夜間調班補課（${transfers.length}）</div>${trHtml}` : ''}
  `;
}

if (typeof window !== 'undefined') {
  window.KioskAlerts = { renderAttendanceAlerts, renderTodayRegistrations };
}
