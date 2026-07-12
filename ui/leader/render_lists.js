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
  const redRows = active.filter(r => r.red_light);

  const wrap = document.createElement('div');
  wrap.className = 'buke-section-block care';

  const h = document.createElement('div');
  h.className = 'buke-section care';
  h.textContent = '🔴 需要關懷（缺課超過3堂）';
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
  table.style.cssText = 'font-size:0.92em;margin-bottom:12px';

  const groupTh = showGroup ? '<th style="padding:6px 8px;text-align:left">組別</th>' : '';
  table.innerHTML = `<thead><tr>
    ${groupTh}
    <th style="padding:6px 8px;text-align:left">姓名</th>
    <th style="padding:6px 8px;text-align:left">缺課堂數</th>
    <th style="padding:6px 8px;text-align:left">距結業還差</th>
  </tr></thead>`;

  const tbody = document.createElement('tbody');
  for (const r of redRows) {
    const gap = Math.max(0, r.need_credit - r.total_credit);
    const tr = document.createElement('tr');
    const groupTd = showGroup ? `<td style="padding:5px 8px">${r.group_id || ''}</td>` : '';
    tr.innerHTML = `
      ${groupTd}
      <td style="padding:5px 8px">${r.name}</td>
      <td style="padding:5px 8px;color:var(--danger)">${r.absent} 堂</td>
      <td style="padding:5px 8px">${gap} 堂</td>
    `;
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  wrap.appendChild(table);
  return wrap;
}

/**
 * ⏰ 即將逾期（已逾期排最前）
 * @param {Array}  items  { row, mk, daysLeft }[]
 * @param {string} mode   'leader' | 'class'
 * @returns {HTMLElement}
 */
function buildUrgentSection(items, mode) {
  const showGroup = mode === 'class';

  const wrap = document.createElement('div');
  wrap.className = 'buke-section-block warn';
  const h = document.createElement('div');
  h.className = 'buke-section warn';
  h.textContent = '⏰ 即將逾期（補課）';
  wrap.appendChild(h);

  const table = document.createElement('table');
  table.className = 'buke-table';
  table.style.cssText = 'font-size:0.92em;margin-bottom:12px';

  const groupTh = showGroup ? '<th style="padding:6px 8px;text-align:left">組別</th>' : '';
  table.innerHTML = `<thead><tr>
    <th style="padding:6px 8px;text-align:left">姓名</th>
    ${groupTh}
    <th style="padding:6px 8px;text-align:left">缺課日期</th>
    <th style="padding:6px 8px;text-align:left">截止日</th>
    <th style="padding:6px 8px;text-align:left">狀態</th>
  </tr></thead>`;

  const tbody = document.createElement('tbody');
  for (const { row, mk, daysLeft } of items) {
    const statusTxt = mk.is_overdue
      ? '<span style="color:var(--danger)">已逾期</span>'
      : `<span style="color:var(--warn)">剩 ${daysLeft} 天</span>`;
    const groupTd = showGroup ? `<td style="padding:5px 8px">${row.group_id || ''}</td>` : '';
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td style="padding:5px 8px">${row.name}</td>
      ${groupTd}
      <td style="padding:5px 8px">${mk.session_date || ''}</td>
      <td style="padding:5px 8px">${mk.deadline_date || ''}</td>
      <td style="padding:5px 8px">${statusTxt}</td>`;
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  wrap.appendChild(table);
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
