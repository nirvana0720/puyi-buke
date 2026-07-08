// 職責：義工櫃台頁——現場登記培訓補課表單渲染
// 獨立成檔以維持 kiosk_render.js ≤ 400 行

'use strict';

function _ktrDayStr(d) {
  const [y, m, dd] = d.split('-').map(Number);
  return ['週日','週一','週二','週三','週四','週五','週六'][new Date(y, m-1, dd).getDay()];
}
function _ktrCheckWin(dateStr, timeStr, slots) {
  if (!slots?.length || !dateStr || !timeStr) return null;
  const day = _ktrDayStr(dateStr);
  const mt  = slots.filter(s => s.day === day);
  if (!mt.length) return `該日（${day}）無開放補課時段`;
  return mt.some(s => timeStr >= s.start && timeStr <= s.end) ? null
    : `${timeStr} 不在開放時間（${mt.map(s => s.start+'–'+s.end).join('、')}）`;
}

/**
 * 渲染現場培訓補課登記表單
 * @param {string}   containerId     - 目標容器 id
 * @param {object}   member          - { name, class_name }
 * @param {Array}    classes         - [{id, name}]
 * @param {object}   rules           - { notice, time_slots }
 * @param {Function} onFetchSessions - async (classRef) => [{id, session_date, session_time, topic}]
 * @param {Function} onSubmit        - async (sessionRef, note, plannedDate, plannedSlot, earphone) => void
 */
function renderTrainingRegisterForm(containerId, member, classes, rules, onFetchSessions, onSubmit) {
  const el = document.getElementById(containerId);
  if (!el) return;

  if (!classes.length) {
    el.innerHTML = `<div class="buke-card" style="margin-top:10px">
      <div class="row"><span class="name">${member.name}</span><span class="meta">${member.class_name}</span></div>
      <div class="detail" style="margin-top:6px">目前後台尚無培訓班別，請待精舍設定後再試。</div>
    </div>`; return;
  }

  const slots    = Array.isArray(rules?.time_slots) ? rules.time_slots : [];
  const noticeHtml = rules?.notice
    ? `<div style="background:var(--warn-bg,#fffbea);border:1px solid var(--warn-bd,#f5c842);border-radius:var(--r);padding:10px 12px;font-size:14px;color:var(--header)">${rules.notice.replace(/\n/g,'<br>')}</div>`
    : '';
  const classOpts = classes.map(c => `<option value="${c.id}">${c.name}</option>`).join('');
  const hourOpts  = Array.from({length:24},(_,h)=>`<option value="${String(h).padStart(2,'0')}">${String(h).padStart(2,'0')}</option>`).join('');
  const minOpts   = Array.from({length:12},(_,m)=>`<option value="${String(m*5).padStart(2,'0')}">${String(m*5).padStart(2,'0')}</option>`).join('');

  el.innerHTML = `<div class="buke-card" style="margin-top:10px">
    <div class="row"><span class="name">${member.name}</span><span class="meta">${member.class_name}</span></div>
    <form id="kiosk-training-form" style="margin-top:12px;display:flex;flex-direction:column;gap:10px">
      <div>
        <div style="font-size:14px;margin-bottom:4px">培訓班別 <span style="color:var(--danger-tx)">*</span></div>
        <select name="training_class" class="buke-select" style="width:100%">
          <option value="">請選擇</option>${classOpts}
        </select>
        <div id="ktr-class-warn" style="font-size:13px;color:var(--danger-tx);display:none;margin-top:2px"></div>
      </div>
      <div>
        <div style="font-size:14px;margin-bottom:4px">堂次日期／時間 <span style="color:var(--danger-tx)">*</span></div>
        <select name="training_session" class="buke-select" style="width:100%" disabled>
          <option value="">請先選擇培訓班別</option>
        </select>
        <div id="ktr-session-warn" style="font-size:13px;color:var(--danger-tx);display:none;margin-top:2px"></div>
      </div>
      ${noticeHtml}
      <div>
        <div style="font-size:14px;margin-bottom:4px">預約補課日期 <span style="color:var(--danger-tx)">*</span></div>
        <input type="date" name="planned_date" class="buke-input" style="width:100%">
        <div id="ktr-date-warn" style="font-size:13px;color:var(--danger-tx);display:none;margin-top:2px"></div>
      </div>
      <div>
        <div style="font-size:14px;margin-bottom:4px">預約時間 <span style="color:var(--danger-tx)">*</span></div>
        <div style="display:flex;align-items:center;gap:6px">
          <select name="planned_hour" class="buke-select" style="flex:1"><option value="">時</option>${hourOpts}</select>
          <span style="color:var(--muted)">:</span>
          <select name="planned_min" class="buke-select" style="flex:1"><option value="">分</option>${minOpts}</select>
        </div>
        <div id="ktr-time-warn" style="font-size:13px;color:var(--danger-tx);display:none;margin-top:2px"></div>
      </div>
      <div>
        <div style="font-size:14px;margin-bottom:4px">借用耳機 <span style="color:var(--danger-tx)">*</span></div>
        <div style="display:flex;gap:16px">
          <label style="font-size:14px;display:flex;align-items:center;gap:4px;cursor:pointer"><input type="radio" name="earphone" value="true"> 借用</label>
          <label style="font-size:14px;display:flex;align-items:center;gap:4px;cursor:pointer"><input type="radio" name="earphone" value="false"> 不借用</label>
        </div>
        <div id="ktr-ear-warn" style="font-size:13px;color:var(--danger-tx);display:none;margin-top:2px"></div>
      </div>
      <div>
        <div style="font-size:14px;margin-bottom:4px">備註（選填）</div>
        <input type="text" name="note" class="buke-input" style="width:100%" placeholder="例：請安排觀看時間">
      </div>
      <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
        <button type="submit" class="buke-btn">登記培訓補課</button>
        <span id="ktr-msg" style="font-size:14px"></span>
      </div>
    </form>
  </div>`;

  const form       = document.getElementById('kiosk-training-form');
  const classSel   = form.querySelector('[name="training_class"]');
  const sessionSel = form.querySelector('[name="training_session"]');
  const setWarn    = (id, txt) => {
    const w = document.getElementById(id);
    if (w) { w.textContent = txt; w.style.display = txt ? 'block' : 'none'; }
  };

  classSel.addEventListener('change', async () => {
    const classRef = Number(classSel.value);
    sessionSel.innerHTML = '<option value="">載入中…</option>'; sessionSel.disabled = true;
    if (!classRef) { sessionSel.innerHTML = '<option value="">請先選擇培訓班別</option>'; return; }
    try {
      const sessions = await onFetchSessions(classRef);
      sessionSel.innerHTML = sessions.length === 0
        ? '<option value="">此班別目前無可選堂次</option>'
        : '<option value="">請選擇</option>' + sessions.map(s => {
            const t = s.session_time ? ` ${s.session_time}` : '';
            const tp = s.topic ? ` ${s.topic}` : '';
            return `<option value="${s.id}">${s.session_date}${t}${tp}</option>`;
          }).join('');
      sessionSel.disabled = sessions.length === 0;
    } catch (_) { sessionSel.innerHTML = '<option value="">載入失敗，請重試</option>'; }
  });

  form.addEventListener('submit', async e => {
    e.preventDefault();
    const btn        = form.querySelector('[type="submit"]');
    const msgEl      = document.getElementById('ktr-msg');
    const classRef   = Number(classSel.value);
    const sessionRef = Number(sessionSel.value);
    const dateVal    = form.querySelector('[name="planned_date"]').value;
    const h          = form.querySelector('[name="planned_hour"]').value;
    const m          = form.querySelector('[name="planned_min"]').value;
    const timeVal    = h && m ? `${h}:${m}` : '';
    const earVal     = form.querySelector('[name="earphone"]:checked')?.value;
    const note       = form.querySelector('[name="note"]').value.trim() || null;

    let blocked = false;
    if (!classRef)   { setWarn('ktr-class-warn',   '⚠ 請選擇培訓班別'); blocked = true; } else setWarn('ktr-class-warn', '');
    if (!sessionRef) { setWarn('ktr-session-warn', '⚠ 請選擇堂次');     blocked = true; } else setWarn('ktr-session-warn', '');
    if (!dateVal)    { setWarn('ktr-date-warn',     '⚠ 請選擇預約日期'); blocked = true; } else setWarn('ktr-date-warn', '');
    if (!timeVal)    { setWarn('ktr-time-warn',     '⚠ 請選擇預約時間'); blocked = true; }
    else {
      const past = dateVal && new Date(`${dateVal}T${timeVal}:00`) < new Date() ? '⚠ 不能登記已過去的時間' : null;
      const win  = past || _ktrCheckWin(dateVal, timeVal, slots);
      if (win) { setWarn('ktr-time-warn', win); blocked = true; } else setWarn('ktr-time-warn', '');
    }
    if (!earVal)     { setWarn('ktr-ear-warn',      '⚠ 請選擇是否借用耳機'); blocked = true; } else setWarn('ktr-ear-warn', '');
    if (blocked) return;

    btn.disabled = true; msgEl.textContent = '登記中…'; msgEl.style.color = 'var(--muted)';
    try {
      await onSubmit(sessionRef, note, dateVal, timeVal, earVal === 'true');
      msgEl.textContent = '✅ 培訓補課已登記！'; msgEl.style.color = 'var(--ok-tx)';
      btn.textContent = '已登記';
    } catch (err) {
      msgEl.textContent = `❌ ${err.message}`; msgEl.style.color = 'var(--danger-tx)';
      btn.disabled = false;
    }
  });
}

if (typeof window !== 'undefined') {
  window.KioskTrainingRender = { renderTrainingRegisterForm };
}
