// 職責：補課規定設定面板——讀寫 settings 全域列（class_ref IS NULL）
// 不依賴其他面板；沿用 window.supabase + authenticated session

'use strict';

(function () {
  const DAYS = ['週一','週二','週三','週四','週五','週六','週日'];

  // ── 讀取全域設定列 ────────────────────────────────────────

  async function fetchGlobalSettings(sb) {
    const { data, error } = await sb
      .from('settings')
      .select('*')
      .is('class_ref', null)
      .single();
    if (error) throw new Error(`讀取設定失敗：${error.message}`);
    return data;
  }

  async function saveGlobalSettings(sb, id, fields) {
    const { error } = await sb
      .from('settings')
      .update(fields)
      .eq('id', id);
    if (error) throw new Error(`儲存失敗：${error.message}`);
  }

  // ── 時段列表渲染 ─────────────────────────────────────────

  function renderSlots(slots, listEl, onChange) {
    listEl.innerHTML = '';
    if (!slots.length) {
      listEl.innerHTML = '<p style="color:var(--muted);font-size:14px;margin:6px 0">尚未設定補課時段。</p>';
      return;
    }
    slots.forEach((slot, i) => {
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;align-items:center;gap:10px;margin-bottom:8px;flex-wrap:wrap';
      row.innerHTML = `
        <span class="buke-badge" style="background:var(--ok-bg);color:var(--ok-tx);font-size:14px">
          ${slot.day} ${slot.start}–${slot.end}
        </span>
        <button class="buke-btn buke-btn-danger" style="font-size:13px;padding:4px 10px;min-height:32px">
          刪除
        </button>`;
      row.querySelector('button').addEventListener('click', () => {
        slots.splice(i, 1);
        renderSlots(slots, listEl, onChange);
        onChange(slots);
      });
      listEl.appendChild(row);
    });
  }

  // ── 黑名單日期列表渲染 ───────────────────────────────────

  /** 顯示用：把「連續日期、設定完全相同（原因＋時段都一樣）」的幾筆合併成一行，
   *  例：2026-12-01～2026-12-31　12:00–14:00、18:00–20:00　僧眾七期間。
   *  資料本身仍是一天一筆（後端檢查邏輯不變），只是畫面合併，刪除時一次刪掉那一行的全部日期。 */
  function renderBlackout(list, listEl) {
    listEl.innerHTML = '';
    if (!list.length) {
      listEl.innerHTML = '<p style="color:var(--muted);font-size:14px;margin:6px 0">尚未設定不開放補課日期。</p>';
      return;
    }
    // 依日期分組，並把同一天的時段排好
    const byDate = new Map();
    [...list].sort((a, b) => a.date.localeCompare(b.date) || (a.start || '').localeCompare(b.start || ''))
      .forEach(it => { if (!byDate.has(it.date)) byDate.set(it.date, []); byDate.get(it.date).push(it); });

    const sigOf = items => items.map(it => (it.start && it.end ? `${it.start}-${it.end}` : '整天')).join('|')
                         + '#' + (items[0].reason || '');
    const dayAfter = d => { const t = new Date(d + 'T00:00:00Z'); t.setUTCDate(t.getUTCDate() + 1); return t.toISOString().slice(0, 10); };

    const groups = []; // { from, to, items(該行包含的所有原始筆), sig, label }
    for (const [date, items] of byDate) {
      const sig = sigOf(items);
      const last = groups[groups.length - 1];
      if (last && last.sig === sig && dayAfter(last.to) === date) {
        last.to = date; last.items.push(...items);
      } else {
        groups.push({ from: date, to: date, items: [...items], sig, first: items });
      }
    }

    groups.forEach(g => {
      const range = g.from === g.to ? g.from : `${g.from}～${g.to}`;
      const times = g.first.some(it => !it.start || !it.end)
        ? '整天不開放'
        : g.first.map(it => `${it.start}–${it.end}`).join('、');
      const days = g.from === g.to ? '' : `（共 ${new Set(g.items.map(it => it.date)).size} 天）`;
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;align-items:center;gap:10px;margin-bottom:8px;flex-wrap:wrap';
      row.innerHTML = `
        <span class="buke-badge" style="background:var(--warn-bg);color:var(--warn-tx);font-size:14px">
          ${range}${days}　${times}　${g.first[0].reason || ''}
        </span>
        <button class="buke-btn buke-btn-danger" style="font-size:13px;padding:4px 10px;min-height:32px">
          ${g.from === g.to ? '刪除' : '刪除這一批'}
        </button>`;
      row.querySelector('button').addEventListener('click', () => {
        g.items.forEach(it => { const k = list.indexOf(it); if (k >= 0) list.splice(k, 1); });
        renderBlackout(list, listEl);
        listEl.dispatchEvent(new Event('change', { bubbles: true })); // 標記「尚未儲存」
      });
      listEl.appendChild(row);
    });
  }

  // ── 主面板 ───────────────────────────────────────────────

  async function loadMakeupRulesPanel(sb, container) {
    container.innerHTML = '<p class="buke-empty">載入中…</p>';
    try {
      const row = await fetchGlobalSettings(sb);
      renderPanel(sb, container, row);
    } catch (e) {
      container.innerHTML = `<div class="buke-msg err">❌ ${e.message}</div>`;
    }
  }

  function renderPanel(sb, container, row) {
    const mode       = row.makeup_earliest_mode || '下週一';
    const days       = row.makeup_earliest_days ?? 7;
    const slots      = Array.isArray(row.makeup_time_slots) ? [...row.makeup_time_slots] : [];
    const blackoutDates = Array.isArray(row.makeup_blackout_dates) ? [...row.makeup_blackout_dates] : [];
    const notice     = row.makeup_notice || '';
    const deadlineDays = row.makeup_deadline_days ?? 40;
    const warnOn     = (row.extra_json?.warn_out_of_range) !== false; // 預設 true
    const machineCount = row.video_machine_count ?? 5;

    container.innerHTML = `
      <!-- §1 可開始補課日期 -->
      <div class="buke-card" style="margin-bottom:16px">
        <div class="name" style="font-size:16px;font-weight:500;margin-bottom:12px">可開始補課日期</div>

        <label style="display:flex;align-items:flex-start;gap:10px;margin-bottom:10px;cursor:pointer;font-size:15px">
          <input type="radio" name="mode" value="下週一"
                 ${mode === '下週一' ? 'checked' : ''} style="margin-top:4px;flex-shrink:0">
          <span>該堂當週結束後、<strong>下週一</strong>起（錨點式）</span>
        </label>

        <label style="display:flex;align-items:flex-start;gap:10px;cursor:pointer;font-size:15px">
          <input type="radio" name="mode" value="缺課後N天"
                 ${mode === '缺課後N天' ? 'checked' : ''} style="margin-top:4px;flex-shrink:0">
          <span>缺課後
            <input type="number" id="inp-days" min="1" max="30" value="${days}"
                   class="buke-input" style="width:64px;font-size:15px;padding:4px 8px;min-height:32px;
                          display:inline-block;margin:0 4px;vertical-align:middle"
                   ${mode !== '缺課後N天' ? 'disabled' : ''}>
            天起（固定天數式）
          </span>
        </label>
      </div>

      <!-- §2 每日補課時段 -->
      <div class="buke-card" style="margin-bottom:16px">
        <div class="name" style="font-size:16px;font-weight:500;margin-bottom:10px">每日補課時段</div>
        <div id="slot-list"></div>

        <details style="margin-top:10px">
          <summary style="cursor:pointer;font-size:14px;color:var(--header);font-weight:500">＋ 新增時段</summary>
          <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-top:10px">
            <select id="inp-day" class="buke-select" style="font-size:14px;min-height:36px">
              ${DAYS.map(d => `<option>${d}</option>`).join('')}
            </select>
            <input type="time" id="inp-start" class="buke-input"
                   value="19:00" style="font-size:14px;min-height:36px;width:110px">
            <span style="color:var(--muted)">–</span>
            <input type="time" id="inp-end" class="buke-input"
                   value="21:00" style="font-size:14px;min-height:36px;width:110px">
            <button id="btn-add-slot" class="buke-btn" style="font-size:14px;padding:6px 14px;min-height:36px">
              加入
            </button>
            <span id="slot-err" style="font-size:13px;color:var(--danger-tx)"></span>
          </div>
        </details>
      </div>

      <!-- §3 補課須知 -->
      <div class="buke-card" style="margin-bottom:16px">
        <div class="name" style="font-size:16px;font-weight:500;margin-bottom:10px">
          補課須知 / 個別規定
          <span style="font-size:13px;color:var(--muted);font-weight:400">（原樣顯示給學員）</span>
        </div>
        <textarea id="inp-notice" class="buke-input" rows="5"
                  style="width:100%;font-size:15px;resize:vertical;line-height:1.6"
                  placeholder="例：補課請提前 10 分鐘到場，穿著整齊…">${notice}</textarea>
      </div>

      <!-- §4 補課期限（唯讀） -->
      <div class="buke-card" style="margin-bottom:16px;background:var(--bg)">
        <div class="name" style="font-size:16px;font-weight:500;margin-bottom:6px">補課期限（全系統鎖定）</div>
        <p style="font-size:15px;color:var(--muted);margin:0">
          缺課日起 <strong style="color:var(--ink)">${deadlineDays} 天</strong>內須完成補課，逾期視同缺席。
          此欄位全系統統一，<strong>不可修改</strong>。
        </p>
        <p style="font-size:14px;color:var(--muted);margin:8px 0 0">
          ⓘ 超過期限想補課：學員/學長無法自行登記，請精舍到「逾期補課登記」頁籤代為登記。
        </p>
      </div>

      <!-- §5 超範圍提醒開關 -->
      <div class="buke-card" style="margin-bottom:16px">
        <label style="display:flex;align-items:center;gap:12px;cursor:pointer;font-size:15px">
          <input type="checkbox" id="chk-warn" ${warnOn ? 'checked' : ''}
                 style="width:20px;height:20px;flex-shrink:0;cursor:pointer">
          <span>學員登記補課若超出上方規定範圍，顯示提醒</span>
        </label>
      </div>

      <!-- 影音補課機台數量 -->
      <div class="buke-card" style="margin-bottom:16px">
        <div class="name" style="font-size:16px;font-weight:500;margin-bottom:10px">影音補課機台數量</div>
        <label style="display:flex;align-items:center;gap:10px;font-size:15px">
          共
          <input type="number" id="inp-machine-count" min="1" value="${machineCount}"
                 class="buke-input" style="width:80px;font-size:15px;padding:4px 8px;min-height:32px">
          台機器（義工櫃台登記出席時的機台下拉選單依此數量顯示）
        </label>
      </div>

      <!-- §7 特定日期不開放補課 -->
      <div class="buke-card" style="margin-bottom:20px">
        <div class="name" style="font-size:16px;font-weight:500;margin-bottom:10px">特定日期不開放補課</div>
        <div id="blackout-list"></div>

        <details style="margin-top:10px">
          <summary style="cursor:pointer;font-size:14px;color:var(--header);font-weight:500">＋ 新增不開放補課日期（可一次設定一段日期、多個時段）</summary>
          <div style="display:flex;flex-direction:column;gap:10px;margin-top:10px">
            <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;font-size:14px">
              <span>日期</span>
              <input type="date" id="inp-blackout-date" class="buke-input" style="font-size:14px;min-height:36px">
              <span>～</span>
              <input type="date" id="inp-blackout-date-end" class="buke-input" style="font-size:14px;min-height:36px">
              <span style="color:var(--muted);font-size:13px">（只有一天的話，後面不用填）</span>
            </div>
            <div id="blackout-weekdays-row" style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;font-size:14px">
              <span>套用星期</span>
              ${['日','一','二','三','四','五','六'].map((w, k) => `<label style="display:flex;align-items:center;gap:3px;cursor:pointer"><input type="checkbox" class="chk-blackout-wd" value="${k}" checked style="width:16px;height:16px">${w}</label>`).join('')}
            </div>
            <input type="text" id="inp-blackout-reason" class="buke-input" placeholder="原因（例：僧眾七期間，開放時間調整）" style="font-size:14px;min-height:36px;min-width:140px">
            <label style="display:flex;align-items:center;gap:8px;font-size:14px;cursor:pointer">
              <input type="checkbox" id="chk-blackout-allday" checked style="width:18px;height:18px">
              整天不開放
            </label>
            <div id="blackout-time-row" style="display:none;flex-direction:column;gap:8px">
              <div id="blackout-time-list" style="display:flex;flex-direction:column;gap:8px"></div>
              <div><button type="button" id="btn-add-blackout-slot" class="buke-btn buke-btn-ghost" style="font-size:13px;padding:4px 12px;min-height:32px">＋ 再加一個時段</button></div>
              <div style="font-size:12px;color:var(--muted)">時段不含結束時間：例如 12:00–14:00，表示 12:00～13:55 不開放，14:00 可以補課。</div>
            </div>
            <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
              <button id="btn-add-blackout" class="buke-btn" style="font-size:14px;padding:6px 14px;min-height:36px">加入</button>
              <span id="blackout-err" style="font-size:13px;color:var(--danger-tx)"></span>
            </div>
          </div>
        </details>
      </div>

      <!-- §6 儲存 -->
      <div style="display:flex;align-items:center;gap:14px;padding-top:14px;border-top:1px solid var(--line)">
        <button id="btn-save-rules" class="buke-btn" style="font-size:15px;padding:10px 28px">
          儲存設定
        </button>
        <span id="save-msg" style="font-size:14px"></span>
      </div>`;

    // ── 時段列表初始化 ──────────────────────────────────
    const slotListEl = container.querySelector('#slot-list');
    renderSlots(slots, slotListEl, () => {});  // onChange 只在 save 時才讀最新 slots

    // ── 黑名單日期列表初始化 ─────────────────────────────
    const blackoutListEl = container.querySelector('#blackout-list');
    renderBlackout(blackoutDates, blackoutListEl);

    // 時段輸入列：可一次設定多個時段（每列一個起訖）
    const timeListEl = container.querySelector('#blackout-time-list');
    function addTimeRow() {
      const r = document.createElement('div');
      r.style.cssText = 'display:flex;align-items:center;gap:10px;flex-wrap:wrap';
      r.innerHTML = `
        <input type="time" class="buke-input inp-bo-start" style="font-size:14px;min-height:36px;width:120px">
        <span style="color:var(--muted)">–</span>
        <input type="time" class="buke-input inp-bo-end" style="font-size:14px;min-height:36px;width:120px">
        <button type="button" class="buke-btn buke-btn-ghost btn-bo-del" style="font-size:12px;padding:2px 10px;min-height:28px">移除</button>`;
      r.querySelector('.btn-bo-del').addEventListener('click', () => {
        if (timeListEl.children.length > 1) r.remove();
        else r.querySelectorAll('input').forEach(i => { i.value = ''; });
      });
      timeListEl.appendChild(r);
    }
    addTimeRow();
    container.querySelector('#btn-add-blackout-slot').addEventListener('click', addTimeRow);

    container.querySelector('#chk-blackout-allday').addEventListener('change', e => {
      container.querySelector('#blackout-time-row').style.display = e.target.checked ? 'none' : 'flex';
    });

    container.querySelector('#btn-add-blackout').addEventListener('click', () => {
      const startDate = container.querySelector('#inp-blackout-date').value;
      const endDate   = container.querySelector('#inp-blackout-date-end').value || startDate;
      const reason    = container.querySelector('#inp-blackout-reason').value.trim();
      const allDay    = container.querySelector('#chk-blackout-allday').checked;
      const errEl     = container.querySelector('#blackout-err');
      const fail = msg => { errEl.style.color = 'var(--danger-tx)'; errEl.textContent = msg; };
      if (!startDate) { fail('請選擇日期'); return; }
      if (endDate < startDate) { fail('結束日期不能早於開始日期'); return; }

      // 展開日期範圍（只留勾選的星期）。用 UTC 計算，避免時區造成日期差一天
      const wds = new Set([...container.querySelectorAll('.chk-blackout-wd:checked')].map(c => Number(c.value)));
      if (!wds.size) { fail('請至少勾選一個星期'); return; }
      const dates = [];
      for (let t = new Date(startDate + 'T00:00:00Z'), endT = new Date(endDate + 'T00:00:00Z');
           t <= endT; t.setUTCDate(t.getUTCDate() + 1)) {
        if (dates.length >= 400) { fail('日期範圍太長（最多約一年），請分次設定'); return; }
        if (wds.has(t.getUTCDay())) dates.push(t.toISOString().slice(0, 10));
      }
      if (!dates.length) { fail('這段日期裡沒有符合所選星期的日子'); return; }

      // 取得要新增的時段
      let newSlots = [null]; // null = 整天
      if (!allDay) {
        newSlots = [];
        for (const r of timeListEl.children) {
          const st = r.querySelector('.inp-bo-start').value;
          const en = r.querySelector('.inp-bo-end').value;
          if (!st && !en) continue; // 空白列略過
          if (!st || !en) { fail('每個時段都要填起訖時間'); return; }
          if (st >= en)   { fail(`時段 ${st}–${en}：開始時間須早於結束時間`); return; }
          newSlots.push({ start: st, end: en });
        }
        if (!newSlots.length) { fail('請填入至少一個時段'); return; }
        for (let x = 0; x < newSlots.length; x++) {
          for (let y = x + 1; y < newSlots.length; y++) {
            if (newSlots[x].start < newSlots[y].end && newSlots[x].end > newSlots[y].start) {
              fail('你填的幾個時段彼此重疊，請修正'); return;
            }
          }
        }
      }

      // 加入：已有的設定一律不覆蓋、不重複，略過並計數
      let added = 0, skipped = 0;
      for (const date of dates) {
        const same = blackoutDates.filter(b => b.date === date);
        const hasAllDay = same.some(b => !b.start || !b.end);
        for (const sl of newSlots) {
          if (sl === null) {
            if (same.length) { skipped++; continue; }
            blackoutDates.push({ date, reason: reason || null }); added++;
          } else {
            if (hasAllDay || same.some(b => b.start && b.end && sl.start < b.end && sl.end > b.start)) { skipped++; continue; }
            const entry = { date, reason: reason || null, start: sl.start, end: sl.end };
            blackoutDates.push(entry); same.push(entry); added++;
          }
        }
      }
      blackoutDates.sort((a, b) => a.date.localeCompare(b.date) || (a.start || '').localeCompare(b.start || ''));

      renderBlackout(blackoutDates, blackoutListEl);
      if (!added) { fail(`沒有新增：這些日期都已經有設定（略過 ${skipped} 筆）`); return; }
      errEl.style.color = skipped ? 'var(--warn-tx)' : 'var(--ok-tx)';
      errEl.textContent = `已加入 ${added} 筆${skipped ? `，另有 ${skipped} 筆因為與既有設定重複或重疊而略過` : ''}。請記得按最下面的「儲存設定」才會生效。`;
      container.querySelector('#inp-blackout-date').value = '';
      container.querySelector('#inp-blackout-date-end').value = '';
      container.querySelector('#inp-blackout-reason').value = '';
      container.querySelector('#chk-blackout-allday').checked = true;
      container.querySelector('#blackout-time-row').style.display = 'none';
      timeListEl.innerHTML = ''; addTimeRow();
    });

    // ── mode 單選 ↔ N 天輸入啟用 ────────────────────────
    container.querySelectorAll('input[name="mode"]').forEach(r => {
      r.addEventListener('change', () => {
        const nDays = container.querySelector('#inp-days');
        nDays.disabled = r.value !== '缺課後N天';
      });
    });

    // ── 新增時段 ─────────────────────────────────────────
    container.querySelector('#btn-add-slot').addEventListener('click', () => {
      const day   = container.querySelector('#inp-day').value;
      const start = container.querySelector('#inp-start').value;
      const end   = container.querySelector('#inp-end').value;
      const errEl = container.querySelector('#slot-err');
      if (!start || !end) { errEl.textContent = '請填入起訖時間'; return; }
      if (start >= end)   { errEl.textContent = '開始時間須早於結束時間'; return; }
      const overlap = slots.some(s => s.day === day && start < s.end && end > s.start);
      if (overlap) { errEl.textContent = '此時段與現有時段重疊，請勿重複新增'; return; }
      errEl.textContent = '';
      slots.push({ day, start, end });
      renderSlots(slots, slotListEl, () => {});
    });

    // ── 儲存＋離開頁面前未存檔提醒（避免漏按儲存就跳走白改一場） ──────
    const saveBtn = container.querySelector('#btn-save-rules');
    const msgEl   = container.querySelector('#save-msg');
    let dirty = false;

    // 任何欄位變動（含加時段／加黑名單日期觸發的 DOM 變化）都標記成「未儲存」
    container.addEventListener('input',  () => { dirty = true; });
    container.addEventListener('change', () => { dirty = true; });
    container.querySelector('#btn-add-slot').addEventListener('click', () => { dirty = true; });
    container.querySelector('#btn-add-blackout').addEventListener('click', () => { dirty = true; });

    function beforeUnloadHandler(e) {
      if (!dirty) return;
      e.preventDefault();
      e.returnValue = '';
    }
    // 換頁籤重新進來這個面板會重跑一次 renderPanel，先移除上一輪掛的監聽避免疊加
    if (window.__makeupRulesBeforeUnload) {
      window.removeEventListener('beforeunload', window.__makeupRulesBeforeUnload);
    }
    window.__makeupRulesBeforeUnload = beforeUnloadHandler;
    window.addEventListener('beforeunload', beforeUnloadHandler);

    function setSaveState(text, color, disabled) {
      msgEl.textContent = text;
      msgEl.style.color = color;
      saveBtn.disabled = disabled;
    }

    async function doSave() {
      setSaveState('儲存中…', 'var(--muted)', true);

      const selMode  = container.querySelector('input[name="mode"]:checked')?.value || '下週一';
      const nDays    = Number(container.querySelector('#inp-days').value) || 7;
      const notice   = container.querySelector('#inp-notice').value;
      const warnFlag = container.querySelector('#chk-warn').checked;
      const machineCountVal = Number(container.querySelector('#inp-machine-count').value) || (row.video_machine_count ?? 5);
      const prevJson = row.extra_json || {};

      const fields = {
        makeup_earliest_mode: selMode,
        makeup_earliest_days: selMode === '缺課後N天' ? nDays : (row.makeup_earliest_days ?? 7),
        makeup_time_slots:    slots.length ? slots : null,
        makeup_blackout_dates: blackoutDates.length ? blackoutDates : null,
        makeup_notice:        notice.trim() || null,
        video_machine_count:  machineCountVal,
        extra_json:           { ...prevJson, warn_out_of_range: warnFlag },
      };

      try {
        await saveGlobalSettings(sb, row.id, fields);
        setSaveState('✅ 已儲存', 'var(--ok-tx)', false);
        dirty = false;
        // 更新本地 row 以供下次儲存合併 extra_json
        Object.assign(row, fields);
      } catch (e) {
        setSaveState(`❌ ${e.message}`, 'var(--danger-tx)', false);
      }
    }

    saveBtn.addEventListener('click', doSave);
  }

  window.PanelMakeupRules = { loadMakeupRulesPanel };
})();
