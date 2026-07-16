// 職責：逾期補課登記——後台專用，繞過補課期限檢查，需另外手動同步山上 CTIS 系統
// 表單呼叫 admin_register_late_makeup；清單只列 is_late_exception=true 的紀錄，
// 卡片複用 panel_makeup_overview.js 的 buildMakeupCard／_loadAbsencesInto，額外加「已補登CTIS」勾選欄

'use strict';

(function () {
  let _sb;
  const TODAY = new Date().toLocaleDateString('sv-SE');

  // ── 面板入口 ────────────────────────────────────────────────

  async function loadMakeupLatePanel(sb, container) {
    _sb = sb;
    renderShell(container);
    await refreshList(container);
  }

  function renderShell(container) {
    container.innerHTML = `
      <div class="buke-tabs tabs-3">
        <div class="buke-tab" data-tab="makeup">補課登記</div>
        <div class="buke-tab" data-tab="transfer">日夜補登記</div>
        <div class="buke-tab active" data-tab="late">逾期補課登記</div>
      </div>
      <div id="ml-form" style="margin-bottom:12px"></div>
      <div id="ml-count" style="font-size:13px;color:var(--muted);margin-bottom:8px"></div>
      <div id="ml-list"></div>`;

    container.querySelector('[data-tab="makeup"]').addEventListener('click', () => {
      container.innerHTML = '';
      window.PanelMakeupOverview.loadMakeupOverviewPanel(_sb, container);
    });
    container.querySelector('[data-tab="transfer"]').addEventListener('click', () => {
      container.innerHTML = '';
      window.PanelTransferOverview.loadTransferOverviewPanel(_sb, container);
    });

    // 任何清單內的按鈕／勾選操作後，稍等一下再重新整理清單，避免標完成／刪除／編輯後畫面卡在舊狀態
    container.querySelector('#ml-list').addEventListener('click', e => {
      if (e.target.closest('button, input[type=checkbox]')) {
        setTimeout(() => refreshList(container), 400);
      }
    });

    renderForm(container);
  }

  // ── 登記表單 ────────────────────────────────────────────────

  function renderForm(container) {
    const formEl = container.querySelector('#ml-form');
    formEl.innerHTML = `
      <div class="buke-card" style="margin-bottom:12px">
        <div style="font-weight:500;margin-bottom:10px">登記逾期補課</div>
        <div style="display:flex;flex-direction:column;gap:8px">
          <div style="display:flex;gap:6px">
            <input class="buke-input f-name" placeholder="學員姓名（需完整）" style="font-size:14px;flex:1">
            <button class="buke-btn btn-lookup" style="font-size:13px;padding:4px 12px">查詢</button>
          </div>
          <select class="buke-select f-class" style="font-size:14px;display:none"><option value="">請選擇班別</option></select>
          <select class="buke-select f-session" style="font-size:14px;display:none"><option value="">請選擇缺課堂次</option></select>
          <div class="f-more" style="display:none;flex-direction:column;gap:8px">
            <select class="buke-select f-method" style="font-size:14px">
              <option value="影音">影音</option>
              <option value="精舍培訓課程">精舍培訓課程</option>
            </select>
            <label style="font-size:14px;display:flex;align-items:center;gap:8px">
              <input type="checkbox" class="f-ear" style="width:18px;height:18px"> 借用耳機
            </label>
            <label style="font-size:14px">備註<input class="buke-input f-note" style="font-size:14px;margin-top:4px;width:100%"></label>
            <label style="font-size:14px">預約補課日期 <span style="color:var(--danger-tx)">*</span>
              <input type="date" class="buke-input f-pdate" style="font-size:14px;margin-top:4px;width:100%">
            </label>
            <div style="font-size:14px">預約補課時間 <span style="color:var(--danger-tx)">*</span>
              <div style="display:flex;align-items:center;gap:6px;margin-top:4px">
                <select class="buke-select f-phour" style="font-size:14px;flex:1">
                  <option value="">時</option>
                  ${Array.from({ length: 24 }, (_, h) => `<option value="${String(h).padStart(2, '0')}">${String(h).padStart(2, '0')}</option>`).join('')}
                </select>
                <span style="color:var(--muted)">:</span>
                <select class="buke-select f-pmin" style="font-size:14px;flex:1">
                  <option value="">分</option>
                  ${Array.from({ length: 12 }, (_, m) => `<option value="${String(m * 5).padStart(2, '0')}">${String(m * 5).padStart(2, '0')}</option>`).join('')}
                </select>
              </div>
            </div>
            <div style="display:flex;gap:8px">
              <button class="buke-btn btn-submit" style="font-size:13px;padding:4px 14px;min-height:30px">送出登記</button>
              <button class="buke-btn buke-btn-ghost btn-cancel" style="font-size:13px;padding:4px 14px;min-height:30px">取消</button>
            </div>
            <div class="form-msg" style="font-size:13px"></div>
          </div>
        </div>
      </div>`;

    let _members = [];

    formEl.querySelector('.btn-lookup').addEventListener('click', async () => {
      const name = formEl.querySelector('.f-name').value.trim();
      if (!name) return;
      const { data } = await _sb.from('members').select('id,class_ref,classes(class_name)').ilike('name', name).eq('status', '在學');
      _members = data || [];
      const clsSel = formEl.querySelector('.f-class');
      clsSel.innerHTML = '<option value="">請選擇班別</option>' +
        _members.map((m, i) => `<option value="${i}">${m.classes?.class_name || '—'}</option>`).join('');
      clsSel.style.display = 'block';
      formEl.querySelector('.f-session').style.display = 'none';
      formEl.querySelector('.f-more').style.display = 'none';
    });

    formEl.querySelector('.f-class').addEventListener('change', async () => {
      const mem = _members[Number(formEl.querySelector('.f-class').value)];
      if (!mem) return;
      await window.PanelMakeupOverview._loadAbsencesInto(mem.id, formEl.querySelector('.f-session'), 0);
      formEl.querySelector('.f-more').style.display = 'flex';
    });

    formEl.querySelector('.btn-cancel').addEventListener('click', () => renderForm(container));

    formEl.querySelector('.btn-submit').addEventListener('click', async () => {
      const msgEl = formEl.querySelector('.form-msg');
      const mem = _members[Number(formEl.querySelector('.f-class').value)];
      const sessRef = formEl.querySelector('.f-session').value;
      if (!mem || !sessRef) { msgEl.textContent = '請選擇班別與缺課堂次'; return; }
      const pdate = formEl.querySelector('.f-pdate').value;
      const ph    = formEl.querySelector('.f-phour').value;
      const pm    = formEl.querySelector('.f-pmin').value;
      const pslot = (ph && pm) ? `${ph}:${pm}` : null;
      if (!pdate || !pslot) { msgEl.textContent = '請填入預約補課日期與時間'; return; }
      const { error } = await _sb.rpc('admin_register_late_makeup', {
        p_member_db_id: mem.id,
        p_session_ref:  Number(sessRef),
        p_method:       formEl.querySelector('.f-method').value,
        p_earphone:     formEl.querySelector('.f-ear').checked,
        p_note:         formEl.querySelector('.f-note').value.trim() || null,
        p_planned_date: pdate,
        p_planned_slot: pslot,
      });
      if (error) { msgEl.textContent = `❌ ${error.message}`; return; }
      renderForm(container);
      await refreshList(container);
    });
  }

  // ── 清單（is_late_exception = true） ──────────────────────────

  async function refreshList(container) {
    const listEl  = container.querySelector('#ml-list');
    const countEl = container.querySelector('#ml-count');
    if (!listEl) return;
    listEl.innerHTML = '<p class="buke-empty">載入中…</p>';

    const { data, error } = await _sb.from('makeups').select(
      'id,member_ref,session_ref,earphone,note,status,registered_by,planned_date,planned_slot,deadline_date,completed_date,ctis_synced,is_late_exception,' +
      'members!member_ref(name,group_id,class_ref,classes(class_name)),' +
      'sessions!session_ref(date)'
    ).eq('is_late_exception', true).order('created_at', { ascending: false });
    if (error) { listEl.innerHTML = `<div class="buke-msg err">❌ ${error.message}</div>`; return; }

    const rows = data || [];
    const muIds = rows.map(r => r.id);
    let attMap = new Map(), allAttMap = new Map();
    if (muIds.length) {
      const { data: attRows } = await _sb.from('makeup_attendances')
        .select('makeup_ref,attended_at,departed_at,late_mark,machine_number')
        .in('makeup_ref', muIds)
        .order('attended_at', { ascending: false });
      (attRows || []).forEach(a => {
        if (!attMap.has(a.makeup_ref)) attMap.set(a.makeup_ref, a);
        const arr = allAttMap.get(a.makeup_ref) || [];
        arr.unshift(a);
        allAttMap.set(a.makeup_ref, arr);
      });
    }

    const list = rows.map(r => ({
      ...r,
      _name:         r.members?.name                || '—',
      _group:        r.members?.group_id            || '',
      _class_name:   r.members?.classes?.class_name || '—',
      _class_ref:    r.members?.class_ref            || '',
      _date:         r.sessions?.date               || '',
      _overdue:      r.status === '待補課' && r.deadline_date < TODAY,
      _attend_count: (allAttMap.get(r.id) || []).length,
      _att_records:  allAttMap.get(r.id) || [],
    }));

    if (countEl) countEl.textContent = `逾期補課登記 ${list.length} 筆`;
    listEl.innerHTML = '';
    if (!list.length) { listEl.innerHTML = '<p class="buke-empty">目前沒有逾期補課登記紀錄。</p>'; return; }
    list.forEach(r => listEl.appendChild(buildLateCard(r, container)));
  }

  /** 複用 buildMakeupCard 的樣式與操作按鈕，額外加一個「已補登CTIS」勾選欄 */
  function buildLateCard(r, container) {
    const card = window.PanelMakeupOverview.buildMakeupCard(r, container);
    const actionRow = card.querySelector('.action-row');
    if (actionRow) {
      const label = document.createElement('label');
      label.style.cssText = 'display:flex;align-items:center;gap:6px;font-size:13px;margin-left:auto';
      label.innerHTML = `<input type="checkbox" class="f-ctis" ${r.ctis_synced ? 'checked' : ''} style="width:16px;height:16px"> 已補登CTIS`;
      actionRow.appendChild(label);
      label.querySelector('.f-ctis').addEventListener('change', async e => {
        const checked = e.target.checked;
        const { error } = await _sb.from('makeups').update({ ctis_synced: checked }).eq('id', r.id);
        if (error) { e.target.checked = !checked; alert(`❌ ${error.message}`); }
      });
    }
    return card;
  }

  window.PanelMakeupLate = { loadMakeupLatePanel };
})();
