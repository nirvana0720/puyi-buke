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
// callbacks = {onDepart, onComplete, onEdit, onCancelReg, lookupMember}
// onDepart/onComplete：結案逾時未結案的到場記錄；跟卡片清單共用同兩支 RPC，只認 makeup_id，
//   不挑「目前選的日期」，所以就算逾時記錄的補課日不是今天也能直接結案
// onEdit/onCancelReg/lookupMember：完全沒到場那組的「編輯」「取消登記」，跟今日補課清單共用
//   同一套 kiosk_edit_makeup／kiosk_cancel_makeup／編輯表單（見 kiosk_render.js toggleEditMakeupForm）
function renderAttendanceAlerts(alerts, callbacks) {
  const { onDepart, onComplete, onEdit, onCancelReg, lookupMember } = callbacks || {};
  const el = document.getElementById('kiosk-attendance-alerts');
  if (!el) return;

  const overdue = alerts?.overdue_attendance || [];
  const noShow  = alerts?.no_show || [];

  if (!overdue.length && !noShow.length) { el.innerHTML = ''; return; }

  const overdueHtml = overdue.length ? `
    <div class="buke-section-block care">
      <div class="buke-section">⚠️ 到場中超過 3 小時尚未結案（${overdue.length} 筆）</div>
      ${overdue.map((a, i) => `
        <div class="alert-overdue-row" data-overdue-row="${i}" style="font-size:14px;padding:6px 0;display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap">
          <span>
            <span style="font-weight:500">${a.member_name}</span>
            <span style="color:var(--muted)">　${a.class_name}　到場時間：${_fmtTime(a.attended_at)}</span>
          </span>
          <span style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
            <button class="buke-btn" data-alert-notdone="${i}"
                    style="font-size:12px;padding:4px 10px;background:var(--warn-tx);border-color:var(--warn-tx)">
              此堂課尚未補完
            </button>
            <button class="buke-btn" data-alert-complete="${i}"
                    style="font-size:12px;padding:4px 10px;background:var(--ok-tx);border-color:var(--ok-tx)">
              補課完成
            </button>
            <span class="alert-overdue-msg" data-overdue-msg="${i}" style="font-size:12px"></span>
          </span>
        </div>`).join('')}
    </div>` : '';

  const noShowHtml = noShow.length ? `
    <div class="buke-section-block care">
      <div class="buke-section">⚠️ 已登記補課但預約時段已過、完全沒有到場（${noShow.length} 筆）</div>
      ${noShow.map((a, i) => `
        <div class="alert-noshow-row" data-noshow-row="${i}" style="font-size:14px;padding:6px 0">
          <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap">
            <span>
              <span style="font-weight:500">${a.member_name}</span>
              <span style="color:var(--muted)">　${a.class_name}　預約：${a.planned_date || ''} ${a.planned_slot || ''}</span>
            </span>
            <span style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
              <button class="buke-btn buke-btn-ghost" data-noshow-edit="${i}" style="font-size:12px;padding:4px 10px">編輯</button>
              <button class="buke-btn buke-btn-ghost" data-noshow-cancel="${i}" style="font-size:12px;padding:4px 10px">取消登記</button>
              <span class="alert-noshow-msg" data-noshow-msg="${i}" style="font-size:12px"></span>
            </span>
          </div>
          <div class="mk-edit-area" id="mk-edit-noshow-${i}"></div>
        </div>`).join('')}
    </div>` : '';

  el.innerHTML = overdueHtml + noShowHtml;

  function lockRow(i) {
    const row = el.querySelector(`[data-overdue-row="${i}"]`);
    row?.querySelectorAll('button').forEach(b => b.setAttribute('disabled', 'disabled'));
  }

  el.querySelectorAll('[data-alert-notdone]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const i = Number(btn.dataset.alertNotdone);
      const msg = el.querySelector(`[data-overdue-msg="${i}"]`);
      lockRow(i);
      msg.textContent = '記錄中…'; msg.style.color = 'var(--muted)';
      try {
        await onDepart(overdue[i].makeup_id);
        msg.textContent = '✅ 已確認，尚未補完'; msg.style.color = 'var(--ok-tx)';
        setTimeout(() => { el.querySelector(`[data-overdue-row="${i}"]`)?.remove(); }, 800);
      } catch (e) {
        msg.textContent = `❌ ${e.message}`; msg.style.color = 'var(--danger-tx)';
        el.querySelectorAll(`[data-overdue-row="${i}"] button`).forEach(b => b.removeAttribute('disabled'));
      }
    });
  });

  el.querySelectorAll('[data-alert-complete]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const i = Number(btn.dataset.alertComplete);
      const msg = el.querySelector(`[data-overdue-msg="${i}"]`);
      lockRow(i);
      msg.textContent = '記錄中…'; msg.style.color = 'var(--muted)';
      try {
        await onComplete(overdue[i].makeup_id);
        msg.textContent = '✅ 補課完成'; msg.style.color = 'var(--ok-tx)';
        setTimeout(() => { el.querySelector(`[data-overdue-row="${i}"]`)?.remove(); }, 800);
      } catch (e) {
        msg.textContent = `❌ ${e.message}`; msg.style.color = 'var(--danger-tx)';
        el.querySelectorAll(`[data-overdue-row="${i}"] button`).forEach(b => b.removeAttribute('disabled'));
      }
    });
  });

  el.querySelectorAll('[data-noshow-edit]').forEach(btn => {
    btn.addEventListener('click', () => {
      const i = Number(btn.dataset.noshowEdit);
      window.KioskRender.toggleEditMakeupForm(`mk-edit-noshow-${i}`, noShow[i], async (...args) => {
        await onEdit(...args);
        const msg = el.querySelector(`[data-noshow-msg="${i}"]`);
        if (msg) { msg.textContent = '✅ 已改期，清單稍後會自動更新'; msg.style.color = 'var(--ok-tx)'; }
      }, lookupMember);
    });
  });

  el.querySelectorAll('[data-noshow-cancel]').forEach(btn => {
    btn.addEventListener('click', () => {
      const i   = Number(btn.dataset.noshowCancel);
      const row = el.querySelector(`[data-noshow-row="${i}"]`);
      window.KioskRender.kioskInlineConfirm(row, `確定要取消 ${noShow[i].member_name} 這筆補課登記嗎？`, async () => {
        await onCancelReg(noShow[i].makeup_id);
        row.remove();
      });
    });
  });
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
    el.innerHTML = '<p class="kiosk-listempty">今日尚無新登記。</p>';
    return;
  }

  const mkHtml = makeups.map(m => {
    const canCancel = m.status === '待補課' && (m.attend_count || 0) === 0;
    return `
    <div class="kiosk-listrow" style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap">
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
    <div class="kiosk-listrow" style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap">
      <span>
        <span style="font-weight:500">${t.member_name}</span>
        <span style="color:var(--muted)">　${t.from_class_name} → ${t.to_class_name}　去上課日：${t.to_date}　狀態：${t.status}</span>
      </span>
      ${canCancel ? `<button class="buke-btn buke-btn-ghost" data-cancel-reg-transfer="${t.transfer_id}" style="font-size:12px;padding:3px 10px;flex-shrink:0">取消登記</button>` : ''}
    </div>`;
  }).join('');

  el.innerHTML = `
    ${makeups.length ? `<div style="margin-top:4px;padding:8px 16px;font-size:13px;font-weight:700;background:var(--surface-alt);border-top:2px solid rgba(0,0,0,.12)">📗 補課（${makeups.length}）</div><div>${mkHtml}</div>` : ''}
    ${transfers.length ? `<div style="margin-top:14px;padding:8px 16px;font-size:13px;font-weight:700;background:var(--surface-alt);border-top:2px solid rgba(0,0,0,.12)">🔁 日↔夜間調班補課（${transfers.length}）</div><div>${trHtml}</div>` : ''}
  `;

  el.querySelectorAll('[data-cancel-reg-makeup]').forEach(btn => {
    btn.addEventListener('click', () => {
      const id  = Number(btn.dataset.cancelRegMakeup);
      const row = btn.closest('div');
      window.KioskRender.kioskInlineConfirm(row, '確定要取消這筆補課登記嗎？', async () => {
        await onCancelMakeup(id);
        row.style.display = 'none';
      });
    });
  });

  el.querySelectorAll('[data-cancel-reg-transfer]').forEach(btn => {
    btn.addEventListener('click', () => {
      const id  = Number(btn.dataset.cancelRegTransfer);
      const row = btn.closest('div');
      window.KioskRender.kioskInlineConfirm(row, '確定要取消這筆調班登記嗎？', async () => {
        await onCancelTransfer(id);
        row.style.display = 'none';
      });
    });
  });
}

if (typeof window !== 'undefined') {
  window.KioskAlerts = { renderAttendanceAlerts, renderTodayRegistrations };
}
