// 職責：補課登記——管理員跨班督看、標完成、編輯、刪除、補登（只處理 makeups）
// 「日夜補登記」（原調課）重構41 拆分搬到 panel_transfer_overview.js
// inline confirm；不用瀏覽器 confirm；authenticated .from() / .rpc()

'use strict';

(function () {
  let _sb, _makeups = [], _filterClass = '', _filterStatus = 'all', _searchName = '';
  const TODAY = new Date().toLocaleDateString('sv-SE');

  // ── 資料讀取 ────────────────────────────────────────────────

  async function fetchMakeups() {
    const { data, error } = await _sb.from('makeups').select(
      'id,member_ref,session_ref,earphone,note,status,registered_by,planned_date,planned_slot,deadline_date,completed_date,' +
      'members!member_ref(name,group_id,class_ref,classes(class_name)),' +
      'sessions!session_ref(date)'
    ).order('created_at', { ascending: false });
    if (error) throw new Error(`補課：${error.message}`);

    const muIds = (data || []).map(r => r.id);
    let attMap    = new Map(); // makeup_ref → 最新一筆（DESC 第一筆）
    let allAttMap = new Map(); // makeup_ref → 所有紀錄[]，由舊到新
    if (muIds.length) {
      const { data: attRows, error: attErr } = await _sb.from('makeup_attendances')
        .select('id,makeup_ref,attended_at,departed_at,late_mark,machine_number')
        .in('makeup_ref', muIds)
        .order('attended_at', { ascending: false });
      if (attErr) throw new Error(`補課出席紀錄：${attErr.message}`);
      (attRows || []).forEach(a => {
        if (!attMap.has(a.makeup_ref)) attMap.set(a.makeup_ref, a);
        const arr = allAttMap.get(a.makeup_ref) || [];
        arr.unshift(a); // unshift 讓最終 arr 由舊到新（ASC）
        allAttMap.set(a.makeup_ref, arr);
      });
    }

    _makeups = (data || []).map(r => ({
      ...r,
      _name:          r.members?.name                || '—',
      _group:         r.members?.group_id            || '',
      _class_name:    r.members?.classes?.class_name || '—',
      _class_ref:     r.members?.class_ref           || '',
      _date:          r.sessions?.date               || '',
      _overdue:       r.status === '待補課' && r.deadline_date < TODAY,
      _attended_at:   attMap.get(r.id)?.attended_at  || null,
      _late_mark:     attMap.get(r.id)?.late_mark     || null,
      _attend_count:  (allAttMap.get(r.id) || []).length,
      _att_records:   allAttMap.get(r.id) || [],
    }));
  }

  // ── RPC / 資料操作 ──────────────────────────────────────────

  const completeMakeup   = id => _sb.rpc('complete_makeup',   { p_makeup_id: id });
  const uncompleteMakeup = id => _sb.rpc('uncomplete_makeup', { p_makeup_id: id });
  const deleteMakeup     = id => _sb.from('makeups').delete().eq('id', id);
  const updateMakeup     = (id, f) => _sb.from('makeups').update(f).eq('id', id);
  const cancelAttendRecord = id => _sb.rpc('admin_makeup_cancel_attend', { p_attendance_id: id });

  // ── 面板入口 ────────────────────────────────────────────────

  async function loadMakeupOverviewPanel(sb, container) {
    _sb = sb;
    container.innerHTML = '<p class="buke-empty">載入中…</p>';
    try {
      await fetchMakeups();
      renderShell(container);
      applyAndRender(container);
    } catch (e) {
      container.innerHTML = `<div class="buke-msg err">❌ ${e.message}</div>`;
    }
  }

  function renderShell(container) {
    const classNames = [...new Set(_makeups.map(r => r._class_name).filter(Boolean))].sort();
    const classOpts  = classNames.map(n => `<option>${n}</option>`).join('');
    container.innerHTML = `
      <div class="buke-tabs tabs-3">
        <div class="buke-tab active" data-tab="makeup">補課登記</div>
        <div class="buke-tab" data-tab="transfer">日夜補登記</div>
        <div class="buke-tab" data-tab="late">逾期補課登記</div>
      </div>
      <div class="no-print" style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px;align-items:center">
        <input id="mo-search" class="buke-input" placeholder="搜尋姓名" style="font-size:14px;min-height:36px;flex:1;min-width:120px">
        <select id="mo-class" class="buke-select" style="font-size:14px;min-height:36px"><option value="">全部班別</option>${classOpts}</select>
        <select id="mo-status" class="buke-select" style="font-size:14px;min-height:36px"><option value="all">全部狀態</option><option value="pending">待補課</option><option value="done">已完成</option><option value="overdue">逾期</option></select>
        <button id="mo-refresh" class="buke-btn buke-btn-ghost" style="font-size:14px;padding:6px 14px;min-height:36px">🔄 重新整理</button>
        <button id="mo-add-makeup" class="buke-btn buke-btn-ghost" style="font-size:14px;padding:6px 14px;min-height:36px">＋ 補登補課</button>
        <button id="mo-print" class="buke-btn buke-btn-ghost" style="font-size:14px;padding:6px 14px;min-height:36px">🖶 列印</button>
      </div>
      <div id="mo-add-form" style="margin-bottom:12px"></div>
      <div id="mo-urgent" style="margin-bottom:14px"></div>
      <div id="mo-count" style="font-size:13px;color:var(--muted);margin-bottom:8px"></div>
      <div id="mo-list"></div>`;

    container.querySelector('[data-tab="transfer"]').addEventListener('click', () => {
      container.innerHTML = '';
      window.PanelTransferOverview.loadTransferOverviewPanel(_sb, container);
    });
    container.querySelector('[data-tab="late"]').addEventListener('click', () => {
      container.innerHTML = '';
      window.PanelMakeupLate.loadMakeupLatePanel(_sb, container);
    });
    container.querySelector('#mo-search').addEventListener('input', e => { _searchName = e.target.value.trim(); applyAndRender(container); });
    container.querySelector('#mo-class').addEventListener('change',  e => { _filterClass  = e.target.value; applyAndRender(container); });
    container.querySelector('#mo-status').addEventListener('change', e => { _filterStatus = e.target.value; applyAndRender(container); });
    container.querySelector('#mo-refresh').addEventListener('click', async () => {
      container.querySelector('#mo-list').innerHTML = '<p class="buke-empty">載入中…</p>';
      await fetchMakeups(); applyAndRender(container);
    });
    container.querySelector('#mo-add-makeup').addEventListener('click', () => showAddMakeupForm(container));
    container.querySelector('#mo-print').addEventListener('click', () => window.print());
  }

  /** ⏰ 即將逾期／已逾期補課摘要（跨班，比照學長/班長看板 urgentMakeups 邏輯：
   *  已逾期 或 剩餘天數 ≤14 天的「待補課」登記，尊重目前的班別篩選但不受狀態篩選影響） */
  function renderUrgentSummary(container) {
    const el = container.querySelector('#mo-urgent');
    if (!el) return;
    const today = new Date(); today.setHours(0, 0, 0, 0);

    const urgent = _makeups
      .filter(r => r.status === '待補課')
      .filter(r => !_filterClass || r._class_name === _filterClass)
      .map(r => {
        const dl = r.deadline_date ? new Date(r.deadline_date) : null;
        const daysLeft = dl ? Math.ceil((dl - today) / 86400000) : null;
        return { r, daysLeft };
      })
      .filter(({ r, daysLeft }) => r._overdue || (daysLeft !== null && daysLeft <= 14))
      .sort((a, b) => (a.r._overdue ? -1 : 1) - (b.r._overdue ? -1 : 1)
        || (a.r.deadline_date || '').localeCompare(b.r.deadline_date || ''));

    if (!urgent.length) {
      el.innerHTML = '';
      return;
    }

    const overdueCount = urgent.filter(({ r }) => r._overdue).length;
    const soonCount    = urgent.length - overdueCount;

    el.innerHTML = `
      <details ${overdueCount ? 'open' : ''} style="border:1px solid var(--warn-line);border-radius:var(--r-md);background:var(--warn-bg);padding:2px 12px">
        <summary style="cursor:pointer;padding:8px 0;font-weight:500;color:var(--warn-tx)">
          ⏰ 即將逾期／已逾期補課（已逾期 ${overdueCount} 筆　14 天內到期 ${soonCount} 筆）
        </summary>
        <table style="width:100%;border-collapse:collapse;font-size:0.9em;margin:6px 0 10px">
          <thead><tr style="background:var(--surface-alt)">
            <th style="padding:5px 8px;text-align:left">姓名</th>
            <th style="padding:5px 8px;text-align:left">班別</th>
            <th style="padding:5px 8px;text-align:left">缺課日</th>
            <th style="padding:5px 8px;text-align:left">補課期限</th>
            <th style="padding:5px 8px;text-align:left">狀態</th>
          </tr></thead>
          <tbody>
            ${urgent.map(({ r, daysLeft }) => `
              <tr>
                <td style="padding:5px 8px">${r._name}</td>
                <td style="padding:5px 8px">${r._class_name}　${r._group}</td>
                <td style="padding:5px 8px">${r._date}</td>
                <td style="padding:5px 8px">${r.deadline_date}</td>
                <td style="padding:5px 8px;color:${r._overdue ? 'var(--danger-tx)' : 'var(--warn-tx)'}">
                  ${r._overdue ? '已逾期' : `剩 ${daysLeft} 天`}
                </td>
              </tr>`).join('')}
          </tbody>
        </table>
      </details>`;
  }

  function applyAndRender(container) {
    const listEl = container.querySelector('#mo-list');
    const countEl = container.querySelector('#mo-count');
    if (!listEl) return;

    renderUrgentSummary(container);

    let muFiltered = _makeups.filter(r => {
      if (_filterClass && r._class_name !== _filterClass) return false;
      if (_filterStatus === 'pending') return r.status === '待補課' && !r._overdue;
      if (_filterStatus === 'done')    return r.status === '已完成';
      if (_filterStatus === 'overdue') return r._overdue;
      return true;
    });
    if (_searchName) {
      const q = _searchName.toLowerCase();
      muFiltered = muFiltered.filter(r => (r._name || '').toLowerCase().includes(q));
    }

    if (countEl) countEl.textContent = `補課 ${muFiltered.length} 筆`;

    listEl.innerHTML = '';
    if (!muFiltered.length) {
      listEl.innerHTML = '<p class="buke-empty">沒有符合的紀錄。</p>'; return;
    }
    renderGroupedByClass(listEl, muFiltered, buildMakeupCard, container);
  }

  /** 依班別分組摺疊（<details> 預設展開），組內維持既有卡片渲染方式不變。
   *  匯出供 panel_transfer_overview.js 共用，不要複製貼上一份一樣的邏輯 */
  function renderGroupedByClass(listEl, rows, buildCardFn, container) {
    const groups = new Map();
    rows.forEach(r => {
      const key = r._class_name || '—';
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(r);
    });
    [...groups.keys()].sort().forEach(className => {
      const list = groups.get(className);
      const details = document.createElement('details');
      details.open = true;
      details.style.marginBottom = '10px';
      const summary = document.createElement('summary');
      summary.style.cssText = 'cursor:pointer;font-weight:500;padding:6px 0';
      summary.textContent = `${className}（${list.length} 筆）`;
      details.appendChild(summary);
      list.forEach(r => details.appendChild(buildCardFn(r, container)));
      listEl.appendChild(details);
    });
  }

  // ── 共用：載入該生缺堂到 select ────────────────────────────────
  async function _loadAbsencesInto(memberRef, sesSel, curRef) {
    const { data } = await _sb.from('attendance')
      .select('session_ref,sessions!inner(date,week_num)').eq('member_ref', memberRef).in('mark',['O','A','LL']);
    sesSel.innerHTML = '<option value="">請選擇</option>' + (data||[]).map(a =>
      `<option value="${a.session_ref}"${a.session_ref===curRef?' selected':''}>${a.sessions?.date}</option>`
    ).join('');
    sesSel.style.display = 'block';
  }

  // ── inline confirm helper（匯出供 panel_transfer_overview.js 共用） ──────

  function inlineConfirm(card, msg, onOk) {
    let area = card.querySelector('.ic-area');
    if (!area) {
      area = document.createElement('div');
      area.className = 'ic-area';
      area.style.cssText = 'margin-top:10px;padding:10px;background:var(--surface);border:1px solid var(--line);border-radius:var(--r-md)';
      card.appendChild(area);
    }
    area.innerHTML = `<p style="font-size:14px;margin-bottom:8px">${msg}</p>
      <div style="display:flex;gap:8px"><button class="buke-btn ic-ok" style="font-size:13px;padding:4px 12px;min-height:30px">確定</button>
      <button class="buke-btn buke-btn-ghost ic-cancel" style="font-size:13px;padding:4px 12px;min-height:30px">取消</button></div>
      <div class="ic-result" style="font-size:13px;margin-top:6px"></div>`;
    area.querySelector('.ic-ok').onclick = async () => {
      try { await onOk(); } catch (e) { area.querySelector('.ic-result').textContent = `❌ ${e.message}`; return; }
      area.innerHTML = '';
    };
    area.querySelector('.ic-cancel').onclick = () => { area.innerHTML = ''; };
  }

  // ── 補課卡片 ────────────────────────────────────────────────

  function buildMakeupCard(r, container) {
    const card = document.createElement('div');
    const statusBadge = r._overdue       ? '<span class="buke-badge danger">逾期</span>'
      : r.status === '已完成'            ? '<span class="buke-badge pass">已完成</span>'
      : r._attend_count >= 1             ? '<span class="buke-badge warn">尚未補完課</span>'
      : '<span class="buke-badge warn">待補課</span>';
    card.className = `buke-card ${r._overdue ? 'care' : r.status === '已完成' ? '' : 'warn'}`;
    card.style.marginBottom = '10px';
    card.innerHTML = `
      <div class="row" style="flex-wrap:wrap;gap:6px">
        <div><span class="name">${r._name}</span>
          <span class="meta">${r._class_name}　${r._group}</span></div>
        ${statusBadge}
      </div>
      <div style="font-size:14px;color:var(--muted);margin:6px 0">
        缺課日：${r._date}　預約補課：${r.planned_date ? `${r.planned_date} ${r.planned_slot || ''}` : '未填'}${r.earphone ? '　🎧耳機' : ''}${r.note ? `　備註：${r.note}` : ''}
        　截止：${r.deadline_date}　登記人：${r.registered_by}
        ${r._att_records.length > 0 ? `
          <div style="margin-top:4px">
            ${r._att_records.map((a, idx) =>
              `<div style="font-size:13px;color:var(--muted);display:flex;align-items:center;gap:6px">
                 <span>第 ${idx+1} 次到場：${new Date(a.attended_at).toLocaleString('zh-TW',{hour12:false})}${a.departed_at ? ` → 離場 ${new Date(a.departed_at).toLocaleString('zh-TW',{hour12:false})}（${Math.round((new Date(a.departed_at)-new Date(a.attended_at))/60000)} 分）` : ''}${a.late_mark ? `　遲到：${a.late_mark}` : ''}${a.machine_number ? `　🖥️${a.machine_number}號機` : ''}</span>
                 <button class="buke-btn buke-btn-ghost btn-del-att" data-att-id="${a.id}" style="font-size:12px;padding:1px 8px;min-height:22px">刪除此筆到場</button>
               </div>`
            ).join('')}
            <div style="font-size:13px;color:${r.status === '已完成' ? 'var(--ok-tx)' : 'var(--warn-tx)'}">
              共 ${r._att_records.length} 次到場／${r.status === '已完成' ? '已補完課' : '尚未補完課'}
            </div>
          </div>` : ''}
      </div>
      <div class="action-row" style="display:flex;gap:6px;flex-wrap:wrap">
        ${r.status !== '已完成' ? `<button class="buke-btn btn-complete" style="font-size:13px;padding:4px 12px;min-height:30px">標完成</button>` : ''}
        ${r.status === '已完成' ? '<button class="buke-btn buke-btn-ghost btn-uncomplete" style="font-size:13px;padding:4px 12px;min-height:30px">取消完成</button>' : ''}
        <button class="buke-btn buke-btn-ghost btn-edit-mu" style="font-size:13px;padding:4px 12px;min-height:30px" ${r._overdue ? 'disabled title="已逾期，無法編輯"' : ''}>編輯</button>
        <button class="buke-btn buke-btn-danger btn-del-mu" style="font-size:13px;padding:4px 12px;min-height:30px">刪除</button>
      </div>
      <div class="edit-area"></div>`;

    card.querySelector('.btn-complete')?.addEventListener('click', () =>
      inlineConfirm(card, `確定將 ${r._name} 的補課（${r._date}）標為完成？`, async () => { await completeMakeup(r.id); await fetchMakeups(); applyAndRender(card.closest('#panel-body') || document.body); }));
    card.querySelector('.btn-uncomplete')?.addEventListener('click', () =>
      inlineConfirm(card, `確定取消 ${r._name} 的補課完成？attendance 將還原（ML→LL / M→O）`, async () => { await uncompleteMakeup(r.id); await fetchMakeups(); applyAndRender(card.closest('#panel-body') || document.body); }));
    card.querySelector('.btn-del-mu').addEventListener('click', () => {
      const msg = r.status === '已完成'
        ? `⚠️ ${r._name} 這筆補課已標記「完成」。直接刪除只會移除這筆登記，<b>不會</b>自動把
           出勤紀錄改回請假/缺席（ML→LL／M→O），會留下對不起來的紀錄（過去發生過）。
           建議先按「取消完成」讓出勤還原，再視情況刪除。確定還是要直接刪除嗎？`
        : `確定刪除 ${r._name} 這筆補課登記？`;
      inlineConfirm(card, msg, async () => { await deleteMakeup(r.id); await fetchMakeups(); applyAndRender(card.closest('#panel-body') || document.body); });
    });
    card.querySelector('.btn-edit-mu').addEventListener('click', () => toggleEditMakeup(card, r));
    card.querySelectorAll('.btn-del-att').forEach(btn => {
      btn.addEventListener('click', () =>
        inlineConfirm(card, `確定刪除 ${r._name} 這筆到場紀錄？`, async () => {
          const { error } = await cancelAttendRecord(Number(btn.dataset.attId));
          if (error) throw new Error(error.message);
          await fetchMakeups(); applyAndRender(card.closest('#panel-body') || document.body);
        }));
    });
    return card;
  }

  function toggleEditMakeup(card, r) {
    const area = card.querySelector('.edit-area');
    if (area.innerHTML) { area.innerHTML = ''; return; }
    area.innerHTML = `<div style="display:flex;flex-direction:column;gap:8px;margin-top:10px;padding:10px;background:var(--bg);border-radius:var(--r-md)">
      <select class="buke-select f-ecls" style="font-size:14px"><option value="">班別載入中…</option></select>
      <select class="buke-select f-eses" style="font-size:14px;display:none"><option value="">請選擇缺課日期</option></select>
      <label style="font-size:14px;display:flex;align-items:center;gap:8px"><input type="checkbox" class="f-ear"${r.earphone?' checked':''} style="width:18px;height:18px"> 借用耳機</label>
      <label style="font-size:14px">備註<input class="buke-input f-note" style="font-size:14px;margin-top:4px;width:100%" value="${r.note||''}"></label>
      <label style="font-size:14px">預約補課日期
        <input type="date" class="buke-input f-pdate" style="font-size:14px;margin-top:4px;width:100%" value="${r.planned_date||''}">
      </label>
      <div style="font-size:14px">預約補課時間
        <div style="display:flex;align-items:center;gap:6px;margin-top:4px">
          <select class="buke-select f-phour" style="font-size:14px;flex:1">
            <option value="">時</option>
            ${Array.from({length:24},(_,h)=>`<option value="${String(h).padStart(2,'0')}"${r.planned_slot?.startsWith(String(h).padStart(2,'0')) ? ' selected' : ''}>${String(h).padStart(2,'0')}</option>`).join('')}
          </select>
          <span style="color:var(--muted)">:</span>
          <select class="buke-select f-pmin" style="font-size:14px;flex:1">
            <option value="">分</option>
            ${Array.from({length:12},(_,m)=>`<option value="${String(m*5).padStart(2,'0')}"${r.planned_slot?.endsWith(':'+String(m*5).padStart(2,'0')) ? ' selected' : ''}>${String(m*5).padStart(2,'0')}</option>`).join('')}
          </select>
        </div>
      </div>
      <div style="display:flex;gap:8px"><button class="buke-btn btn-save-mu" style="font-size:13px;padding:4px 14px;min-height:30px">儲存</button>
      <button class="buke-btn buke-btn-ghost btn-cancel-mu" style="font-size:13px;padding:4px 14px;min-height:30px">取消</button></div>
      <div class="edit-msg" style="font-size:13px"></div></div>`;
    area.querySelector('.btn-cancel-mu').onclick = () => { area.innerHTML = ''; };
    const clsSel = area.querySelector('.f-ecls'), sesSel = area.querySelector('.f-eses');
    const msgEl  = area.querySelector('.edit-msg');
    let _ems = [];
    (async () => {
      const { data: m0 } = await _sb.from('members').select('member_id').eq('id', r.member_ref).single();
      if (!m0?.member_id) return;
      const { data } = await _sb.from('members').select('id,class_ref,classes(class_name)').eq('member_id', m0.member_id).eq('status','在學');
      _ems = data || [];
      clsSel.innerHTML = _ems.map((m,i) =>
        `<option value="${i}"${m.class_ref===r._class_ref?' selected':''}>${m.classes?.class_name||'—'}</option>`).join('');
      const initIdx = _ems.findIndex(m => m.class_ref === r._class_ref);
      if (initIdx >= 0) await _loadAbsencesInto(_ems[initIdx].id, sesSel, r.session_ref);
    })();
    clsSel.addEventListener('change', async () => {
      const m = _ems[Number(clsSel.value)]; if (m) await _loadAbsencesInto(m.id, sesSel, 0);
    });
    area.querySelector('.btn-save-mu').addEventListener('click', async () => {
      const mem = _ems[Number(clsSel.value)], sessRef = Number(sesSel.value);
      if (!mem || !sessRef) { msgEl.textContent = '請選擇班別與缺課日期'; return; }
      const pdate = area.querySelector('.f-pdate').value || null;
      const ph    = area.querySelector('.f-phour').value;
      const pm    = area.querySelector('.f-pmin').value;
      const pslot = (ph && pm) ? `${ph}:${pm}` : null;
      const { error } = await updateMakeup(r.id, {
        member_ref:   mem.id,
        session_ref:  sessRef,
        earphone:     area.querySelector('.f-ear').checked,
        note:         area.querySelector('.f-note').value.trim() || null,
        planned_date: pdate,
        planned_slot: pslot,
      });
      if (error?.code === '23505') { msgEl.textContent = '⚠ 此缺堂已有補課登記，不能重複'; return; }
      if (error) { msgEl.textContent = `❌ ${error.message}`; return; }
      await fetchMakeups(); applyAndRender(card.closest('#panel-body') || document.body);
    });
  }

  // ── 補登表單（補課） ──────────────────────────────────────────

  function showAddMakeupForm(container) {
    const formEl = container.querySelector('#mo-add-form');
    if (formEl.innerHTML) { formEl.innerHTML = ''; return; }
    formEl.innerHTML = `
      <div class="buke-card" style="margin-bottom:12px">
        <div style="font-weight:500;margin-bottom:10px">補登補課</div>
        <div style="display:flex;flex-direction:column;gap:8px">
          <div style="display:flex;gap:6px">
            <input class="buke-input f-mname" placeholder="學員姓名（需完整）" style="font-size:14px;flex:1">
            <button class="buke-btn btn-lookup-member" style="font-size:13px;padding:4px 12px">查詢</button>
          </div>
          <select class="buke-select f-mclass" style="font-size:14px;display:none"><option value="">請選擇班別</option></select>
          <select class="buke-select f-msession" style="font-size:14px;display:none"><option value="">請選擇缺課堂次</option></select>
          <div class="f-more" style="display:none;flex-direction:column;gap:8px">
            <div style="font-size:14px">補登日期 <span style="color:var(--danger-tx)">*</span>
              <input type="date" class="buke-input f-mcdate" style="font-size:14px;margin-top:4px;width:100%">
            </div>
            <div style="display:flex;gap:8px">
              <button class="buke-btn btn-submit-add" style="font-size:13px;padding:4px 14px;min-height:30px">補登</button>
              <button class="buke-btn buke-btn-ghost" style="font-size:13px;padding:4px 14px;min-height:30px"
                onclick="this.closest('#mo-add-form').innerHTML=''">取消</button>
            </div>
            <div class="add-msg" style="font-size:13px"></div>
          </div>
        </div>
      </div>`;

    let _adMembers = [];
    formEl.querySelector('.btn-lookup-member').addEventListener('click', async () => {
      const name = formEl.querySelector('.f-mname').value.trim();
      if (!name) return;
      const { data } = await _sb.from('members').select('id,class_ref,classes(class_name)').ilike('name', name).eq('status','在學');
      _adMembers = data || [];
      const clsSel = formEl.querySelector('.f-mclass');
      clsSel.innerHTML = '<option value="">請選擇班別</option>' + _adMembers.map((m,i)=>`<option value="${i}">${m.classes?.class_name||'—'}</option>`).join('');
      clsSel.style.display = 'block';
      formEl.querySelector('.f-msession').style.display = 'none';
      formEl.querySelector('.f-more').style.display = 'none';
    });
    formEl.querySelector('.f-mclass').addEventListener('change', async () => {
      const mem = _adMembers[Number(formEl.querySelector('.f-mclass').value)];
      if (!mem) return;
      await _loadAbsencesInto(mem.id, formEl.querySelector('.f-msession'), 0);
      formEl.querySelector('.f-more').style.display = 'flex';
    });
    formEl.querySelector('.btn-submit-add').addEventListener('click', async () => {
      const mem = _adMembers[Number(formEl.querySelector('.f-mclass').value)];
      const sessRef = formEl.querySelector('.f-msession').value;
      const msgEl = formEl.querySelector('.add-msg');
      if (!mem || !sessRef) { msgEl.textContent = '請選擇班別與缺課堂次'; return; }
      const cdate = formEl.querySelector('.f-mcdate').value;
      if (!cdate) { msgEl.textContent = '請填入補登日期'; return; }
      // 補登＝已發生過的事，直接建立＋標完成（不經過「待補課」中間狀態）
      const { error } = await _sb.rpc('admin_backfill_makeup', {
        p_member_db_id: mem.id, p_session_ref: Number(sessRef), p_method: '影音',
      });
      if (error) { msgEl.textContent = `❌ ${error.message}`; return; }
      const { data: muRow, error: muErr } = await _sb.from('makeups')
        .select('id').eq('member_ref', mem.id).eq('session_ref', Number(sessRef)).single();
      if (muErr || !muRow) { msgEl.textContent = `❌ 找不到剛建立的補課紀錄：${muErr?.message || ''}`; return; }
      const { error: cErr } = await _sb.rpc('complete_makeup', { p_makeup_id: muRow.id, p_completed_date: cdate });
      if (cErr) { msgEl.textContent = `❌ 補登成功但標完成失敗：${cErr.message}`; return; }
      formEl.innerHTML = ''; await fetchMakeups(); applyAndRender(container);
    });
  }

  window.PanelMakeupOverview = { loadMakeupOverviewPanel, buildMakeupCard, _loadAbsencesInto, renderGroupedByClass, inlineConfirm };
})();
