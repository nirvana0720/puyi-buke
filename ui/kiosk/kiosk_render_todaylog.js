// 職責：義工櫃台頁——「今日到場紀錄」表格渲染（含每列「撤銷這筆」按鈕）
// 2026-11-25 從 kiosk_render.js 拆出（該檔已近 1000 行），並新增撤銷這筆功能
// 不負責：RPC 呼叫、撤銷後的重新載入（由 kiosk.js 的 onUndo callback 負責）
// 依賴：kiosk_render.js 先載入（使用 window.KioskRender.kioskInlineConfirm，並把 renderTodayLog 掛回 window.KioskRender）

'use strict';

function _ktlEsc(v) {
  return String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// callbacks = {onUndo(attendanceId)}
// 只有影片補課的列有 attendance_id；培訓補課列沒有，不顯示撤銷按鈕（培訓補課有自己的取消到場流程）
function renderTodayLog(records, callbacks) {
  const el = document.getElementById('kiosk-today-log');
  if (!el) return;
  const { onUndo } = callbacks || {};
  if (!records || !records.length) {
    el.innerHTML = '<p class="kiosk-listempty">今日尚無補課到場記錄。</p>';
    return;
  }
  function durStr(a, d) {
    if (!a || !d) return '—';
    const m = Math.round((new Date(d) - new Date(a)) / 60000);
    return m < 60 ? `${m} 分` : `${Math.floor(m/60)}h${m%60 ? ` ${m%60}m` : ''}`;
  }
  function timeStr(ts) {
    if (!ts) return '—';
    return new Date(ts).toLocaleTimeString('zh-TW',{hour12:false,hour:'2-digit',minute:'2-digit'});
  }
  el.innerHTML = `<table style="width:100%;font-size:13px;border-collapse:collapse">
    <thead><tr style="background:var(--surface-alt);color:var(--muted);text-align:left">
      <th style="padding:8px">姓名</th><th style="padding:8px">班別</th>
      <th style="padding:8px">缺課日</th><th style="padding:8px">到場</th>
      <th style="padding:8px">離場</th><th style="padding:8px">時長</th>
      <th style="padding:8px">機台</th>
      <th style="padding:8px">狀態</th>
      <th style="padding:8px"></th>
    </tr></thead>
    <tbody>
      ${records.map((r, i) => `<tr style="border-top:1px solid var(--line);${i % 2 ? 'background:var(--surface-alt)' : ''}">
        <td style="padding:8px;font-weight:500">${_ktlEsc(r.member_name)}</td>
        <td style="padding:8px;color:var(--muted)">${_ktlEsc(r.class_name)}</td>
        <td style="padding:8px;color:var(--muted)">${_ktlEsc(r.session_date)}</td>
        <td style="padding:8px">${timeStr(r.attended_at)}</td>
        <td style="padding:8px">${timeStr(r.departed_at)}</td>
        <td style="padding:8px">${durStr(r.attended_at, r.departed_at)}</td>
        <td style="padding:8px;color:var(--muted)">${r.machine_number ? `🖥️${_ktlEsc(r.machine_number)}號機` : '—'}</td>
        <td style="padding:8px;color:${r.status==='已完成'?'var(--ok-tx)':'var(--warn-tx)'}">${r.status==='已完成'?'✅ 補完':'⏳ 尚未補完'}</td>
        <td style="padding:8px">${r.attendance_id != null && onUndo
          ? `<button class="buke-btn buke-btn-ghost ktl-undo" data-idx="${i}" style="font-size:12px;padding:3px 10px;min-height:28px;white-space:nowrap">撤銷這筆</button>`
          : ''}</td>
      </tr>
      <tr class="ktl-confirm-row" data-idx="${i}" style="display:none"><td colspan="9" style="padding:0 8px 8px"></td></tr>`).join('')}
    </tbody>
  </table>`;

  el.querySelectorAll('.ktl-undo').forEach(btn => {
    btn.addEventListener('click', () => {
      const r = records[Number(btn.dataset.idx)];
      const confirmRow = el.querySelector(`.ktl-confirm-row[data-idx="${btn.dataset.idx}"]`);
      confirmRow.style.display = '';
      const cell = confirmRow.querySelector('td');
      window.KioskRender.kioskInlineConfirm(cell,
        `確定要撤銷 ${_ktlEsc(r.member_name)}（缺課日 ${_ktlEsc(r.session_date)}）這筆到場紀錄嗎？<br>` +
        '會刪除這筆到場紀錄；若這堂補課已標完成（且這筆是最後一次到場），會一併改回待補課、出缺勤還原。',
        async () => { await onUndo(r.attendance_id); });
      // 按「取消」時把確認列收起來
      const cancel = cell.querySelector('.ic-cancel');
      if (cancel) cancel.addEventListener('click', () => { confirmRow.style.display = 'none'; });
    });
  });
}

if (typeof window !== 'undefined') {
  window.KioskRender = Object.assign(window.KioskRender || {}, { renderTodayLog });
}
