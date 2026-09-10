// 職責：學員總表——全部在學學員，可篩選班/組、排序距結業/可勤學待補

'use strict';

(function () {
  const { fetchClasses, compareClassSchedule } = window.AdminData;

  let _allRows  = [];
  let _filterClass = null;
  let _filterGroup = '';
  let _searchName  = '';
  let _sortKey     = 'short';   // 'short' | 'pending'
  let _scheduleMap = new Map(); // class_ref → {day_of_week, day_night}（供班別下拉依星期排序）

  let _sb = null;
  let _container = null; // 2026-09-10：記住外層容器，補登/編輯出缺勤成功後要拿它刷新學員總表

  async function loadStudentsPanel(sb, container, opts) {
    // opts: { classRef, className } 從各班總覽的「看名單」帶入
    _sb = sb;
    _container = container;
    _filterClass = opts?.classRef  ?? null;
    _filterGroup = '';
    _sortKey     = 'short';

    container.innerHTML = '<p class="buke-empty">載入中…</p>';
    try {
      // fetchAllStudentStats：分批抓全部學員統計，避免 Supabase 單次 1000 筆上限漏資料
      // （主檔在 admin.js，各班總覽／結業風險總表共用同一份，見該檔案註解）
      const [rows, classes] = await Promise.all([
        fetchAllStudentStats(sb),
        fetchClasses(sb),
      ]);
      _allRows = rows;
      _scheduleMap = new Map(classes.map(c => [c.id, c]));
      renderStudentsShell(container, opts);
      applyAndRender(container);
    } catch (e) {
      container.innerHTML = `<div class="buke-msg err">❌ ${e.message}</div>`;
    }
  }

  /** 2026-09-10：出缺勤明細視窗裡編輯／新增成功後，重新抓 admin_student_stats 並刷新
   *  外層「學員總表」——原本編輯只會刷新彈出視窗自己，外層總表的出席/缺課/勤學狀態
   *  是進面板時抓的一次性快照，補登完不會自動更新，容易讓人誤以為沒存到。 */
  async function refreshStudentsList() {
    if (!_sb) return;
    try {
      _allRows = await fetchAllStudentStats(_sb);
      if (_container) applyAndRender(_container);
    } catch (_) {
      // 靜默失敗即可：明細視窗本身已經刷新成功，外層總表頂多要等下次進面板才會更新
    }
  }

  /** 建立篩選工具列 shell */
  function renderStudentsShell(container, opts) {
    // 取班別清單，依星期一～日排序（同星期日間排夜間前面）
    const classOpts = [...new Map(_allRows.map(r => [r.class_ref, r.class_name])).entries()]
      .sort(([refA], [refB]) => compareClassSchedule(_scheduleMap.get(refA), _scheduleMap.get(refB)))
      .map(([id, name]) => `<option value="${id}"${_filterClass === id ? ' selected' : ''}>${name}</option>`)
      .join('');

    container.innerHTML = `
      <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin-bottom:14px">
        <input id="st-search-name" class="buke-input" placeholder="搜尋姓名" style="font-size:14px;min-height:36px" value="${_searchName}">
        <select id="st-sel-class" class="buke-select" style="font-size:14px;min-height:36px">
          <option value="">全部班別</option>${classOpts}
        </select>
        <select id="st-sel-group" class="buke-select" style="font-size:14px;min-height:36px;min-width:120px">
          <option value="">全部組別</option>
        </select>
        <label style="font-size:14px;color:var(--muted)">排序：
          <select id="st-sort" class="buke-select" style="font-size:14px;min-height:36px">
            <option value="short" ${_sortKey==='short' ? 'selected':''}>距結業（差最多的在前）</option>
            <option value="pending" ${_sortKey==='pending' ? 'selected':''}>可勤學待補（多的在前）</option>
          </select>
        </label>
        <button id="btn-export-st" class="buke-btn buke-btn-ghost" style="font-size:13px;padding:5px 14px;min-height:34px">
          匯出 CSV
        </button>
      </div>
      <div id="st-count" style="font-size:14px;color:var(--muted);margin-bottom:10px"></div>
      <div id="st-table"></div>`;

    // 若從總覽帶入班別，更新組別下拉
    if (_filterClass) refreshGroupOpts(container);

    container.querySelector('#st-search-name').addEventListener('input', e => {
      _searchName = e.target.value.trim().toLowerCase();
      applyAndRender(container);
    });
    container.querySelector('#st-sel-class').addEventListener('change', e => {
      _filterClass = e.target.value ? Number(e.target.value) : null;
      _filterGroup = '';
      refreshGroupOpts(container);
      applyAndRender(container);
    });
    container.querySelector('#st-sel-group').addEventListener('change', e => {
      _filterGroup = e.target.value;
      applyAndRender(container);
    });
    container.querySelector('#st-sort').addEventListener('change', e => {
      _sortKey = e.target.value;
      applyAndRender(container);
    });
    container.querySelector('#btn-export-st').addEventListener('click', () => exportCsv(filtered()));
  }

  function refreshGroupOpts(container) {
    const base = _filterClass
      ? _allRows.filter(r => r.class_ref === _filterClass)
      : _allRows;
    const groups = [...new Set(base.map(r => r.group_id).filter(Boolean))]
      .sort(window.AdminData?.compareGroupNames);
    const sel = container.querySelector('#st-sel-group');
    if (!sel) return;
    sel.innerHTML = '<option value="">全部組別</option>'
      + groups.map(g => `<option value="${g}"${_filterGroup === g ? ' selected' : ''}>${g}</option>`).join('');
  }

  function filtered() {
    return _allRows.filter(r =>
      (!_filterClass || r.class_ref === _filterClass) &&
      (!_filterGroup || r.group_id  === _filterGroup) &&
      (!_searchName  || r.name.toLowerCase().includes(_searchName))
    );
  }

  function sorted(rows) {
    return [...rows].sort((a, b) => {
      if (_sortKey === 'pending') {
        // 可勤學（待補多）排前；其他排後
        const pa = a.diligent === '可勤學' ? a.absent : -1;
        const pb = b.diligent === '可勤學' ? b.absent : -1;
        return pb - pa || b.short - a.short;
      }
      // 距結業（short 大的排前）；同差幾堂時，缺課總數（含已補）多的排前，跟勤學狀態的嚴重度對齊
      return b.short - a.short || b.total_absent - a.total_absent;
    });
  }

  function applyAndRender(container) {
    const rows  = sorted(filtered());
    const count = container.querySelector('#st-count');
    const table = container.querySelector('#st-table');
    if (count) count.textContent = `共 ${rows.length} 位學員`;
    if (!table) return;
    if (!rows.length) { table.innerHTML = '<p class="buke-empty">沒有符合的學員。</p>'; return; }

    const th = 'text-align:left;padding:6px 10px;position:sticky;top:0;background:var(--surface);'
             + 'border-bottom:2px solid var(--line);color:var(--muted);font-size:13px;z-index:1';
    const thC = th.replace('text-align:left', 'text-align:center').replace('padding:6px 10px', 'padding:6px 8px');
    table.innerHTML = `
      <table style="width:100%;border-collapse:collapse;font-size:15px">
        <thead>
          <tr>
            <th style="${th}">姓名</th>
            <th style="${th}">班別／組</th>
            <th style="${thC}">出席</th>
            <th style="${thC}">缺課</th>
            <th style="${thC}">補課</th>
            <th style="${th}" title="結業門檻堂數（總堂數−3，超過20堂以20計算）減去目前「出席＋補課」，不是班級剩餘堂數">距結業</th>
            <th style="${th}">勤學狀態</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map(studentRow).join('')}
        </tbody>
      </table>`;

    table.querySelectorAll('.btn-view-student').forEach(btn => {
      btn.addEventListener('click', () => {
        openStudentDetail(Number(btn.dataset.memberDbId), btn.dataset.name);
      });
    });
  }

  // ── 學員明細（點姓名跳出，顯示每堂出缺勤＋補課紀錄）────────────

  async function openStudentDetail(memberDbId, name) {
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.4);z-index:9999;'
      + 'display:flex;align-items:center;justify-content:center;padding:20px';
    overlay.innerHTML = `
      <div class="buke-card" style="max-width:640px;width:100%;max-height:85vh;overflow-y:auto;background:var(--surface)">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px">
          <div style="font-size:18px;font-weight:500">${name} 的出缺勤明細</div>
          <button class="buke-btn buke-btn-ghost btn-close-detail" style="font-size:13px;padding:5px 12px;min-height:32px">關閉</button>
        </div>
        <div id="detail-body"><p class="buke-empty">載入中…</p></div>
      </div>`;
    document.body.appendChild(overlay);

    const close = () => overlay.remove();
    overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
    overlay.querySelector('.btn-close-detail').addEventListener('click', close);

    const body = overlay.querySelector('#detail-body');
    await loadAndRenderDetail(memberDbId, body);
  }

  /** 重新抓 get_student_view + admin_list_member_sessions 並整包重繪明細視窗
   *  （編輯／新增出缺勤成功或取消後都靠這支刷新）
   *  2026-09-08：改用 admin_list_member_sessions 取得「全部堂次」（含未登記），
   *  不再只靠 get_student_view.attendance（只有已有紀錄的堂次），
   *  這樣沒登記的堂次才有辦法在畫面上顯示出來、補登。 */
  async function loadAndRenderDetail(memberDbId, body) {
    try {
      const [{ data, error }, sessRes] = await Promise.all([
        _sb.rpc('get_student_view', { p_member_db_id: memberDbId }),
        _sb.rpc('admin_list_member_sessions', { p_member_db_id: memberDbId }),
      ]);
      if (error) throw new Error(error.message);
      if (!data) { body.innerHTML = '<p class="buke-empty">查無資料。</p>'; return; }
      if (sessRes.error) throw new Error(sessRes.error.message);
      const sessions = sessRes.data || [];
      body.innerHTML = renderStudentDetail(data, sessions);
      wireAttendanceEdit(body, data, sessions, memberDbId);
    } catch (e) {
      body.innerHTML = `<div class="buke-msg err">❌ ${e.message}</div>`;
    }
  }

  const MARK_LABEL = {
    V: '出席', L: '遲到', LL: '靜坐遲到', A: '晚到', O: '請假/缺席', M: '補課', ML: '靜坐補課',
    D: '日補', N: '夜補', E: '早退', W: '公假', X: '中輟', S1: '特殊1', S2: '特殊2', S3: '特殊3',
  };
  const MARK_OPTIONS = ['V', 'L', 'LL', 'A', 'O', 'M', 'ML', 'D', 'N', 'E', 'W', 'X', 'S1', 'S2', 'S3'];
  const SOURCE_LABEL = { manual: '人工登打', api: '刷卡同步' };

  /** 幫每一列出缺勤掛上「編輯」／「新增」互動：改標記，或幫沒有紀錄的堂次補登一筆，
   *  遇到對應補課登記時詢問是否一併刪除
   *  2026-09-08：sessions 是該學員班別「全部堂次」（含未登記的），沒紀錄的堂次
   *  顯示「新增」，按下去呼叫 admin_add_attendance_mark 而不是 admin_edit_attendance_mark */
  function wireAttendanceEdit(body, v, sessions, memberDbId) {
    function bindBtns(tr) {
      tr.querySelector('.btn-edit-att')?.addEventListener('click', () => enterEditMode(tr));
      tr.querySelector('.btn-add-att')?.addEventListener('click', () => enterEditMode(tr));
    }

    function enterEditMode(tr) {
      const markCell    = tr.querySelector('.cell-mark');
      const actionsCell = tr.querySelector('.cell-actions');
      const currentMark = markCell.dataset.mark || '';

      markCell.innerHTML = `
        <select class="sel-edit-mark buke-select" style="font-size:13px;padding:4px 6px;min-height:30px">
          ${MARK_OPTIONS.map(m => `<option value="${m}"${m === currentMark ? ' selected' : ''}>${m}（${MARK_LABEL[m]}）</option>`).join('')}
        </select>`;
      actionsCell.innerHTML = `
        <button class="buke-btn btn-save-att" style="font-size:12px;padding:3px 10px;min-height:28px">儲存</button>
        <button class="buke-btn buke-btn-ghost btn-cancel-att" style="font-size:12px;padding:3px 10px;min-height:28px">取消</button>
        <div class="att-edit-msg" style="font-size:13px;margin-top:6px"></div>`;

      actionsCell.querySelector('.btn-cancel-att').addEventListener('click', () => exitEditMode(tr));
      actionsCell.querySelector('.btn-save-att').addEventListener('click', () => confirmAndSave(tr));
    }

    function exitEditMode(tr) {
      const s = sessions.find(x => String(x.session_id) === tr.dataset.sessionId);
      const hasRecord   = !!(s && s.attendance_id);
      const markCell    = tr.querySelector('.cell-mark');
      const actionsCell = tr.querySelector('.cell-actions');
      markCell.dataset.mark = (hasRecord ? s.mark : '') || '';
      markCell.textContent  = hasRecord ? (MARK_LABEL[s.mark] || s.mark || '—') : '未登記';
      actionsCell.innerHTML = hasRecord
        ? `<button class="buke-btn buke-btn-ghost btn-edit-att" style="font-size:12px;padding:3px 10px;min-height:28px">編輯</button>`
        : `<button class="buke-btn btn-add-att" style="font-size:12px;padding:3px 10px;min-height:28px">新增</button>`;
      bindBtns(tr);
    }

    function confirmAndSave(tr) {
      const newMark    = tr.querySelector('.sel-edit-mark').value;
      const sessionId  = tr.dataset.sessionId;
      const matched    = (v.makeups || []).find(mk => String(mk.session_ref) === sessionId);
      const msgEl      = tr.querySelector('.att-edit-msg');

      if (matched) {
        msgEl.innerHTML = `
          <div style="padding:8px;background:var(--surface);border:1px solid var(--line);border-radius:var(--r-md)">
            這堂課已有登記補課，是否一併刪除補課登記？
            <div style="display:flex;gap:8px;margin-top:6px;flex-wrap:wrap">
              <button class="buke-btn btn-confirm-yes" style="font-size:12px;padding:3px 10px;min-height:28px">是，一併刪除</button>
              <button class="buke-btn buke-btn-ghost btn-confirm-no" style="font-size:12px;padding:3px 10px;min-height:28px">否，只改標記</button>
              <button class="buke-btn buke-btn-ghost btn-confirm-cancel" style="font-size:12px;padding:3px 10px;min-height:28px">取消整個編輯</button>
            </div>
          </div>`;
        msgEl.querySelector('.btn-confirm-yes').addEventListener('click', () => doSave(tr, newMark, true));
        msgEl.querySelector('.btn-confirm-no').addEventListener('click', () => doSave(tr, newMark, false));
        msgEl.querySelector('.btn-confirm-cancel').addEventListener('click', () => exitEditMode(tr));
      } else {
        doSave(tr, newMark, false);
      }
    }

    async function doSave(tr, newMark, deleteMakeup) {
      const attendanceId = tr.dataset.attendanceId ? Number(tr.dataset.attendanceId) : null;
      const sessionId     = Number(tr.dataset.sessionId);
      const msgEl = tr.querySelector('.att-edit-msg');
      if (msgEl) msgEl.innerHTML = '<span style="color:var(--muted)">儲存中…</span>';
      try {
        const { error } = attendanceId
          ? await _sb.rpc('admin_edit_attendance_mark', {
              p_attendance_id: attendanceId,
              p_new_mark: newMark,
              p_delete_makeup: deleteMakeup,
            })
          : await _sb.rpc('admin_add_attendance_mark', {
              p_member_ref: memberDbId,
              p_session_ref: sessionId,
              p_new_mark: newMark,
              p_delete_makeup: deleteMakeup,
            });
        if (error) throw new Error(error.message);
        await loadAndRenderDetail(memberDbId, body);
        await refreshStudentsList();
      } catch (e) {
        if (msgEl) msgEl.innerHTML = `<div class="buke-msg err">❌ ${e.message}</div>`;
      }
    }

    body.querySelectorAll('tr[data-session-id]').forEach(bindBtns);
  }

  function renderStudentDetail(v, sessions) {
    const makeups = v.makeups || [];

    const attRows = (sessions && sessions.length)
      ? sessions.map(s => {
          const hasRecord = !!s.attendance_id;
          return `
        <tr style="border-bottom:1px solid var(--line)"${hasRecord ? ` data-attendance-id="${s.attendance_id}"` : ''} data-session-id="${s.session_id}">
          <td style="padding:6px 10px">${s.date}</td>
          <td style="padding:6px 10px;text-align:center">${s.week_num ?? '—'}</td>
          <td class="cell-mark" style="padding:6px 10px" data-mark="${s.mark || ''}">${hasRecord ? (MARK_LABEL[s.mark] || s.mark || '—') : '未登記'}</td>
          <td style="padding:6px 10px;color:var(--muted);font-size:13px">${SOURCE_LABEL[s.source] || s.source || ''}</td>
          <td class="cell-actions" style="padding:6px 10px">
            ${hasRecord
              ? `<button class="buke-btn buke-btn-ghost btn-edit-att" style="font-size:12px;padding:3px 10px;min-height:28px">編輯</button>`
              : `<button class="buke-btn btn-add-att" style="font-size:12px;padding:3px 10px;min-height:28px">新增</button>`}
          </td>
        </tr>`;
        }).join('')
      : `<tr><td colspan="5" style="padding:10px;color:var(--muted)">尚無堂次資料</td></tr>`;

    const makeupRows = makeups.length
      ? makeups.map(mk => `
        <tr style="border-bottom:1px solid var(--line)">
          <td style="padding:6px 10px">${mk.session_date}</td>
          <td style="padding:6px 10px">${mk.method || '—'}</td>
          <td style="padding:6px 10px">
            <span class="buke-badge ${mk.status === '已完成' ? 'pass' : 'warn'}">${mk.status}</span>
          </td>
          <td style="padding:6px 10px">${mk.planned_date || '—'}</td>
          <td style="padding:6px 10px">${mk.completed_date || '—'}</td>
          <td style="padding:6px 10px;color:var(--muted);font-size:13px">${mk.deadline_date || '—'}</td>
        </tr>`).join('')
      : `<tr><td colspan="6" style="padding:10px;color:var(--muted)">尚無補課紀錄</td></tr>`;

    return `
      <div class="buke-section" style="margin-bottom:8px">每堂出缺勤</div>
      <div style="overflow-x:auto;margin-bottom:20px">
        <table style="width:100%;border-collapse:collapse;font-size:14px">
          <thead>
            <tr style="border-bottom:2px solid var(--line);color:var(--muted);font-size:13px">
              <th style="text-align:left;padding:6px 10px">日期</th>
              <th style="text-align:center;padding:6px 10px">第幾堂</th>
              <th style="text-align:left;padding:6px 10px">標記</th>
              <th style="text-align:left;padding:6px 10px">來源</th>
              <th style="text-align:left;padding:6px 10px">操作</th>
            </tr>
          </thead>
          <tbody>${attRows}</tbody>
        </table>
      </div>

      <div class="buke-section" style="margin-bottom:8px">補課紀錄</div>
      <div style="overflow-x:auto">
        <table style="width:100%;border-collapse:collapse;font-size:14px">
          <thead>
            <tr style="border-bottom:2px solid var(--line);color:var(--muted);font-size:13px">
              <th style="text-align:left;padding:6px 10px">缺課日期</th>
              <th style="text-align:left;padding:6px 10px">方式</th>
              <th style="text-align:left;padding:6px 10px">狀態</th>
              <th style="text-align:left;padding:6px 10px">預約補課日</th>
              <th style="text-align:left;padding:6px 10px">完成日期</th>
              <th style="text-align:left;padding:6px 10px">補課期限</th>
            </tr>
          </thead>
          <tbody>${makeupRows}</tbody>
        </table>
      </div>`;
  }

  function studentRow(r) {
    const gradCell = r.grad_ok
      ? '<span class="buke-badge pass">已達標</span>'
      : `<span style="color:var(--danger-tx)">差 ${r.short} 堂</span>`;

    let diligentCell = '';
    if (r.diligent === '目前全勤')      diligentCell = '<span class="buke-badge makeup">目前全勤</span>';
    else if (r.diligent === '已勤學')   diligentCell = '<span class="buke-badge pass">已勤學</span>';
    else if (r.diligent === '可勤學')   diligentCell = `<span class="buke-badge warn">可勤學（還差 ${r.absent} 待補）</span>`;
    else                                diligentCell = `<span class="buke-badge danger">無法勤學（缺課 ${r.total_absent} 堂）</span>`;

    // 2026-09-10：「資料不全」警示——只是提醒「勤學狀態」判斷所根據的出缺勤紀錄
    // 可能不完整（已上課但完全沒登記的堂次），不影響上面既有的勤學四態判定邏輯。
    if (r.missing > 0) {
      diligentCell += `<br><span class="buke-badge warn" style="margin-top:4px;display:inline-block;font-size:12px"
        title="這位學員所屬班別有 ${r.missing} 堂已上課，但完全沒有出缺勤紀錄（不是缺課也不是出席，是根本沒登記）。上面的勤學狀態只根據「有登記」的紀錄計算，可能不準確，建議對照紙本或原始資料確認。">
        ⚠️ 資料不全（${r.missing} 堂未登記）
      </span>`;
    }

    return `<tr style="border-bottom:1px solid var(--line)">
      <td style="padding:8px 10px;font-weight:500">
        <button class="btn-view-student" data-member-db-id="${r.member_db_id}" data-name="${r.name}"
                style="background:none;border:none;padding:0;font:inherit;font-weight:500;color:var(--header);
                       cursor:pointer;text-decoration:underline;text-underline-offset:2px">
          ${r.name}
        </button>
      </td>
      <td style="padding:8px 10px;color:var(--muted);font-size:13px">${r.class_name}<br>${r.group_id || '—'}</td>
      <td style="text-align:center;padding:8px">${r.phys}</td>
      <td style="text-align:center;padding:8px;color:${r.absent > 0 ? 'var(--danger-tx)' : 'inherit'}">${r.absent}</td>
      <td style="text-align:center;padding:8px">${r.makeup}</td>
      <td style="padding:8px 10px">${gradCell}</td>
      <td style="padding:8px 10px">${diligentCell}</td>
    </tr>`;
  }

  function exportCsv(rows) {
    const header = ['姓名','班別','組別','出席','缺課','補課','距結業','勤學狀態'];
    const lines  = rows.map(r => [
      r.name, r.class_name, r.group_id || '',
      r.phys, r.absent, r.makeup,
      r.grad_ok ? '已達標' : `差${r.short}堂`,
      r.diligent === '可勤學' ? `可勤學（還差${r.absent}待補）`
        : r.diligent === '無法勤學' ? `無法勤學（缺課${r.total_absent}堂）`
        : r.diligent,
    ].map(v => `"${String(v).replace(/"/g,'""')}"`).join(','));
    const csv  = [header.join(','), ...lines].join('\n');
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url;
    a.download = `學員總表_${new Date().toLocaleDateString('sv-SE')}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  window.PanelStudents = { loadStudentsPanel };
})();
