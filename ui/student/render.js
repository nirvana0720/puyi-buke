// 職責：學員頁 DOM 渲染（進度尺、出缺勤統計、缺堂就地展開補課表單、補課記錄列表）
// 不負責：資料取用、Supabase 連線

'use strict';

const MARK_LABEL = { O: '請假/缺席', A: '晚到(≥60分)', LL: '靜坐遲到(20~60分)' };

// 從 'YYYY-MM-DD' 安全解析星期（不依賴本地時區）
function _dayStr(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return ['週日','週一','週二','週三','週四','週五','週六'][new Date(y, m-1, d).getDay()];
}

// 檢查預約時間是否在開放窗口內；slots 為空 → 不擋，回 null
function _checkWindow(dateStr, timeStr, slots) {
  if (!slots || !slots.length || !dateStr || !timeStr) return null;
  const day = _dayStr(dateStr);
  const matching = slots.filter(s => s.day === day);
  if (!matching.length) return `該日（${day}）無開放補課時段`;
  const ok = matching.some(s => timeStr >= s.start && timeStr <= s.end);
  if (!ok) {
    const ranges = matching.map(s => `${s.start}–${s.end}`).join('、');
    return `${timeStr} 不在開放時間內（${day}：${ranges}）`;
  }
  return null;
}

// ── 1. 上課進度尺 ─────────────────────────────────────────────

function renderProgressBar(memberInfo, stats) {
  const el = document.getElementById('section-progress');
  if (!el) return;
  const total = memberInfo.total_sessions || 0;
  if (total === 0) { el.innerHTML = ''; return; }
  const cap      = Math.min(total, 20);
  const gradPct  = ((cap - 3) / total * 100).toFixed(1);
  const physPct  = Math.min(stats.phys   / total * 100, 100).toFixed(1);
  const mkupPct  = Math.min(stats.makeup / total * 100, 100 - physPct).toFixed(1);
  el.innerHTML = `
    <div style="margin-bottom:18px">
      <div style="font-size:15px;font-weight:500;color:var(--header);margin-bottom:8px">上課進度</div>
      <div style="position:relative;height:18px;background:var(--line);border-radius:9px;overflow:visible">
        <div style="position:absolute;left:0;top:0;height:100%;width:${physPct}%;
                    background:var(--ok-bar);border-radius:9px 0 0 9px;transition:width .3s"></div>
        <div style="position:absolute;left:${physPct}%;top:0;height:100%;width:${mkupPct}%;
                    background:var(--warn-bar);transition:width .3s"></div>
        <div style="position:absolute;left:${gradPct}%;top:-4px;bottom:-4px;
                    width:2px;background:var(--danger-tx);border-radius:1px"></div>
        <span style="position:absolute;left:${gradPct}%;top:-20px;transform:translateX(-50%);
                     font-size:11px;color:var(--danger-tx);white-space:nowrap">結業標準</span>
      </div>
      <div style="display:flex;gap:12px;margin-top:6px;font-size:13px;color:var(--muted)">
        <span><span style="color:var(--ok-bar)">■</span> 實體出席</span>
        <span><span style="color:var(--warn-bar)">■</span> 補課</span>
      </div>
    </div>`;
}

// ── 2. 出缺勤三數字 ───────────────────────────────────────────

function renderStats(stats) {
  const el = document.getElementById('section-stats');
  if (!el) return;
  el.innerHTML = `
    <div style="display:flex;gap:10px;margin-bottom:18px">
      ${[
        { label:'出席', val:stats.phys,   color:'var(--ok-tx)' },
        { label:'缺課', val:stats.absent, color:'var(--danger-tx)' },
        { label:'補課', val:stats.makeup, color:'var(--warn-tx)' },
      ].map(({ label, val, color }) => `
        <div style="flex:1;text-align:center;background:var(--surface);border:1px solid var(--line);
                    border-radius:var(--r);padding:10px 4px">
          <div style="font-size:24px;font-weight:700;color:${color}">${val}</div>
          <div style="font-size:13px;color:var(--muted);margin-top:2px">${label}</div>
        </div>`).join('')}
    </div>`;
}

// ── 3. 缺堂清單（就地展開表單 + 取消登記） ──────────────────

/**
 * @param {AbsenceRow[]} absences
 * @param {MakeupRow[]}  makeups
 * @param {{ notice, time_slots }} rules
 * @param {Function} onSubmit  (sessionRef, formData) => Promise
 * @param {Function} onCancel  (sessionRef) => Promise
 */
function renderAbsences(absences, makeups, rules, onSubmit, onCancel, className) {
  const el = document.getElementById('section-absences');
  if (!el) return;

  if (!absences.length) {
    el.innerHTML = '<p class="buke-empty">目前沒有需要補課的缺堂 🎉</p>';
    return;
  }

  const makeupMap = new Map((makeups || []).map(m => [m.session_ref, m]));
  const slots     = Array.isArray(rules.time_slots) ? rules.time_slots : [];

  const noticeHtml = rules.notice
    ? `<div style="background:var(--warn-bg,#fffbea);border:1px solid var(--warn-bd,#f5c842);
                  border-radius:var(--r);padding:10px 12px;font-size:14px;color:var(--header);margin-bottom:10px">
         <strong>補課規定</strong><br>${rules.notice.replace(/\n/g, '<br>')}</div>`
    : '';

  el.innerHTML = absences.map((row, i) => {
    const markLabel = MARK_LABEL[row.mark] || row.mark;
    const mk = makeupMap.get(row.session_id);

    // 已逾期（且沒完成補課）
    if ((mk ? mk.is_overdue : row.is_overdue) && !(mk && mk.status === '已完成')) {
      return `<div class="buke-card care" style="margin-bottom:12px">
        <div class="row">
          <div><span class="name">${row.session_date}</span><span class="meta">${markLabel}</span></div>
          <span class="buke-badge danger">已逾期</span>
        </div>
        <div class="detail" style="color:var(--danger-tx)">補課期限（${row.deadline_date}）已過，此堂視同缺席。</div>
      </div>`;
    }

    // 已登記補課 → 顯示狀態；待補課（未逾期）加取消鈕
    if (mk) {
      const isDone    = mk.status === '已完成';
      const isOverdue = mk.is_overdue;
      const badgeCls  = isDone ? 'pass' : isOverdue ? 'danger' : 'warn';
      const badgeTxt  = isDone ? '✅ 已完成' : isOverdue ? '⏰ 已逾期'
        : (mk.attend_count >= 1) ? '⏳ 尚未補完課' : '⏳ 待補課';
      const canCancel     = !isDone && !isOverdue && mk.attend_count === 0;
      const canReschedule = !isDone && !isOverdue;
      const cancelBtn = canReschedule
        ? `<div style="margin-top:8px;display:flex;flex-wrap:wrap;gap:8px">
             ${canCancel ? `<button data-cancel-toggle="${i}"
                     style="font-size:13px;padding:4px 10px;border:1px solid var(--danger-tx);
                            color:var(--danger-tx);background:none;border-radius:var(--r-pill);cursor:pointer">
               取消登記
             </button>` : ''}
             <button data-reschedule-toggle="${i}"
                     style="font-size:13px;padding:4px 10px;border:1px solid var(--header);
                            color:var(--header);background:none;border-radius:var(--r-pill);cursor:pointer">
               重新預約補課時間
             </button>
           </div>
           ${canCancel ? `<div id="cancel-confirm-${i}" style="display:none;margin-top:8px;
                padding:10px 12px;background:var(--bg);border:1px solid var(--danger-tx);
                border-radius:var(--r);font-size:14px">
             確定要取消這筆補課登記嗎？
             <div style="display:flex;gap:8px;margin-top:8px">
               <button data-cancel-ok="${i}" class="buke-btn buke-btn-danger"
                       style="font-size:13px;padding:5px 14px">確定取消</button>
               <button data-cancel-no="${i}"
                       style="font-size:13px;padding:5px 14px;border:1px solid var(--line);
                              background:none;border-radius:var(--r-pill);cursor:pointer">不取消</button>
             </div>
             <span id="cancel-msg-${i}" style="font-size:13px;color:var(--danger-tx);display:block;margin-top:6px"></span>
           </div>` : ''}
           <div id="reschedule-form-${i}" style="display:none;margin-top:12px">
             ${noticeHtml}
             <form class="makeup-form" data-session="${row.session_id}" data-idx="${i}"
                   style="display:flex;flex-direction:column;gap:10px">
               <div>
                 <div style="font-size:15px;margin-bottom:6px">預定補課日期 <span style="color:var(--danger-tx)">*</span></div>
                 <input type="date" name="planned_date" class="buke-input" style="width:100%"
                        min="${row.earliest_date}" max="${row.deadline_date}"
                        value="${mk.planned_date || ''}">
                 <div id="date-warn-${i}" style="font-size:13px;color:var(--danger-tx);display:none;margin-top:3px"></div>
               </div>
               <div>
                 <div style="font-size:15px;margin-bottom:6px">預約時間 <span style="color:var(--danger-tx)">*</span></div>
                 <div style="display:flex;align-items:center;gap:6px">
                   <select name="planned_hour" class="buke-select" style="flex:1">
                     <option value="">時</option>
                     ${Array.from({length:24},(_,h)=>`<option value="${String(h).padStart(2,'0')}"${mk.planned_slot && mk.planned_slot.startsWith(String(h).padStart(2,'0')) ? ' selected' : ''}>${String(h).padStart(2,'0')}</option>`).join('')}
                   </select>
                   <span style="color:var(--muted);font-size:16px">:</span>
                   <select name="planned_min" class="buke-select" style="flex:1">
                     <option value="">分</option>
                     ${Array.from({length:12},(_,m2)=>`<option value="${String(m2*5).padStart(2,'0')}"${mk.planned_slot && mk.planned_slot.endsWith(':'+String(m2*5).padStart(2,'0')) ? ' selected' : ''}>${String(m2*5).padStart(2,'0')}</option>`).join('')}
                   </select>
                 </div>
                 <div id="time-warn-${i}" style="font-size:13px;color:var(--danger-tx);display:none;margin-top:3px"></div>
               </div>
               <div>
                 <div style="font-size:15px;margin-bottom:6px">借用耳機 <span style="color:var(--danger-tx)">*</span></div>
                 <div style="display:flex;gap:20px">
                   <label style="display:flex;align-items:center;gap:6px;font-size:15px;cursor:pointer">
                     <input type="radio" name="earphone-${i}" value="true"${mk.earphone ? ' checked' : ''}> 借用
                   </label>
                   <label style="display:flex;align-items:center;gap:6px;font-size:15px;cursor:pointer">
                     <input type="radio" name="earphone-${i}" value="false"${mk.earphone === false ? ' checked' : ''}> 不借用
                   </label>
                 </div>
                 <div id="ear-warn-${i}" style="font-size:13px;color:var(--danger-tx);display:none;margin-top:3px"></div>
               </div>
               <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
                 <button type="submit" class="buke-btn">送出</button>
                 <span class="form-msg" id="msg-${i}" style="font-size:15px"></span>
               </div>
             </form>
           </div>`
        : '';
      return `<div class="buke-card ${isDone ? 'pass' : 'warn'}" style="margin-bottom:12px">
        <div class="row">
          <div><span class="name">${row.session_date}</span><span class="meta">${markLabel}</span></div>
          <span class="buke-badge ${badgeCls}">${badgeTxt}</span>
        </div>
        <div class="detail">${className || ''} / 預約補課時間：${mk.planned_date || '未填'} ${mk.planned_slot || ''} / ${mk.earphone ? '需要耳機' : '不需要耳機'}</div>
        ${cancelBtn}
      </div>`;
    }

    // 未登記 → 可展開表單（方式固定影音）
    return `<div class="buke-card warn" style="margin-bottom:12px" id="card-${i}">
      <div class="row">
        <div><span class="name">${row.session_date}</span><span class="meta">${markLabel}</span></div>
        <span class="buke-badge warn">截止 ${row.deadline_date}</span>
      </div>
      <div class="detail">最早可補：${row.earliest_date}</div>
      <div style="margin-top:8px">
        <button class="buke-btn" style="font-size:14px;padding:6px 14px"
                data-toggle-form="${i}">登記補課</button>
      </div>
      <div id="form-${i}" style="display:none;margin-top:12px">
        ${noticeHtml}
        <form class="makeup-form" data-session="${row.session_id}" data-idx="${i}"
              style="display:flex;flex-direction:column;gap:10px">

          <div>
            <div style="font-size:15px;margin-bottom:6px">預定補課日期 <span style="color:var(--danger-tx)">*</span></div>
            <input type="date" name="planned_date" class="buke-input"
                   style="width:100%"
                   min="${row.earliest_date}" max="${row.deadline_date}">
            <div id="date-warn-${i}" style="font-size:13px;color:var(--danger-tx);display:none;margin-top:3px"></div>
          </div>

          <div>
            <div style="font-size:15px;margin-bottom:6px">預約時間 <span style="color:var(--danger-tx)">*</span></div>
            <div style="display:flex;align-items:center;gap:6px">
              <select name="planned_hour" class="buke-select" style="flex:1">
                <option value="">時</option>
                ${Array.from({length:24},(_,h)=>`<option value="${String(h).padStart(2,'0')}">${String(h).padStart(2,'0')}</option>`).join('')}
              </select>
              <span style="color:var(--muted);font-size:16px">:</span>
              <select name="planned_min" class="buke-select" style="flex:1">
                <option value="">分</option>
                ${Array.from({length:12},(_,m)=>`<option value="${String(m*5).padStart(2,'0')}">${String(m*5).padStart(2,'0')}</option>`).join('')}
              </select>
            </div>
            <div id="time-warn-${i}" style="font-size:13px;color:var(--danger-tx);display:none;margin-top:3px"></div>
          </div>

          <div>
            <div style="font-size:15px;margin-bottom:6px">借用耳機 <span style="color:var(--danger-tx)">*</span></div>
            <div style="display:flex;gap:20px">
              <label style="display:flex;align-items:center;gap:6px;font-size:15px;cursor:pointer">
                <input type="radio" name="earphone-${i}" value="true"> 借用
              </label>
              <label style="display:flex;align-items:center;gap:6px;font-size:15px;cursor:pointer">
                <input type="radio" name="earphone-${i}" value="false"> 不借用
              </label>
            </div>
            <div id="ear-warn-${i}" style="font-size:13px;color:var(--danger-tx);display:none;margin-top:3px"></div>
          </div>

          <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
            <button type="submit" class="buke-btn">送出</button>
            <span class="form-msg" id="msg-${i}" style="font-size:15px"></span>
          </div>
        </form>
      </div>
    </div>`;
  }).join('');

  // ── 綁定事件 ─────────────────────────────────────────────

  // 展開/收起登記表單
  el.querySelectorAll('[data-toggle-form]').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx     = btn.dataset.toggleForm;
      const formDiv = document.getElementById(`form-${idx}`);
      const open    = formDiv.style.display === 'none';
      formDiv.style.display = open ? 'block' : 'none';
      btn.textContent = open ? '收起' : '登記補課';
    });
  });

  // 重新預約展開
  el.querySelectorAll('[data-reschedule-toggle]').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = btn.dataset.rescheduleToggle;
      const div = document.getElementById(`reschedule-form-${idx}`);
      const open = div.style.display === 'none';
      div.style.display = open ? 'block' : 'none';
      btn.textContent = open ? '收起' : '重新預約補課時間';
    });
  });

  // 取消登記 inline confirm
  el.querySelectorAll('[data-cancel-toggle]').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = btn.dataset.cancelToggle;
      const div = document.getElementById(`cancel-confirm-${idx}`);
      div.style.display = div.style.display === 'none' ? 'block' : 'none';
    });
  });
  el.querySelectorAll('[data-cancel-no]').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = btn.dataset.cancelNo;
      document.getElementById(`cancel-confirm-${idx}`).style.display = 'none';
    });
  });
  el.querySelectorAll('[data-cancel-ok]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const idx    = btn.dataset.cancelOk;
      const msgEl  = document.getElementById(`cancel-msg-${idx}`);
      const session = absences[parseInt(idx, 10)]?.session_id;
      if (!session) return;
      btn.disabled = true;
      msgEl.textContent = '取消中…';
      try {
        await onCancel(session);
      } catch (err) {
        msgEl.textContent = `❌ ${err.message}`;
        btn.disabled = false;
      }
    });
  });

  // 登記表單事件
  el.querySelectorAll('.makeup-form').forEach(form => {
    const idx       = form.dataset.idx;
    const dateWarn  = document.getElementById(`date-warn-${idx}`);
    const timeWarn  = document.getElementById(`time-warn-${idx}`);
    const earWarn   = document.getElementById(`ear-warn-${idx}`);
    const dateInput = form.querySelector('[name="planned_date"]');
    const hourSel   = form.querySelector('[name="planned_hour"]');
    const minSel    = form.querySelector('[name="planned_min"]');

    function getTimeVal() {
      const h = hourSel?.value;
      const m = minSel?.value;
      return (h && m) ? `${h}:${m}` : '';
    }

    // 日期超出 earliest/deadline 提醒（非擋下，僅提示）
    dateInput && dateInput.addEventListener('change', () => {
      const v = dateInput.value;
      if (!v) { dateWarn.style.display = 'none'; }
      else if (v < dateInput.min) {
        dateWarn.textContent = `⚠ 此日期早於最早可補日（${dateInput.min}）`;
        dateWarn.style.display = 'block';
      } else if (v > dateInput.max) {
        dateWarn.textContent = `⚠ 此日期超過截止日（${dateInput.max}），仍可送出，請盡快確認`;
        dateWarn.style.display = 'block';
      } else {
        dateWarn.style.display = 'none';
      }
      if (getTimeVal()) checkAndShowTimeWarn();
    });

    function checkAndShowTimeWarn() {
      const err = _checkWindow(dateInput?.value, getTimeVal(), slots);
      timeWarn.textContent   = err ? `⚠ ${err}` : '';
      timeWarn.style.display = err ? 'block' : 'none';
    }
    [hourSel, minSel].forEach(s => s && s.addEventListener('change', checkAndShowTimeWarn));

    // 送出：三項必填驗證 + 窗口硬擋
    form.addEventListener('submit', async e => {
      e.preventDefault();
      const idx     = form.dataset.idx;
      const msgEl   = document.getElementById(`msg-${idx}`);
      const btn     = form.querySelector('[type="submit"]');
      const dateVal = dateInput ? dateInput.value : '';
      const timeVal = getTimeVal();
      const earVal  = form.querySelector(`[name="earphone-${idx}"]:checked`)?.value ?? null;

      let blocked = false;

      if (!dateVal) {
        dateWarn.textContent = '⚠ 請選擇預定補課日期';
        dateWarn.style.display = 'block';
        blocked = true;
      }
      if (!timeVal) {
        timeWarn.textContent = '⚠ 請選擇預約時間（時與分皆需選擇）';
        timeWarn.style.display = 'block';
        blocked = true;
      } else {
        const winErr = _checkWindow(dateVal, timeVal, slots);
        if (winErr) {
          timeWarn.textContent = `⚠ ${winErr}`;
          timeWarn.style.display = 'block';
          blocked = true;
        }
      }
      if (earVal === null) {
        earWarn.textContent = '⚠ 請選擇是否借用耳機';
        earWarn.style.display = 'block';
        blocked = true;
      } else {
        earWarn.style.display = 'none';
      }

      if (blocked) return;

      btn.disabled = true;
      msgEl.textContent = '送出中…';
      msgEl.style.color = 'var(--muted)';

      try {
        await onSubmit(Number(form.dataset.session), {
          sessionRef:   Number(form.dataset.session),
          method:       '影音',
          trainingName: null,
          earphone:     earVal === 'true',
          plannedDate:  dateVal,
          plannedSlot:  timeVal,
        });
        msgEl.textContent = '✅ 已登記！';
        msgEl.style.color = 'var(--ok-tx)';
        btn.textContent = '已登記';
      } catch (err) {
        msgEl.textContent = `❌ ${err.message}`;
        msgEl.style.color = 'var(--danger-tx)';
        btn.disabled = false;
      }
    });
  });
}

// ── 4. 補課記錄列表 ───────────────────────────────────────────

function renderMyMakeups(makeups, className) {
  const el = document.getElementById('section-makeups');
  if (!el) return;
  if (!makeups.length) {
    el.innerHTML = '<p class="buke-empty">尚無補課紀錄。</p>';
    return;
  }
  el.innerHTML = makeups.map(r => {
    const badgeCls = r.status === '已完成' ? 'pass' : r.is_overdue ? 'danger' : 'warn';
    const pendingTxt = r.attend_count >= 1
      ? `⏳ 尚未補完課（${new Date(r.last_attended_at).toLocaleString('zh-TW',{hour12:false})} 已補${r.attend_count >= 2 ? `，共 ${r.attend_count} 次` : ''}）`
      : '⏳ 待補課';
    const badgeTxt = r.status === '已完成' ? '✅ 已完成' : r.is_overdue ? '⏰ 已逾期' : pendingTxt;
    return `<div class="buke-card ${r.status === '已完成' ? 'pass' : r.is_overdue ? 'care' : 'warn'}"
                 style="margin-bottom:10px">
      <div class="row">
        <div><span class="name">${r.session_date || '—'}</span><span class="meta">${r.method}</span></div>
        <span class="buke-badge ${badgeCls}">${badgeTxt}</span>
      </div>
      <div class="detail">
        ${className || ''} / 預約補課時間：${r.planned_date || '未填'} ${r.planned_slot || ''} / ${r.earphone ? '需要耳機' : '不需要耳機'}
        ${r.completed_date ? ' / 完成：' + r.completed_date : ''}
      </div>
    </div>`;
  }).join('');
}

if (typeof window !== 'undefined') {
  window.StudentRender = { renderProgressBar, renderStats, renderAbsences, renderMyMakeups };
}
if (typeof module !== 'undefined') {
  module.exports = { renderProgressBar, renderStats, renderAbsences, renderMyMakeups };
}
