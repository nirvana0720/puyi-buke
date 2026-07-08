// 職責：角色指派面板——選班→選組→搜尋→設學長/班長/移除
// ⚠️ 不使用瀏覽器 confirm()，改用頁面內 inline 確認列
// 依賴：window.AdminData（admin.js）

'use strict';

(function () {
  const {
    fetchClasses, fetchGroups, fetchMembersWithStatus, compareGroupNames, compareClassSchedule,
    fetchAssignments, upsertAssignment, deleteAssignment,
  } = window.AdminData;

  let _sb, _classRef, _groups, _members, _assignments;

  async function loadAssignPanel(sb, container) {
    _sb = sb;
    container.innerHTML = '<p class="buke-empty">載入中…</p>';
    try {
      const classes = await fetchClasses(sb);
      const opts = classes
        .filter(c => c.status !== '已結業')
        .sort(compareClassSchedule)
        .map(c => `<option value="${c.id}">${c.class_name}（${c.status}）</option>`)
        .join('');

      container.innerHTML = `
        <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:12px">
          <select class="buke-select" id="as-sel-class" style="min-width:160px">
            <option value="">— 選班別 —</option>${opts}
          </select>
          <select class="buke-select" id="as-sel-group" style="min-width:140px">
            <option value="">— 全部組（只列已指派）—</option>
          </select>
          <button class="buke-btn" id="as-btn-load" style="font-size:14px">載入</button>
        </div>
        <p id="as-hint" style="font-size:14px;color:var(--muted);margin-bottom:10px">
          選特定組別 → 列出該組所有在學學員；選「全部組」→ 只列已指派的學長/班長。同一組可指派多位學長。
        </p>
        <div id="as-current" style="margin-bottom:16px"></div>
        <div id="as-search-area" style="display:none">
          <div style="display:flex;gap:8px;margin-bottom:10px">
            <input class="buke-input" id="as-search-input" placeholder="跨組搜尋：輸入姓名或學員編號" style="flex:1">
            <button class="buke-btn buke-btn-ghost" id="as-btn-search" style="font-size:14px">搜尋</button>
          </div>
          <div id="as-search-result"></div>
        </div>`;

      // 班別切換 → 更新組別下拉
      container.querySelector('#as-sel-class').addEventListener('change', async () => {
        const classRef = Number(container.querySelector('#as-sel-class').value);
        const groupSel = container.querySelector('#as-sel-group');
        groupSel.innerHTML = '<option value="">— 全部組（只列已指派）—</option>';
        if (!classRef) return;
        const groups = await fetchGroups(sb, classRef);
        groups.forEach(g => groupSel.insertAdjacentHTML('beforeend', `<option>${g}</option>`));
      });

      container.querySelector('#as-btn-load').addEventListener('click', () => {
        _classRef = Number(container.querySelector('#as-sel-class').value);
        if (!_classRef) return;
        const selectedGroup = container.querySelector('#as-sel-group').value;
        refreshAssignView(container, selectedGroup);
      });

      container.querySelector('#as-btn-search').addEventListener('click', () => searchMembers(container));
      container.querySelector('#as-search-input').addEventListener('keydown', e => {
        if (e.key === 'Enter') searchMembers(container);
      });
    } catch (e) {
      container.innerHTML = `<div class="buke-msg err">❌ ${e.message}</div>`;
    }
  }

  /**
   * 重新載入清單
   * @param {Element} container
   * @param {string}  [filterGroup]  空字串 = 全部組模式；有值 = 列出該組所有在學學員
   */
  async function refreshAssignView(container, filterGroup) {
    // 保留目前選取的組別（操作後重整時沿用）
    const currentGroup = filterGroup !== undefined
      ? filterGroup
      : (container.querySelector('#as-sel-group')?.value || '');

    const currentEl  = container.querySelector('#as-current');
    const searchArea = container.querySelector('#as-search-area');
    currentEl.innerHTML = '<p class="buke-empty">載入中…</p>';
    if (searchArea) {
      searchArea.querySelector('#as-search-result').innerHTML = '';
      searchArea.querySelector('#as-search-input').value = '';
    }

    try {
      [_members, _assignments, _groups] = await Promise.all([
        fetchMembersWithStatus(_sb, _classRef),
        fetchAssignments(_sb, _classRef),
        fetchGroups(_sb, _classRef),
      ]);

      if (currentGroup) {
        // ── 選了特定組：列出該組所有在學學員 ────────────────
        if (searchArea) searchArea.style.display = 'none'; // 組別模式不需搜尋框

        const groupMembers = _members.filter(
          m => m.group_id === currentGroup && m.status !== '休學'
        );

        if (!groupMembers.length) {
          currentEl.innerHTML = `<p class="buke-empty">「${currentGroup}」尚無在學學員。</p>`;
          return;
        }

        currentEl.innerHTML =
          `<div class="buke-section warn" style="margin-bottom:8px">${currentGroup} — 在學學員</div>`;
        for (const m of groupMembers) {
          const a = _assignments.find(x => x.member_id === m.member_id) || null;
          currentEl.appendChild(buildMemberCard(m, a, container, currentGroup));
        }

      } else {
        // ── 全部組：只列已指派的學長/班長 ＋ 搜尋框 ────────
        if (searchArea) searchArea.style.display = '';

        // 排序：班長最前，接下來依組別（男1、男2…、女1、女2…）排序
        const assigned = _assignments
          .filter(a => a.role !== '學員')
          .slice()
          .sort((x, y) => {
            const xHead = x.role === '班長' ? 0 : 1;
            const yHead = y.role === '班長' ? 0 : 1;
            if (xHead !== yHead) return xHead - yHead;
            return compareGroupNames(x.scope_group || '', y.scope_group || '');
          });
        if (!assigned.length) {
          currentEl.innerHTML = '<p class="buke-empty">此班目前尚無學長/班長指派。請選特定組別或用搜尋框新增。</p>';
          return;
        }

        currentEl.innerHTML = '<div class="buke-section warn" style="margin-bottom:8px">目前指派（學長/班長）</div>';
        for (const a of assigned) {
          const m = _members.find(x => x.member_id === a.member_id);
          if (!m) continue;
          currentEl.appendChild(buildMemberCard(m, a, container, ''));
        }
      }
    } catch (e) {
      currentEl.innerHTML = `<div class="buke-msg err">❌ ${e.message}</div>`;
    }
  }

  /** 搜尋學員 */
  function searchMembers(container) {
    const q = container.querySelector('#as-search-input').value.trim().toLowerCase();
    const resultEl = container.querySelector('#as-search-result');
    if (!q || !_members) { resultEl.innerHTML = ''; return; }

    const found = _members.filter(m =>
      m.name.toLowerCase().includes(q) ||
      m.member_id.includes(q)
    );

    resultEl.innerHTML = found.length
      ? '<div class="buke-section" style="margin-bottom:8px;color:var(--muted)">搜尋結果</div>'
      : '<p class="buke-empty">找不到符合的學員。</p>';

    for (const m of found) {
      const a = _assignments.find(x => x.member_id === m.member_id) || null;
      resultEl.appendChild(buildMemberCard(m, a, container, false));
    }
  }

  /**
   * 建立一張學員操作卡
   * @param {object}      m          學員資料
   * @param {object|null} a          目前指派（可 null）
   * @param {Element}     container  面板根元素（重新整理用）
   * @param {string}      groupCtx   操作後重整時要保持的組別篩選（空字串=全部組模式）
   */
  function buildMemberCard(m, a, container, groupCtx) {
    const card = document.createElement('div');
    card.className = 'buke-card';
    card.style.marginBottom = '10px';

    const role  = a?.role || '學員';
    const scope = a?.scope_group || '';
    const badgeCls = role === '班長' ? 'pass' : role === '學長' ? 'warn' : role === '點名' ? 'pass' : '';
    const badgeEl  = badgeCls
      ? `<span class="buke-badge ${badgeCls}">${role}${scope ? '（' + scope + '）' : ''}</span>`
      : `<span class="buke-badge" style="background:var(--line);color:var(--muted)">學員</span>`;

    // 預設帶入該學員自己所在的組別（學長通常就是自己那組），已有指派則以指派的 scope_group 為準；
    // 兩者皆無時才留空白要求手動選
    const defaultScope = scope || m.group_id || '';
    const groupOpts = _groups.map(g =>
      `<option value="${g}"${defaultScope === g ? ' selected' : ''}>${g}</option>`).join('');

    card.innerHTML = `
      <div class="row" style="flex-wrap:wrap;gap:8px">
        <div>
          <span class="name">${m.name}</span>
          <span class="meta">${m.dharma_name || ''}　${m.group_id || ''}${m.group_num ? '-' + m.group_num : ''}</span>
        </div>
        ${badgeEl}
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px;align-items:center">
        <select class="buke-select sel-scope" style="font-size:14px;padding:6px 10px;min-height:36px">
          <option value="">選組別（設學長用）</option>${groupOpts}
        </select>
        <button class="buke-btn buke-btn-ghost btn-set-leader" style="font-size:14px;padding:5px 12px;min-height:36px">設為學長</button>
        <button class="buke-btn buke-btn-ghost btn-set-head" style="font-size:14px;padding:5px 12px;min-height:36px">設為班長</button>
        <button class="buke-btn buke-btn-ghost btn-set-rollcall" style="font-size:14px;padding:5px 12px;min-height:36px">設為點名</button>
        ${a ? `<button class="buke-btn buke-btn-danger btn-remove"
               style="font-size:14px;padding:5px 12px;min-height:36px">移除指派</button>` : ''}
      </div>
      <div class="inline-confirm" style="display:none;margin-top:10px;padding:10px;
           background:var(--surface);border-radius:var(--r-md);border:1px solid var(--line)">
        <p class="ic-msg" style="font-size:15px;margin-bottom:8px"></p>
        <div style="display:flex;gap:8px">
          <button class="buke-btn ic-yes" style="font-size:14px">確定</button>
          <button class="buke-btn buke-btn-ghost ic-no" style="font-size:14px">取消</button>
        </div>
        <div class="ic-result" style="font-size:14px;margin-top:6px"></div>
      </div>`;

    const confirmArea = card.querySelector('.inline-confirm');
    const icMsg       = card.querySelector('.ic-msg');
    const icResult    = card.querySelector('.ic-result');

    function showConfirm(msg, onOk) {
      icMsg.textContent = msg;
      icResult.textContent = '';
      confirmArea.style.display = '';
      card.querySelector('.ic-yes').onclick = async () => {
        try { await onOk(); refreshAssignView(container, groupCtx); }
        catch (e) { icResult.textContent = `❌ ${e.message}`; }
      };
      card.querySelector('.ic-no').onclick = () => { confirmArea.style.display = 'none'; };
    }

    card.querySelector('.btn-set-leader').addEventListener('click', () => {
      const scope = card.querySelector('.sel-scope').value;
      if (!scope) { icMsg.textContent = '請先選組別後再設為學長。'; icResult.textContent = ''; confirmArea.style.display = ''; return; }
      showConfirm(`確定將 ${m.name} 設為學長（${scope}）？`, () =>
        upsertAssignment(_sb, { member_id: m.member_id, class_ref: _classRef, role: '學長', scope_group: scope }));
    });

    card.querySelector('.btn-set-head').addEventListener('click', () => {
      showConfirm(`確定將 ${m.name} 設為班長（可看整班）？`, () =>
        upsertAssignment(_sb, { member_id: m.member_id, class_ref: _classRef, role: '班長', scope_group: null }));
    });

    card.querySelector('.btn-set-rollcall').addEventListener('click', () => {
      showConfirm(`確定將 ${m.name} 設為點名（可看整班當天出缺勤）？`, () =>
        upsertAssignment(_sb, { member_id: m.member_id, class_ref: _classRef, role: '點名', scope_group: null }));
    });

    card.querySelector('.btn-remove')?.addEventListener('click', () => {
      showConfirm(`確定移除 ${m.name} 的角色指派（恢復為一般學員）？`, () =>
        deleteAssignment(_sb, m.member_id, _classRef));
    });

    return card;
  }

  window.PanelAssign = { loadAssignPanel };
})();
