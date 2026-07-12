// 職責：我要調班分頁——RPC 包裝 + 渲染（畫在 #section-transfer）
// 不負責：Supabase client 初始化、補課相關 RPC

'use strict';

// ── RPC 包裝 ─────────────────────────────────────────────────────

async function fetchTransferViewViaRpc(sb, memberDbId) {
  const { data, error } = await sb.rpc('get_transfer_view', { p_member_db_id: memberDbId });
  if (error) throw new Error(`get_transfer_view 失敗：${error.message}`);
  return data || { upcoming: [], targets: [], transfers: [] };
}

async function registerTransferViaRpc(sb, memberDbId, fromSessionRef, toClassRef, toDate) {
  const { data, error } = await sb.rpc('register_transfer', {
    p_member_db_id:     memberDbId,
    p_from_session_ref: fromSessionRef,
    p_to_class_ref:     toClassRef,
    p_to_date:          toDate,
  });
  if (error) throw new Error(error.message);
  return data;
}

async function cancelTransferViaRpc(sb, memberDbId, fromSessionRef) {
  const { data, error } = await sb.rpc('cancel_transfer', {
    p_member_db_id:     memberDbId,
    p_from_session_ref: fromSessionRef,
  });
  if (error) throw new Error(error.message);
  if (data && data.ok === false) throw new Error(data.reason || '取消失敗');
  return data;
}

// ── 渲染 ─────────────────────────────────────────────────────────

/**
 * 渲染「我要調班」分頁
 * @param {{ upcoming, targets, transfers }} view - get_transfer_view 回傳
 * @param {Function} onSubmit  (fromSessionRef, toClassRef, toDate) => Promise
 * @param {Function} onCancel  (fromSessionRef) => Promise
 */
function renderTransferTab(view, onSubmit, onCancel) {
  const el = document.getElementById('section-transfer');
  if (!el) return;

  const { upcoming = [], targets = [], transfers = [] } = view;

  // ── 已登記的調班列表 ──────────────────────────────────────────
  const registeredHtml = transfers.length === 0
    ? '<p class="buke-empty" style="margin-bottom:16px">目前尚無日↔夜間調班補課登記。</p>'
    : transfers.map((t, i) => {
        const badgeCls = t.status === '已出席' ? 'pass' : t.status === '未到' ? 'danger' : 'warn';
        const badgeTxt = t.status === '已出席' ? '✅ 已出席'
                       : t.status === '未到'   ? '❌ 未到'
                                               : '⏳ 已登記';
        const canCancel = t.status === '已登記';
        const cancelSection = canCancel
          ? `<div style="margin-top:8px">
               <button data-tr-cancel-toggle="${i}"
                       style="font-size:13px;padding:4px 10px;border:1px solid var(--danger-tx);
                              color:var(--danger-tx);background:none;border-radius:var(--r-pill);cursor:pointer">
                 取消日↔夜間調班補課
               </button>
               <div id="tr-cancel-confirm-${i}" style="display:none;margin-top:8px;padding:10px 12px;
                    background:var(--bg);border:1px solid var(--danger-tx);border-radius:var(--r);font-size:14px">
                 確定要取消這筆日↔夜間調班補課嗎？
                 <div style="display:flex;gap:8px;margin-top:8px">
                   <button data-tr-cancel-ok="${i}" class="buke-btn buke-btn-danger"
                           style="font-size:13px;padding:5px 14px">確定取消</button>
                   <button data-tr-cancel-no="${i}"
                           style="font-size:13px;padding:5px 14px;border:1px solid var(--line);
                                  background:none;border-radius:var(--r-pill);cursor:pointer">不取消</button>
                 </div>
                 <span id="tr-cancel-msg-${i}" style="font-size:13px;color:var(--danger-tx);display:block;margin-top:6px"></span>
               </div>
             </div>`
          : '';
        return `<div class="buke-card ${t.status === '已出席' ? 'pass' : t.status === '未到' ? 'care' : 'warn'}"
                     style="margin-bottom:10px">
          <div class="row">
            <div>
              <span class="name">${t.from_date}</span>
              <span class="meta">→ ${t.to_class_name}</span>
            </div>
            <span class="buke-badge ${badgeCls}">${badgeTxt}</span>
          </div>
          <div class="detail">調去上課日期：${t.to_date}</div>
          ${cancelSection}
        </div>`;
      }).join('');

  // ── 登記調班表單 ──────────────────────────────────────────────
  const noUpcoming = upcoming.length === 0;
  const noTargets  = targets.length === 0;

  const upcomingOpts = upcoming.map(s =>
    `<option value="${s.session_ref}" data-week="${s.week_num}">${s.date}（第 ${s.week_num} 週）</option>`
  ).join('');

  // 目標班堂數對照表：class_ref → Map(week_num → date)
  const targetSessionMap = new Map(
    targets.map(c => [
      c.class_ref,
      new Map((c.sessions || []).map(s => [s.week_num, s.date]))
    ])
  );

  const targetOpts = targets.map(c =>
    `<option value="${c.class_ref}">${c.class_name}（${c.day_of_week} ${c.day_night}）</option>`
  ).join('');

  const formHtml = `
    <div style="font-size:15px;font-weight:500;color:var(--header);margin-bottom:12px">登記日↔夜間調班補課</div>
    ${noUpcoming
      ? '<p class="buke-empty">目前沒有可調的未來堂次。</p>'
      : noTargets
        ? '<p class="buke-empty">目前沒有同級別的其他班。</p>'
        : `<form id="transfer-form" style="display:flex;flex-direction:column;gap:12px">

            <div>
              <div style="font-size:15px;margin-bottom:6px">
                哪一堂課要日↔夜間調班補課 <span style="color:var(--danger-tx)">*</span>
              </div>
              <select name="from_session" class="buke-select" style="width:100%">
                <option value="">請選擇堂次</option>
                ${upcomingOpts}
              </select>
              <div id="tr-from-warn" style="font-size:13px;color:var(--danger-tx);display:none;margin-top:3px"></div>
            </div>

            <div>
              <div style="font-size:15px;margin-bottom:6px">
                調去哪一班 <span style="color:var(--danger-tx)">*</span>
              </div>
              <select name="to_class" class="buke-select" style="width:100%">
                <option value="">請選擇班別</option>
                ${targetOpts}
              </select>
              <div id="tr-class-warn" style="font-size:13px;color:var(--danger-tx);display:none;margin-top:3px"></div>
            </div>

            <div>
              <div style="font-size:15px;margin-bottom:6px">
                去上課日期 <span style="color:var(--danger-tx)">*</span>
              </div>
              <input type="date" name="to_date" class="buke-input" style="width:100%">
              <div id="tr-date-auto" style="font-size:13px;color:var(--muted);display:none;margin-top:3px"></div>
              <div id="tr-date-warn" style="font-size:13px;color:var(--danger-tx);display:none;margin-top:3px"></div>
            </div>

            <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
              <button type="submit" class="buke-btn">送出日↔夜間調班補課登記</button>
              <span id="tr-form-msg" style="font-size:15px"></span>
            </div>
          </form>`
    }`;

  el.innerHTML = `
    <div style="margin-bottom:20px">
      <div style="font-size:15px;font-weight:500;color:var(--header);margin-bottom:10px">我登記的日↔夜間調班補課</div>
      ${registeredHtml}
    </div>
    <div style="border-top:1px solid var(--line);padding-top:16px">
      ${formHtml}
    </div>`;

  // ── 綁定事件 ─────────────────────────────────────────────────

  // 取消 inline confirm
  el.querySelectorAll('[data-tr-cancel-toggle]').forEach(btn => {
    btn.addEventListener('click', () => {
      const i   = btn.dataset.trCancelToggle;
      const div = document.getElementById(`tr-cancel-confirm-${i}`);
      div.style.display = div.style.display === 'none' ? 'block' : 'none';
    });
  });
  el.querySelectorAll('[data-tr-cancel-no]').forEach(btn => {
    btn.addEventListener('click', () => {
      const i = btn.dataset.trCancelNo;
      document.getElementById(`tr-cancel-confirm-${i}`).style.display = 'none';
    });
  });
  el.querySelectorAll('[data-tr-cancel-ok]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const i      = btn.dataset.trCancelOk;
      const msgEl  = document.getElementById(`tr-cancel-msg-${i}`);
      const fromRef = transfers[parseInt(i, 10)]?.from_session_ref;
      if (!fromRef) return;
      btn.disabled = true;
      msgEl.textContent = '取消中…';
      try {
        await onCancel(fromRef);
      } catch (err) {
        msgEl.textContent = `❌ ${err.message}`;
        btn.disabled = false;
      }
    });
  });

  // 依堂數自動帶去上課日期
  const form = document.getElementById('transfer-form');
  if (form) {
    const fromSel   = form.querySelector('[name="from_session"]');
    const toClassSel = form.querySelector('[name="to_class"]');
    const toDateInput = form.querySelector('[name="to_date"]');
    const autoHint  = document.getElementById('tr-date-auto');

    function autoFillDate() {
      if (!fromSel || !toClassSel || !toDateInput || !autoHint) return;
      const selectedOpt = fromSel.options[fromSel.selectedIndex];
      const weekNum     = selectedOpt ? Number(selectedOpt.dataset.week) : NaN;
      const classRef    = Number(toClassSel.value);
      if (!weekNum || !classRef) { autoHint.style.display = 'none'; return; }
      const sessMap = targetSessionMap.get(classRef);
      const date    = sessMap ? sessMap.get(weekNum) : undefined;
      if (date) {
        toDateInput.value = date;
        autoHint.textContent = `已自動帶入第 ${weekNum} 週日期`;
        autoHint.style.display = 'block';
        document.getElementById('tr-date-warn').style.display = 'none';
      } else {
        toDateInput.value = '';
        autoHint.textContent = '目標班無對應堂數，請手動選日期';
        autoHint.style.display = 'block';
      }
    }

    fromSel   && fromSel.addEventListener('change', autoFillDate);
    toClassSel && toClassSel.addEventListener('change', autoFillDate);
  }

  // 登記表單送出
  if (!form) return;

  form.addEventListener('submit', async e => {
    e.preventDefault();
    const fromWarn  = document.getElementById('tr-from-warn');
    const classWarn = document.getElementById('tr-class-warn');
    const dateWarn  = document.getElementById('tr-date-warn');
    const msgEl     = document.getElementById('tr-form-msg');
    const submitBtn = form.querySelector('[type="submit"]');

    const fromVal  = form.querySelector('[name="from_session"]').value;
    const classVal = form.querySelector('[name="to_class"]').value;
    const dateVal  = form.querySelector('[name="to_date"]').value;

    let blocked = false;
    if (!fromVal) {
      fromWarn.textContent = '⚠ 請選擇哪一堂課要日↔夜間調班補課';
      fromWarn.style.display = 'block';
      blocked = true;
    } else { fromWarn.style.display = 'none'; }

    if (!classVal) {
      classWarn.textContent = '⚠ 請選擇目標班別';
      classWarn.style.display = 'block';
      blocked = true;
    } else { classWarn.style.display = 'none'; }

    if (!dateVal) {
      dateWarn.textContent = '⚠ 請選擇去上課的日期';
      dateWarn.style.display = 'block';
      blocked = true;
    } else { dateWarn.style.display = 'none'; }

    if (blocked) return;

    submitBtn.disabled = true;
    msgEl.textContent = '送出中…';
    msgEl.style.color = 'var(--muted)';

    try {
      await onSubmit(Number(fromVal), Number(classVal), dateVal);
      msgEl.textContent = '✅ 日↔夜間調班補課已登記！';
      msgEl.style.color = 'var(--ok-tx)';
      submitBtn.textContent = '已登記';
    } catch (err) {
      msgEl.textContent = `❌ ${err.message}`;
      msgEl.style.color = 'var(--danger-tx)';
      submitBtn.disabled = false;
    }
  });
}

if (typeof window !== 'undefined') {
  window.TransferLogic = { fetchTransferViewViaRpc, registerTransferViaRpc, cancelTransferViaRpc };
  window.TransferRender = { renderTransferTab };
}
