// 職責：培訓補課總覽——管理員督看精舍培訓課程（training_classes/training_sessions）
// 的補課登記狀態，比照 panel_makeup_overview.js 結構，資料表換成 training_makeups。
// training_makeups 沒有 deadline_date/earliest_date，沒有「逾期」概念，畫面不做逾期篩選/摘要。
// 完成／取消完成／刪除到場紀錄直接 .update()/.delete()（RLS 已開放 authenticated），不走 RPC。
// inline confirm 直接呼叫 window.PanelMakeupOverview 匯出的共用函式，不複製一份；
// 分組摺疊改成依「個別堂次」分組（重構57），不沿用 renderGroupedByClass（那支是依班別
// 分組，培訓課是以堂次為單位在運作，同一班不同堂次可能是不同法師負責，混在一起看不出用途）。

'use strict';

(function () {
  let _sb, _tmRows = [], _filterClass = '', _filterStatus = 'all', _searchName = '';

  // ── 資料讀取 ────────────────────────────────────────────────

  async function _tmFetchMakeups() {
    const { data, error } = await _sb.from('training_makeups').select(
      'id,member_ref,training_session_ref,note,status,registered_by,planned_date,planned_slot,earphone,' +
      'members!member_ref(name,dharma_name,group_id),' +
      'training_sessions!training_session_ref(session_date,session_time,topic,training_classes(name))'
    ).order('created_at', { ascending: false });
    if (error) throw new Error(`培訓補課：${error.message}`);

    const tmIds = (data || []).map(r => r.id);
    let attMap    = new Map(); // training_makeup_ref → 最新一筆（DESC 第一筆）
    let allAttMap = new Map(); // training_makeup_ref → 所有紀錄[]，由舊到新
    if (tmIds.length) {
      const { data: attRows, error: attErr } = await _sb.from('training_makeup_attendances')
        .select('id,training_makeup_ref,attended_at,departed_at,machine_number')
        .in('training_makeup_ref', tmIds)
        .order('attended_at', { ascending: false });
      if (attErr) throw new Error(`培訓補課到場紀錄：${attErr.message}`);
      (attRows || []).forEach(a => {
        if (!attMap.has(a.training_makeup_ref)) attMap.set(a.training_makeup_ref, a);
        const arr = allAttMap.get(a.training_makeup_ref) || [];
        arr.unshift(a); // unshift 讓最終 arr 由舊到新（ASC）
        allAttMap.set(a.training_makeup_ref, arr);
      });
    }

    _tmRows = (data || []).map(r => ({
      ...r,
      _name:          r.members?.name                          || '—',
      _dharma:        r.members?.dharma_name                    || '',
      _group:         r.members?.group_id                       || '',
      _class_name:    r.training_sessions?.training_classes?.name || '—',
      _topic:         r.training_sessions?.topic                || '',
      _session_date:  r.training_sessions?.session_date         || '',
      _attended_at:   attMap.get(r.id)?.attended_at             || null,
      _attend_count:  (allAttMap.get(r.id) || []).length,
      _att_records:   allAttMap.get(r.id) || [],
    }));
  }

  // ── 資料操作（RLS 已開放 authenticated，直接 .from()，不用 RPC）───

  const _tmComplete       = id => _sb.from('training_makeups').update({ status: '已完成' }).eq('id', id);
  const _tmUncomplete     = id => _sb.from('training_makeups').update({ status: '待補課' }).eq('id', id);
  const _tmDelete         = id => _sb.from('training_makeups').delete().eq('id', id);
  const _tmCancelAttend   = id => _sb.from('training_makeup_attendances').delete().eq('id', id);

  // ── 面板入口 ────────────────────────────────────────────────

  async function loadTrainingMakeupOverviewPanel(sb, container) {
    _sb = sb;
    container.innerHTML = '<p class="buke-empty">載入中…</p>';
    try {
      await _tmFetchMakeups();
      _tmRenderShell(container);
      _tmApplyAndRender(container);
    } catch (e) {
      container.innerHTML = `<div class="buke-msg err">❌ ${e.message}</div>`;
    }
  }

  function _tmRenderShell(container) {
    const classNames = [...new Set(_tmRows.map(r => r._class_name).filter(Boolean))].sort();
    const classOpts  = classNames.map(n => `<option>${n}</option>`).join('');
    container.innerHTML = `
      <div class="no-print" style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px;align-items:center">
        <input id="tmo-search" class="buke-input" placeholder="搜尋姓名" style="font-size:14px;min-height:36px;flex:1;min-width:120px">
        <select id="tmo-class" class="buke-select" style="font-size:14px;min-height:36px"><option value="">全部培訓班別</option>${classOpts}</select>
        <select id="tmo-status" class="buke-select" style="font-size:14px;min-height:36px"><option value="all">全部狀態</option><option value="pending">待補課</option><option value="done">已完成</option></select>
        <button id="tmo-refresh" class="buke-btn buke-btn-ghost" style="font-size:14px;padding:6px 14px;min-height:36px">🔄 重新整理</button>
      </div>
      <div id="tmo-count" style="font-size:13px;color:var(--muted);margin-bottom:8px"></div>
      <div id="tmo-list"></div>`;

    container.querySelector('#tmo-search').addEventListener('input', e => { _searchName = e.target.value.trim(); _tmApplyAndRender(container); });
    container.querySelector('#tmo-class').addEventListener('change',  e => { _filterClass  = e.target.value; _tmApplyAndRender(container); });
    container.querySelector('#tmo-status').addEventListener('change', e => { _filterStatus = e.target.value; _tmApplyAndRender(container); });
    container.querySelector('#tmo-refresh').addEventListener('click', async () => {
      container.querySelector('#tmo-list').innerHTML = '<p class="buke-empty">載入中…</p>';
      await _tmFetchMakeups(); _tmApplyAndRender(container);
    });
  }

  function _tmApplyAndRender(container) {
    const listEl  = container.querySelector('#tmo-list');
    const countEl = container.querySelector('#tmo-count');
    if (!listEl) return;

    let filtered = _tmRows.filter(r => {
      if (_filterClass && r._class_name !== _filterClass) return false;
      if (_filterStatus === 'pending') return r.status === '待補課';
      if (_filterStatus === 'done')    return r.status === '已完成';
      return true;
    });
    if (_searchName) {
      const q = _searchName.toLowerCase();
      filtered = filtered.filter(r => (r._name || '').toLowerCase().includes(q));
    }

    if (countEl) countEl.textContent = `培訓補課 ${filtered.length} 筆`;

    listEl.innerHTML = '';
    if (!filtered.length) {
      listEl.innerHTML = '<p class="buke-empty">沒有符合的紀錄。</p>'; return;
    }
    _tmRenderGroupedBySession(listEl, filtered, container);
  }

  /** 依「個別堂次」分組摺疊（<details> 預設展開）：培訓課是以堂次為單位在運作，
   *  同一培訓班不同堂次可能是不同法師負責，不適合像禪修班補課那樣依班別混在一起看。
   *  分組 key 用 training_session_ref；標題「培訓班名稱｜課程主題（課程日期）」；
   *  群組依課程日期新到舊排序（比照補課/調課總覽新到舊的習慣，不用字串字母排序）。 */
  function _tmRenderGroupedBySession(listEl, rows, container) {
    const groups = new Map(); // training_session_ref → { rows, className, topic, date }
    rows.forEach(r => {
      const key = r.training_session_ref;
      if (!groups.has(key)) {
        groups.set(key, { rows: [], className: r._class_name, topic: r._topic, date: r._session_date });
      }
      groups.get(key).rows.push(r);
    });
    [...groups.keys()]
      .sort((a, b) => (groups.get(b).date || '').localeCompare(groups.get(a).date || ''))
      .forEach(key => {
        const g = groups.get(key);
        const details = document.createElement('details');
        details.open = true;
        details.style.marginBottom = '10px';
        const summary = document.createElement('summary');
        summary.style.cssText = 'cursor:pointer;font-weight:500;padding:6px 0';
        summary.textContent = `${g.className}｜${g.topic || '（無主題）'}（${g.date}）（${g.rows.length} 筆）`;
        details.appendChild(summary);
        g.rows.forEach(r => details.appendChild(_tmBuildCard(r, container)));
        listEl.appendChild(details);
      });
  }

  // ── 培訓補課卡片 ────────────────────────────────────────────

  function _tmBuildCard(r, container) {
    const card = document.createElement('div');
    const statusBadge = r.status === '已完成' ? '<span class="buke-badge pass">已完成</span>'
      : r._attend_count >= 1            ? '<span class="buke-badge warn">尚未補完課</span>'
      : '<span class="buke-badge warn">待補課</span>';
    card.className = `buke-card ${r.status === '已完成' ? '' : 'warn'}`;
    card.style.marginBottom = '10px';
    card.innerHTML = `
      <div class="row" style="flex-wrap:wrap;gap:6px">
        <div><span class="name">${r._name}${r._dharma ? `（${r._dharma}）` : ''}</span>
          <span class="meta">${r._class_name}　${r._group}</span></div>
        ${statusBadge}
      </div>
      <div style="font-size:14px;color:var(--muted);margin:6px 0">
        課程：${r._topic || '—'}　課程日期：${r._session_date}
        　預約補課：${r.planned_date ? `${r.planned_date} ${r.planned_slot || ''}` : '未填'}${r.earphone ? '　🎧耳機' : ''}${r.note ? `　備註：${r.note}` : ''}
        　登記人：${r.registered_by}
        ${r._att_records.length > 0 ? `
          <div style="margin-top:4px">
            ${r._att_records.map((a, idx) =>
              `<div style="font-size:13px;color:var(--muted);display:flex;align-items:center;gap:6px">
                 <span>第 ${idx+1} 次到場：${new Date(a.attended_at).toLocaleString('zh-TW',{hour12:false})}${a.departed_at ? ` → 離場 ${new Date(a.departed_at).toLocaleString('zh-TW',{hour12:false})}（${Math.round((new Date(a.departed_at)-new Date(a.attended_at))/60000)} 分）` : ''}${a.machine_number ? `　🖥️${a.machine_number}號機` : ''}</span>
                 <button class="buke-btn buke-btn-ghost btn-tm-del-att" data-att-id="${a.id}" style="font-size:12px;padding:1px 8px;min-height:22px">刪除此筆到場</button>
               </div>`
            ).join('')}
            <div style="font-size:13px;color:${r.status === '已完成' ? 'var(--ok-tx)' : 'var(--warn-tx)'}">
              共 ${r._att_records.length} 次到場／${r.status === '已完成' ? '已補完課' : '尚未補完課'}
            </div>
          </div>` : ''}
      </div>
      <div class="action-row" style="display:flex;gap:6px;flex-wrap:wrap">
        ${r.status !== '已完成' ? `<button class="buke-btn btn-tm-complete" style="font-size:13px;padding:4px 12px;min-height:30px">標完成</button>` : ''}
        ${r.status === '已完成' ? '<button class="buke-btn buke-btn-ghost btn-tm-uncomplete" style="font-size:13px;padding:4px 12px;min-height:30px">取消完成</button>' : ''}
        <button class="buke-btn buke-btn-danger btn-tm-del" style="font-size:13px;padding:4px 12px;min-height:30px">刪除</button>
      </div>`;

    card.querySelector('.btn-tm-complete')?.addEventListener('click', () =>
      window.PanelMakeupOverview.inlineConfirm(card, `確定將 ${r._name} 的培訓補課（${r._topic || r._session_date}）標為完成？`, async () => {
        const { error } = await _tmComplete(r.id);
        if (error) throw new Error(error.message);
        await _tmFetchMakeups(); _tmApplyAndRender(card.closest('#panel-body') || document.body);
      }));
    card.querySelector('.btn-tm-uncomplete')?.addEventListener('click', () =>
      window.PanelMakeupOverview.inlineConfirm(card, `確定取消 ${r._name} 的培訓補課完成？`, async () => {
        const { error } = await _tmUncomplete(r.id);
        if (error) throw new Error(error.message);
        await _tmFetchMakeups(); _tmApplyAndRender(card.closest('#panel-body') || document.body);
      }));
    card.querySelector('.btn-tm-del').addEventListener('click', () => {
      window.PanelMakeupOverview.inlineConfirm(card, `確定刪除 ${r._name} 這筆培訓補課登記？`, async () => {
        const { error } = await _tmDelete(r.id);
        if (error) throw new Error(error.message);
        await _tmFetchMakeups(); _tmApplyAndRender(card.closest('#panel-body') || document.body);
      });
    });
    card.querySelectorAll('.btn-tm-del-att').forEach(btn => {
      btn.addEventListener('click', () =>
        window.PanelMakeupOverview.inlineConfirm(card, `確定刪除 ${r._name} 這筆到場紀錄？`, async () => {
          const { error } = await _tmCancelAttend(Number(btn.dataset.attId));
          if (error) throw new Error(error.message);
          await _tmFetchMakeups(); _tmApplyAndRender(card.closest('#panel-body') || document.body);
        }));
    });
    return card;
  }

  window.PanelTrainingMakeupOverview = { loadTrainingMakeupOverviewPanel };
})();
