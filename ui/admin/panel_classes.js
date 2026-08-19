// 職責：班別設定面板——列出進行中/準備中班別、編輯、新增、結業封存、新班啟用
// 依賴：window.AdminData（admin.js）

'use strict';

(function () {
  const { fetchClasses, updateClass, insertClass, archiveClass, activateClass, fetchSessions, updateSession, deleteSession,
          insertSession, postponeSessions,
          bindClassId, findClassByClassId, compareClassSchedule } = window.AdminData;

  const DAY_OPTS = ['一','二','三','四','五','六','日'];

  /** 計算並回傳結業標準文字（唯讀顯示用） */
  function graduationText(total) {
    const cap     = Math.min(Number(total) || 20, 20);
    const phys    = Math.ceil(cap / 2);
    const credit  = cap - 3;
    return `實體出席 ≥ ${phys} 堂　缺課 ≤ 3 堂　實體＋補課 ≥ ${credit} 堂${Number(total) > 20 ? '（超過 20 堂套 20 計算）' : ''}`;
  }

  /** 產生編輯/新增表單 HTML */
  function classFormHtml(cls) {
    const v = cls || {};
    const dayOpts = DAY_OPTS.map(d =>
      `<option${v.day_of_week === d ? ' selected' : ''}>${d}</option>`).join('');
    const totalVal = v.total_sessions || 20;
    return `
      <div style="display:flex;flex-direction:column;gap:10px;margin-top:10px">
        <label style="font-size:15px">班名
          <input class="buke-input f-name" style="margin-top:4px;width:100%"
                 value="${v.class_name || ''}" placeholder="例：二夜中級班">
        </label>
        <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end">
          <label style="font-size:15px">星期 <span style="color:var(--danger-tx)">＊必填</span>
            <select class="buke-select f-dow" style="margin-top:4px">
              <option value="">—</option>${dayOpts}
            </select>
          </label>
          <label style="font-size:15px">日/夜 <span style="color:var(--danger-tx)">＊必填</span>
            <select class="buke-select f-dn" style="margin-top:4px">
              <option value="">—</option>
              <option${v.day_night === '日' ? ' selected' : ''}>日</option>
              <option${v.day_night === '夜' ? ' selected' : ''}>夜</option>
            </select>
          </label>
          <label style="font-size:15px">總堂數
            <input class="buke-input f-total" type="number" min="1"
                   style="margin-top:4px;width:80px" value="${totalVal}">
          </label>
          <label style="font-size:15px">上課時間
            <input class="buke-input f-start" type="time"
                   style="margin-top:4px" value="${v.start_time ? String(v.start_time).slice(0,5) : ''}">
          </label>
        </div>
        <div style="font-size:12px;color:var(--muted)">
          ⚠️ 星期／日夜請務必填寫：匯入資料時的「檔名跟目標班兜不起來」防呆會用到這兩個
          欄位比對，沒填會讓防呆失效。上課時間沒填的話，日夜補調班的學員在櫃台刷卡時，
          系統會判斷不出遲到／準時，「補課／調課總覽」會顯示異常文字。
        </div>
        <div class="grad-hint" style="font-size:13px;color:var(--muted);
             background:var(--surface);border-radius:var(--r-md);
             padding:8px 12px;border:1px solid var(--line)">
          📐 結業標準：<span class="grad-text">${graduationText(totalVal)}</span>
        </div>
        <label style="font-size:15px">負責法師
          <input class="buke-input f-teacher" style="margin-top:4px;width:100%"
                 value="${v.teacher || ''}" placeholder="例：星良法師">
        </label>
        <div style="display:flex;gap:10px">
          <button class="buke-btn btn-save-class" style="font-size:14px">儲存</button>
          <button class="buke-btn buke-btn-ghost btn-cancel-class" style="font-size:14px">取消</button>
        </div>
        <div class="form-msg" style="font-size:14px"></div>
      </div>`;
  }

  /** 在 formWrap 內綁定總堂數即時更新結業標準 */
  function bindGradHint(formWrap) {
    const input   = formWrap.querySelector('.f-total');
    const display = formWrap.querySelector('.grad-text');
    if (!input || !display) return;
    input.addEventListener('input', () => {
      display.textContent = graduationText(input.value);
    });
  }

  /** 讀取表單欄位 */
  function readForm(wrap) {
    return {
      class_name:     wrap.querySelector('.f-name').value.trim(),
      day_of_week:    wrap.querySelector('.f-dow').value  || null,
      day_night:      wrap.querySelector('.f-dn').value   || null,
      total_sessions: Number(wrap.querySelector('.f-total').value) || 20,
      teacher:        wrap.querySelector('.f-teacher').value.trim() || null,
      start_time:     wrap.querySelector('.f-start').value || null,
    };
  }

  /** 依日期重新排序整班堂次、重新編號「第幾堂」（week_num 只是顯示標籤，sessions 表對它
   *  沒有 UNIQUE 限制，可以直接覆寫；新增/刪除/改日期互換之後都呼叫這支，確保「第幾堂」
   *  永遠等於上課日期的先後順序，不管資料是怎麼異動的，不要各自寫一份重複邏輯） */
  async function resyncWeekNums(sb, classRef) {
    let list = await fetchSessions(sb, classRef);
    list = list.slice().sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    for (let idx = 0; idx < list.length; idx++) {
      const wantedNum = idx + 1;
      if (list[idx].week_num !== wantedNum) {
        await updateSession(sb, list[idx].id, { week_num: wantedNum });
        list[idx].week_num = wantedNum;
      }
    }
    return list;
  }

  /** 渲染堂次管理表格（inline 逐列儲存，改一堂不整面板重整；刪除/新增/整批順延則重抓整班堂次重繪表格）
   *  @param {object} cls 該班別完整物件（需含 id／class_name／total_sessions，供整批順延下拉與
   *         「新增一堂」後比對 total_sessions 用） */
  function renderSessionsTable(sb, area, sessions, cls) {
    const classRef = cls.id;

    const weekOpts = sessions.map(s => `<option value="${s.week_num}">第 ${s.week_num} 堂（${s.date}）</option>`).join('');

    const postponeHtml = sessions.length ? `
      <div class="postpone-wrap" style="margin-bottom:10px">
        <button class="buke-btn buke-btn-ghost btn-toggle-postpone" style="font-size:13px">整批順延</button>
        <div class="postpone-form" style="display:none;margin-top:8px;padding:10px;
             background:var(--bg);border-radius:var(--r-md)">
          <div style="display:flex;gap:10px;align-items:flex-end;flex-wrap:wrap">
            <label style="font-size:13px">從第幾堂開始
              <select class="buke-select f-postpone-week" style="margin-top:4px">${weekOpts}</select>
            </label>
            <label style="font-size:13px">順延天數
              <input type="number" class="buke-input f-postpone-days" value="7" style="margin-top:4px;width:80px">
            </label>
            <button class="buke-btn btn-apply-postpone" style="font-size:13px">套用</button>
          </div>
          <div class="postpone-msg" style="font-size:13px;margin-top:6px"></div>
        </div>
      </div>` : '';

    const tableHtml = sessions.length ? `
      <table style="width:100%;border-collapse:collapse;font-size:0.9em">
        <thead><tr style="background:var(--surface-alt)">
          <th style="padding:5px 8px;text-align:left">第幾堂</th>
          <th style="padding:5px 8px;text-align:left">日期</th>
          <th style="padding:5px 8px;text-align:left">已上課</th>
          <th style="padding:5px 8px;text-align:left"></th>
        </tr></thead>
        <tbody>
          ${sessions.map((s, i) => `<tr data-srow="${i}">
            <td style="padding:5px 8px">第 ${s.week_num} 堂</td>
            <td style="padding:5px 8px">
              <input type="date" class="buke-input f-sdate" value="${s.date}">
              ${s.is_held ? '<div style="font-size:12px;color:var(--danger-tx);margin-top:2px">⚠️ 此堂已有出缺勤/補課資料，改期前請確認</div>' : ''}
            </td>
            <td style="padding:5px 8px"><input type="checkbox" class="f-sheld" ${s.is_held ? 'checked' : ''}></td>
            <td style="padding:5px 8px">
              <button class="buke-btn small btn-save-session" style="font-size:13px">儲存</button>
              <button class="buke-btn buke-btn-danger small btn-delete-session" style="font-size:13px">刪除</button>
              <span class="s-msg" style="font-size:13px;margin-left:6px"></span>
            </td>
          </tr>`).join('')}
        </tbody>
      </table>` : '<p class="buke-empty" style="font-size:13px">尚無堂次資料。</p>';

    area.innerHTML = `
      ${postponeHtml}
      ${tableHtml}
      <div class="add-session-wrap" style="margin-top:10px;padding:10px;
           background:var(--bg);border-radius:var(--r-md)">
        <div style="font-size:14px;margin-bottom:6px">新增一堂</div>
        <div style="display:flex;gap:10px;align-items:flex-end;flex-wrap:wrap">
          <label style="font-size:13px">日期
            <input type="date" class="buke-input f-add-date" style="margin-top:4px">
          </label>
          <button class="buke-btn btn-add-session" style="font-size:13px">新增</button>
        </div>
        <div class="add-session-msg" style="font-size:13px;margin-top:6px"></div>
      </div>`;

    if (sessions.length) {
      area.querySelectorAll('[data-srow]').forEach((row, i) => {
        const s = sessions[i];
        row.querySelector('.btn-save-session').addEventListener('click', async () => {
          const btn   = row.querySelector('.btn-save-session');
          const msgEl = row.querySelector('.s-msg');
          const date  = row.querySelector('.f-sdate').value;
          const held  = row.querySelector('.f-sheld').checked;
          if (!date) { msgEl.textContent = '請選擇日期'; msgEl.style.color = 'var(--danger-tx)'; return; }

          const conflict = sessions.find(x => x.id !== s.id && x.date === date);
          if (conflict) {
            const warnHeld = (s.is_held || conflict.is_held)
              ? '\n⚠️ 其中至少一堂已有出缺勤/補課資料，互換後這些紀錄會跟著各自的堂次變成新日期，請確認。'
              : '';
            const ok = confirm(
              `這個日期已經是第 ${conflict.week_num} 堂了，要不要直接跟第 ${conflict.week_num} 堂互換日期？${warnHeld}`
            );
            if (!ok) { msgEl.textContent = '已取消，請換一個日期'; msgEl.style.color = 'var(--danger-tx)'; return; }
          }

          btn.disabled = true; msgEl.textContent = '儲存中…'; msgEl.style.color = 'var(--muted)';
          try {
            if (conflict) {
              // 三段式互換，中間借一個保證沒人用的暫時日期，避開 UNIQUE(class_ref, date) 撞期
              const TEMP_DATE = '9999-12-31';
              await updateSession(sb, conflict.id, { date: TEMP_DATE });
              await updateSession(sb, s.id, { date, is_held: held });
              await updateSession(sb, conflict.id, { date: s.date });
            } else {
              await updateSession(sb, s.id, { date, is_held: held });
            }
            const updated = await resyncWeekNums(sb, classRef);
            renderSessionsTable(sb, area, updated, cls);
          } catch (e) {
            msgEl.textContent = `❌ ${e.message}`; msgEl.style.color = 'var(--danger-tx)';
            btn.disabled = false;
          }
        });

        row.querySelector('.btn-delete-session').addEventListener('click', async () => {
          const btn   = row.querySelector('.btn-delete-session');
          const msgEl = row.querySelector('.s-msg');
          const confirmMsg = s.is_held
            ? '這堂已有出缺勤/補課資料，刪除後這些紀錄會一併消失且無法復原，確定要刪除嗎？'
            : '確定要刪除這堂嗎？';
          if (!confirm(confirmMsg)) return;
          btn.disabled = true; msgEl.textContent = '刪除中…'; msgEl.style.color = 'var(--muted)';
          try {
            await deleteSession(sb, s.id);
            const updated = await resyncWeekNums(sb, classRef);
            renderSessionsTable(sb, area, updated, cls);
          } catch (e) {
            msgEl.textContent = `❌ ${e.message}`; msgEl.style.color = 'var(--danger-tx)';
            btn.disabled = false;
          }
        });
      });

      // 整批順延（停課/颱風假：從某一堂開始，後面所有堂次日期整批 ±天數，避免逐筆改撞到 UNIQUE(class_ref,date)）
      const toggleBtn  = area.querySelector('.btn-toggle-postpone');
      const postponeEl = area.querySelector('.postpone-form');
      toggleBtn.addEventListener('click', () => {
        postponeEl.style.display = postponeEl.style.display === 'none' ? '' : 'none';
      });

      area.querySelector('.btn-apply-postpone').addEventListener('click', async () => {
        const btn      = area.querySelector('.btn-apply-postpone');
        const msgEl    = area.querySelector('.postpone-msg');
        const fromWeek = Number(area.querySelector('.f-postpone-week').value);
        const days     = Number(area.querySelector('.f-postpone-days').value);
        if (!days) { msgEl.textContent = '請輸入順延天數（不可為 0）'; msgEl.style.color = 'var(--danger-tx)'; return; }

        const affected = sessions.filter(s => s.week_num >= fromWeek);
        const hasHeld  = affected.some(s => s.is_held);
        const confirmMsg = hasHeld
          ? `這幾堂已有出缺勤/報到資料，順延日期後日期會跟著改，請確認：從第 ${fromWeek} 堂起共 ${affected.length} 堂，順延 ${days} 天，確定要套用嗎？`
          : `確定要從第 ${fromWeek} 堂起共 ${affected.length} 堂，整批順延 ${days} 天嗎？`;
        if (!confirm(confirmMsg)) return;

        btn.disabled = true; msgEl.textContent = '套用中…'; msgEl.style.color = 'var(--muted)';
        try {
          await postponeSessions(sb, classRef, fromWeek, days);
          const updated = await fetchSessions(sb, classRef);
          renderSessionsTable(sb, area, updated, cls);
        } catch (e) {
          msgEl.textContent = `❌ ${e.message}`; msgEl.style.color = 'var(--danger-tx)';
          btn.disabled = false;
        }
      });
    }

    // 新增一堂
    area.querySelector('.btn-add-session').addEventListener('click', async () => {
      const btn   = area.querySelector('.btn-add-session');
      const msgEl = area.querySelector('.add-session-msg');
      const date  = area.querySelector('.f-add-date').value;
      if (!date) { msgEl.textContent = '請選擇日期'; msgEl.style.color = 'var(--danger-tx)'; return; }
      if (sessions.some(s => s.date === date)) {
        msgEl.textContent = '這個日期已經有堂次了，請換一個日期'; msgEl.style.color = 'var(--danger-tx)'; return;
      }
      btn.disabled = true; msgEl.textContent = '新增中…'; msgEl.style.color = 'var(--muted)';
      try {
        const nextWeekNum = sessions.length ? Math.max(...sessions.map(s => s.week_num)) + 1 : 1;
        await insertSession(sb, classRef, { date, week_num: nextWeekNum });
        const updated = await resyncWeekNums(sb, classRef);

        if (updated.length > (cls.total_sessions || 0)) {
          const sync = confirm(
            `目前共幾堂設定是 ${cls.total_sessions}，新增後已有 ${updated.length} 筆堂次，`
            + `要不要一併把「共幾堂」改成 ${updated.length}？`
          );
          if (sync) {
            await updateClass(sb, cls.id, { class_name: cls.class_name, total_sessions: updated.length });
            cls.total_sessions = updated.length;
          }
        }
        renderSessionsTable(sb, area, updated, cls);
      } catch (e) {
        msgEl.textContent = `❌ ${e.message}`; msgEl.style.color = 'var(--danger-tx)';
        btn.disabled = false;
      }
    });
  }

  const ZENCLASS_SCAN_RANGE = 20; // 掃描錨點前後範圍（可調整，不寫死在函式內部）

  /** 找掃描法的預設錨點：優先找「同系列」的已綁定班（班名去掉日/夜後相同，例如
   *  「四夜研經班」跟「四日研經班」通常是相鄰真代碼），這樣掃描範圍才會落在正確號段；
   *  找不到同系列的才退回「隨便一筆已綁定班」（可能號段差很遠，掃不到很正常，
   *  UI 一律讓使用者可以手動改，不要卡死在這個猜測值）。 */
  function findAnchorClassId(allClasses, targetName) {
    const real = (allClasses || []).filter(c => c.class_id && !c.class_id.startsWith('MANUAL-'));
    if (!real.length) return null;
    if (targetName) {
      const stripped = targetName.replace(/[日夜]/g, '');
      const sameFamily = real.find(c => c.class_name && c.class_name.replace(/[日夜]/g, '') === stripped);
      if (sameFamily) return sameFamily.class_id;
    }
    return real[0].class_id;
  }

  /** 把真代碼拆成「前綴」＋「尾碼數字」，供掃描鄰近號碼使用 */
  function splitClassIdAnchor(classId) {
    const m = String(classId || '').match(/^(\D*)(\d+)$/);
    if (!m) return null;
    return { prefix: m[1], digits: m[2] };
  }

  /** 掃描法找真代碼（主要方法，不受上課時間限制）：以錨點代碼為中心，往前往後掃 range 個候選號碼，
   *  逐一呼叫 class_attend_records（帶今天/指定日期），有回傳資料的視為「zenclass 真的有這個代碼」 */
  async function scanZenclassClassIds(anchorClassId, dateStr, range, onProgress) {
    const parsed = splitClassIdAnchor(anchorClassId);
    if (!parsed) throw new Error(`錨點代碼「${anchorClassId}」格式無法解析（需為英文前綴＋數字）`);
    const apiBase   = (typeof CONFIG !== 'undefined' && CONFIG.API_BASE) || 'https://zenclass.ctcm.org.tw';
    const anchorNum = parseInt(parsed.digits, 10);
    const width     = parsed.digits.length;

    const offsets = [];
    for (let o = -range; o <= range; o++) offsets.push(o);
    const total = offsets.length;
    const found = [];
    let done = 0;

    for (const offset of offsets) {
      done++;
      if (onProgress) onProgress(done, total);
      const num = anchorNum + offset;
      if (num < 0) continue;
      const candidateId = parsed.prefix + String(num).padStart(width, '0');
      try {
        const url = `${apiBase}/meditation/api/kiosk/class_attend_records`
          + `?classDate=${dateStr}&classId=${candidateId}&includes=${encodeURIComponent('className')}`;
        const res  = await fetch(url);
        const json = await res.json();
        if (json.errCode === 200 && Array.isArray(json.items) && json.items.length > 0) {
          found.push({ classId: candidateId, className: json.items[0].className || '', attendCount: json.items.length });
        }
      } catch (e) { /* 單一候選失敗不中斷整輪掃描 */ }
    }
    return found;
  }

  /** （可選）class_date_infos 雙重確認：只有在該班「當下正在上課」才有回應，查不到不影響掃描結果 */
  async function fetchZenclassDateInfosOptional(dateStr) {
    try {
      const unitId  = (typeof CONFIG !== 'undefined' && CONFIG.UNIT_ID)  || 'UNIT01071';
      const apiBase = (typeof CONFIG !== 'undefined' && CONFIG.API_BASE) || 'https://zenclass.ctcm.org.tw';
      const url = `${apiBase}/meditation/api/kiosk/class_date_infos?unitId=${unitId}&classDate=${dateStr}`;
      const res  = await fetch(url);
      const json = await res.json();
      if (json.errCode !== 200) return [];
      return json.items || [];
    } catch (e) { return []; }
  }

  /** 主要路徑：直接查今日班表（class_date_infos），不需錨點、不需猜號，
   *  只有該班「正在上課時間內」才查得到；查到後渲染清單，點選後透過 onBindPick 回呼交由呼叫端綁定 */
  async function renderTodayClassPicker(area, dateVal, cls, onBindPick) {
    const resultEl = area.querySelector('.today-result');
    resultEl.innerHTML = '<p class="buke-empty" style="font-size:13px">查詢中…</p>';
    const items = await fetchZenclassDateInfosOptional(dateVal);

    if (!items.length) {
      resultEl.innerHTML = `<p class="buke-empty" style="font-size:13px">
        目前查無今日班表，可能還沒到上課時間，可以稍後再查，或改用下方「進階：掃描猜號碼」。</p>`;
      return;
    }

    const sorted = [...items].sort((a, b) => {
      const am = a.className === cls.class_name ? 0 : 1;
      const bm = b.className === cls.class_name ? 0 : 1;
      return am - bm;
    });

    resultEl.innerHTML = sorted.map((it, i) => `
      <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;
                  padding:6px 0;border-bottom:1px solid var(--line)">
        <span style="font-size:14px">
          ${it.className || '—'}${it.className === cls.class_name ? ' <strong style="color:var(--ok-tx)">（班名相符）</strong>' : ''}
          　${it.classStartTime || ''}–${it.classEndTime || ''}　代碼 ${it.classId}
        </span>
        <button class="buke-btn small btn-pick-today" data-idx="${i}" style="font-size:13px">選這班</button>
      </div>`).join('');

    resultEl.querySelectorAll('.btn-pick-today').forEach(btn => {
      const picked = sorted[Number(btn.dataset.idx)];
      btn.addEventListener('click', () => onBindPick({ classId: picked.classId, className: picked.className }));
    });
  }

  /** 綁定用：選定真代碼後，先查是否已被另一筆班別佔用，決定直接綁定或走合併流程 */
  async function confirmBind(sb, area, cls, picked, onRefresh) {
    const msgEl = area.querySelector('.bind-msg');
    const realClassId = picked.classId;
    if (!realClassId) { msgEl.textContent = '此筆排課缺少 classId，無法綁定'; return; }
    msgEl.textContent = '檢查中…';
    try {
      const existing = await findClassByClassId(sb, cls.unit_id, realClassId);
      const other = existing.find(r => r.id !== cls.id);
      if (other) {
        const ok = confirm(
          `⚠ zenclass 代碼「${realClassId}」已經被「${other.class_name}」（${other.status}）這筆班別使用。\n`
          + `將把「${cls.class_name}」的學員合併進「${other.class_name}」，此為不可逆操作，確定要合併嗎？`
        );
        if (!ok) { msgEl.textContent = '已取消。'; return; }
        msgEl.textContent = '合併中…';
        const { data: mergeResult, error: mergeErr } = await sb.rpc('merge_manual_class_into_real', {
          p_manual_class_ref: cls.id,
          p_real_class_ref:   other.id,
        });
        if (mergeErr) throw new Error(mergeErr.message);
        const dupCount = (mergeResult.duplicate_members || []).length;
        msgEl.textContent = `✅ 合併完成，搬移 ${mergeResult.moved_members} 位學員${dupCount ? `，另有 ${dupCount} 位需人工核對` : ''}。`;
        onRefresh();
        return;
      }
      // 不存在同代碼的另一筆 → 簡單狀況，直接綁定
      await bindClassId(sb, cls.id, realClassId);
      msgEl.textContent = '✅ 已綁定 zenclass 真代碼。';
      onRefresh();
    } catch (e) {
      msgEl.textContent = `❌ ${e.message}`;
    }
  }

  /** 渲染「綁定 zenclass 真代碼」表單：
   *  主要路徑＝查今日班表（class_date_infos）直接挑選；備援路徑＝錨點＋掃描猜號（收合在「進階」內）。
   *  兩條路徑最終都呼叫同一個 confirmBind，不重複寫合併/綁定判斷邏輯。 */
  function renderBindForm(sb, area, cls, onRefresh, allClasses) {
    const today  = new Date().toLocaleDateString('sv-SE');
    const anchor = findAnchorClassId(allClasses, cls.class_name);

    area.innerHTML = `
      <div style="padding:10px;background:var(--bg);border-radius:var(--r-md)">
        <div style="display:flex;gap:8px;align-items:center;margin-bottom:10px;flex-wrap:wrap">
          <label style="font-size:13px;color:var(--muted)">查詢日期
            <input type="date" class="buke-input f-binddate" value="${today}" style="width:150px;margin-left:4px">
          </label>
          <button class="buke-btn btn-query-today" style="font-size:13px">查詢今日班表</button>
        </div>
        <div class="today-result"></div>
        <div class="bind-msg" style="font-size:13px;margin-top:6px"></div>

        <details style="margin-top:16px">
          <summary style="font-size:13px;color:var(--muted);cursor:pointer">
            進階：掃描猜號碼（不限上課時間，需要已知真代碼當錨點）
          </summary>
          <div style="margin-top:10px">
            <div style="font-size:14px;margin-bottom:8px">
              掃描錨點（${anchor ? '自動抓到一筆已知真代碼，' : '目前沒有已知真代碼可自動帶入，'}掃描是以這個代碼為中心往前後找；
              如果掃不到，代表這班跟錨點不同號段，換一個同系列的班代碼再試）：
            </div>
            <input class="buke-input f-anchor" placeholder="例：CLS115031900005" value="${anchor || ''}" style="width:100%;margin-bottom:8px">
            <div style="display:flex;gap:8px;align-items:center;margin-bottom:10px;flex-wrap:wrap">
              <label style="font-size:13px;color:var(--muted)">掃描範圍 ±
                <input type="number" class="buke-input f-scanrange" value="${ZENCLASS_SCAN_RANGE}" min="1" max="200" style="width:70px;margin-left:4px">
              </label>
              <button class="buke-btn btn-query-schedule" style="font-size:13px">掃描查詢真代碼</button>
            </div>
            <div class="bind-progress" style="font-size:13px;color:var(--muted)"></div>
            <div class="bind-result"></div>
          </div>
        </details>
      </div>`;

    area.querySelector('.btn-query-today').addEventListener('click', () => {
      const dateVal = area.querySelector('.f-binddate').value;
      const msgEl   = area.querySelector('.bind-msg');
      msgEl.textContent = '';
      if (!dateVal) { msgEl.textContent = '請選擇日期'; return; }
      renderTodayClassPicker(area, dateVal, cls, (picked) => confirmBind(sb, area, cls, picked, onRefresh));
    });

    area.querySelector('.btn-query-schedule').addEventListener('click', async () => {
      const dateVal    = area.querySelector('.f-binddate').value;
      const rangeVal   = Number(area.querySelector('.f-scanrange').value) || ZENCLASS_SCAN_RANGE;
      const anchorVal  = area.querySelector('.f-anchor')?.value.trim();
      const progressEl = area.querySelector('.bind-progress');
      const resultEl   = area.querySelector('.bind-result');
      const msgEl      = area.querySelector('.bind-msg');
      msgEl.textContent = '';
      resultEl.innerHTML = '';
      if (!dateVal)   { msgEl.textContent = '請選擇日期'; return; }
      if (!anchorVal) { msgEl.textContent = '請輸入一個已知的真代碼當錨點'; return; }

      try {
        const found = await scanZenclassClassIds(anchorVal, dateVal, rangeVal, (done, total) => {
          progressEl.textContent = `掃描中… ${done} / ${total}`;
        });
        progressEl.textContent = '';

        const dateInfos = await fetchZenclassDateInfosOptional(dateVal);
        const dateInfoNote = dateInfos.length
          ? `（雙重確認：class_date_infos 目前也查到 ${dateInfos.length} 筆排課，供對照）`
          : '（class_date_infos 目前無回應，不影響掃描結果，可能只是現在不是上課時間）';

        if (!found.length) {
          resultEl.innerHTML = `<p class="buke-empty" style="font-size:13px">掃描範圍內查無任何真代碼有資料。${dateInfoNote}</p>`;
          return;
        }

        const sorted = [...found].sort((a, b) => {
          const am = a.className === cls.class_name ? 0 : 1;
          const bm = b.className === cls.class_name ? 0 : 1;
          return am - bm;
        });

        resultEl.innerHTML = `<p style="font-size:12px;color:var(--muted);margin-bottom:6px">${dateInfoNote}</p>`
          + sorted.map((it, i) => `
            <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;
                        padding:6px 0;border-bottom:1px solid var(--line)">
              <span style="font-size:14px">
                ${it.className || '—'}${it.className === cls.class_name ? ' <strong style="color:var(--ok-tx)">（班名相符）</strong>' : ''}
                　代碼 ${it.classId}　當天報到 ${it.attendCount} 人
              </span>
              <button class="buke-btn small btn-pick-schedule" data-idx="${i}" style="font-size:13px">選這班</button>
            </div>`).join('');
        resultEl.querySelectorAll('.btn-pick-schedule').forEach(btn => {
          btn.addEventListener('click', () => confirmBind(sb, area, cls, sorted[Number(btn.dataset.idx)], onRefresh));
        });
      } catch (e) {
        progressEl.textContent = '';
        msgEl.textContent = `❌ ${e.message}`;
      }
    });
  }

  /** 建立一張班別卡（含動作按鈕） */
  function buildClassCard(sb, cls, onRefresh, allClasses) {
    const card = document.createElement('div');
    card.className = 'buke-card';
    card.style.marginBottom = '10px';

    const isReady   = cls.status === '準備中';
    const isActive  = cls.status === '進行中';
    const isManual  = (cls.class_id || '').startsWith('MANUAL-');

    card.innerHTML = `
      <div class="row">
        <div>
          <span class="name">${cls.class_name}</span>
          ${isManual ? `<span style="background:#f4d35e;color:#5c3d00;padding:2px 8px;border-radius:4px;font-size:13px;margin-left:8px">⚠ 尚未綁定 zenclass</span>` : ''}
          <span class="meta">${cls.day_of_week || ''}　${cls.day_night || ''}　共 ${cls.total_sessions} 堂
            ${cls.teacher ? '　' + cls.teacher : ''}</span>
        </div>
        <span class="buke-badge ${isActive ? 'pass' : 'warn'}">${cls.status}</span>
      </div>
      <div class="action-row" style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px">
        <button class="buke-btn buke-btn-ghost btn-edit" style="font-size:14px">編輯</button>
        <button class="buke-btn buke-btn-ghost btn-sessions" style="font-size:14px">堂次管理</button>
        ${isManual ? `<button class="buke-btn buke-btn-ghost btn-bind-zenclass"
          style="font-size:14px">🔗 綁定 zenclass 真代碼</button>` : ''}
        ${isActive ? `<button class="buke-btn btn-archive"
          style="font-size:14px;background:var(--muted)">結業封存</button>` : ''}
        ${isReady ? `<button class="buke-btn btn-activate"
          style="font-size:14px">新班啟用</button>` : ''}
      </div>
      <div class="edit-area"></div>
      <div class="sessions-area" style="margin-top:10px"></div>
      <div class="bind-area" style="margin-top:10px"></div>
      <div class="confirm-area" style="display:none;margin-top:10px;padding:10px;
           background:var(--surface);border-radius:var(--r-md);border:1px solid var(--line)">
        <p class="confirm-msg" style="font-size:15px;margin-bottom:10px"></p>
        <div style="display:flex;gap:8px">
          <button class="buke-btn btn-confirm-yes" style="font-size:14px">確定</button>
          <button class="buke-btn buke-btn-ghost btn-confirm-no" style="font-size:14px">取消</button>
        </div>
        <div class="confirm-result" style="font-size:14px;margin-top:8px"></div>
      </div>`;

    const editArea     = card.querySelector('.edit-area');
    const sessionsArea = card.querySelector('.sessions-area');
    const bindArea     = card.querySelector('.bind-area');
    const confirmArea = card.querySelector('.confirm-area');
    const confirmMsg  = card.querySelector('.confirm-msg');
    const confirmRes  = card.querySelector('.confirm-result');

    // 編輯
    card.querySelector('.btn-edit').addEventListener('click', () => {
      editArea.innerHTML = classFormHtml(cls);
      bindGradHint(editArea);
      card.querySelector('.btn-save-class').addEventListener('click', async () => {
        const fields = readForm(card);
        if (!fields.class_name) { card.querySelector('.form-msg').textContent = '班名不可空白'; return; }
        if (!fields.day_of_week || !fields.day_night) {
          card.querySelector('.form-msg').textContent = '星期／日夜請務必選擇，匯入防呆需要用到這兩個欄位';
          return;
        }
        try {
          await updateClass(sb, cls.id, fields);
          onRefresh();
        } catch (e) { card.querySelector('.form-msg').textContent = `❌ ${e.message}`; }
      });
      card.querySelector('.btn-cancel-class').addEventListener('click', () => { editArea.innerHTML = ''; });
    });

    // 堂次管理
    card.querySelector('.btn-sessions').addEventListener('click', async () => {
      if (sessionsArea.innerHTML) { sessionsArea.innerHTML = ''; return; }
      sessionsArea.innerHTML = '<p class="buke-empty" style="font-size:13px">載入中…</p>';
      try {
        const sessions = await fetchSessions(sb, cls.id);
        renderSessionsTable(sb, sessionsArea, sessions, cls);
      } catch (e) {
        sessionsArea.innerHTML = `<div class="buke-msg err">❌ ${e.message}</div>`;
      }
    });

    // 綁定 zenclass 真代碼
    card.querySelector('.btn-bind-zenclass')?.addEventListener('click', () => {
      if (bindArea.innerHTML) { bindArea.innerHTML = ''; return; }
      renderBindForm(sb, bindArea, cls, onRefresh, allClasses);
    });

    // 結業封存
    card.querySelector('.btn-archive')?.addEventListener('click', () => {
      confirmMsg.textContent = `確定將「${cls.class_name}」結業封存？封存後學員在前台看不到此班。`;
      confirmArea.style.display = '';
      card.querySelector('.btn-confirm-yes').onclick = async () => {
        try {
          await archiveClass(sb, cls.id);
          onRefresh();
        } catch (e) { confirmRes.textContent = `❌ ${e.message}`; }
      };
      card.querySelector('.btn-confirm-no').onclick = () => { confirmArea.style.display = 'none'; };
    });

    // 新班啟用
    card.querySelector('.btn-activate')?.addEventListener('click', () => {
      confirmMsg.textContent = `確定啟用「${cls.class_name}」？只有同級別（${cls.level}）且同星期同日夜（${cls.day_of_week} ${cls.day_night}）目前進行中的班會自動結業封存，其他時段的班不受影響。`;
      confirmArea.style.display = '';
      card.querySelector('.btn-confirm-yes').onclick = async () => {
        try {
          await activateClass(sb, cls);
          onRefresh();
        } catch (e) { confirmRes.textContent = `❌ ${e.message}`; }
      };
      card.querySelector('.btn-confirm-no').onclick = () => { confirmArea.style.display = 'none'; };
    });

    return card;
  }

  /** 主入口：載入並渲染班別設定面板 */
  async function loadClassesPanel(sb, container) {
    container.innerHTML = '<p class="buke-empty">載入中…</p>';
    try {
      const classes = await fetchClasses(sb);
      // 依星期一～日排序（同星期日間排夜間前面）
      const active  = classes.filter(c => c.status === '進行中').sort(compareClassSchedule);
      const ready   = classes.filter(c => c.status === '準備中').sort(compareClassSchedule);

      const refresh = () => loadClassesPanel(sb, container);

      let html = '';
      if (!active.length && !ready.length) {
        html = '<p class="buke-empty">尚無班別資料，請新增。</p>';
      }
      container.innerHTML = `
        ${active.length ? '<div class="buke-section pass">進行中（本期）</div>' : ''}
        <div id="cls-active"></div>
        ${ready.length ? '<div class="buke-section warn" style="margin-top:16px">準備中（下期）</div>' : ''}
        <div id="cls-ready"></div>
        <div style="margin-top:20px">
          <button class="buke-btn buke-btn-ghost" id="btn-new-class" style="font-size:14px">＋ 新增班別（準備中）</button>
          <div id="new-class-form"></div>
        </div>`;

      for (const cls of active) container.querySelector('#cls-active').appendChild(buildClassCard(sb, cls, refresh, classes));
      for (const cls of ready)  container.querySelector('#cls-ready').appendChild(buildClassCard(sb, cls, refresh, classes));

      // 新增班別
      container.querySelector('#btn-new-class').addEventListener('click', () => {
        const formWrap = container.querySelector('#new-class-form');
        if (formWrap.innerHTML) { formWrap.innerHTML = ''; return; }
        formWrap.innerHTML = classFormHtml(null);
        bindGradHint(formWrap);
        formWrap.querySelector('.btn-save-class').addEventListener('click', async () => {
          const fields = readForm(formWrap);
          if (!fields.class_name) { formWrap.querySelector('.form-msg').textContent = '班名不可空白'; return; }
          if (!fields.day_of_week || !fields.day_night) {
            formWrap.querySelector('.form-msg').textContent = '星期／日夜請務必選擇，匯入防呆需要用到這兩個欄位';
            return;
          }
          try {
            await insertClass(sb, fields);
            formWrap.innerHTML = '';
            refresh();
          } catch (e) { formWrap.querySelector('.form-msg').textContent = `❌ ${e.message}`; }
        });
        formWrap.querySelector('.btn-cancel-class').addEventListener('click', () => { formWrap.innerHTML = ''; });
      });

    } catch (e) {
      container.innerHTML = `<div class="buke-msg err">❌ ${e.message}</div>`;
    }
  }

  window.PanelClasses = { loadClassesPanel };
})();
