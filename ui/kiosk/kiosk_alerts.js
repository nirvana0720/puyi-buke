// 職責：義工櫃台「查詢/顯示」性質的兩個區塊——B 到場提醒（站內警示）、G 今日登記清單
// G 區塊列的是「今天登記的」而非「今天上課的」，所以常包含未來日期的補課/調班；
// 這些項目不會出現在「今日補課/調班」卡片清單（那邊只列今天要上課的），
// 所以取消登記的按鈕要獨立掛在這裡，不能只靠上面那組卡片的取消鈕。
// 資料來源見 kiosk.js 的 RPC 包裝

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
// callbacks = {onCancelMakeup, onCancelTransfer}
function renderTodayRegistrations(regs, callbacks) {
  const { onCancelMakeup, onCancelTransfer } = callbacks || {};
  const el = document.getElementById('kiosk-today-registrations');
  if (!el) return;

  const makeups   = regs?.makeups   || [];
  const transfers = regs?.transfers || [];

  if (!makeups.length && !transfers.length) {
    el.innerHTML = '<p class="buke-empty">今日尚無新登記。</p>';
    return;
  }

  const mkHtml = makeups.map(m => {
    const canCancel = m.status === '待補課' && (m.attend_count || 0) === 0;
    return `
    <div style="font-size:14px;padding:4px 0;border-bottom:1px solid var(--line);display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap">
      <span>
        <span style="font-weight:500">${m.member_name}</span>
        <span style="color:var(--muted)">　${m.class_name}　缺課日：${m.session_date}　預約：${m.planned_date || ''} ${m.planned_slot || ''}　狀態：${m.status}</span>
      </span>
      ${canCancel ? `<button class="buke-btn buke-btn-ghost" data-cancel-reg-makeup="${m.makeup_id}" style="font-size:12px;padding:3px 10px;flex-shrink:0">取消登記</button>` : ''}
    </div>`;
  }).join('');

  const trHtml = transfers.map(t => {
    const canCancel = t.status === '已登記';
    return `
    <div style="font-size:14px;padding:4px 0;border-bottom:1px solid var(--line);display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap">
      <span>
        <span style="font-weight:500">${t.member_name}</span>
        <span style="color:var(--muted)">　${t.from_class_name} → ${t.to_class_name}　去上課日：${t.to_date}　狀態：${t.status}</span>
      </span>
      ${canCancel ? `<button class="buke-btn buke-btn-ghost" data-cancel-reg-transfer="${t.transfer_id}" style="font-size:12px;padding:3px 10px;flex-shrink:0">取消登記</button>` : ''}
    </div>`;
  }).join('');

  el.innerHTML = `
    ${makeups.length ? `<div class="buke-section" style="margin-bottom:4px">補課（${makeups.length}）</div>${mkHtml}` : ''}
    ${transfers.length ? `<div class="buke-section" style="margin:10px 0 4px">日↔夜間調班補課（${transfers.length}）</div>${trHtml}` : ''}
  `;

  el.querySelectorAll('[data-cancel-reg-makeup]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = Number(btn.dataset.cancelRegMakeup);
      if (!confirm('確定要取消這筆補課登記嗎？')) return;
      btn.disabled = true; btn.textContent = '處理中…';
      try {
        await onCancelMakeup(id);
        btn.closest('div').style.display = 'none';
      } catch (e) {
        alert(`❌ ${e.message}`);
        btn.disabled = false; btn.textContent = '取消登記';
      }
    });
  });

  el.querySelectorAll('[data-cancel-reg-transfer]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = Number(btn.dataset.cancelRegTransfer);
      if (!confirm('確定要取消這筆調班登記嗎？')) return;
      btn.disabled = true; btn.textContent = '處理中…';
      try {
        await onCancelTransfer(id);
        btn.closest('div').style.display = 'none';
      } catch (e) {
        alert(`❌ ${e.message}`);
        btn.disabled = false; btn.textContent = '取消登記';
      }
    });
  });
}

if (typeof window !== 'undefined') {
  window.KioskAlerts = { renderAttendanceAlerts, renderTodayRegistrations };
}
