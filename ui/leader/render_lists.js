// 職責：學長/班長看板頂部各種統計表格渲染
// KPI 磚、紅燈名單、即將逾期表、缺課尚未登記表
// 依賴：LEADER_MARK_LABEL（render.js 定義的全域常數）

'use strict';

/**
 * KPI 磚
 * @param {StudentRow[]} active        在學學員
 * @param {string}       mode          'leader' | 'class'
 * @param {Array}        urgentMakeups 已篩好的即將逾期清單（buildUrgentSection 同一份）
 * @returns {HTMLElement}
 */
function buildKpiSection(active, mode, urgentMakeups) {
  const count = active.length;

  // 平均出席率：每人 physical/held*100，held=0 者以 0% 計
  const avgAttend = count
    ? Math.round(active.reduce((s, r) => s + (r.held > 0 ? r.physical / r.held * 100 : 0), 0) / count)
    : 0;

  const perfectCount   = active.filter(r => r.perfect).length;
  const diligentCount  = active.filter(r => r.diligent === '已勤學').length;

  const wrap = document.createElement('div');
  wrap.className = 'buke-stats';

  if (mode === 'leader') {
    // 補課完成率：總已補 / (總已補 + 總缺課)
    const totalMakeup = active.reduce((s, r) => s + r.makeup, 0);
    const totalAbsent = active.reduce((s, r) => s + r.absent, 0);
    const makeupRate  = (totalMakeup + totalAbsent) > 0
      ? Math.round(totalMakeup / (totalMakeup + totalAbsent) * 100)
      : 100;

    wrap.innerHTML = `
      <div class="buke-stat ok">
        <div class="label">平均出席率</div>
        <div class="num">${avgAttend}%</div>
      </div>
      <div class="buke-stat makeup">
        <div class="label">補課完成率</div>
        <div class="num">${makeupRate}%</div>
      </div>
      <div class="buke-stat ok">
        <div class="label">全勤人數</div>
        <div class="num">${perfectCount}</div>
      </div>
      <div class="buke-stat warn">
        <div class="label">勤學人數</div>
        <div class="num">${diligentCount}</div>
      </div>
    `;
  } else {
    // 班長：缺課學員數（absent > 0）、補課將逾期（尚未逾期 && daysLeft ≤14）
    const absentCount  = active.filter(r => r.absent > 0).length;
    const nearExpire   = urgentMakeups.filter(({ mk, daysLeft }) =>
      !mk.is_overdue && daysLeft !== null && daysLeft >= 0
    ).length;

    wrap.innerHTML = `
      <div class="buke-stat ok">
        <div class="label">平均出席率</div>
        <div class="num">${avgAttend}%</div>
      </div>
      <div class="buke-stat ok">
        <div class="label">全勤人數</div>
        <div class="num">${perfectCount}</div>
      </div>
      <div class="buke-stat warn">
        <div class="label">勤學人數</div>
        <div class="num">${diligentCount}</div>
      </div>
      <div class="buke-stat danger">
        <div class="label">缺課學員數</div>
        <div class="num">${absentCount}</div>
      </div>
      <div class="buke-stat danger">
        <div class="label">補課將逾期</div>
        <div class="num">${nearExpire}</div>
      </div>
    `;
  }

  return wrap;
}

/**
 * 🔴 需要關懷（缺課超過3堂）名單，永遠顯示
 * @param {StudentRow[]} active
 * @param {string}       mode  'leader' | 'class'
 * @returns {HTMLElement}
 */
function buildRedLightList(active, mode) {
  // 2026-08-13 補記：缺課堂數由多到少排序，最需要關懷的排最前面
  // （原本沒有排序，順序是資料庫剛好回傳的順序，跟缺課堂數/姓名/組別都無關）
  // 2026-08-13 補記：原本這裡沒有筆數上限，紅燈一多（例如 20 人）就會整批列出，
  // 把頁面拉得很長。改用跟「缺課尚未登記補課」（buildUnregisteredSection）同一套
  // 「預設只顯示前 5 筆＋顯示全部」做法，並在標題直接標出總人數，一眼看出規模。
  const redRows = active.filter(r => r.red_light).sort((a, b) => (b.absent || 0) - (a.absent || 0));
  const VISIBLE_COUNT = 5;

  const wrap = document.createElement('div');
  wrap.className = 'buke-section-block care';

  const h = document.createElement('div');
  h.className = 'buke-section care';
  h.textContent = `🔴 需要關懷（缺課超過3堂，共 ${redRows.length} 人）`;
  wrap.appendChild(h);

  if (!redRows.length) {
    const empty = document.createElement('p');
    empty.style.cssText = 'margin:8px 0 16px;font-size:0.92em;color:var(--muted)';
    empty.textContent = '目前沒有需要關懷的學員';
    wrap.appendChild(empty);
    return wrap;
  }

  const showGroup = mode === 'class';
  const table = document.createElement('table');
  table.className = 'buke-table';
  table.style.cssText = 'font-size:0.92em;margin-bottom:8px';

  const groupTh = showGroup ? '<th style="padding:6px 8px;text-align:left">組別</th>' : '';
  table.innerHTML = `<thead><tr>
    ${groupTh}
    <th style="padding:6px 8px;text-align:left">姓名</th>
    <th style="padding:6px 8px;text-align:left">缺課堂數</th>
    <th style="padding:6px 8px;text-align:left">距結業還差</th>
  </tr></thead>`;

  function buildRow(r) {
    const gap = Math.max(0, r.need_credit - r.total_credit);
    const tr = document.createElement('tr');
    tr.dataset.search = `${r.name || ''} ${r.dharma_name || ''}`.toLowerCase();
    const groupTd = showGroup ? `<td style="padding:5px 8px">${r.group_id || ''}</td>` : '';
    tr.innerHTML = `
      ${groupTd}
      <td style="padding:5px 8px">${r.name}</td>
      <td style="padding:5px 8px;color:var(--danger)">${r.absent} 堂</td>
      <td style="padding:5px 8px">${gap} 堂</td>
    `;
    return tr;
  }

  const visibleRows = redRows.slice(0, VISIBLE_COUNT);
  const hiddenRows  = redRows.slice(VISIBLE_COUNT);

  const tbody = document.createElement('tbody');
  for (const r of visibleRows) tbody.appendChild(buildRow(r));
  table.appendChild(tbody);

  let hiddenTbody = null;
  if (hiddenRows.length) {
    hiddenTbody = document.createElement('tbody');
    hiddenTbody.style.display = 'none';
    for (const r of hiddenRows) hiddenTbody.appendChild(buildRow(r));
    table.appendChild(hiddenTbody);
  }

  wrap.appendChild(table);

  if (hiddenRows.length) {
    const expandBtn = document.createElement('button');
    expandBtn.className = 'buke-expand-btn';
    expandBtn.textContent = `顯示全部 ${redRows.length} 筆 ▾`;
    expandBtn.addEventListener('click', () => {
      if (hiddenTbody) hiddenTbody.style.display = '';
      expandBtn.remove();
    });
    wrap.appendChild(expandBtn);
  }

  return wrap;
}

/**
 * 📝 已登記補課（未逾期，可改時間）— 2026-08-13 新增
 * 緣由：原本學長看板完全沒地方能看到／編輯「已登記、但還沒進即將逾期名單」的補課，
 * 得等剩 14 天內才會在「即將逾期」表現身，看到了也不能改——學長頁面代登記表單
 * （renderProxyMakeupPicker）只吃「還沒登記過」的缺課，已登記的完全沒有編輯入口。
 * 這裡列出所有未逾期的已登記補課，每筆都能開彈窗改時間；已逾期的不收在這裡
 * （逾期只能師父後台改，維持跟義工端 kiosk_edit_makeup 一致的規則），逾期的
 * 只會出現在下面「即將逾期」表，灰字提示、不給按鈕。
 * @param {StudentRow[]} active
 * @param {string} mode        'leader' | 'class'
 * @param {number} leaderDbId
 * @param {object} sb
 * @returns {HTMLElement}
 */
function buildRegisteredMakeupSection(active, mode, leaderDbId, sb) {
  const items = [];
  for (const r of active) {
    for (const mk of (r.makeups || [])) {
      if (!mk.is_overdue) items.push({ row: r, mk });
    }
  }
  items.sort((a, b) => (a.mk.planned_date || '').localeCompare(b.mk.planned_date || ''));

  // 2026-08-13 補記：良師父要求這區可收合、標題標共幾筆，人多的班這區也會拉很長。
  // 整塊改成 <details>，標題列（<summary>）本身可點擊收合／展開，預設展開（維持原本
  // 看得到的行為，只是現在多了能收起來的能力），樣式見 theme.css 的 .buke-collapsible。
  const wrap = document.createElement('details');
  wrap.className = 'buke-section-block makeup buke-collapsible';
  wrap.open = true;
  wrap.dataset.defaultOpen = '1'; // 搜尋清空後要還原成展開（見 render.js 的 filterBoardByName）
  const h = document.createElement('summary');
  h.className = 'buke-section';
  h.innerHTML = `<span>📝 已登記補課</span><span class="buke-collapse-count">（共 ${items.length} 筆）</span><span class="buke-collapse-arrow">▶</span>`;
  wrap.appendChild(h);

  if (!items.length) {
    const p = document.createElement('p');
    p.className = 'buke-empty';
    p.textContent = '目前沒有已登記、未逾期的補課。';
    wrap.appendChild(p);
    return wrap;
  }

  // 手機版排版考量：這裡有操作按鈕，改用卡片（義工端／學員端本來就是這個風格）而不是
  // 表格——實測過表格加操作欄在窄螢幕會被壓到欄位文字一字一行直排，卡片式滿版按鈕才點得到。
  // 包一層 .buke-grid：跟風險卡片牆用同一個 class，搜尋框（filterBoardByName）才抓得到。
  const grid = document.createElement('div');
  grid.className = 'buke-grid';

  for (const { row, mk } of items) {
    const card = document.createElement('div');
    card.className = 'buke-card';
    card.dataset.search = `${row.name || ''} ${row.dharma_name || ''}`.toLowerCase();
    const groupTxt = mode === 'class' && row.group_id ? `　${row.group_id}` : '';

    const top = document.createElement('div');
    top.className = 'row';
    top.style.marginBottom = '4px';
    top.innerHTML = `<span class="name">${row.name}${groupTxt}</span><span class="buke-badge warn">⏳ 待補課</span>`;

    const detail = document.createElement('div');
    detail.className = 'detail';
    detail.innerHTML = `缺課日期：${mk.session_date || ''}<br>預約補課時間：${mk.planned_date || '未填'} ${mk.planned_slot || ''}`;

    const btn = document.createElement('button');
    btn.className = 'buke-btn';
    btn.style.cssText = 'margin-top:8px;width:100%;font-size:14px;padding:8px 0';
    btn.textContent = '改預約時間';
    btn.addEventListener('click', () => {
      window.LeaderActions.renderEditMakeupTimeSheet(sb, mk, row.name, leaderDbId, () => {
        detail.innerHTML = `缺課日期：${mk.session_date || ''}<br>預約補課時間：${mk.planned_date || '未填'} ${mk.planned_slot || ''}`;
      });
    });

    card.appendChild(top);
    card.appendChild(detail);
    card.appendChild(btn);
    grid.appendChild(card);
  }

  wrap.appendChild(grid);
  return wrap;
}

/**
 * ⏰ 即將逾期（已逾期排最前）
 * 2026-08-13：改用卡片＋操作欄——未逾期的可以直接改時間（跟上面「已登記補課」共用
 * 同一個編輯彈窗），已逾期的維持灰字「請洽師父後台」，不給按鈕（逾期只能後台改）。
 * @param {Array}  items      { row, mk, daysLeft }[]
 * @param {string} mode       'leader' | 'class'
 * @param {number} leaderDbId
 * @param {object} sb
 * @returns {HTMLElement}
 */
function buildUrgentSection(items, mode, leaderDbId, sb) {
  const wrap = document.createElement('div');
  wrap.className = 'buke-section-block warn';
  const h = document.createElement('div');
  h.className = 'buke-section warn';
  h.textContent = '⏰ 即將逾期（補課）';
  wrap.appendChild(h);

  const grid = document.createElement('div');
  grid.className = 'buke-grid';

  for (const { row, mk, daysLeft } of items) {
    const card = document.createElement('div');
    card.className = 'buke-card';
    card.dataset.search = `${row.name || ''} ${row.dharma_name || ''}`.toLowerCase();
    const groupTxt = mode === 'class' && row.group_id ? `　${row.group_id}` : '';
    const badge = mk.is_overdue
      ? '<span class="buke-badge danger">已逾期</span>'
      : `<span class="buke-badge warn">剩 ${daysLeft} 天</span>`;

    const top = document.createElement('div');
    top.className = 'row';
    top.style.marginBottom = '4px';
    top.innerHTML = `<span class="name">${row.name}${groupTxt}</span>${badge}`;

    const detail = document.createElement('div');
    detail.className = 'detail';
    detail.innerHTML = `缺課日期：${mk.session_date || ''}　截止日：${mk.deadline_date || ''}`;

    card.appendChild(top);
    card.appendChild(detail);

    if (mk.is_overdue) {
      const note = document.createElement('div');
      note.style.cssText = 'margin-top:8px;font-size:12px;color:var(--muted);text-align:center;padding:6px 0';
      note.textContent = '已逾期，請洽師父後台';
      card.appendChild(note);
    } else {
      const btn = document.createElement('button');
      btn.className = 'buke-btn';
      btn.style.cssText = 'margin-top:8px;width:100%;font-size:14px;padding:8px 0';
      btn.textContent = '改預約時間';
      btn.addEventListener('click', () => {
        window.LeaderActions.renderEditMakeupTimeSheet(sb, mk, row.name, leaderDbId, () => {
          detail.innerHTML = `缺課日期：${mk.session_date || ''}　截止日：${mk.deadline_date || ''}`;
        });
      });
      card.appendChild(btn);
    }

    grid.appendChild(card);
  }

  wrap.appendChild(grid);
  return wrap;
}

/**
 * 📋 缺課尚未登記補課（含補課期限欄）
 * @param {Array}  items      { row, abs }[]
 * @param {string} mode       'leader' | 'class'
 * @param {number} leaderDbId
 * @param {object} sb         Supabase client
 * @returns {HTMLElement}
 */
function buildUnregisteredSection(items, mode, leaderDbId, sb) {
  const showGroup = mode === 'class';
  const today = new Date().toLocaleDateString('sv-SE');
  const VISIBLE_COUNT = 5; // 方案A：預設只顯示前 5 筆，其餘展開才顯示

  // 已超過補課期限的缺課：不給「代為登記補課」（後端也會擋，這裡先擋在前端），
  // 且預設收合，避免逾期一多，畫面被塞滿
  const activeItems  = items.filter(({ abs }) => !(abs.deadline_date && abs.deadline_date < today));
  const overdueItems = items.filter(({ abs }) => abs.deadline_date && abs.deadline_date < today);

  const wrap = document.createElement('div');
  wrap.className = 'buke-section-block makeup';
  const h = document.createElement('div');
  h.className = 'buke-section';
  h.textContent = '📋 缺課尚未登記補課';
  wrap.appendChild(h);

  const groupTh = showGroup ? '<th style="padding:6px 8px;text-align:left">組別</th>' : '';
  const theadHtml = `<thead><tr>
    <th style="padding:6px 8px;text-align:left">姓名</th>
    ${groupTh}
    <th style="padding:6px 8px;text-align:left">缺課日期</th>
    <th style="padding:6px 8px;text-align:left">補課期限</th>
    <th style="padding:6px 8px;text-align:left">標記</th>
    <th style="padding:6px 8px;text-align:left">操作</th>
  </tr></thead>`;

  /** 掛「代為登記補課」按鈕事件（單一列）：直接開全螢幕彈窗 */
  function bindProxyBtn(row, abs) {
    const btn  = document.getElementById(`proxy-btn-${row.id}-${abs.session_ref}`);
    const form = document.getElementById(`proxy-form-${row.id}-${abs.session_ref}`);
    if (btn && window.LeaderActions) {
      btn.addEventListener('click', () => {
        window.LeaderActions.renderProxyMakeupForm(form, sb, row.id, abs.session_ref, leaderDbId, () => {
          btn.textContent = '已登記 ✓';
          btn.disabled = true;
        });
      });
    }
  }

  /** 產生單一 <tr>（overdue=true 時操作欄改顯示「已超過補課期限」，不給按鈕） */
  function buildRow(row, abs, overdue) {
    const btnId  = `proxy-btn-${row.id}-${abs.session_ref}`;
    const formId = `proxy-form-${row.id}-${abs.session_ref}`;
    const groupTd = showGroup ? `<td style="padding:5px 8px">${row.group_id || ''}</td>` : '';
    const opTd = overdue
      ? `<td style="padding:5px 8px;color:var(--danger-tx)">已超過補課期限</td>`
      : `<td style="padding:5px 8px">
           <button id="${btnId}" class="buke-btn small">代為登記補課</button>
           <div id="${formId}" style="display:none;margin-top:6px"></div>
         </td>`;
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td style="padding:5px 8px">${row.name}</td>
      ${groupTd}
      <td style="padding:5px 8px">${abs.session_date || ''}</td>
      <td style="padding:5px 8px">${abs.deadline_date || ''}</td>
      <td style="padding:5px 8px">${(typeof LEADER_MARK_LABEL !== 'undefined' ? LEADER_MARK_LABEL[abs.mark] : null) || abs.mark || ''}</td>
      ${opTd}`;
    return tr;
  }

  /**
   * 產生表格。overdue=false 時支援「預設只顯示前 VISIBLE_COUNT 筆＋展開全部」按鈕，
   * overdue=true（已逾期收合區塊內）維持全部顯示，不再分次展開。
   */
  function buildTable(list, overdue) {
    const table = document.createElement('table');
    table.className = 'buke-table';
    table.style.cssText = 'font-size:0.92em;margin-bottom:8px';
    table.innerHTML = theadHtml;

    const visibleList = overdue ? list : list.slice(0, VISIBLE_COUNT);
    const hiddenList  = overdue ? []   : list.slice(VISIBLE_COUNT);

    const tbody = document.createElement('tbody');
    for (const { row, abs } of visibleList) tbody.appendChild(buildRow(row, abs, overdue));
    table.appendChild(tbody);

    let hiddenTbody = null;
    if (hiddenList.length) {
      hiddenTbody = document.createElement('tbody');
      hiddenTbody.style.display = 'none';
      for (const { row, abs } of hiddenList) hiddenTbody.appendChild(buildRow(row, abs, overdue));
      table.appendChild(hiddenTbody);
    }

    if (!overdue) {
      setTimeout(() => {
        for (const { row, abs } of visibleList) bindProxyBtn(row, abs);
        for (const { row, abs } of hiddenList)  bindProxyBtn(row, abs);
      }, 0);
    }

    return { table, hiddenCount: hiddenList.length };
  }

  if (activeItems.length) {
    const { table, hiddenCount } = buildTable(activeItems, false);
    wrap.appendChild(table);
    if (hiddenCount) {
      const expandBtn = document.createElement('button');
      expandBtn.className = 'buke-expand-btn';
      expandBtn.textContent = `顯示全部 ${activeItems.length} 筆 ▾`;
      expandBtn.addEventListener('click', () => {
        const hiddenTbody = table.querySelectorAll('tbody')[1];
        if (hiddenTbody) hiddenTbody.style.display = '';
        expandBtn.remove();
      });
      wrap.appendChild(expandBtn);
    }
  } else {
    const p = document.createElement('p');
    p.className = 'buke-empty';
    p.textContent = '目前沒有還在期限內、尚未登記補課的缺課。';
    wrap.appendChild(p);
  }

  if (overdueItems.length) {
    const details = document.createElement('details');
    details.style.marginBottom = '12px';
    const summary = document.createElement('summary');
    summary.style.cssText = 'cursor:pointer;font-size:0.9em;color:var(--danger-tx)';
    summary.textContent = `已超過補課期限（${overdueItems.length} 筆，預設收合）`;
    details.appendChild(summary);
    details.appendChild(buildTable(overdueItems, true).table);
    wrap.appendChild(details);
  }

  return wrap;
}
