// 職責：學長/班長代登記表單（代補課登記/取消、代調班）
// 供 render.js 掛按鈕事件；呼叫 Supabase RPC 時帶 p_acting_leader_db_id
'use strict';

/** 代補課表單欄位＋送出按鈕的 body HTML（不含選堂次，那段由呼叫端視情況接在前面） */
function buildProxyMakeupFieldsHtml() {
  return `
    <label style="display:block;margin-bottom:12px;font-size:16px">補課方式
      <select name="method" class="buke-select" style="display:block;width:100%;margin-top:4px">
        <option value="影音">影音</option>
        <option value="精舍培訓課程">精舍培訓課程</option>
      </select>
    </label>
    <label style="display:block;margin-bottom:12px;font-size:16px">預定補課日期
      <input type="date" name="planned_date" required class="buke-input" style="display:block;width:100%;margin-top:4px">
    </label>
    <div style="display:flex;gap:10px;margin-bottom:12px">
      <label style="flex:1;font-size:16px">時
        <input type="number" name="hour" min="0" max="23" placeholder="時" class="buke-input" style="display:block;width:100%;margin-top:4px">
      </label>
      <label style="flex:1;font-size:16px">分
        <input type="number" name="minute" min="0" max="59" value="0" class="buke-input" style="display:block;width:100%;margin-top:4px">
      </label>
    </div>
    <label style="display:block;margin-bottom:16px;font-size:16px">
      <input type="checkbox" name="earphone"> 借用耳機
    </label>
    <div class="proxy-msg" style="margin-bottom:10px;font-size:16px;color:var(--danger)"></div>
    <div style="display:flex;gap:10px">
      <button type="button" class="buke-btn proxy-submit">送出代登記</button>
      <button type="button" class="buke-btn-ghost proxy-cancel">取消</button>
    </div>
  `;
}

/**
 * 開啟「代為登記補課」彈窗（bottom sheet）
 * @param {HTMLElement} formEl       相容既有呼叫保留，內部不再使用
 * @param {object}      sb           Supabase client
 * @param {number}      memberDbId   目標學員的 members.id
 * @param {number}      sessionRef   預填的缺課堂次 id
 * @param {number}      leaderDbId   登入者（學長/班長）的 members.id
 * @param {Function}    onDone       成功後回呼
 */
function renderProxyMakeupForm(formEl, sb, memberDbId, sessionRef, leaderDbId, onDone) {
  const sheet = window.LeaderModal.openSheet({
    title: '代為登記補課',
    bodyHtml: buildProxyMakeupFieldsHtml(),
    onMount(panelEl) {
      const msgEl = panelEl.querySelector('.proxy-msg');

      panelEl.querySelector('.proxy-cancel').addEventListener('click', () => sheet.close());

      panelEl.querySelector('.proxy-submit').addEventListener('click', async () => {
        const method      = panelEl.querySelector('[name=method]').value;
        const plannedDate = panelEl.querySelector('[name=planned_date]').value;
        const hour        = String(panelEl.querySelector('[name=hour]').value || '0').padStart(2, '0');
        const minute      = String(panelEl.querySelector('[name=minute]').value || '0').padStart(2, '0');
        const earphone    = panelEl.querySelector('[name=earphone]').checked;

        if (!plannedDate) { msgEl.textContent = '請填入預定日期。'; return; }

        const plannedSlot = `${hour}:${minute}`;
        msgEl.style.color = 'var(--muted)';
        msgEl.textContent = '送出中…';

        try {
          const { error } = await sb.rpc('register_makeup', {
            p_member_db_id:        memberDbId,
            p_session_ref:         sessionRef,
            p_method:              method,
            p_earphone:            earphone,
            p_planned_date:        plannedDate,
            p_planned_slot:        plannedSlot,
            p_acting_leader_db_id: leaderDbId,
          });
          if (error) throw new Error(error.message);
          msgEl.style.color = 'var(--ok)';
          msgEl.textContent = '✓ 已登記';
          onDone && onDone();
          sheet.close();
        } catch (e) {
          msgEl.style.color = 'var(--danger)';
          msgEl.textContent = `❌ ${e.message}`;
        }
      });
    },
  });

  return sheet;
}

/**
 * 開啟「代為登記補課」彈窗，若學員有多筆未登記缺課堂次，先在彈窗最上方讓學長選一堂
 * （只有 1 筆時直接開表單，不用多選一次）
 * @param {HTMLElement} formEl     相容既有呼叫保留，內部不再使用
 * @param {object}      sb
 * @param {object}      row        StudentRow（含 unregistered_absences）
 * @param {number}      leaderDbId
 */
function renderProxyMakeupPicker(formEl, sb, row, leaderDbId) {
  const absences = row.unregistered_absences || [];
  if (!absences.length) return;

  if (absences.length === 1) {
    renderProxyMakeupForm(formEl, sb, row.id, absences[0].session_ref, leaderDbId, null);
    return;
  }

  const opts = absences.map(a =>
    `<option value="${a.session_ref}">${a.session_date}（${a.mark}）</option>`
  ).join('');

  const bodyHtml = `
    <label style="display:block;margin-bottom:14px;font-size:16px">選擇缺課堂次
      <select name="pick_session" class="buke-select" style="display:block;width:100%;margin-top:4px">${opts}</select>
    </label>
    ${buildProxyMakeupFieldsHtml()}
  `;

  let sessionRef = parseInt(absences[0].session_ref, 10);

  const sheet = window.LeaderModal.openSheet({
    title: '代為登記補課',
    bodyHtml,
    onMount(panelEl) {
      const msgEl = panelEl.querySelector('.proxy-msg');

      panelEl.querySelector('[name=pick_session]').addEventListener('change', (e) => {
        sessionRef = parseInt(e.target.value, 10);
      });

      panelEl.querySelector('.proxy-cancel').addEventListener('click', () => sheet.close());

      panelEl.querySelector('.proxy-submit').addEventListener('click', async () => {
        const method      = panelEl.querySelector('[name=method]').value;
        const plannedDate = panelEl.querySelector('[name=planned_date]').value;
        const hour        = String(panelEl.querySelector('[name=hour]').value || '0').padStart(2, '0');
        const minute      = String(panelEl.querySelector('[name=minute]').value || '0').padStart(2, '0');
        const earphone    = panelEl.querySelector('[name=earphone]').checked;

        if (!plannedDate) { msgEl.textContent = '請填入預定日期。'; return; }

        const plannedSlot = `${hour}:${minute}`;
        msgEl.style.color = 'var(--muted)';
        msgEl.textContent = '送出中…';

        try {
          const { error } = await sb.rpc('register_makeup', {
            p_member_db_id:        row.id,
            p_session_ref:         sessionRef,
            p_method:              method,
            p_earphone:            earphone,
            p_planned_date:        plannedDate,
            p_planned_slot:        plannedSlot,
            p_acting_leader_db_id: leaderDbId,
          });
          if (error) throw new Error(error.message);
          msgEl.style.color = 'var(--ok)';
          msgEl.textContent = '✓ 已登記';
          sheet.close();
        } catch (e) {
          msgEl.style.color = 'var(--danger)';
          msgEl.textContent = `❌ ${e.message}`;
        }
      });
    },
  });

  return sheet;
}

/**
 * 代取消補課
 */
async function actingCancelMakeup(sessionRef, targetMemberDbId, leaderDbId, sb) {
  const { error } = await sb.rpc('cancel_makeup', {
    p_member_db_id:        targetMemberDbId,
    p_session_ref:         sessionRef,
    p_acting_leader_db_id: leaderDbId,
  });
  if (error) throw new Error(error.message);
}

/**
 * 在 formEl 內插入代調班表單
 */
async function renderProxyTransferForm(formEl, sb, row, leaderDbId, onDone) {
  formEl.innerHTML = '<span style="font-size:0.9em">載入日↔夜間調班補課資料中…</span>';

  let tview;
  try {
    const { data, error } = await sb.rpc('get_transfer_view', { p_member_db_id: row.id });
    if (error) throw new Error(error.message);
    tview = data;
  } catch (e) {
    formEl.innerHTML = `<span style="color:var(--danger)">❌ ${e.message}</span>`;
    return;
  }

  const upcoming = (tview && tview.upcoming) || [];
  const targets  = (tview && tview.targets)  || [];

  if (!upcoming.length) {
    formEl.innerHTML = '<span style="font-size:0.9em;color:var(--muted)">此學員無未上堂次可調。</span>';
    return;
  }

  const fromOpts = upcoming.map(s =>
    `<option value="${s.session_ref}" data-week="${s.week_num}">${s.date}（第${s.week_num}堂）</option>`
  ).join('');
  const toOpts = targets.map(c =>
    `<option value="${c.class_ref}">${c.class_name}（${c.day_of_week}${c.day_night}）</option>`
  ).join('');

  // 目標班堂數對照表：class_ref → Map(week_num → date)，日期只能從該班實際堂次挑，不開放亂填
  const targetSessionMap = new Map(
    targets.map(c => [
      c.class_ref,
      new Map((c.sessions || []).map(s => [s.week_num, s.date]))
    ])
  );

  formEl.innerHTML = `
    <div style="padding:6px 0">
      <label style="display:block;margin-bottom:6px">要調的課
        <select name="from_session" style="margin-left:8px">${fromOpts}</select>
      </label>
      <label style="display:block;margin-bottom:6px">調去的班別
        <select name="to_class" style="margin-left:8px">${toOpts}</select>
      </label>
      <label style="display:block;margin-bottom:8px">去上課日期
        <select name="to_date" style="margin-left:8px"></select>
      </label>
      <button type="button" class="buke-btn primary proxy-tfr-submit" style="background:#1B4332">送出代日↔夜間調班補課</button>
      <span class="proxy-tfr-msg" style="margin-left:8px;font-size:0.9em;color:var(--danger)"></span>
    </div>
  `;

  const fromSel   = formEl.querySelector('[name=from_session]');
  const toClassSel = formEl.querySelector('[name=to_class]');
  const toDateSel  = formEl.querySelector('[name=to_date]');

  // 依「調去的班別」重新列出該班所有堂次日期；若跟原堂次週數對得上，預選那一堂
  function refillDateOptions() {
    const classRef = Number(toClassSel.value);
    const sessMap  = targetSessionMap.get(classRef);
    if (!sessMap || !sessMap.size) {
      toDateSel.innerHTML = '<option value="">目標班無可調堂次</option>';
      return;
    }
    const weekNum = Number(fromSel.options[fromSel.selectedIndex]?.dataset.week);
    toDateSel.innerHTML = [...sessMap.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([wk, date]) =>
        `<option value="${date}"${wk === weekNum ? ' selected' : ''}>${date}（第${wk}堂）</option>`
      ).join('');
  }
  refillDateOptions();
  fromSel.addEventListener('change', refillDateOptions);
  toClassSel.addEventListener('change', refillDateOptions);

  formEl.querySelector('.proxy-tfr-submit').addEventListener('click', async () => {
    const fromSession = parseInt(fromSel.value, 10);
    const toClass     = parseInt(toClassSel.value, 10);
    const toDate      = toDateSel.value;
    const msgEl       = formEl.querySelector('.proxy-tfr-msg');

    if (!toDate) { msgEl.textContent = '請選擇日↔夜間調班補課日期。'; return; }
    msgEl.textContent = '送出中…';

    try {
      const { error } = await sb.rpc('register_transfer', {
        p_member_db_id:        row.id,
        p_from_session_ref:    fromSession,
        p_to_class_ref:        toClass,
        p_to_date:             toDate,
        p_acting_leader_db_id: leaderDbId,
      });
      if (error) throw new Error(error.message);
      msgEl.style.color = 'var(--ok)';
      msgEl.textContent = '✓ 已登記';
      onDone && onDone();
    } catch (e) {
      msgEl.style.color = 'var(--danger)';
      msgEl.textContent = `❌ ${e.message}`;
    }
  });
}

if (typeof window !== 'undefined') {
  window.LeaderActions = {
    renderProxyMakeupForm,
    renderProxyMakeupPicker,
    actingCancelMakeup,
    renderProxyTransferForm,
  };
}
if (typeof module !== 'undefined') {
  module.exports = {
    renderProxyMakeupForm,
    renderProxyMakeupPicker,
    actingCancelMakeup,
    renderProxyTransferForm,
  };
}
