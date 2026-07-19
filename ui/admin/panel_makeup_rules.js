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

  function renderBlackout(list, listEl) {
    listEl.innerHTML = '';
    if (!list.length) {
      listEl.innerHTML = '<p style="color:var(--muted);font-size:14px;margin:6px 0">尚未設定不開放補課日期。</p>';
      return;
    }
    list.forEach((item, i) => {
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;align-items:center;gap:10px;margin-bottom:8px;flex-wrap:wrap';
      const timeTxt = (item.start && item.end) ? ` ${item.start}–${item.end}` : '';
      row.innerHTML = `
        <span class="buke-badge" style="background:var(--warn-bg);color:var(--warn-tx);font-size:14px">
          ${item.date}${timeTxt}　${item.reason || ''}
        </span>
        <button class="buke-btn buke-btn-danger" style="font-size:13px;padding:4px 10px;min-height:32px">
          刪除
        </button>`;
      row.querySelector('button').addEventListener('click', () => {
        list.splice(i, 1);
        renderBlackout(list, listEl);
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
          <summary style="cursor:pointer;font-size:14px;color:var(--header);font-weight:500">＋ 新增不開放補課日期</summary>
          <div style="display:flex;flex-direction:column;gap:10px;margin-top:10px">
            <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
              <input type="date" id="inp-blackout-date" class="buke-input" style="font-size:14px;min-height:36px">
              <input type="text" id="inp-blackout-reason" class="buke-input" placeholder="原因（例：梁皇啟建）" style="font-size:14px;min-height:36px;flex:1;min-width:140px">
            </div>
            <label style="display:flex;align-items:center;gap:8px;font-size:14px;cursor:pointer">
              <input type="checkbox" id="chk-blackout-allday" checked style="width:18px;height:18px">
              整天不開放
            </label>
            <div id="blackout-time-row" style="display:none;align-items:center;gap:10px;flex-wrap:wrap">
              <input type="time" id="inp-blackout-start" class="buke-input" style="font-size:14px;min-height:36px;width:110px">
              <span style="color:var(--muted)">–</span>
              <input type="time" id="inp-blackout-end" class="buke-input" style="font-size:14px;min-height:36px;width:110px">
            </div>
            <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
              <button id="btn-add-blackout" class="buke-btn" style="font-size:14px;padding:6px 14px;min-height:36px">加入</button>
              <span id="blackout-err" style="font-size:13px;color:var(--danger-tx)"></span>
            </div>
          </div>
        </details>
      </div>

      <!-- §6 儲存（浮在畫面底部，滾到哪都看得到、點得到，避免漏按） -->
      <div style="position:sticky;bottom:0;margin-top:20px;padding:14px 0;
                  background:var(--bg);border-top:1px solid var(--line);
                  box-shadow:0 -4px 10px rgba(0,0,0,.06);
                  display:flex;align-items:center;gap:14px;z-index:5">
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

    container.querySelector('#chk-blackout-allday').addEventListener('change', e => {
      container.querySelector('#blackout-time-row').style.display = e.target.checked ? 'none' : 'flex';
    });

    container.querySelector('#btn-add-blackout').addEventListener('click', () => {
      const date    = container.querySelector('#inp-blackout-date').value;
      const reason  = container.querySelector('#inp-blackout-reason').value.trim();
      const allDay  = container.querySelector('#chk-blackout-allday').checked;
      const errEl   = container.querySelector('#blackout-err');
      if (!date) { errEl.textContent = '請選擇日期'; return; }
      const dup = blackoutDates.some(b => b.date === date);
      if (dup) { errEl.textContent = '此日期已列入不開放補課，請勿重複新增'; return; }

      if (allDay) {
        errEl.textContent = '';
        blackoutDates.push({ date, reason: reason || null });
      } else {
        const start = container.querySelector('#inp-blackout-start').value;
        const end   = container.querySelector('#inp-blackout-end').value;
        if (!start || !end) { errEl.textContent = '請填入起訖時間'; return; }
        if (start >= end)   { errEl.textContent = '開始時間須早於結束時間'; return; }
        errEl.textContent = '';
        blackoutDates.push({ date, reason: reason || null, start, end });
      }

      renderBlackout(blackoutDates, blackoutListEl);
      container.querySelector('#inp-blackout-date').value = '';
      container.querySelector('#inp-blackout-reason').value = '';
      container.querySelector('#inp-blackout-start').value = '';
      container.querySelector('#inp-blackout-end').value = '';
      container.querySelector('#chk-blackout-allday').checked = true;
      container.querySelector('#blackout-time-row').style.display = 'none';
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

    // ── 儲存 ─────────────────────────────────────────────
    container.querySelector('#btn-save-rules').addEventListener('click', async () => {
      const saveBtn = container.querySelector('#btn-save-rules');
      const msgEl   = container.querySelector('#save-msg');
      saveBtn.disabled = true;
      msgEl.textContent = '儲存中…';
      msgEl.style.color = 'var(--muted)';

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
        msgEl.textContent = '✅ 已儲存';
        msgEl.style.color = 'var(--ok-tx)';
        // 更新本地 row 以供下次儲存合併 extra_json
        Object.assign(row, fields);
      } catch (e) {
        msgEl.textContent = `❌ ${e.message}`;
        msgEl.style.color = 'var(--danger-tx)';
      } finally {
        saveBtn.disabled = false;
      }
    });
  }

  window.PanelMakeupRules = { loadMakeupRulesPanel };
})();
