// 職責：義工櫃台頁所有 DOM 渲染（今日調班、今日補課、現場登記表單）
// 不負責：RPC 呼叫、Supabase client、登入邏輯（由 kiosk.js 負責）

'use strict';

// ── 今日調班清單 ──────────────────────────────────────────────────
function renderTransfers(transfers, onAttend) {
  const el = document.getElementById('kiosk-transfers');
  if (!el) return;
  if (!transfers.length) {
    el.innerHTML = '<p class="buke-empty">今日無日↔夜間調班補課名單。</p>'; return;
  }
  el.innerHTML = transfers.map((t, i) => {
    const canAttend = t.status === '已登記';
    const badge = t.status === '已出席' ? '<span class="buke-badge pass">✅ 已出席</span>'
                : t.status === '未到'   ? '<span class="buke-badge danger">❌ 未到</span>'
                                        : '<span class="buke-badge warn">⏳ 已登記</span>';
    return `<div class="buke-card ${t.status === '已出席' ? 'pass' : 'warn'}" style="margin-bottom:10px">
      <div class="row">
        <div><span class="name">${t.member_name}</span>
          <span class="meta">${t.from_class_name} → ${t.to_class_name}</span>
        </div>
        ${badge}
      </div>
      ${canAttend ? `
        <div style="margin-top:8px;display:flex;align-items:center;gap:10px">
          <button class="buke-btn" data-attend-transfer="${i}" style="font-size:14px;padding:5px 14px">出席</button>
          <span id="tr-attend-msg-${i}" style="font-size:13px"></span>
        </div>` : ''}
    </div>`;
  }).join('');

  el.querySelectorAll('[data-attend-transfer]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const i   = Number(btn.dataset.attendTransfer);
      const msg = document.getElementById(`tr-attend-msg-${i}`);
      btn.disabled = true; msg.textContent = '記錄中…';
      try {
        await onAttend(transfers[i].transfer_id);
        msg.textContent = '✅ 已記錄出席';
        msg.style.color = 'var(--ok-tx)';
      } catch (e) {
        msg.textContent = `❌ ${e.message}`;
        msg.style.color = 'var(--danger-tx)';
        btn.disabled = false;
      }
    });
  });
}

// ── 今日補課清單 ──────────────────────────────────────────────────
function renderMakeups(makeups, onAttend, onDepart, onComplete, onEdit, lookupMember) {
  const el = document.getElementById('kiosk-makeups');
  if (!el) return;
  if (!makeups.length) {
    el.innerHTML = '<p class="buke-empty">今日無補課名單。</p>'; return;
  }
  el.innerHTML = makeups.map((m, i) => {
    const overdue = !!m.is_overdue;
    const attendCount = m.attend_count || 0;
    const badge = overdue
      ? '<span class="buke-badge danger">已逾期</span>'
      : attendCount >= 1 ? '<span class="buke-badge warn">⏳ 尚未補完課</span>'
      : '<span class="buke-badge warn">⏳ 待補課</span>';
    const cardCls = overdue ? 'buke-card care' : 'buke-card warn';
    const disAttr = overdue ? ' disabled title="已逾期"' : '';
    const disNext = (overdue || attendCount < 1) ? ' disabled' : '';
    return `<div class="${cardCls}" style="margin-bottom:10px">
      <div class="row">
        <div>
          <span class="name">${m.member_name}</span>
          <span class="meta">${m.class_name}</span>
        </div>
        ${badge}
      </div>
      <div class="detail">缺課日：${m.session_date}　時段：${m.planned_slot || '未填'}　${m.earphone ? '🎧耳機' : ''}${m.note ? `　備註：${m.note}` : ''}</div>
      <div style="margin-top:8px;display:flex;gap:8px;align-items:center;flex-wrap:wrap">
        <button class="buke-btn" data-attend-makeup="${i}" style="font-size:13px;padding:5px 12px"${disAttr}>出席</button>
        <button class="buke-btn" data-notdone-makeup="${i}"
                style="font-size:13px;padding:5px 12px;background:var(--warn-bar);border-color:var(--warn-bar)"${disNext}>
          此堂課尚未補完
        </button>
        <button class="buke-btn" data-complete-makeup="${i}"
                style="font-size:13px;padding:5px 12px;background:var(--ok-tx);border-color:var(--ok-tx)"${disNext}>
          補課完成
        </button>
        <button class="buke-btn buke-btn-ghost" data-edit-makeup="${i}" style="font-size:13px;padding:5px 12px">
          編輯
        </button>
        <span id="mk-msg-${i}" style="font-size:13px"></span>
      </div>
      <div class="mk-edit-area" id="mk-edit-${i}"></div>
    </div>`;
  }).join('');

  el.querySelectorAll('[data-attend-makeup]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const i = Number(btn.dataset.attendMakeup);
      const msg = document.getElementById(`mk-msg-${i}`);
      btn.disabled = true; msg.textContent = '記錄中…';
      try {
        await onAttend(makeups[i].makeup_id);
        msg.textContent = '✅ 已記錄出席'; msg.style.color = 'var(--ok-tx)';
        const card = btn.closest('.buke-card');
        card.querySelector('[data-notdone-makeup]')?.removeAttribute('disabled');
        card.querySelector('[data-complete-makeup]')?.removeAttribute('disabled');
      } catch (e) {
        msg.textContent = `❌ ${e.message}`; msg.style.color = 'var(--danger-tx)';
        btn.disabled = false;
      }
    });
  });

  el.querySelectorAll('[data-notdone-makeup]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const i   = Number(btn.dataset.notdoneMakeup);
      const msg = document.getElementById(`mk-msg-${i}`);
      btn.disabled = true;
      msg.textContent = '記錄中…'; msg.style.color = 'var(--muted)';
      try {
        await onDepart(makeups[i].makeup_id);
        msg.textContent = '✅ 已確認，尚未補完，下次再處理';
        msg.style.color = 'var(--ok-tx)';
        btn.closest('.buke-card').style.display = 'none';
      } catch (e) {
        msg.textContent = `❌ ${e.message}`; msg.style.color = 'var(--danger-tx)';
        btn.disabled = false;
      }
    });
  });

  el.querySelectorAll('[data-complete-makeup]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const i = Number(btn.dataset.completeMakeup);
      const msg = document.getElementById(`mk-msg-${i}`);
      btn.disabled = true; msg.textContent = '記錄中…';
      try {
        await onComplete(makeups[i].makeup_id);
        msg.textContent = '✅ 補課完成'; msg.style.color = 'var(--ok-tx)';
        const card = btn.closest('.buke-card');
        card.className = 'buke-card pass';
        card.querySelector('.buke-badge').className = 'buke-badge pass';
        card.querySelector('.buke-badge').textContent = '✅ 已完成';
        // 補課已完成，同卡片的「出席」「此堂課尚未補完」都要一併鎖住，避免重複記錄
        card.querySelector('[data-attend-makeup]')?.setAttribute('disabled', 'disabled');
        card.querySelector('[data-notdone-makeup]')?.setAttribute('disabled', 'disabled');
      } catch (e) {
        msg.textContent = `❌ ${e.message}`; msg.style.color = 'var(--danger-tx)';
        btn.disabled = false;
      }
    });
  });

  el.querySelectorAll('[data-edit-makeup]').forEach(btn => {
    btn.addEventListener('click', () => {
      const i = Number(btn.dataset.editMakeup);
      toggleEditMakeupForm(i, makeups[i], onEdit, lookupMember);
    });
  });
}

// ── 補課卡片編輯表單（義工櫃台，僅改缺課堂次/耳機/預約時間/備註，期限系統重算不可編輯） ─
function toggleEditMakeupForm(i, m, onEdit, lookupMember) {
  const area = document.getElementById(`mk-edit-${i}`);
  if (!area) return;
  if (area.innerHTML) { area.innerHTML = ''; return; }

  const hourOpts = Array.from({length:24},(_,h)=>`<option value="${String(h).padStart(2,'0')}">${String(h).padStart(2,'0')}</option>`).join('');
  const minOpts  = Array.from({length:12},(_,mi)=>`<option value="${String(mi*5).padStart(2,'0')}">${String(mi*5).padStart(2,'0')}</option>`).join('');
  const [ph0, pm0] = (m.planned_slot || '').split(':');

  area.innerHTML = `<div style="display:flex;flex-direction:column;gap:8px;margin-top:10px;padding:10px;background:var(--bg);border-radius:var(--r-md)">
    <div style="font-size:14px">缺課堂次
      <select class="buke-select f-esess" style="font-size:14px;width:100%;margin-top:4px"><option value="">載入中…</option></select>
    </div>
    <label style="font-size:14px;display:flex;align-items:center;gap:8px"><input type="checkbox" class="f-eear"${m.earphone ? ' checked' : ''} style="width:18px;height:18px"> 借用耳機</label>
    <div style="font-size:14px">預約補課日期
      <input type="date" class="buke-input f-edate" style="font-size:14px;margin-top:4px;width:100%" value="${m.planned_date || ''}">
    </div>
    <div style="font-size:14px">預約補課時間
      <div style="display:flex;align-items:center;gap:6px;margin-top:4px">
        <select class="buke-select f-ehour" style="font-size:14px;flex:1"><option value="">時</option>${hourOpts}</select>
        <span style="color:var(--muted)">:</span>
        <select class="buke-select f-emin" style="font-size:14px;flex:1"><option value="">分</option>${minOpts}</select>
      </div>
    </div>
    <label style="font-size:14px">備註
      <input class="buke-input f-enote" style="font-size:14px;margin-top:4px;width:100%" value="${m.note || ''}">
    </label>
    <div style="display:flex;gap:8px">
      <button class="buke-btn f-esave" style="font-size:13px;padding:4px 14px;min-height:30px">儲存</button>
      <button class="buke-btn buke-btn-ghost f-ecancel" style="font-size:13px;padding:4px 14px;min-height:30px">取消</button>
    </div>
    <div class="f-emsg" style="font-size:13px"></div>
  </div>`;

  const sessSel = area.querySelector('.f-esess');
  const hourSel = area.querySelector('.f-ehour');
  const minSel  = area.querySelector('.f-emin');
  const msgEl   = area.querySelector('.f-emsg');
  if (ph0) hourSel.value = ph0;
  if (pm0) minSel.value = pm0;

  area.querySelector('.f-ecancel').addEventListener('click', () => { area.innerHTML = ''; });

  (async () => {
    try {
      const result = await lookupMember(m.member_id);
      const cls = (result.classes || []).find(c => c.class_name === m.class_name);
      const absences = cls?.absences || [];
      sessSel.innerHTML = absences.length
        ? absences.map(a => {
            const wk = a.week_num ? ` 第${a.week_num}堂` : '';
            return `<option value="${a.session_ref}"${a.date === m.session_date ? ' selected' : ''}>${wk} ${a.date}</option>`;
          }).join('')
        : '<option value="">查無缺課堂次</option>';
    } catch (e) {
      sessSel.innerHTML = '<option value="">載入失敗</option>';
    }
  })();

  area.querySelector('.f-esave').addEventListener('click', async () => {
    const sessionRef = Number(sessSel.value);
    if (!sessionRef) { msgEl.textContent = '⚠ 請選擇缺課堂次'; msgEl.style.color = 'var(--danger-tx)'; return; }
    const earphone    = area.querySelector('.f-eear').checked;
    const plannedDate = area.querySelector('.f-edate').value || null;
    const h = hourSel.value, mi = minSel.value;
    const plannedSlot = (h && mi) ? `${h}:${mi}` : null;
    const note = area.querySelector('.f-enote').value.trim() || null;
    const btn = area.querySelector('.f-esave');
    btn.disabled = true; msgEl.textContent = '儲存中…'; msgEl.style.color = 'var(--muted)';
    try {
      await onEdit(m.makeup_id, sessionRef, earphone, plannedDate, plannedSlot, note);
      msgEl.textContent = '✅ 已儲存'; msgEl.style.color = 'var(--ok-tx)';
    } catch (e) {
      msgEl.textContent = `❌ ${e.message}`; msgEl.style.color = 'var(--danger-tx)';
      btn.disabled = false;
    }
  });
}

// ── 現場補課登記表單（純禪修班影音，移除類型選擇） ─────────────────
// classes = [{member_db_id, class_ref, class_name, absences:[{session_ref,date,week_num}]}]
function renderMakeupRegisterForm(containerId, member, classes, todayStr, onSubmit, onReloadDay) {
  const el = document.getElementById(containerId);
  if (!el) return;

  const hasAbsences = (classes || []).some(c => c.absences?.length > 0);
  if (!classes.length || !hasAbsences) {
    el.innerHTML = `<div class="buke-card" style="margin-top:10px">
      <div class="row"><span class="name">${member.name}</span><span class="meta">${member.class_name}</span></div>
      <div class="detail" style="margin-top:6px">目前無需補課的缺堂 🎉</div>
    </div>`; return;
  }

  const classOpts = classes.filter(c => c.absences?.length > 0)
    .map(c => `<option value="${c.class_ref}" data-member="${c.member_db_id}">${c.class_name}</option>`).join('');
  const hourOpts = Array.from({length:24},(_,h)=>`<option value="${String(h).padStart(2,'0')}">${String(h).padStart(2,'0')}</option>`).join('');
  const minOpts  = Array.from({length:12},(_,m)=>`<option value="${String(m*5).padStart(2,'0')}">${String(m*5).padStart(2,'0')}</option>`).join('');

  // classRef → absences lookup
  const classMap = new Map((classes || []).map(c => [c.class_ref, c]));

  el.innerHTML = `<div class="buke-card" style="margin-top:10px">
    <div class="row"><span class="name">${member.name}</span><span class="meta">${member.class_name}</span></div>
    <form id="mk-reg-form" style="margin-top:12px;display:flex;flex-direction:column;gap:10px">
      <div>
        <div style="font-size:14px;margin-bottom:4px">班別 <span style="color:var(--danger-tx)">*</span></div>
        <select name="mk_class" class="buke-select" style="width:100%">
          <option value="">請選擇班別</option>${classOpts}
        </select>
        <div id="mk-reg-class-warn" style="font-size:13px;color:var(--danger-tx);display:none;margin-top:2px"></div>
      </div>
      <div>
        <div style="font-size:14px;margin-bottom:4px">缺課日期 <span style="color:var(--danger-tx)">*</span></div>
        <select name="session_ref" class="buke-select" style="width:100%" disabled>
          <option value="">請先選擇班別</option>
        </select>
        <div id="mk-reg-session-warn" style="font-size:13px;color:var(--danger-tx);display:none;margin-top:2px"></div>
      </div>
      <div>
        <div style="font-size:14px;margin-bottom:4px">借用耳機 <span style="color:var(--danger-tx)">*</span></div>
        <div style="display:flex;gap:16px">
          <label style="font-size:14px;display:flex;align-items:center;gap:4px;cursor:pointer"><input type="radio" name="earphone" value="true"> 借用</label>
          <label style="font-size:14px;display:flex;align-items:center;gap:4px;cursor:pointer"><input type="radio" name="earphone" value="false"> 不借用</label>
        </div>
        <div id="mk-reg-ear-warn" style="font-size:13px;color:var(--danger-tx);display:none;margin-top:2px"></div>
      </div>
      <div>
        <div style="font-size:14px;margin-bottom:4px">預約日期 <span style="color:var(--danger-tx)">*</span></div>
        <input type="date" name="planned_date" id="mk-reg-date" class="buke-input" style="width:100%" value="${todayStr}">
        <div id="mk-reg-date-warn" style="font-size:13px;color:var(--danger-tx);display:none;margin-top:2px"></div>
      </div>
      <div>
        <div style="font-size:14px;margin-bottom:4px">時間 <span style="color:var(--danger-tx)">*</span></div>
        <div style="display:flex;align-items:center;gap:6px">
          <select name="planned_hour" class="buke-select" style="flex:1"><option value="">時</option>${hourOpts}</select>
          <span style="color:var(--muted)">:</span>
          <select name="planned_min" class="buke-select" style="flex:1"><option value="">分</option>${minOpts}</select>
        </div>
        <div id="mk-reg-time-warn" style="font-size:13px;color:var(--danger-tx);display:none;margin-top:2px"></div>
      </div>
      <div>
        <div style="font-size:14px;margin-bottom:4px">備註（選填）</div>
        <input type="text" name="note" class="buke-input" style="width:100%" placeholder="例：請安排觀看">
      </div>
      <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
        <button type="submit" class="buke-btn">登記補課</button>
        <span id="mk-reg-msg" style="font-size:14px"></span>
      </div>
    </form>
  </div>`;

  const form = document.getElementById('mk-reg-form');
  const classSel   = form.querySelector('[name="mk_class"]');
  const sessionSel = form.querySelector('[name="session_ref"]');
  const setWarn = (id, txt) => {
    const w = document.getElementById(id);
    if (w) { w.textContent = txt; w.style.display = txt ? 'block' : 'none'; }
  };

  classSel.addEventListener('change', () => {
    const cr = Number(classSel.value);
    const cls = classMap.get(cr);
    if (!cls) { sessionSel.innerHTML = '<option value="">請先選擇班別</option>'; sessionSel.disabled = true; return; }
    sessionSel.innerHTML = '<option value="">請選擇</option>' + (cls.absences || []).map(a => {
      const wk = a.week_num ? ` 第${a.week_num}堂` : '';
      const hint = a.already_registered
        ? (a.attend_count >= 1
            ? `（已登記：${a.planned_date || ''} ${a.planned_slot || ''}，已到 ${a.attend_count} 次，尚未補完課）`
            : `（已登記：${a.planned_date || ''} ${a.planned_slot || ''}）`)
        : '';
      return `<option value="${a.session_ref}" data-registered="${a.already_registered ? '1' : ''}" data-planned="${a.planned_date || ''} ${a.planned_slot || ''}">${cls.class_name}${wk} ${a.date}${hint}</option>`;
    }).join('');
    sessionSel.disabled = false;
  });

  form.addEventListener('submit', async e => {
    e.preventDefault();
    const btn = form.querySelector('[type="submit"]');
    const msg = document.getElementById('mk-reg-msg');
    const clsOpt = classSel.options[classSel.selectedIndex];
    const memberDbId = Number(clsOpt?.dataset.member);
    const sessionRef = Number(sessionSel.value);
    const earVal  = form.querySelector('[name="earphone"]:checked')?.value;
    const dateVal = form.querySelector('[name="planned_date"]').value;
    const h = form.querySelector('[name="planned_hour"]').value;
    const m = form.querySelector('[name="planned_min"]').value;
    const timeVal = h && m ? `${h}:${m}` : '';
    const note    = form.querySelector('[name="note"]').value.trim() || null;

    let blocked = false;
    if (!memberDbId)  { setWarn('mk-reg-class-warn',   '⚠ 請選擇班別');     blocked = true; } else setWarn('mk-reg-class-warn', '');
    if (!sessionRef)  { setWarn('mk-reg-session-warn', '⚠ 請選擇缺課日期'); blocked = true; } else setWarn('mk-reg-session-warn', '');
    if (!earVal)      { setWarn('mk-reg-ear-warn',     '⚠ 請選擇是否借用耳機'); blocked = true; } else setWarn('mk-reg-ear-warn', '');
    if (!dateVal)     { setWarn('mk-reg-date-warn',    '⚠ 請選擇日期');      blocked = true; } else setWarn('mk-reg-date-warn', '');
    if (!timeVal)     { setWarn('mk-reg-time-warn',    '⚠ 請選擇時間');      blocked = true; } else setWarn('mk-reg-time-warn', '');

    // 過去時間擋下
    if (dateVal && timeVal) {
      const chosen = new Date(`${dateVal}T${timeVal}:00`);
      if (chosen < new Date()) {
        setWarn('mk-reg-time-warn', '⚠ 不能登記已過去的時間'); blocked = true;
      }
    }

    if (blocked) return;
    const sessOpt = sessionSel.options[sessionSel.selectedIndex];
    if (sessOpt?.dataset.registered === '1') {
      const ok = confirm(`此堂已登記補課時段：${sessOpt.dataset.planned}，要覆蓋成新的登記嗎？`);
      if (!ok) return;
    }
    btn.disabled = true; msg.textContent = '登記中…'; msg.style.color = 'var(--muted)';
    try {
      await onSubmit({ memberDbId, sessionRef, earphone: earVal === 'true', plannedDate: dateVal, plannedSlot: timeVal, note });
      msg.textContent = '✅ 登記成功！'; msg.style.color = 'var(--ok-tx)';
      if (onReloadDay) onReloadDay();
    } catch (err) {
      msg.textContent = `❌ ${err.message}`; msg.style.color = 'var(--danger-tx)';
      btn.disabled = false;
    }
  });
}

// ── 現場調班登記表單 ──────────────────────────────────────────────
function renderTransferRegisterForm(containerId, member, upcoming, targets, onSubmit) {
  const el = document.getElementById(containerId);
  if (!el) return;

  if (!upcoming.length) {
    el.innerHTML = `<div class="buke-card" style="margin-top:10px">
      <div class="row"><span class="name">${member.name}</span><span class="meta">${member.class_name}</span></div>
      <div class="detail" style="margin-top:6px">目前無可日↔夜間調班補課的未來堂次。</div>
    </div>`; return;
  }
  if (!targets.length) {
    el.innerHTML = `<div class="buke-card" style="margin-top:10px">
      <div class="row"><span class="name">${member.name}</span><span class="meta">${member.class_name}</span></div>
      <div class="detail" style="margin-top:6px">目前無同級別其他班。</div>
    </div>`; return;
  }

  const upOpts  = upcoming.map(s => `<option value="${s.session_ref}" data-week="${s.week_num}">${s.date}（第${s.week_num}週）</option>`).join('');
  const tgtOpts = targets.map(c  => `<option value="${c.class_ref}">${c.class_name}</option>`).join('');
  const tgtMap  = new Map(targets.map(c => [c.class_ref, new Map((c.sessions||[]).map(s=>[s.week_num,s.date]))]));

  el.innerHTML = `<div class="buke-card" style="margin-top:10px">
    <div class="row"><span class="name">${member.name}</span><span class="meta">${member.class_name}</span></div>
    <form id="tr-reg-form" style="margin-top:12px;display:flex;flex-direction:column;gap:10px">
      <div>
        <div style="font-size:14px;margin-bottom:4px">哪一堂課要日↔夜間調班補課 <span style="color:var(--danger-tx)">*</span></div>
        <select name="from_session" class="buke-select" style="width:100%">
          <option value="">請選擇</option>${upOpts}
        </select>
        <div id="tr-reg-from-warn" style="font-size:13px;color:var(--danger-tx);display:none;margin-top:2px"></div>
      </div>
      <div>
        <div style="font-size:14px;margin-bottom:4px">調去哪一班 <span style="color:var(--danger-tx)">*</span></div>
        <select name="to_class" class="buke-select" style="width:100%">
          <option value="">請選擇</option>${tgtOpts}
        </select>
        <div id="tr-reg-class-warn" style="font-size:13px;color:var(--danger-tx);display:none;margin-top:2px"></div>
      </div>
      <div>
        <div style="font-size:14px;margin-bottom:4px">去上課日期 <span style="color:var(--danger-tx)">*</span></div>
        <input type="date" name="to_date" id="tr-reg-date" class="buke-input" style="width:100%">
        <div id="tr-reg-date-auto" style="font-size:13px;color:var(--muted);display:none;margin-top:2px"></div>
        <div id="tr-reg-date-warn" style="font-size:13px;color:var(--danger-tx);display:none;margin-top:2px"></div>
      </div>
      <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
        <button type="submit" class="buke-btn">登記日↔夜間調班補課</button>
        <span id="tr-reg-msg" style="font-size:14px"></span>
      </div>
    </form>
  </div>`;

  const form = document.getElementById('tr-reg-form');
  const fromSel = form.querySelector('[name="from_session"]');
  const toSel   = form.querySelector('[name="to_class"]');
  const dateInp = document.getElementById('tr-reg-date');
  const autoHint = document.getElementById('tr-reg-date-auto');

  function autoDate() {
    const opt = fromSel.options[fromSel.selectedIndex];
    const wk  = opt ? Number(opt.dataset.week) : NaN;
    const cr  = Number(toSel.value);
    if (!wk || !cr) { autoHint.style.display='none'; return; }
    const date = tgtMap.get(cr)?.get(wk);
    if (date) { dateInp.value = date; autoHint.textContent=`已自動帶入第${wk}週日期`; autoHint.style.display='block'; }
    else { dateInp.value=''; autoHint.textContent='目標班無對應堂數，請手動選日期'; autoHint.style.display='block'; }
  }
  fromSel.addEventListener('change', autoDate);
  toSel.addEventListener('change', autoDate);

  form.addEventListener('submit', async e => {
    e.preventDefault();
    const btn = form.querySelector('[type="submit"]');
    const msg = document.getElementById('tr-reg-msg');
    const setWarn = (id, txt) => { const w=document.getElementById(id); if(w){w.textContent=txt;w.style.display=txt?'block':'none';} };
    const fromVal = fromSel.value, toVal = toSel.value, dateVal = dateInp.value;
    let blocked = false;
    if (!fromVal) { setWarn('tr-reg-from-warn','⚠ 請選擇堂次'); blocked=true; } else setWarn('tr-reg-from-warn','');
    if (!toVal)   { setWarn('tr-reg-class-warn','⚠ 請選擇目標班'); blocked=true; } else setWarn('tr-reg-class-warn','');
    if (!dateVal) { setWarn('tr-reg-date-warn','⚠ 請選擇去上課日期'); blocked=true; } else setWarn('tr-reg-date-warn','');
    if (blocked) return;
    btn.disabled = true; msg.textContent = '登記中…'; msg.style.color='var(--muted)';
    try {
      await onSubmit(Number(fromVal), Number(toVal), dateVal);
      msg.textContent = '✅ 日↔夜間調班補課已登記！'; msg.style.color='var(--ok-tx)'; btn.textContent='已登記';
    } catch (err) {
      msg.textContent = `❌ ${err.message}`; msg.style.color='var(--danger-tx)'; btn.disabled=false;
    }
  });
}

// ── 今日培訓補課清單 ──────────────────────────────────────────────
function renderTrainingMakeupsToday(trainingMakeups, onComplete) {
  const el = document.getElementById('kiosk-training-makeups');
  if (!el) return;
  if (!trainingMakeups.length) {
    el.innerHTML = '<p class="buke-empty">今日無培訓補課名單。</p>'; return;
  }
  el.innerHTML = trainingMakeups.map((m, i) => `
    <div class="buke-card warn" style="margin-bottom:10px">
      <div class="row">
        <div>
          <span class="name">${m.member_name}</span>
          <span class="meta">${m.class_name}</span>
        </div>
        <span class="buke-badge warn" id="tmk-badge-${i}">⏳ 待補課</span>
      </div>
      <div class="detail">課程：${m.topic || '—'}　課程日：${m.session_date}　時段：${m.planned_slot || '未填'}　${m.earphone ? '🎧耳機' : ''}${m.note ? `　備註：${m.note}` : ''}</div>
      <div style="margin-top:8px;display:flex;gap:8px;align-items:center;flex-wrap:wrap">
        <button class="buke-btn" data-complete-training="${i}"
                style="font-size:13px;padding:5px 12px;background:var(--ok-tx);border-color:var(--ok-tx)">
          完成
        </button>
        <span id="tmk-msg-${i}" style="font-size:13px"></span>
      </div>
    </div>`).join('');

  el.querySelectorAll('[data-complete-training]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const i   = Number(btn.dataset.completeTraining);
      const msg = document.getElementById(`tmk-msg-${i}`);
      btn.disabled = true; msg.textContent = '記錄中…';
      try {
        await onComplete(trainingMakeups[i].training_makeup_id);
        msg.textContent = '✅ 已完成'; msg.style.color = 'var(--ok-tx)';
        btn.textContent = '✅ 已完成';
        btn.closest('.buke-card').className = 'buke-card pass';
        const badge = document.getElementById(`tmk-badge-${i}`);
        if (badge) { badge.className = 'buke-badge pass'; badge.textContent = '✅ 已完成'; }
      } catch (e) {
        msg.textContent = `❌ ${e.message}`; msg.style.color = 'var(--danger-tx)';
        btn.disabled = false;
      }
    });
  });
}

function renderTodayLog(records) {
  const el = document.getElementById('kiosk-today-log');
  if (!el) return;
  if (!records || !records.length) {
    el.innerHTML = '<p class="buke-empty">今日尚無補課到場記錄。</p>';
    return;
  }
  function durStr(a, d) {
    if (!a || !d) return '—';
    const m = Math.round((new Date(d) - new Date(a)) / 60000);
    return m < 60 ? `${m} 分` : `${Math.floor(m/60)}h${m%60 ? ` ${m%60}m` : ''}`;
  }
  function timeStr(ts) {
    if (!ts) return '—';
    return new Date(ts).toLocaleTimeString('zh-TW',{hour12:false,hour:'2-digit',minute:'2-digit'});
  }
  el.innerHTML = `<table style="width:100%;font-size:13px;border-collapse:collapse">
    <thead><tr style="border-bottom:2px solid var(--line);color:var(--muted);text-align:left">
      <th style="padding:4px 8px">姓名</th><th style="padding:4px 8px">班別</th>
      <th style="padding:4px 8px">缺課日</th><th style="padding:4px 8px">到場</th>
      <th style="padding:4px 8px">離場</th><th style="padding:4px 8px">時長</th>
      <th style="padding:4px 8px">狀態</th>
    </tr></thead>
    <tbody>
      ${records.map(r => `<tr style="border-bottom:1px solid var(--line)">
        <td style="padding:6px 8px;font-weight:500">${r.member_name}</td>
        <td style="padding:6px 8px;color:var(--muted)">${r.class_name}</td>
        <td style="padding:6px 8px;color:var(--muted)">${r.session_date}</td>
        <td style="padding:6px 8px">${timeStr(r.attended_at)}</td>
        <td style="padding:6px 8px">${timeStr(r.departed_at)}</td>
        <td style="padding:6px 8px">${durStr(r.attended_at, r.departed_at)}</td>
        <td style="padding:6px 8px;color:${r.status==='已完成'?'var(--ok-tx)':'var(--warn-tx)'}">${r.status==='已完成'?'✅ 補完':'⏳ 尚未補完'}</td>
      </tr>`).join('')}
    </tbody>
  </table>`;
}

if (typeof window !== 'undefined') {
  window.KioskRender = { renderTransfers, renderMakeups, renderMakeupRegisterForm, renderTransferRegisterForm, renderTrainingMakeupsToday, renderTodayLog };
}
