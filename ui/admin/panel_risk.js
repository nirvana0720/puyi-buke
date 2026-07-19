// 職責：結業風險總表——依班分組，只列紅燈（結業已不可逆）與黃燈（逾期未補剛好3堂，最後緩衝）
// 2026-07-03 修正：紅/黃燈判斷改回跟結業達標（grad_ok）同一套公式，不用「缺課總數」
// （那是「勤學狀態」的標準，跟結業是否還救得回來是兩件事——缺課總數高但目前沒有欠補、實體出席還夠的人，
// 結業並沒有卡住，不該顯示「不可逆」）。
// 紅燈＝結業數學上已經不可能達標（即使剩下的堂次全出席／全補課也補不回來）；
// 黃燈＝逾期未補（overdue_absent）剛好卡在門檻上限（3 堂），再逾期一堂沒補就會變不可逆；
// 2026-07-03 二次修正：黃燈跟文字說明改用「逾期未補」（overdue_absent）而非「目前還沒補的」（absent），
// 因為還沒過期的缺課本來就還救得回來，真正決定會不會變紅燈的是逾期未補的數量，用這個數字才準確。

'use strict';

(function () {
  const { fetchClasses, compareClassSchedule } = window.AdminData;

  let _allRows       = [];
  let _scheduleMap   = new Map();
  let _searchName    = '';
  let _selectedClass = '';   // '' = 全部班別，否則存 class_ref（字串比對，select value 一律字串）
  let _selectedLight = '';   // '' = 全部燈號，'red' / 'yellow'

  async function loadRiskPanel(sb, container) {
    container.innerHTML = '<p class="buke-empty">載入中…</p>';
    try {
      const [{ data, error }, classes] = await Promise.all([
        sb.rpc('admin_student_stats', {}),
        fetchClasses(sb),
      ]);
      if (error) throw new Error(error.message);
      if (!data || !data.length) {
        container.innerHTML = '<p class="buke-empty">目前沒有進行中的班別資料。</p>';
        return;
      }
      _allRows       = data;
      _scheduleMap   = new Map(classes.map(c => [c.id, c]));
      _searchName    = '';
      _selectedClass = '';
      _selectedLight = '';
      renderRiskShell(container);
      renderRiskBody(container);
    } catch (e) {
      container.innerHTML = `<div class="buke-msg err">❌ ${e.message}</div>`;
    }
  }

  /** 是否結業已不可逆（跟 panel_overview.js 的 isRed 同一套公式，統一維護）
   *  2026-07-03 修正：不再用「目前還沒補的>3」無條件觸發（還沒過期的都還能補）。
   *  改用 overdue_absent（已經過補課期限、永久救不回來的堂數）：
   *  - overdue_absent > 3 → 官方「缺課≤3」門檻已經永久破功，不可逆
   *  - 剩餘堂數全出席 + 還沒過期的缺課全部補完，最好情況下還是湊不到門檻 → 不可逆
   *  這樣一開課、大家都還沒上幾堂課時不會誤判紅燈（remaining 還很多，early-term 不會觸發）。 */
  function isUnrecoverable(r) {
    const held         = r.phys + r.absent + r.makeup;
    const remaining    = r.total - held;
    const needPhysical = Math.ceil(r.cap / 2);
    const needCredit   = r.cap - 3;
    const totalCredit  = r.phys + r.makeup;
    const stillFixable = r.absent - r.overdue_absent; // 目前還沒補、但還沒過期、還救得回來的堂數
    return (r.phys + remaining) < needPhysical
      || r.overdue_absent > 3
      || (totalCredit + remaining + stillFixable) < needCredit;
  }

  /** 姓名／班別篩選後的資料來源，供 renderRiskBody／CSV 匯出共用 */
  function filteredRows() {
    return _allRows.filter(r =>
      (!_searchName || r.name.toLowerCase().includes(_searchName)) &&
      (!_selectedClass || String(r.class_ref) === _selectedClass)
    );
  }

  /** 分燈號＋依班分組（跟畫面上看到的一致，供表格渲染／CSV 匯出共用，避免各算一份） */
  function computeRiskGroups(rows) {
    // 分燈號：已達標(grad_ok) 一律不顯示；紅＝結業已不可逆；黃＝逾期未補剛好3堂（最後緩衝）
    // 再套用燈號篩選（_selectedLight）：選了紅燈就不算黃燈進 atRisk，反之亦然
    const redRows    = _selectedLight === 'yellow' ? [] :
      rows.filter(r => !r.grad_ok && isUnrecoverable(r));
    const yellowRows = _selectedLight === 'red' ? [] :
      rows.filter(r => !r.grad_ok && !isUnrecoverable(r) && r.overdue_absent === 3);
    const atRisk     = [...redRows, ...yellowRows];

    // 依班分組
    const classMap = new Map();
    for (const r of atRisk) {
      if (!classMap.has(r.class_ref)) {
        classMap.set(r.class_ref, { class_name: r.class_name, red: [], yellow: [] });
      }
      const entry = classMap.get(r.class_ref);
      if (isUnrecoverable(r)) entry.red.push(r);
      else                    entry.yellow.push(r);
    }
    // 依星期一～日排序（同星期日間排夜間前面），下面兩個迴圈（CSV／畫面）共用這個排序後的陣列
    const sortedClassEntries = [...classMap.entries()].sort(([refA], [refB]) =>
      compareClassSchedule(_scheduleMap.get(refA), _scheduleMap.get(refB)));

    return { atRisk, sortedClassEntries };
  }

  function buildCsv(sortedClassEntries) {
    const csvRows = [['班別','燈號','姓名','組別','出席','缺課(未補)','補課','逾期未補日期','原因']];
    for (const [, cls] of sortedClassEntries) {
      for (const r of [...cls.red, ...cls.yellow]) {
        const red    = isUnrecoverable(r);
        const light  = red ? '🔴紅' : '🟡黃';
        const dates  = (r.overdue_dates || []).join('、');
        const reason = red
          ? `逾期未補 ${r.overdue_absent} 堂（超標，不可逆）`
          : `逾期未補 ${r.overdue_absent} 堂（最後緩衝，再逾期一堂就不可逆）`;
        csvRows.push([cls.class_name, light, r.name, r.group_id || '', r.phys, r.absent, r.makeup, dates, reason]);
      }
    }
    return csvRows.map(row => row.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
  }

  /** 依目前資料算出去重、排序過的班別清單，供班別篩選下拉選單用 */
  function distinctSortedClasses() {
    const seen = new Map();
    for (const r of _allRows) {
      if (!seen.has(r.class_ref)) seen.set(r.class_ref, r.class_name);
    }
    return [...seen.entries()].sort(([refA], [refB]) =>
      compareClassSchedule(_scheduleMap.get(refA), _scheduleMap.get(refB)));
  }

  /** 篩選說明列＋姓名搜尋框＋班別/燈號篩選＋匯出 CSV 按鈕，只執行一次；#risk-content 交給 renderRiskBody 反覆重繪 */
  function renderRiskShell(container) {
    const classOptions = distinctSortedClasses()
      .map(([ref, name]) => `<option value="${ref}"${_selectedClass === String(ref) ? ' selected' : ''}>${name}</option>`)
      .join('');

    container.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;flex-wrap:wrap;gap:8px">
        <p style="font-size:14px;color:var(--muted);margin:0">
          🔴 逾期未補超過 3 堂（不可逆）　🟡 逾期未補剛好 3 堂（最後緩衝，再逾期一堂就不可逆）
          已達標或緩衝充足的不顯示。
        </p>
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
          <select id="risk-filter-class" class="buke-select" style="font-size:14px;min-height:34px">
            <option value="">全部班別</option>
            ${classOptions}
          </select>
          <select id="risk-filter-light" class="buke-select" style="font-size:14px;min-height:34px">
            <option value="">全部燈號</option>
            <option value="red"${_selectedLight === 'red' ? ' selected' : ''}>🔴 紅燈</option>
            <option value="yellow"${_selectedLight === 'yellow' ? ' selected' : ''}>🟡 黃燈</option>
          </select>
          <input id="risk-search-name" class="buke-input" placeholder="搜尋姓名" style="font-size:14px;min-height:34px">
          <button id="btn-export-risk" class="buke-btn buke-btn-ghost" style="font-size:13px;padding:5px 14px;min-height:34px">
            匯出 CSV
          </button>
        </div>
      </div>
      <div id="risk-content"></div>`;

    container.querySelector('#risk-search-name').addEventListener('input', e => {
      _searchName = e.target.value.trim().toLowerCase();
      renderRiskBody(container);
    });

    container.querySelector('#risk-filter-class').addEventListener('change', e => {
      _selectedClass = e.target.value;
      renderRiskBody(container);
    });

    container.querySelector('#risk-filter-light').addEventListener('change', e => {
      _selectedLight = e.target.value;
      renderRiskBody(container);
    });

    container.querySelector('#btn-export-risk').addEventListener('click', () => {
      const { sortedClassEntries } = computeRiskGroups(filteredRows());
      const csv  = buildCsv(sortedClassEntries);
      const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      a.href = url;
      a.download = `結業風險總表_${new Date().toLocaleDateString('sv-SE')}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    });
  }

  /** 依目前 _searchName 篩選後重繪 #risk-content，不動搜尋框所在的外層 */
  function renderRiskBody(container) {
    const contentEl = container.querySelector('#risk-content');
    if (!contentEl) return;

    const { atRisk, sortedClassEntries } = computeRiskGroups(filteredRows());

    if (!atRisk.length) {
      contentEl.innerHTML = _searchName
        ? `<p class="buke-empty" style="padding:40px 0">查無符合姓名的風險學員。</p>`
        : `<p class="buke-empty" style="padding:40px 0">🎉 目前沒有結業風險或逼近門檻的學員，無風險名單。</p>`;
      return;
    }

    let html = '';
    for (const [, cls] of sortedClassEntries) {
      html += `<div style="margin-bottom:24px">
        <div class="buke-section" style="margin-bottom:8px">${cls.class_name}</div>
        <table style="width:100%;border-collapse:collapse;font-size:15px">
          <thead>
            <tr style="border-bottom:2px solid var(--line);color:var(--muted);font-size:13px">
              <th style="text-align:left;padding:6px 10px">燈</th>
              <th style="text-align:left;padding:6px 10px">姓名</th>
              <th style="text-align:left;padding:6px 10px">組別</th>
              <th style="text-align:center;padding:6px 8px">出席</th>
              <th style="text-align:center;padding:6px 8px">缺課(未補)</th>
              <th style="text-align:center;padding:6px 8px">補課</th>
              <th style="text-align:left;padding:6px 10px">逾期未補日期</th>
              <th style="text-align:left;padding:6px 10px">原因</th>
            </tr>
          </thead>
          <tbody>`;

      for (const r of cls.red) {
        html += riskRow(r, 'red');
      }
      for (const r of cls.yellow) {
        html += riskRow(r, 'yellow');
      }

      html += `</tbody></table></div>`;
    }

    contentEl.innerHTML = html;
  }

  function riskRow(r, type) {
    const light   = type === 'red'
      ? '<span style="color:var(--danger-tx)">🔴</span>'
      : '<span style="color:var(--warn-tx)">🟡</span>';
    const reason  = type === 'red'
      ? `<span style="color:var(--danger-tx)">逾期未補 ${r.overdue_absent} 堂（超標，不可逆）</span>`
      : `<span style="color:var(--warn-tx)">逾期未補 ${r.overdue_absent} 堂（最後緩衝，再逾期一堂就不可逆）</span>`;
    const rowBg   = type === 'red' ? 'var(--danger-bg)' : 'var(--warn-bg)';
    const dates   = (r.overdue_dates && r.overdue_dates.length)
      ? `<span style="color:var(--danger-tx)">${r.overdue_dates.join('、')}</span>`
      : '<span style="color:var(--muted)">—</span>';
    return `<tr style="border-bottom:1px solid var(--line);background:${rowBg}">
      <td style="padding:8px 10px">${light}</td>
      <td style="padding:8px 10px;font-weight:500">${r.name}</td>
      <td style="padding:8px 10px;color:var(--muted)">${r.group_id || '—'}</td>
      <td style="text-align:center;padding:8px">${r.phys}</td>
      <td style="text-align:center;padding:8px">${r.absent}</td>
      <td style="text-align:center;padding:8px">${r.makeup}</td>
      <td style="padding:8px 10px">${dates}</td>
      <td style="padding:8px 10px">${reason}</td>
    </tr>`;
  }

  window.PanelRisk = { loadRiskPanel };
})();
