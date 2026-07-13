// 職責：日夜補（跨班調課）登記總覽——原本併在 panel_makeup_overview.js，重構41 拆分獨立
// 分組摺疊／inline confirm 複用 window.PanelMakeupOverview 匯出的 renderGroupedByClass／inlineConfirm

'use strict';

(function () {
  let _sb, _transfers = [], _filterClass = '', _filterStatus = 'all', _searchName = '';

  // ── 資料讀取 ────────────────────────────────────────────────

  async function fetchTransfers() {
    const { data, error } = await _sb.from('transfers').select(
      'id,to_date,status,attended_at,late_mark,registered_by,' +
      'members!member_ref(name,group_id,classes(class_name)),' +
      'sessions!from_session_ref(date),' +
      'classes!to_class_ref(class_name)'
    ).order('created_at', { ascending: false });
    if (error) throw new Error(`日夜補：${error.message}`);

    _transfers = (data || []).map(r => ({
      ...r,
      _name:       r.members?.name                || '—',
      _group:      r.members?.group_id            || '',
      _class_name: r.members?.classes?.class_name || '—',
      _class_ref:  r.members?.class_ref           || '',
      _from_date:  r.sessions?.date               || '',
      _to_class:   r.classes?.class_name          || '—',
    }));
  }

  // ── RPC / 資料操作 ──────────────────────────────────────────

  const deleteTransfer = id => _sb.from('transfers').delete().eq('id', id);

  // ── 面板入口 ────────────────────────────────────────────────

  async function loadTransferOverviewPanel(sb, container) {
    _sb = sb;
    container.innerHTML = '<p class="buke-empty">載入中…</p>';
    try {
      await fetchTransfers();
      renderShell(container);
      applyAndRender(container);
    } catch (e) {
      container.innerHTML = `<div class="buke-msg err">❌ ${e.message}</div>`;
    }
  }

  function renderShell(container) {
    const classNames = [...new Set(_transfers.map(r => r._class_name).filter(Boolean))].sort();
    const classOpts  = classNames.map(n => `<option>${n}</option>`).join('');
    container.innerHTML = `
      <div class="buke-tabs tabs-3">
        <div class="buke-tab" data-tab="makeup">補課登記</div>
        <div class="buke-tab active" data-tab="transfer">日夜補登記</div>
        <div class="buke-tab" data-tab="late">逾期補課登記</div>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px;align-items:center">
        <input id="to-search" class="buke-input" placeholder="搜尋姓名" style="font-size:14px;min-height:36px;flex:1;min-width:120px">
        <select id="to-class" class="buke-select" style="font-size:14px;min-height:36px"><option value="">全部班別</option>${classOpts}</select>
        <select id="to-status" class="buke-select" style="font-size:14px;min-height:36px"><option value="all">全部狀態</option><option value="pending">已登記</option><option value="attended">已出席</option><option value="absent">未到</option></select>
        <button id="to-refresh" class="buke-btn buke-btn-ghost" style="font-size:14px;padding:6px 14px;min-height:36px">🔄 重新整理</button>
        <button id="to-add" class="buke-btn buke-btn-ghost" style="font-size:14px;padding:6px 14px;min-height:36px">＋ 補登日夜補</button>
      </div>
      <div id="to-add-form" style="margin-bottom:12px"></div>
      <div id="to-count" style="font-size:13px;color:var(--muted);margin-bottom:8px"></div>
      <div id="to-list"></div>`;

    container.querySelector('[data-tab="makeup"]').addEventListener('click', () => {
      container.innerHTML = '';
      window.PanelMakeupOverview.loadMakeupOverviewPanel(_sb, container);
    });
    container.querySelector('[data-tab="late"]').addEventListener('click', () => {
      container.innerHTML = '';
      window.PanelMakeupLate.loadMakeupLatePanel(_sb, container);
    });
    container.querySelector('#to-search').addEventListener('input', e => { _searchName = e.target.value.trim(); applyAndRender(container); });
    container.querySelector('#to-class').addEventListener('change', e => { _filterClass = e.target.value; applyAndRender(container); });
    container.querySelector('#to-status').addEventListener('change', e => { _filterStatus = e.target.value; applyAndRender(container); });
    container.querySelector('#to-refresh').addEventListener('click', async () => {
      container.querySelector('#to-list').innerHTML = '<p class="buke-empty">載入中…</p>';
      await fetchTransfers(); applyAndRender(container);
    });
    container.querySelector('#to-add').addEventListener('click', () => showAddTransferForm(container));
  }

  function applyAndRender(container) {
    const listEl  = container.querySelector('#to-list');
    const countEl = container.querySelector('#to-count');
    if (!listEl) return;

    let trFiltered = _transfers.filter(r => {
      if (_filterClass && r._class_name !== _filterClass) return false;
      if (_filterStatus === 'attended') return r.status === '已出席';
      if (_filterStatus === 'absent')   return r.status === '未到';
      if (_filterStatus === 'pending')  return r.status === '已登記';
      return true;
    });
    if (_searchName) {
      const q = _searchName.toLowerCase();
      trFiltered = trFiltered.filter(r => (r._name || '').toLowerCase().includes(q));
    }

    if (countEl) countEl.textContent = `日夜補 ${trFiltered.length} 筆`;

    listEl.innerHTML = '';
    if (!trFiltered.length) {
      listEl.innerHTML = '<p class="buke-empty">沒有符合的紀錄。</p>'; return;
    }
    window.PanelMakeupOverview.renderGroupedByClass(listEl, trFiltered, buildTransferCard, container);
  }

  // ── 日夜補卡片 ────────────────────────────────────────────────

  function buildTransferCard(r, container) {
    const card = document.createElement('div');
    const badge = r.status==='已出席' ? '<span class="buke-badge pass">已出席</span>'
      : r.status==='未到' ? '<span class="buke-badge danger">未到</span>'
      : '<span class="buke-badge warn">已登記</span>';
    card.className = 'buke-card';
    card.style.marginBottom = '10px';
    card.innerHTML = `
      <div class="row" style="flex-wrap:wrap;gap:6px">
        <div><span class="name">${r._name}</span>
          <span class="meta">${r._class_name}　${r._group}</span></div>
        ${badge}
      </div>
      <div style="font-size:14px;color:var(--muted);margin:6px 0">
        原堂：${r._from_date}　→　調去：${r._to_class}　${r.to_date}
        ${r.late_mark ? `　遲到：${r.late_mark}` : ''}　登記人：${r.registered_by}
      </div>
      <div class="action-row" style="display:flex;gap:6px;flex-wrap:wrap">
        ${r.status!=='已出席' ? '<button class="buke-btn btn-tr-attend" style="font-size:13px;padding:4px 12px;min-height:30px">標已出席</button>' : ''}
        ${r.status!=='未到'   ? '<button class="buke-btn buke-btn-ghost btn-tr-absent" style="font-size:13px;padding:4px 12px;min-height:30px">標未到</button>' : ''}
        <button class="buke-btn buke-btn-danger btn-del-tr" style="font-size:13px;padding:4px 12px;min-height:30px">刪除</button>
      </div>
      <div class="edit-area"></div>`;

    card.querySelector('.btn-tr-attend')?.addEventListener('click', () => {
      const editArea = card.querySelector('.edit-area');
      editArea.innerHTML = `<div style="margin-top:8px;display:flex;align-items:center;gap:8px;flex-wrap:wrap">
          <span style="font-size:14px">遲到判定：</span>
          <select class="buke-select f-late" style="font-size:14px;min-height:32px"><option value="準時">準時</option><option>L</option><option>LL</option><option>A</option></select>
          <button class="buke-btn btn-ok-attend" style="font-size:13px;padding:4px 12px;min-height:30px">確定出席</button>
          <button class="buke-btn buke-btn-ghost" style="font-size:13px;padding:4px 12px;min-height:30px" onclick="this.parentElement.innerHTML=''">取消</button>
          <div class="ic-result" style="font-size:13px"></div></div>`;
      editArea.querySelector('.btn-ok-attend').addEventListener('click', async () => {
        const lm = editArea.querySelector('.f-late').value;
        try {
          const { error } = await _sb.rpc('admin_transfer_mark_attended', { p_transfer_id: r.id, p_late_mark: lm });
          if (error) throw new Error(error.message);
          await fetchTransfers(); applyAndRender(card.closest('#panel-body') || document.body);
        } catch (e) { editArea.querySelector('.ic-result').textContent = `❌ ${e.message}`; }
      });
    });
    card.querySelector('.btn-tr-absent')?.addEventListener('click', () =>
      window.PanelMakeupOverview.inlineConfirm(card, `確定將 ${r._name} 的日夜補（${r._from_date}）標為未到？`, async () => {
        const { error } = await _sb.rpc('admin_transfer_mark_absent', { p_transfer_id: r.id });
        if (error) throw new Error(error.message);
        await fetchTransfers(); applyAndRender(card.closest('#panel-body') || document.body);
      }));
    card.querySelector('.btn-del-tr').addEventListener('click', () =>
      window.PanelMakeupOverview.inlineConfirm(card, `確定刪除 ${r._name} 這筆日夜補紀錄？`, async () => {
        const { error } = await deleteTransfer(r.id);
        if (error) throw new Error(error.message);
        await fetchTransfers(); applyAndRender(card.closest('#panel-body') || document.body);
      }));
    return card;
  }

  // ── 補登表單（日夜補·跨班） ──────────────────────────────────

  function showAddTransferForm(container) {
    const formEl = container.querySelector('#to-add-form');
    if (formEl.innerHTML) { formEl.innerHTML = ''; return; }
    formEl.innerHTML = `
      <div class="buke-card" style="margin-bottom:12px">
        <div style="font-weight:500;margin-bottom:10px">補登日夜補（跨班）</div>
        <div style="display:flex;flex-direction:column;gap:8px">
          <div style="display:flex;gap:6px">
            <input class="buke-input f-tname2" placeholder="學員姓名（需完整）" style="font-size:14px;flex:1">
            <button class="buke-btn btn-lookup-tr" style="font-size:13px;padding:4px 12px">查詢</button>
          </div>
          <select class="buke-select f-tsrccls" style="font-size:14px;display:none"><option value="">請選擇該生班別（同名有多筆在學紀錄）</option></select>
          <div class="f-tmore" style="display:none;flex-direction:column;gap:8px">
            <input class="buke-input f-tfsess" type="date" style="font-size:14px">
            <div style="font-size:13px;color:var(--muted);margin-top:-4px">↑ 原本的上課日期（該生目前班別）</div>
            <select class="buke-select f-tclass" style="font-size:14px"><option value="">請選擇調去的班別</option></select>
            <input class="buke-input f-tdate" type="date" style="font-size:14px">
            <div style="font-size:13px;color:var(--muted);margin-top:-4px">↑ 調去日期</div>
            <select class="buke-select f-tattend" style="font-size:14px">
              <option value="">尚未確認（僅登記，之後再標出席）</option>
              <option value="準時">已出席．準時</option>
              <option value="L">已出席．遲到（20分內）</option>
              <option value="LL">已出席．靜坐遲到（20~60分）</option>
              <option value="A">已出席．晚到（≥60分）</option>
            </select>
            <div style="font-size:13px;color:var(--muted);margin-top:-4px">↑ 出席狀況（補登沒有實際到場時間，遲到狀況用選的）</div>
            <div style="display:flex;gap:8px">
              <button class="buke-btn btn-submit-tr" style="font-size:13px;padding:4px 14px;min-height:30px">補登</button>
              <button class="buke-btn buke-btn-ghost" style="font-size:13px;padding:4px 14px;min-height:30px"
                onclick="this.closest('#to-add-form').innerHTML=''">取消</button>
            </div>
          </div>
          <div class="add-msg" style="font-size:13px"></div>
        </div>
      </div>`;

    let _trMembers = [];
    let _trMember  = null;

    async function _loadTransferTargets(member) {
      const msgEl  = formEl.querySelector('.add-msg');
      const moreEl = formEl.querySelector('.f-tmore');
      const level  = member.classes?.level;
      const { data: targets, error: tErr } = await _sb.from('classes')
        .select('id,class_name')
        .eq('level', level).eq('status', '進行中').neq('id', member.class_ref)
        .order('class_name');
      if (tErr) { msgEl.textContent = `❌ ${tErr.message}`; return; }
      const clsSel = formEl.querySelector('.f-tclass');
      clsSel.innerHTML = '<option value="">請選擇調去的班別</option>' +
        (targets || []).map(c => `<option value="${c.id}">${c.class_name}</option>`).join('');
      msgEl.textContent = targets?.length ? '' : `⚠ 目前沒有同級別（${level}）其他進行中的班可調`;
      moreEl.style.display = 'flex';
    }

    formEl.querySelector('.btn-lookup-tr').addEventListener('click', async () => {
      const name   = formEl.querySelector('.f-tname2').value.trim();
      const msgEl  = formEl.querySelector('.add-msg');
      const moreEl = formEl.querySelector('.f-tmore');
      const srcSel = formEl.querySelector('.f-tsrccls');
      msgEl.textContent = '';
      moreEl.style.display = 'none';
      srcSel.style.display = 'none';
      _trMember = null;
      if (!name) return;
      const { data: mems } = await _sb.from('members')
        .select('id,class_ref,classes(class_name,level)')
        .ilike('name', name).eq('status', '在學');
      _trMembers = mems || [];
      if (!_trMembers.length) { msgEl.textContent = '找不到此在學學員'; return; }
      if (_trMembers.length === 1) {
        _trMember = _trMembers[0];
        await _loadTransferTargets(_trMember);
        return;
      }
      // 同名有多筆在學紀錄（例如同時在兩個班別在學），先讓精舍選對是哪一班的那位，
      // 避免抓錯人導致「調去的班別」選項對不上（level 不對）
      srcSel.innerHTML = '<option value="">請選擇該生班別（同名有多筆在學紀錄）</option>' +
        _trMembers.map((m, i) => `<option value="${i}">${m.classes?.class_name || '—'}</option>`).join('');
      srcSel.style.display = 'block';
      msgEl.textContent = `⚠ 查到 ${_trMembers.length} 筆同名在學紀錄，請先選擇該生目前班別`;
    });

    formEl.querySelector('.f-tsrccls').addEventListener('change', async () => {
      const idx = formEl.querySelector('.f-tsrccls').value;
      if (idx === '') return;
      _trMember = _trMembers[Number(idx)];
      formEl.querySelector('.add-msg').textContent = '';
      await _loadTransferTargets(_trMember);
    });

    formEl.querySelector('.btn-submit-tr').addEventListener('click', async () => {
      const fromDay = formEl.querySelector('.f-tfsess').value;
      const toClass = Number(formEl.querySelector('.f-tclass').value);
      const toDate  = formEl.querySelector('.f-tdate').value;
      const msgEl   = formEl.querySelector('.add-msg');
      if (!_trMember) { msgEl.textContent = '請先查詢學員'; return; }
      if (!fromDay || !toClass || !toDate) { msgEl.textContent = '請填入原上課日期、調去的班別、調去日期'; return; }
      const { data: ses } = await _sb.from('sessions').select('id').eq('date', fromDay).eq('class_ref', _trMember.class_ref).limit(1);
      if (!ses?.length) { msgEl.textContent = '找不到對應的原班堂次'; return; }
      const attendMark = formEl.querySelector('.f-tattend').value; // '' = 尚未確認；否則 準時/L/LL/A
      const insertRow = {
        member_ref: _trMember.id, from_session_ref: ses[0].id,
        to_class_ref: toClass, to_date: toDate,
        registered_by: '精舍',
        ...(attendMark
          ? { status: '已出席', attended_at: new Date().toISOString(), late_mark: attendMark }
          : { status: '已登記' }),
      };
      const { error } = await _sb.from('transfers').insert(insertRow);
      if (error) { msgEl.textContent = `❌ ${error.message}`; return; }
      formEl.innerHTML = '';
      await fetchTransfers(); applyAndRender(container);
    });
  }

  window.PanelTransferOverview = { loadTransferOverviewPanel };
})();
