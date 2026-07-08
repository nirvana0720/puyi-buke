// 職責：精舍培訓課程補課分頁（畫在 #section-training）
// 完全獨立於禪修班 makeups；走 training_makeups 子系統
// 資料取用走 window.StudentLogic（student.js 提供）

'use strict';

/**
 * 渲染「精舍培訓課程補課」分頁
 * 自行取資料（get_training_classes / get_my_training_makeups）
 * @param {object} sb          - Supabase client
 * @param {number} memberDbId  - 學員 DB id
 */
async function renderTrainingTab(sb, memberDbId) {
  const el = document.getElementById('section-training');
  if (!el) return;
  el.innerHTML = '<p style="color:var(--muted);font-size:14px;margin-top:8px">載入中…</p>';

  const {
    fetchTrainingClasses, fetchTrainingSessions, fetchMakeupRulesViaRpc,
    fetchMyTrainingMakeups, registerTrainingMakeup, cancelTrainingMakeup,
  } = window.StudentLogic;

  async function reload() { await renderTrainingTab(sb, memberDbId); }

  try {
    const [classes, myMakeups, rules] = await Promise.all([
      fetchTrainingClasses(sb),
      fetchMyTrainingMakeups(sb, memberDbId),
      fetchMakeupRulesViaRpc(sb),
    ]);

    // ── 上方：我登記的培訓補課 ────────────────────────────────────
    const registeredHtml = myMakeups.length === 0
      ? '<p class="buke-empty" style="margin-bottom:16px">目前尚無培訓補課登記。</p>'
      : myMakeups.map((m, i) => {
          const isPending = m.status === '待補課';
          const badgeCls  = isPending ? 'warn' : 'pass';
          const badgeTxt  = isPending ? '⏳ 待補課' : '✅ 已完成';
          const timeStr    = m.session_time ? ` ${m.session_time}` : '';
          const topicStr   = m.topic ? ` / ${m.topic}` : '';
          const plannedStr = m.planned_date ? ` / 預約：${m.planned_date}${m.planned_slot ? ' '+m.planned_slot : ''}${m.earphone ? ' 🎧' : ''}` : '';
          const noteStr    = m.note  ? ` / 備註：${m.note}` : '';
          const cancelBtn = isPending ? `
            <div style="margin-top:8px">
              <button data-tr-cancel-toggle="${i}"
                      style="font-size:13px;padding:4px 10px;border:1px solid var(--danger-tx);
                             color:var(--danger-tx);background:none;border-radius:var(--r-pill);cursor:pointer">
                取消登記
              </button>
              <div id="tr-cancel-${i}" style="display:none;margin-top:8px;padding:10px 12px;
                   background:var(--bg);border:1px solid var(--danger-tx);border-radius:var(--r);font-size:14px">
                確定要取消這筆培訓補課登記嗎？
                <div style="display:flex;gap:8px;margin-top:8px">
                  <button data-tr-cancel-ok="${i}" class="buke-btn buke-btn-danger"
                          style="font-size:13px;padding:5px 14px">確定取消</button>
                  <button data-tr-cancel-no="${i}"
                          style="font-size:13px;padding:5px 14px;border:1px solid var(--line);
                                 background:none;border-radius:var(--r-pill);cursor:pointer">不取消</button>
                </div>
                <span id="tr-cancel-msg-${i}" style="font-size:13px;color:var(--danger-tx);display:block;margin-top:6px"></span>
              </div>
            </div>` : '';
          return `<div class="buke-card ${isPending ? 'warn' : 'pass'}" style="margin-bottom:10px">
            <div class="row">
              <div>
                <span class="name">${m.class_name}</span>
                <span class="meta">${m.session_date}${timeStr}${topicStr}</span>
              </div>
              <span class="buke-badge ${badgeCls}">${badgeTxt}</span>
            </div>
            ${(plannedStr || noteStr) ? `<div class="detail">${plannedStr}${noteStr}</div>` : ''}
            ${cancelBtn}
          </div>`;
        }).join('');

    // ── 下方：登記表單 ────────────────────────────────────────────
    // 時間 helper（與 render.js 同邏輯，此分頁自含）
    function _tDayStr(d) { const [y,m,dd]=d.split('-').map(Number); return ['週日','週一','週二','週三','週四','週五','週六'][new Date(y,m-1,dd).getDay()]; }
    function _tCheckWin(dateStr, timeStr, slots) {
      if (!slots?.length || !dateStr || !timeStr) return null;
      const day = _tDayStr(dateStr); const mt = slots.filter(s=>s.day===day);
      if (!mt.length) return `該日（${day}）無開放補課時段`;
      return mt.some(s=>timeStr>=s.start && timeStr<=s.end) ? null : `${timeStr} 不在開放時間（${mt.map(s=>s.start+'–'+s.end).join('、')}）`;
    }
    const slots = Array.isArray(rules.time_slots) ? rules.time_slots : [];
    const hourOpts = Array.from({length:24},(_,h)=>`<option value="${String(h).padStart(2,'0')}">${String(h).padStart(2,'0')}</option>`).join('');
    const minOpts  = Array.from({length:12},(_,m)=>`<option value="${String(m*5).padStart(2,'0')}">${String(m*5).padStart(2,'0')}</option>`).join('');
    const noticeHtml = rules.notice ? `<div style="background:var(--warn-bg,#fffbea);border:1px solid var(--warn-bd,#f5c842);border-radius:var(--r);padding:10px 12px;font-size:14px;color:var(--header)">${rules.notice.replace(/\n/g,'<br>')}</div>` : '';

    const classOpts = classes.map(c => `<option value="${c.id}">${c.name}</option>`).join('');
    const formHtml = classes.length === 0
      ? '<p class="buke-empty">目前後台尚無培訓班別，請待精舍設定後再試。</p>'
      : `<form id="training-reg-form" style="display:flex;flex-direction:column;gap:12px">
          <div>
            <div style="font-size:15px;margin-bottom:6px">培訓班別 <span style="color:var(--danger-tx)">*</span></div>
            <select name="training_class" class="buke-select" style="width:100%">
              <option value="">請選擇</option>${classOpts}
            </select>
            <div id="tr-class-warn" style="font-size:13px;color:var(--danger-tx);display:none;margin-top:3px"></div>
          </div>
          <div>
            <div style="font-size:15px;margin-bottom:6px">堂次日期／時間 <span style="color:var(--danger-tx)">*</span></div>
            <select name="training_session" class="buke-select" style="width:100%" disabled>
              <option value="">請先選擇培訓班別</option>
            </select>
            <div id="tr-session-warn" style="font-size:13px;color:var(--danger-tx);display:none;margin-top:3px"></div>
          </div>
          ${noticeHtml}
          <div>
            <div style="font-size:15px;margin-bottom:6px">預約補課日期 <span style="color:var(--danger-tx)">*</span></div>
            <input type="date" name="planned_date" class="buke-input" style="width:100%">
            <div id="tr-date-warn" style="font-size:13px;color:var(--danger-tx);display:none;margin-top:3px"></div>
          </div>
          <div>
            <div style="font-size:15px;margin-bottom:6px">預約時間 <span style="color:var(--danger-tx)">*</span></div>
            <div style="display:flex;align-items:center;gap:6px">
              <select name="planned_hour" class="buke-select" style="flex:1"><option value="">時</option>${hourOpts}</select>
              <span style="color:var(--muted)">:</span>
              <select name="planned_min" class="buke-select" style="flex:1"><option value="">分</option>${minOpts}</select>
            </div>
            <div id="tr-time-warn" style="font-size:13px;color:var(--danger-tx);display:none;margin-top:3px"></div>
          </div>
          <div>
            <div style="font-size:15px;margin-bottom:6px">借用耳機 <span style="color:var(--danger-tx)">*</span></div>
            <div style="display:flex;gap:20px">
              <label style="font-size:15px;display:flex;align-items:center;gap:6px;cursor:pointer"><input type="radio" name="earphone" value="true"> 借用</label>
              <label style="font-size:15px;display:flex;align-items:center;gap:6px;cursor:pointer"><input type="radio" name="earphone" value="false"> 不借用</label>
            </div>
            <div id="tr-ear-warn" style="font-size:13px;color:var(--danger-tx);display:none;margin-top:3px"></div>
          </div>
          <div>
            <div style="font-size:15px;margin-bottom:6px">備註（選填）</div>
            <input type="text" name="note" class="buke-input" style="width:100%" placeholder="例：請安排觀看時間">
          </div>
          <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
            <button type="submit" class="buke-btn">送出</button>
            <span id="tr-reg-msg" style="font-size:15px"></span>
          </div>
        </form>`;

    el.innerHTML = `
      <div style="margin-bottom:20px">
        <div style="font-size:15px;font-weight:500;color:var(--header);margin-bottom:10px">我登記的培訓補課</div>
        ${registeredHtml}
      </div>
      <div style="border-top:1px solid var(--line);padding-top:16px">
        <div style="font-size:15px;font-weight:500;color:var(--header);margin-bottom:12px">登記培訓補課</div>
        ${formHtml}
      </div>`;

    // ── 取消 inline confirm ────────────────────────────────────────
    el.querySelectorAll('[data-tr-cancel-toggle]').forEach(btn => {
      btn.addEventListener('click', () => {
        const i = btn.dataset.trCancelToggle;
        const d = document.getElementById(`tr-cancel-${i}`);
        d.style.display = d.style.display === 'none' ? 'block' : 'none';
      });
    });
    el.querySelectorAll('[data-tr-cancel-no]').forEach(btn => {
      btn.addEventListener('click', () => {
        document.getElementById(`tr-cancel-${btn.dataset.trCancelNo}`).style.display = 'none';
      });
    });
    el.querySelectorAll('[data-tr-cancel-ok]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const i   = btn.dataset.trCancelOk;
        const msg = document.getElementById(`tr-cancel-msg-${i}`);
        const ref = myMakeups[parseInt(i, 10)]?.training_session_ref;
        if (!ref) return;
        btn.disabled = true; msg.textContent = '取消中…';
        try { await cancelTrainingMakeup(sb, memberDbId, ref); await reload(); }
        catch (e) { msg.textContent = `❌ ${e.message}`; btn.disabled = false; }
      });
    });

    // ── 登記表單 ─────────────────────────────────────────────────
    const form = document.getElementById('training-reg-form');
    if (!form) return;

    const classSel   = form.querySelector('[name="training_class"]');
    const sessionSel = form.querySelector('[name="training_session"]');

    classSel.addEventListener('change', async () => {
      const classRef = Number(classSel.value);
      sessionSel.innerHTML = '<option value="">載入中…</option>';
      sessionSel.disabled = true;
      if (!classRef) { sessionSel.innerHTML = '<option value="">請先選擇培訓班別</option>'; return; }
      try {
        const sessions = await fetchTrainingSessions(sb, classRef);
        sessionSel.innerHTML = sessions.length === 0
          ? '<option value="">此班別目前無可選堂次</option>'
          : '<option value="">請選擇</option>' + sessions.map(s => {
              const t = s.session_time ? ` ${s.session_time}` : '';
              const tp = s.topic       ? ` ${s.topic}`        : '';
              return `<option value="${s.id}">${s.session_date}${t}${tp}</option>`;
            }).join('');
        sessionSel.disabled = sessions.length === 0;
      } catch (_) {
        sessionSel.innerHTML = '<option value="">載入失敗，請重試</option>';
      }
    });

    const setWarn = (id, txt) => {
      const w = document.getElementById(id);
      if (w) { w.textContent = txt; w.style.display = txt ? 'block' : 'none'; }
    };

    form.addEventListener('submit', async e => {
      e.preventDefault();
      const btn        = form.querySelector('[type="submit"]');
      const msgEl      = document.getElementById('tr-reg-msg');
      const classRef   = Number(classSel.value);
      const sessionRef = Number(sessionSel.value);
      const dateVal    = form.querySelector('[name="planned_date"]').value;
      const h          = form.querySelector('[name="planned_hour"]').value;
      const m          = form.querySelector('[name="planned_min"]').value;
      const timeVal    = h && m ? `${h}:${m}` : '';
      const earVal     = form.querySelector('[name="earphone"]:checked')?.value;
      const note       = form.querySelector('[name="note"]').value.trim() || null;
      let blocked = false;
      if (!classRef)   { setWarn('tr-class-warn',   '⚠ 請選擇培訓班別'); blocked = true; } else setWarn('tr-class-warn', '');
      if (!sessionRef) { setWarn('tr-session-warn', '⚠ 請選擇堂次');     blocked = true; } else setWarn('tr-session-warn', '');
      if (!dateVal)    { setWarn('tr-date-warn', '⚠ 請選擇預約日期');     blocked = true; } else setWarn('tr-date-warn', '');
      if (!timeVal)    { setWarn('tr-time-warn', '⚠ 請選擇預約時間');     blocked = true; }
      else {
        const pastErr = dateVal && new Date(`${dateVal}T${timeVal}:00`) < new Date() ? '⚠ 不能登記已過去的時間' : null;
        const winErr  = pastErr || _tCheckWin(dateVal, timeVal, slots);
        if (winErr) { setWarn('tr-time-warn', winErr); blocked = true; } else setWarn('tr-time-warn', '');
      }
      if (!earVal)     { setWarn('tr-ear-warn', '⚠ 請選擇是否借用耳機'); blocked = true; } else setWarn('tr-ear-warn', '');
      if (blocked) return;
      btn.disabled = true; msgEl.textContent = '送出中…'; msgEl.style.color = 'var(--muted)';
      try {
        await registerTrainingMakeup(sb, memberDbId, sessionRef, note, dateVal, timeVal, earVal === 'true');
        msgEl.textContent = '✅ 已登記！'; msgEl.style.color = 'var(--ok-tx)';
        setTimeout(reload, 700);
      } catch (err) {
        msgEl.textContent = `❌ ${err.message}`; msgEl.style.color = 'var(--danger-tx)';
        btn.disabled = false;
      }
    });

  } catch (e) {
    el.innerHTML = `<div class="buke-msg err">❌ ${e.message}</div>`;
  }
}

if (typeof window !== 'undefined') {
  window.TrainingRender = { renderTrainingTab };
}
