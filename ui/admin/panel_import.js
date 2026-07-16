// 職責：後台「匯入資料」面板（合併原「匯入名冊」＋「匯入上課紀錄」）
// 依上傳檔案內容自動判斷：純名冊（無日期欄）只建 members；上課紀錄式（有日期欄）額外建 sessions/attendance。
// 執事欄（學長/班長/點名）有值時一併寫入 assignments。
// 依賴：SheetJS（window.XLSX）、window.AdminData（admin.js）

'use strict';

(function () {
  const { fetchClasses, compareClassSchedule } = window.AdminData;

  const BATCH = 50;

  // ── 表頭關鍵字比對（依序比對，一欄命中第一個符合的關鍵字就定案）─────────
  const HEADER_KEYWORDS = [
    { keyword: '學員編號', field: 'member_id' },
    { keyword: '編號',     field: 'member_id' },
    { keyword: '姓名',     field: 'name' },
    { keyword: '法名',     field: 'dharma_name' },
    { keyword: '性別',     field: 'gender' },
    { keyword: '組別',     field: 'group_id' },
    { keyword: '組號',     field: 'group_num' },
    { keyword: '執事',     field: 'role' },
    { keyword: '幹部',     field: 'role' },
    { keyword: '職稱',     field: 'role' },
    { keyword: '角色',     field: 'role' },
  ];

  function buildColMap(headerRow) {
    const colMap = {}; // field → colIndex
    let hits = 0;
    (headerRow || []).forEach((cell, i) => {
      const h = String(cell ?? '').trim();
      for (const { keyword, field } of HEADER_KEYWORDS) {
        if (h.includes(keyword) && !(field in colMap)) {
          colMap[field] = i;
          hits++;
          break;
        }
      }
    });
    return { colMap, hits };
  }

  /** 偵測表頭在第幾列：hits0>=2 → 名冊式（第1列表頭）；否則 hits1>=2 → 上課紀錄式（第2列表頭）；都不成立回 null */
  function detectHeader(rows) {
    const { colMap: colMap0, hits: hits0 } = buildColMap(rows[0]);
    if (hits0 >= 2) return { headerRowIdx: 0, colMap: colMap0, dataStartIdx: 1 };
    if (rows.length >= 2) {
      const { colMap: colMap1, hits: hits1 } = buildColMap(rows[1]);
      if (hits1 >= 2) return { headerRowIdx: 1, colMap: colMap1, dataStartIdx: 2 };
    }
    return null;
  }

  /** 從表頭列找日期欄（MM/DD） */
  function detectDateCols(headerRow) {
    const dateCols = [];
    (headerRow || []).forEach((h, i) => {
      const s = String(h ?? '').trim();
      if (/^\d{1,2}\/\d{1,2}$/.test(s)) dateCols.push({ colIndex: i, mmdd: s });
    });
    return dateCols;
  }

  function readRows(file) {
    return new Promise((resolve, reject) => {
      if (!window.XLSX) { reject(new Error('SheetJS 尚未載入，請稍候再試。')); return; }
      const reader = new FileReader();
      reader.onload = e => {
        try {
          // ⚠️ 2026-07-16 踩雷修正：原本用 readAsBinaryString + {type:'binary'}，
          // 這個組合會讓瀏覽器把檔案位元組跑過一次字串解碼，中文姓名／法號在
          // 某些情況下會被「雙重 UTF-8 編碼」壞掉存進資料庫（2026-07-02 匯入
          // 的 147 筆姓名／法號因此變亂碼，事後才發現，見
          // db/fix_學員姓名法號雙重編碼亂碼_20260716.sql 的修復紀錄）。
          // 改用 readAsArrayBuffer + {type:'array'}：直接讀原始位元組，不經過
          // 任何字串解碼，SheetJS 官方文件也建議用這個組合讀檔，才不會有編碼風險。
          const wb    = XLSX.read(e.target.result, { type: 'array' });
          const sheet = wb.Sheets[wb.SheetNames[0]];
          resolve(XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' }));
        } catch (err) { reject(new Error(`解析失敗：${err.message}`)); }
      };
      reader.onerror = () => reject(new Error('檔案讀取失敗'));
      reader.readAsArrayBuffer(file);
    });
  }

  const F = (colMap, field, row) =>
    colMap[field] !== undefined ? String(row[colMap[field]] ?? '').trim() : '';

  /** 組別加性別：男1組／女1組。已經是這個格式（以「組」結尾）就不重複加；沒有性別資料則保留原始值 */
  function combineGroupId(gender, rawGroupId) {
    const g = (rawGroupId || '').trim();
    if (!g) return '';
    if (/組$/.test(g)) return g;
    if (gender === '男' || gender === '女') return `${gender}${g}組`;
    return g;
  }

  function buildParsed(rows, header, dateColsRaw, year) {
    const { colMap, dataStartIdx } = header;
    const dateCols = dateColsRaw.map(({ colIndex, mmdd }) => {
      const [mm, dd] = mmdd.split('/').map(n => String(n).padStart(2, '0'));
      return { colIndex, dateStr: `${year}-${mm}-${dd}` };
    });

    const dataRows = rows.slice(dataStartIdx);
    const members = [];
    for (const row of dataRows) {
      const name = F(colMap, 'name', row);
      if (name.includes('範例')) continue;
      const memberId = F(colMap, 'member_id', row);
      if (!memberId && !name) continue;

      const marks = {};
      for (const { colIndex, dateStr } of dateCols) {
        marks[dateStr] = String(row[colIndex] ?? '').trim();
      }

      members.push({
        member_id:   memberId,
        name,
        dharma_name: F(colMap, 'dharma_name', row),
        gender:      F(colMap, 'gender', row),
        group_id:    F(colMap, 'group_id', row),
        group_num:   F(colMap, 'group_num', row),
        role:        F(colMap, 'role', row),
        marks,
      });
    }

    // 'F' = 停課／颱風假專用代碼（全班同一天都寫 F）：這天不算「已上課」，不建任何出缺勤紀錄，
    // 避免被誤判成整班缺席、產生一堆假的補課義務。跟真正無法辨識的代碼分開判斷。
    const heldDates = dateCols
      .filter(({ dateStr }) => members.some(m => m.marks[dateStr] !== '' && m.marks[dateStr] !== 'F'))
      .map(({ dateStr }) => dateStr)
      .sort();

    const allDates = dateCols.map(({ dateStr }) => dateStr).sort();

    const cancelledDates = dateCols
      .filter(({ dateStr }) => members.some(m => m.marks[dateStr] === 'F'))
      .map(({ dateStr }) => dateStr)
      .sort();

    return {
      members,
      heldDates,
      allDates,
      cancelledDates,
      attendCount: members.length * heldDates.length,
      hasDateCols: dateCols.length > 0,
    };
  }

  // ── 面板主體 ──────────────────────────────────────────────────────────────

  async function loadImportPanel(sb, container) {
    container.innerHTML = '<p class="buke-empty">載入中…</p>';
    try {
      const classes  = await fetchClasses(sb);
      const eligible = classes.filter(c => c.status !== '已結業').sort(compareClassSchedule);
      renderShell(sb, container, eligible);
    } catch (e) {
      container.innerHTML = `<div class="buke-msg err">❌ ${e.message}</div>`;
    }
  }

  function renderShell(sb, container, classes) {
    const classOpts = classes
      .map(c => `<option value="${c.id}">${c.class_name}（${c.status}）</option>`)
      .join('');
    const thisYear = new Date().getFullYear();

    container.innerHTML = `
      <p style="font-size:14px;color:var(--muted);margin-bottom:16px">
        上傳官方 Excel（.xlsx）→ 系統自動判斷這份是「名冊」還是「連出缺勤都有的上課紀錄」，並自動解析建檔／更新。
        若表內有「執事」欄（學長/班長/點名），會一併寫入角色指派。
      </p>

      <!-- Step 1: 選班別 -->
      <div class="buke-card" style="margin-bottom:14px">
        <div style="font-weight:500;margin-bottom:10px">① 選目標班別</div>
        <select id="imp-class" class="buke-select" style="min-width:200px;font-size:15px">
          <option value="">— 選班別 —</option>${classOpts}
        </select>
      </div>

      <!-- Step 2: 學期年份（僅有日期欄時使用） -->
      <div class="buke-card" style="margin-bottom:14px">
        <div style="font-weight:500;margin-bottom:10px">② 學期年份（官方表頭只有 MM/DD，若檔案含出缺勤日期欄需補西元年；純名冊檔案可略過）</div>
        <input id="imp-year" type="number" value="${thisYear}" min="2000" max="2099"
               style="width:100px;font-size:15px;padding:6px 10px;border:1px solid var(--line);border-radius:var(--r-sm)">
      </div>

      <!-- Step 3: 上傳檔案 -->
      <div class="buke-card" style="margin-bottom:14px" id="imp-upload-card">
        <div style="font-weight:500;margin-bottom:10px">③ 上傳 .xlsx</div>
        <div id="imp-dropzone"
             style="border:2px dashed var(--line);border-radius:var(--r-md);padding:28px;
                    text-align:center;color:var(--muted);font-size:15px;cursor:pointer;
                    transition:border-color .15s">
          拖曳 .xlsx 到這裡，或點擊選檔
          <input type="file" id="imp-file" accept=".xlsx,.xls" style="display:none">
        </div>
        <div id="imp-parse-msg" style="font-size:14px;margin-top:8px"></div>
      </div>

      <!-- Step 4: 預覽 -->
      <div id="imp-preview" style="display:none;margin-bottom:14px"></div>

      <!-- Step 5: 匯入結果 -->
      <div id="imp-result" style="margin-bottom:14px"></div>`;

    const dropzone  = container.querySelector('#imp-dropzone');
    const fileInput = container.querySelector('#imp-file');
    dropzone.addEventListener('click', () => fileInput.click());
    dropzone.addEventListener('dragover', e => { e.preventDefault(); dropzone.style.borderColor = 'var(--header)'; });
    dropzone.addEventListener('dragleave', () => { dropzone.style.borderColor = ''; });
    dropzone.addEventListener('drop', e => {
      e.preventDefault(); dropzone.style.borderColor = '';
      const f = e.dataTransfer.files[0];
      if (f) handleFile(sb, container, f);
    });
    fileInput.addEventListener('change', e => {
      if (e.target.files[0]) handleFile(sb, container, e.target.files[0]);
    });
  }

  async function handleFile(sb, container, file) {
    const msgEl  = container.querySelector('#imp-parse-msg');
    const prevEl = container.querySelector('#imp-preview');
    container.querySelector('#imp-result').innerHTML = '';
    prevEl.style.display = 'none';
    msgEl.innerHTML = '解析中…';
    msgEl.style.color = 'var(--muted)';

    if (!file.name.match(/\.xlsx?$/i)) {
      msgEl.innerHTML = '<span style="color:var(--danger-tx)">❌ 僅支援 .xlsx 格式</span>'; return;
    }

    try {
      const rows = await readRows(file);
      if (!rows.length) throw new Error('工作表無資料');

      const header = detectHeader(rows);
      if (!header) throw new Error('無法辨識欄位表頭，請確認檔案格式');

      const dateColsRaw = detectDateCols(rows[header.headerRowIdx]);

      let year = null;
      if (dateColsRaw.length) {
        year = parseInt(container.querySelector('#imp-year').value, 10);
        if (!year || year < 2000 || year > 2099) {
          msgEl.innerHTML = '<span style="color:var(--danger-tx)">❌ 偵測到日期欄，請先填入有效的學期年份（2000–2099）</span>';
          return;
        }
      }

      const parsed = buildParsed(rows, header, dateColsRaw, year);
      if (!parsed.members.length) {
        msgEl.innerHTML = '<span style="color:var(--danger-tx)">❌ 解析不到有效學員列（需有學員編號與姓名）</span>'; return;
      }
      const futureNote = parsed.hasDateCols
        ? `另有 ${parsed.allDates.length - parsed.heldDates.length - parsed.cancelledDates.length} 堂未來堂次${parsed.cancelledDates.length ? `、${parsed.cancelledDates.length} 天停課／颱風假` : ''}`
        : '';
      msgEl.innerHTML = parsed.hasDateCols
        ? `<span style="color:var(--ok-tx)">✅ 解析到 ${parsed.members.length} 位學員、${parsed.heldDates.length} 個已上課次（${futureNote}）</span>`
        : `<span style="color:var(--ok-tx)">✅ 解析到 ${parsed.members.length} 筆學員</span>`;
      renderPreview(sb, container, parsed);
    } catch (e) {
      msgEl.innerHTML = `<span style="color:var(--danger-tx)">❌ ${e.message}</span>`;
    }
  }

  function renderPreview(sb, container, parsed) {
    const { members, heldDates, allDates, cancelledDates, attendCount, hasDateCols } = parsed;
    const prevEl  = container.querySelector('#imp-preview');
    const sample  = members.slice(0, 5);
    const hasRole = members.some(m => m.role);
    const futureCount = allDates.length - heldDates.length - cancelledDates.length;

    prevEl.innerHTML = `
      <div class="buke-card">
        <div style="font-weight:500;margin-bottom:10px">④ 預覽（前 ${sample.length} 筆，共 ${members.length} 筆）</div>

        ${hasDateCols ? `
        <div style="margin-bottom:12px;font-size:14px">
          <span style="margin-right:18px">👤 ${members.length} 位學員</span>
          <span style="margin-right:18px">📅 ${heldDates.length} 個已上課次</span>
          <span style="margin-right:18px">🗓️ ${futureCount} 堂未來堂次</span>
          ${cancelledDates.length ? `<span style="margin-right:18px">🌀 ${cancelledDates.length} 天停課／颱風假</span>` : ''}
          <span>📝 ${attendCount} 筆出缺勤</span>
        </div>
        <div style="margin-bottom:12px;font-size:13px;color:var(--muted)">
          已上課次：${heldDates.join('、') || '（無）'}
          ${cancelledDates.length ? `<br>停課／颱風假（不建出缺勤）：${cancelledDates.join('、')}` : ''}
        </div>` : ''}

        <div style="overflow-x:auto">
          <table style="width:100%;border-collapse:collapse;font-size:13px">
            <thead>
              <tr style="background:var(--bg);color:var(--muted)">
                <th style="padding:6px 10px;text-align:left">學員編號</th>
                <th style="padding:6px 10px;text-align:left">姓名</th>
                <th style="padding:6px 10px;text-align:left">法名</th>
                <th style="padding:6px 10px;text-align:left">性別</th>
                <th style="padding:6px 10px;text-align:left">組別</th>
                <th style="padding:6px 10px;text-align:left">組號</th>
                ${hasRole ? '<th style="padding:6px 10px;text-align:left">執事</th>' : ''}
              </tr>
            </thead>
            <tbody>
              ${sample.map(m => `<tr style="border-bottom:1px solid var(--line)">
                <td style="padding:6px 10px;color:var(--muted)">${m.member_id}</td>
                <td style="padding:6px 10px;font-weight:500">${m.name}</td>
                <td style="padding:6px 10px">${m.dharma_name || ''}</td>
                <td style="padding:6px 10px">${m.gender || ''}</td>
                <td style="padding:6px 10px">${m.group_id || ''}</td>
                <td style="padding:6px 10px">${m.group_num || ''}</td>
                ${hasRole ? `<td style="padding:6px 10px">${m.role || ''}</td>` : ''}
              </tr>`).join('')}
            </tbody>
          </table>
        </div>
        ${members.length > 5 ? `<p style="font-size:13px;color:var(--muted);margin:8px 0 0">…以及另外 ${members.length - 5} 筆</p>` : ''}
        ${hasRole ? '<p style="font-size:13px;color:var(--ok-tx);margin:8px 0 0">✅ 偵測到執事欄，將依內容寫入角色指派（學長／班長／點名，其他文字略過）</p>' : ''}

        ${hasDateCols ? `
        <label style="display:flex;align-items:center;gap:8px;font-size:14px;margin:14px 0;cursor:pointer">
          <input type="checkbox" id="imp-as-manual" checked>
          這批資料視為已確認結果（勾選後之後刷卡自動同步不會覆蓋這些紀錄）
        </label>` : ''}

        <div style="margin-top:14px;display:flex;align-items:center;gap:12px">
          <button id="imp-confirm" class="buke-btn" style="font-size:15px;padding:8px 24px">確認匯入</button>
          <button id="imp-cancel" class="buke-btn buke-btn-ghost" style="font-size:15px;padding:8px 16px">重選檔案</button>
          <span id="imp-progress" style="font-size:14px;color:var(--muted)"></span>
        </div>
      </div>`;
    prevEl.style.display = '';

    prevEl.querySelector('#imp-cancel').addEventListener('click', () => {
      prevEl.style.display = 'none';
      container.querySelector('#imp-parse-msg').innerHTML = '';
      container.querySelector('#imp-file').value = '';
      container.querySelector('#imp-result').innerHTML = '';
    });
    prevEl.querySelector('#imp-confirm').addEventListener('click', () =>
      doImport(sb, container, prevEl, parsed));
  }

  // ── 執行匯入 ─────────────────────────────────────────────────────────────

  async function doImport(sb, container, prevEl, parsed) {
    const classRef = Number(container.querySelector('#imp-class').value);
    if (!classRef) {
      container.querySelector('#imp-result').innerHTML =
        '<div class="buke-msg err">❌ 請先選目標班別</div>'; return;
    }

    const { members, heldDates, allDates, cancelledDates, hasDateCols } = parsed;
    const source     = hasDateCols && prevEl.querySelector('#imp-as-manual')?.checked ? 'manual' : 'api';
    const confirmBtn = prevEl.querySelector('#imp-confirm');
    const progEl     = prevEl.querySelector('#imp-progress');
    const resultEl   = container.querySelector('#imp-result');
    confirmBtn.disabled = true;
    progEl.textContent  = '匯入中…';
    resultEl.innerHTML  = '';

    try {
      // 1. upsert members（固定執行）
      const memberRows = members.map(m => ({
        class_ref:   classRef,
        member_id:   m.member_id,
        name:        m.name,
        dharma_name: m.dharma_name || null,
        gender:      ['男','女'].includes(m.gender) ? m.gender : null,
        group_id:    combineGroupId(m.gender, m.group_id) || null,
        group_num:   m.group_num   || null,
        status:      '在學',
      }));
      for (let i = 0; i < memberRows.length; i += BATCH) {
        progEl.textContent = `匯入學員… ${Math.min(i + BATCH, memberRows.length)} / ${memberRows.length}`;
        const { error } = await sb
          .from('members')
          .upsert(memberRows.slice(i, i + BATCH), { onConflict: 'class_ref,member_id' });
        if (error) throw new Error(`members upsert 失敗：${error.message}`);
      }

      // 2. upsert assignments（執事欄有值才處理：學長/班長/點名，其餘略過）
      const withRole = members
        .map(m => {
          let role = null;
          if (m.role.includes('班長')) role = '班長';
          else if (m.role.includes('學長')) role = '學長';
          else if (m.role.includes('點名')) role = '點名';
          return role ? { ...m, _assignRole: role } : null;
        })
        .filter(Boolean);

      if (withRole.length) {
        const ids = withRole.map(m => m.member_id);
        const { data: dbMembers, error: qErr } = await sb
          .from('members')
          .select('id,member_id,group_id')
          .eq('class_ref', classRef)
          .in('member_id', ids);
        if (qErr) throw new Error(`查學員 id 失敗：${qErr.message}`);

        const idMap = Object.fromEntries((dbMembers || []).map(r => [r.member_id, r]));
        const assignRows = withRole.flatMap(m => {
          const dbMem = idMap[m.member_id];
          if (!dbMem) return [];
          const isLeader = m._assignRole === '學長';
          return [{
            member_id:   m.member_id,
            class_ref:   classRef,
            role:        m._assignRole,
            scope_group: isLeader ? (dbMem.group_id || combineGroupId(m.gender, m.group_id) || null) : null,
          }];
        });

        for (let i = 0; i < assignRows.length; i += BATCH) {
          const { error } = await sb
            .from('assignments')
            .upsert(assignRows.slice(i, i + BATCH), { onConflict: 'member_id,class_ref' });
          if (error) throw new Error(`assignments upsert 失敗：${error.message}`);
        }
      }

      let attendRowsLen = 0;
      if (hasDateCols) {
        const heldSet = new Set(heldDates);
        // 3. upsert sessions（依「本期全部日期欄」建立，含尚未發生、還沒有出缺勤資料的未來堂次；
        //    week_num 依全部日期欄順序編號，不是只算有資料的，避免之後補資料進來時 week_num 跳號）
        const sessionRows = allDates.map((date, idx) => ({
          class_ref: classRef,
          date,
          is_held:   heldSet.has(date),
          week_num:  idx + 1,
        }));
        for (let i = 0; i < sessionRows.length; i += BATCH) {
          progEl.textContent = `匯入堂次… ${Math.min(i + BATCH, sessionRows.length)} / ${sessionRows.length}`;
          const { error } = await sb
            .from('sessions')
            .upsert(sessionRows.slice(i, i + BATCH), { onConflict: 'class_ref,date' });
          if (error) throw new Error(`sessions upsert 失敗：${error.message}`);
        }

        // 4. 查回 members id 與 sessions id
        progEl.textContent = '查回索引…';
        const { data: dbMembers, error: mQErr } = await sb
          .from('members')
          .select('id,member_id')
          .eq('class_ref', classRef)
          .in('member_id', members.map(m => m.member_id));
        if (mQErr) throw new Error(`查學員 id 失敗：${mQErr.message}`);

        const { data: dbSessions, error: sQErr } = await sb
          .from('sessions')
          .select('id,date')
          .eq('class_ref', classRef)
          .in('date', heldDates);
        if (sQErr) throw new Error(`查堂次 id 失敗：${sQErr.message}`);

        const memberIdMap  = Object.fromEntries((dbMembers  || []).map(r => [r.member_id, r.id]));
        const sessionIdMap = Object.fromEntries((dbSessions || []).map(r => [r.date, r.id]));

        // 5. upsert attendance（每位學員 × 每個已上課次）
        // 出缺勤代碼只認 7 種官方標記，其餘一律視為無法辨識，匯入前先擋下並明確列出
        // 「哪位學員、哪一天、寫了什麼」，不要讓資料庫的 CHECK 限制擋下整批卻看不出是哪一筆。
        const VALID_MARKS = new Set(['V', 'L', 'ML', 'M', 'A', 'O', 'LL']);
        const attendRows = [];
        const badMarks = [];
        for (const m of members) {
          const membRef = memberIdMap[m.member_id];
          if (!membRef) continue;
          for (const date of heldDates) {
            const sessRef = sessionIdMap[date];
            if (!sessRef) continue;
            const rawMark = m.marks[date] ?? '';
            if (rawMark && !VALID_MARKS.has(rawMark)) {
              badMarks.push(`${m.name}（${date}）寫了「${rawMark}」`);
              continue;
            }
            attendRows.push({
              member_ref:  membRef,
              session_ref: sessRef,
              mark:        rawMark || 'O',
              source,
            });
          }
        }
        if (badMarks.length) {
          throw new Error(
            `偵測到 ${badMarks.length} 筆無法辨識的出缺勤代碼（只認 V/L/ML/M/A/O/LL），已中止匯入，` +
            `請到 Excel 修正下列儲存格後重新匯入：${badMarks.slice(0, 15).join('；')}` +
            `${badMarks.length > 15 ? `…（還有 ${badMarks.length - 15} 筆）` : ''}`
          );
        }
        attendRowsLen = attendRows.length;

        for (let i = 0; i < attendRows.length; i += BATCH) {
          progEl.textContent = `匯入出缺勤… ${Math.min(i + BATCH, attendRows.length)} / ${attendRows.length}`;
          const { error } = await sb
            .from('attendance')
            .upsert(attendRows.slice(i, i + BATCH), { onConflict: 'member_ref,session_ref' });
          if (error) throw new Error(`attendance upsert 失敗：${error.message}`);
        }
      }

      // 完成
      const roleMsg = withRole.length ? `（含 ${withRole.length} 筆角色指派）` : '';
      const futureCount = allDates.length - heldDates.length - cancelledDates.length;
      const cancelledMsg = cancelledDates.length ? `、${cancelledDates.length} 天停課／颱風假（未建出缺勤）` : '';
      resultEl.innerHTML = hasDateCols
        ? `<div class="buke-msg" style="background:var(--ok-bg);color:var(--ok-tx)">
             ✅ 已匯入 ${members.length} 位學員、${heldDates.length} 堂已上課次（另建 ${futureCount} 堂未來堂次）、${attendRowsLen} 筆出缺勤${cancelledMsg}${roleMsg}。
           </div>`
        : `<div class="buke-msg" style="background:var(--ok-bg);color:var(--ok-tx)">
             ✅ 已匯入 ${members.length} 位學員${roleMsg}。
           </div>`;
      prevEl.style.display = 'none';
      progEl.textContent   = '';

    } catch (e) {
      resultEl.innerHTML  = `<div class="buke-msg err">❌ ${e.message}</div>`;
      confirmBtn.disabled = false;
      progEl.textContent  = '';
    }
  }

  window.PanelImport = { loadImportPanel };
})();
