// 職責：義工櫃台頁所有 DOM 渲染（今日調班、今日補課、現場登記表單）
// 不負責：RPC 呼叫、Supabase client、登入邏輯（由 kiosk.js 負責）

'use strict';

// ── 今日調班清單 ──────────────────────────────────────────────────
// callbacks = {onAttend, onEditNote, onReset, onCancel}
function renderTransfers(transfers, callbacks) {
  const { onAttend, onEditNote, onReset, onCancel } = callbacks || {};
  const el = document.getElementById('kiosk-transfers');
  if (!el) return;
  if (!transfers.length) {
    el.innerHTML = '<p class="buke-empty">今日無日↔夜間調班補課名單。</p>'; return;
  }
  el.innerHTML = transfers.map((t, i) => {
    const canAttend = t.status === '已登記';
    const canReset  = t.status === '已出席' || t.status === '未到';
    const canCancel = t.status === '已登記';
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
      ${t.note ? `<div class="detail">備註：${t.note}</div>` : ''}
      <div style="margin-top:8px;display:flex;align-items:center;gap:8px;flex-wrap:wrap">
        ${canAttend ? `<button class="buke-btn" data-attend-transfer="${i}" style="font-size:13px;padding:5px 12px">出席</button>` : ''}
        <button class="buke-btn buke-btn-ghost" data-edit-transfer="${i}" style="font-size:13px;padding:5px 12px">編輯備註</button>
        ${canReset ? `<button class="buke-btn buke-btn-ghost" data-reset-transfer="${i}" style="font-size:13px;padding:5px 12px">重設為已登記</button>` : ''}
        ${canCancel ? `<button class="buke-btn buke-btn-ghost" data-cancel-transfer="${i}" style="font-size:13px;padding:5px 12px">取消登記</button>` : ''}
        <span id="tr-attend-msg-${i}" style="font-size:13px"></span>
      </div>
      <div class="tr-edit-area" id="tr-edit-${i}"></div>
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

  el.querySelectorAll('[data-edit-transfer]').forEach(btn => {
    btn.addEventListener('click', () => {
      const i = Number(btn.dataset.editTransfer);
      toggleEditTransferNoteForm(i, transfers[i], onEditNote);
    });
  });

  el.querySelectorAll('[data-reset-transfer]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const i   = Number(btn.dataset.resetTransfer);
      const msg = document.getElementById(`tr-attend-msg-${i}`);
      const ok = confirm('確定要重設為已登記嗎？已重設，但原班出勤紀錄不會自動復原，如需要請自行到學員總表核對。');
      if (!ok) return;
      btn.disabled = true; msg.textContent = '處理中…';
      try {
        await onReset(transfers[i].transfer_id);
        msg.textContent = '✅ 已重設為已登記'; msg.style.color = 'var(--ok-tx)';
      } catch (e) {
        msg.textContent = `❌ ${e.message}`; msg.style.color = 'var(--danger-tx)';
        btn.disabled = false;
      }
    });
  });

  el.querySelectorAll('[data-cancel-transfer]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const i   = Number(btn.dataset.cancelTransfer);
      const msg = document.getElementById(`tr-attend-msg-${i}`);
      const ok = confirm(`確定要取消 ${transfers[i].member_name} 這筆日↔夜間調班補課登記嗎？`);
      if (!ok) return;
      btn.disabled = true; msg.textContent = '處理中…';
      try {
        await onCancel(transfers[i].transfer_id);
        msg.textContent = '✅ 已取消登記'; msg.style.color = 'var(--ok-tx)';
        btn.closest('.buke-card').style.display = 'none';
      } catch (e) {
        msg.textContent = `❌ ${e.message}`; msg.style.color = 'var(--danger-tx)';
        btn.disabled = false;
      }
    });
  });
}

// ── 調班卡片備註編輯表單（只能改備註，日期/班別請走取消登記重新登記） ─
function toggleEditTransferNoteForm(i, t, onEditNote) {
  const area = document.getElementById(`tr-edit-${i}`);
  if (!area) return;
  if (area.innerHTML) { area.innerHTML = ''; return; }

  area.innerHTML = `<div style="display:flex;flex-direction:column;gap:8px;margin-top:10px;padding:10px;background:var(--bg);border-radius:var(--r-md)">
    <label style="font-size:14px">備註
      <input class="buke-input f-trnote" style="font-size:14px;margin-top:4px;width:100%" value="${t.note || ''}">
    </label>
    <div style="display:flex;gap:8px">
      <button class="buke-btn f-trsave" style="font-size:13px;padding:4px 14px;min-height:30px">儲存</button>
      <button class="buke-btn buke-btn-ghost f-trcancel" style="font-size:13px;padding:4px 14px;min-height:30px">取消</button>
    </div>
    <div class="f-trmsg" style="font-size:13px"></div>
  </div>`;

  const msgEl = area.querySelector('.f-trmsg');
  area.querySelector('.f-trcancel').addEventListener('click', () => { area.innerHTML = ''; });
  area.querySelector('.f-trsave').addEventListener('click', async () => {
    const note = area.querySelector('.f-trnote').value.trim() || null;
    const btn = area.querySelector('.f-trsave');
    btn.disabled = true; msgEl.textContent = '儲存中…'; msgEl.style.color = 'var(--muted)';
    try {
      await onEditNote(t.transfer_id, note);
      msgEl.textContent = '✅ 已儲存'; msgEl.style.color = 'var(--ok-tx)';
    } catch (e) {
      msgEl.textContent = `❌ ${e.message}`; msgEl.style.color = 'var(--danger-tx)';
      btn.disabled = false;
    }
  });
}

// ── 機台號碼下拉選單（影音補課出席登記用；機台數由呼叫端傳入，來源為 settings.video_machine_count）──
// machineStatus = [{machine_number, member_name}]（目前使用中的機台）
function buildMachineOptions(machineStatus, machineCount) {
  const busyMap = new Map((machineStatus || []).map(s => [s.machine_number, s.member_name]));
  const count = machineCount || 0;
  let opts = '<option value="">請選擇機台</option>';
  for (let n = 1; n <= count; n++) {
    const busyName = busyMap.get(n);
    opts += `<option value="${n}">${n} 號機${busyName ? `（使用中：${busyName}）` : ''}</option>`;
  }
  return opts;
}

// 出席／取消到場／結案後，依最新機台使用狀況更新畫面上所有機台下拉選單的顯示文字
// （不重新整理整個清單，只換 option 文字，避免其他卡片操作被打斷）
function updateMachineOptions(machineStatus) {
  const busyMap = new Map((machineStatus || []).map(s => [s.machine_number, s.member_name]));
  // .mk-machine-select＝影片補課、.tmk-machine-select＝培訓補課，機台號碼共用同一個池，兩邊都要更新
  document.querySelectorAll('.mk-machine-select, .tmk-machine-select').forEach(sel => {
    const kept = sel.value;
    Array.from(sel.options).forEach(opt => {
      const n = Number(opt.value);
      if (!n) return;
      const busyName = busyMap.get(n);
      opt.textContent = `${n} 號機${busyName ? `（使用中：${busyName}）` : ''}`;
    });
    sel.value = kept;
  });
}

// ── 畫面內確認框（取代瀏覽器原生 confirm()；2026-07-23 新增，起因：義工按取消登記時
// confirm() 彈窗按太快漏按確定，資料其實沒刪掉但畫面清單還在，義工誤以為取消成功。
// 比照 ui/admin/panel_makeup_overview.js 的 inlineConfirm，掛在傳入的容器內顯示確定/取消。
function kioskInlineConfirm(container, msg, onOk) {
  let area = container.querySelector('.ic-area');
  if (!area) {
    area = document.createElement('div');
    area.className = 'ic-area';
    area.style.cssText = 'margin-top:8px;padding:10px;background:var(--bg);border-radius:var(--r-md)';
    container.appendChild(area);
  }
  area.innerHTML = `<p style="font-size:14px;margin-bottom:8px">${msg}</p>
    <div style="display:flex;gap:8px">
      <button class="buke-btn ic-ok" style="font-size:13px;padding:4px 12px;min-height:30px">確定</button>
      <button class="buke-btn buke-btn-ghost ic-cancel" style="font-size:13px;padding:4px 12px;min-height:30px">取消</button>
    </div>
    <div class="ic-result" style="font-size:13px;margin-top:6px"></div>`;
  area.querySelector('.ic-ok').onclick = async () => {
    try { await onOk(); } catch (e) { area.querySelector('.ic-result').textContent = `❌ ${e.message}`; return; }
    area.innerHTML = '';
  };
  area.querySelector('.ic-cancel').onclick = () => { area.innerHTML = ''; };
}

// ── 今日補課清單 ──────────────────────────────────────────────────
// callbacks = {onAttend, onDepart, onComplete, onEdit, lookupMember, onCancelAttend, onCancelReg}
// machineStatus = [{machine_number, member_name}]（今天目前使用中的機台，供下拉選單提示）
// machineCount = 機台總數（來自 settings.video_machine_count，見 kiosk.js）
function renderMakeups(makeups, callbacks, machineStatus, machineCount) {
  const { onAttend, onDepart, onComplete, onEdit, lookupMember, onCancelAttend, onCancelReg } = callbacks || {};
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
    const openAttendance = !!m.has_open_attendance;
    const disAttr = (overdue || openAttendance)
      ? ` disabled title="${overdue ? '已逾期' : '已到場中，請先按「此堂課尚未補完」或「補課完成」結案'}"`
      : '';
    const disNext = (overdue || attendCount < 1) ? ' disabled' : '';
    const openHint = openAttendance ? '<span style="font-size:12px;color:var(--warn-tx)">（已到場中，尚未結案）</span>' : '';
    const canCancelReg = attendCount === 0;
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
        <select class="buke-select mk-machine-select" data-machine-select="${i}" style="font-size:13px;padding:4px 8px;min-height:30px;width:auto">${buildMachineOptions(machineStatus, machineCount)}</select>
        <button class="buke-btn" data-attend-makeup="${i}" style="font-size:13px;padding:5px 12px"${disAttr}>出席</button>
        ${openAttendance ? `<button class="buke-btn buke-btn-ghost" data-cancelattend-makeup="${i}" style="font-size:13px;padding:5px 12px">取消到場</button>` : ''}
        ${openHint}
        <button class="buke-btn" data-notdone-makeup="${i}"
                style="font-size:13px;padding:5px 12px;background:var(--warn-tx);border-color:var(--warn-tx)"${disNext}>
          此堂課尚未補完
        </button>
        <button class="buke-btn" data-complete-makeup="${i}"
                style="font-size:13px;padding:5px 12px;background:var(--ok-tx);border-color:var(--ok-tx)"${disNext}>
          補課完成
        </button>
        <button class="buke-btn buke-btn-ghost" data-edit-makeup="${i}" style="font-size:13px;padding:5px 12px">
          編輯
        </button>
        ${canCancelReg ? `<button class="buke-btn buke-btn-ghost" data-cancelreg-makeup="${i}" style="font-size:13px;padding:5px 12px">取消登記</button>` : ''}
        <span id="mk-msg-${i}" style="font-size:13px"></span>
      </div>
      <div class="mk-edit-area" id="mk-edit-${i}"></div>
    </div>`;
  }).join('');

  el.querySelectorAll('[data-attend-makeup]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const i = Number(btn.dataset.attendMakeup);
      const msg = document.getElementById(`mk-msg-${i}`);
      const machineSel = el.querySelector(`[data-machine-select="${i}"]`);
      const machineNumber = machineSel && machineSel.value ? Number(machineSel.value) : null;
      btn.disabled = true; msg.textContent = '記錄中…';
      try {
        await onAttend(makeups[i].makeup_id, machineNumber);
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
      toggleEditMakeupForm(`mk-edit-${i}`, makeups[i], onEdit, lookupMember);
    });
  });

  el.querySelectorAll('[data-cancelattend-makeup]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const i   = Number(btn.dataset.cancelattendMakeup);
      const msg = document.getElementById(`mk-msg-${i}`);
      btn.disabled = true; msg.textContent = '取消中…';
      try {
        await onCancelAttend(makeups[i].makeup_id);
        msg.textContent = '✅ 已取消到場'; msg.style.color = 'var(--ok-tx)';
        const card = btn.closest('.buke-card');
        card.querySelector('[data-attend-makeup]')?.removeAttribute('disabled');
        card.querySelector('[data-notdone-makeup]')?.setAttribute('disabled', 'disabled');
        card.querySelector('[data-complete-makeup]')?.setAttribute('disabled', 'disabled');
        btn.remove();
      } catch (e) {
        msg.textContent = `❌ ${e.message}`; msg.style.color = 'var(--danger-tx)';
        btn.disabled = false;
      }
    });
  });

  el.querySelectorAll('[data-cancelreg-makeup]').forEach(btn => {
    btn.addEventListener('click', () => {
      const i    = Number(btn.dataset.cancelregMakeup);
      const card = btn.closest('.buke-card');
      kioskInlineConfirm(card, `確定要取消 ${makeups[i].member_name} 這筆補課登記嗎？`, async () => {
        await onCancelReg(makeups[i].makeup_id);
        card.style.display = 'none';
      });
    });
  });
}

// ── 補課卡片編輯表單（義工櫃台，僅改缺課堂次/耳機/預約時間/備註，期限系統重算不可編輯） ─
// areaId：放表單的容器 id（今日補課清單用 mk-edit-i，到場提醒的未到場清單用 mk-edit-noshow-i，
// 共用同一支表單邏輯，只是掛的容器不同）
function toggleEditMakeupForm(areaId, m, onEdit, lookupMember) {
  const area = document.getElementById(areaId);
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
      const today = new Date().toLocaleDateString('sv-SE');
      // 排除已被其他登記占用、或已逾期的缺課堂次；正在編輯的這一堂本身要保留（能選回自己）
      const absences = (cls?.absences || []).filter(a => {
        if (a.date === m.session_date) return true;
        if (a.already_registered) return false;
        if (a.deadline_date && a.deadline_date < today) return false;
        return true;
      });
      sessSel.innerHTML = absences.length
        ? absences.map(a => {
            const wk = a.week_num ? ` 第${a.week_num}堂` : '';
            return `<option value="${a.session_ref}"${a.date === m.session_date ? ' selected' : ''}>${wk} ${a.date}</option>`;
          }).join('')
        : '<option value="">查無可選缺課堂次</option>';
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
    // 防呆：有填時段就不能沒填日期，否則這筆補課登記會從「今日補課」清單消失，
    // 沒人知道要提醒學員（2026-07-15 實測踩到：毛夢飛的登記時段有填但日期是空的）
    if (plannedSlot && !plannedDate) {
      msgEl.textContent = '⚠ 已填時段，請一併選擇日期';
      msgEl.style.color = 'var(--danger-tx)';
      return;
    }
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
        <div style="font-size:14px;margin-bottom:4px">缺課日期（可複選連補） <span style="color:var(--danger-tx)">*</span></div>
        <div id="mk-reg-sessions" style="display:flex;flex-direction:column;gap:6px">
          <span style="color:var(--muted);font-size:14px">請先選擇班別</span>
        </div>
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
  const classSel  = form.querySelector('[name="mk_class"]');
  const sessWrap  = document.getElementById('mk-reg-sessions');
  const setWarn = (id, txt) => {
    const w = document.getElementById(id);
    if (w) { w.textContent = txt; w.style.display = txt ? 'block' : 'none'; }
  };

  classSel.addEventListener('change', () => {
    const cr = Number(classSel.value);
    const cls = classMap.get(cr);
    if (!cls) { sessWrap.innerHTML = '<span style="color:var(--muted);font-size:14px">請先選擇班別</span>'; return; }
    sessWrap.innerHTML = (cls.absences || []).map(a => {
      const wk = a.week_num ? ` 第${a.week_num}堂` : '';
      const disabled = !!a.already_registered;
      const hint = disabled
        ? (a.attend_count >= 1
            ? `（已登記：${a.planned_date || ''} ${a.planned_slot || ''}，已到 ${a.attend_count} 次，尚未補完課）`
            : `（已登記：${a.planned_date || ''} ${a.planned_slot || ''}）`)
        : '';
      return `<label style="font-size:14px;display:flex;align-items:center;gap:6px;${disabled ? 'cursor:not-allowed;color:var(--muted)' : 'cursor:pointer'}">
        <input type="checkbox" class="mk-sess-cb" value="${a.session_ref}"${disabled ? ' disabled' : ''}
               data-label="${cls.class_name}${wk} ${a.date}" style="width:18px;height:18px">
        ${cls.class_name}${wk} ${a.date}${hint}
      </label>`;
    }).join('') || '<span style="color:var(--muted);font-size:14px">此班無缺課堂次</span>';
  });

  form.addEventListener('submit', async e => {
    e.preventDefault();
    const btn = form.querySelector('[type="submit"]');
    const msg = document.getElementById('mk-reg-msg');
    const clsOpt = classSel.options[classSel.selectedIndex];
    const memberDbId = Number(clsOpt?.dataset.member);
    const checkedBoxes = Array.from(sessWrap.querySelectorAll('.mk-sess-cb:checked'));
    const earVal  = form.querySelector('[name="earphone"]:checked')?.value;
    const dateVal = form.querySelector('[name="planned_date"]').value;
    const h = form.querySelector('[name="planned_hour"]').value;
    const m = form.querySelector('[name="planned_min"]').value;
    const timeVal = h && m ? `${h}:${m}` : '';
    const note    = form.querySelector('[name="note"]').value.trim() || null;

    let blocked = false;
    if (!memberDbId)         { setWarn('mk-reg-class-warn',   '⚠ 請選擇班別');       blocked = true; } else setWarn('mk-reg-class-warn', '');
    if (!checkedBoxes.length){ setWarn('mk-reg-session-warn', '⚠ 請至少勾選一個缺課日期'); blocked = true; } else setWarn('mk-reg-session-warn', '');
    if (!earVal)              { setWarn('mk-reg-ear-warn',     '⚠ 請選擇是否借用耳機'); blocked = true; } else setWarn('mk-reg-ear-warn', '');
    if (!dateVal)             { setWarn('mk-reg-date-warn',    '⚠ 請選擇日期');      blocked = true; } else setWarn('mk-reg-date-warn', '');
    if (!timeVal)             { setWarn('mk-reg-time-warn',    '⚠ 請選擇時間');      blocked = true; } else setWarn('mk-reg-time-warn', '');

    // 過去時間擋下
    if (dateVal && timeVal) {
      const chosen = new Date(`${dateVal}T${timeVal}:00`);
      if (chosen < new Date()) {
        setWarn('mk-reg-time-warn', '⚠ 不能登記已過去的時間'); blocked = true;
      }
    }

    if (blocked) return;

    btn.disabled = true; msg.textContent = '登記中…'; msg.style.color = 'var(--muted)';
    const results = [];
    for (const cb of checkedBoxes) {
      try {
        await onSubmit({ memberDbId, sessionRef: Number(cb.value), earphone: earVal === 'true', plannedDate: dateVal, plannedSlot: timeVal, note });
        results.push({ ok: true, label: cb.dataset.label });
      } catch (err) {
        results.push({ ok: false, label: cb.dataset.label, error: err.message });
      }
    }
    const okCount   = results.filter(r => r.ok).length;
    const failed    = results.filter(r => !r.ok);
    if (!failed.length) {
      msg.textContent = `✅ 已成功登記 ${okCount} 堂！`; msg.style.color = 'var(--ok-tx)';
      if (onReloadDay) onReloadDay();
      return;
    }
    msg.innerHTML = `⚠ 成功 ${okCount} 堂，失敗 ${failed.length} 堂：<br>` +
      failed.map(f => `❌ ${f.label}：${f.error}`).join('<br>');
    msg.style.color = 'var(--danger-tx)';
    btn.disabled = false;
  });
}

// ── 現場調班登記表單 ──────────────────────────────────────────────
// classes = [{member_db_id, class_ref, class_name, upcoming:[{session_ref,date,week_num}], targets:[{class_ref,class_name,sessions:[{week_num,date}]}]}]
function renderTransferRegisterForm(containerId, member, classes, onSubmit) {
  const el = document.getElementById(containerId);
  if (!el) return;

  const eligible = (classes || []).filter(c => c.upcoming?.length > 0 && c.targets?.length > 0);
  if (!eligible.length) {
    el.innerHTML = `<div class="buke-card" style="margin-top:10px">
      <div class="row"><span class="name">${member.name}</span><span class="meta">${member.class_name}</span></div>
      <div class="detail" style="margin-top:6px">目前無可日↔夜間調班補課的班級／堂次。</div>
    </div>`; return;
  }

  const classMap = new Map(eligible.map(c => [String(c.class_ref), c]));
  const classOpts = eligible.map(c => `<option value="${c.class_ref}">${c.class_name}</option>`).join('');

  el.innerHTML = `<div class="buke-card" style="margin-top:10px">
    <div class="row"><span class="name">${member.name}</span><span class="meta">${member.class_name}</span></div>
    <form id="tr-reg-form" style="margin-top:12px;display:flex;flex-direction:column;gap:10px">
      <div>
        <div style="font-size:14px;margin-bottom:4px">哪一班要日↔夜間調班補課 <span style="color:var(--danger-tx)">*</span></div>
        <select name="src_class" class="buke-select" style="width:100%">
          <option value="">請選擇班別</option>${classOpts}
        </select>
        <div id="tr-reg-srcclass-warn" style="font-size:13px;color:var(--danger-tx);display:none;margin-top:2px"></div>
      </div>
      <div>
        <div style="font-size:14px;margin-bottom:4px">哪一堂課 <span style="color:var(--danger-tx)">*</span></div>
        <select name="from_session" class="buke-select" style="width:100%" disabled>
          <option value="">請先選擇班別</option>
        </select>
        <div id="tr-reg-from-warn" style="font-size:13px;color:var(--danger-tx);display:none;margin-top:2px"></div>
      </div>
      <div>
        <div style="font-size:14px;margin-bottom:4px">調去哪一班 <span style="color:var(--danger-tx)">*</span></div>
        <select name="to_class" class="buke-select" style="width:100%" disabled>
          <option value="">請先選擇班別</option>
        </select>
        <div id="tr-reg-class-warn" style="font-size:13px;color:var(--danger-tx);display:none;margin-top:2px"></div>
      </div>
      <div>
        <div style="font-size:14px;margin-bottom:4px">去上課日期 <span style="color:var(--danger-tx)">*</span></div>
        <input type="date" name="to_date" id="tr-reg-date" class="buke-input" style="width:100%">
        <div id="tr-reg-date-auto" style="font-size:13px;color:var(--muted);display:none;margin-top:2px"></div>
        <div id="tr-reg-date-warn" style="font-size:13px;color:var(--danger-tx);display:none;margin-top:2px"></div>
      </div>
      <div>
        <div style="font-size:14px;margin-bottom:4px">備註（選填）</div>
        <input type="text" name="note" class="buke-input" style="width:100%" placeholder="例：請安排觀看">
      </div>
      <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
        <button type="submit" class="buke-btn">登記日↔夜間調班補課</button>
        <span id="tr-reg-msg" style="font-size:14px"></span>
      </div>
    </form>
  </div>`;

  const form    = document.getElementById('tr-reg-form');
  const srcSel  = form.querySelector('[name="src_class"]');
  const fromSel = form.querySelector('[name="from_session"]');
  const toSel   = form.querySelector('[name="to_class"]');
  const dateInp = document.getElementById('tr-reg-date');
  const autoHint = document.getElementById('tr-reg-date-auto');
  let tgtMap = new Map();

  srcSel.addEventListener('change', () => {
    const cls = classMap.get(srcSel.value);
    dateInp.value = ''; autoHint.style.display = 'none';
    if (!cls) {
      fromSel.innerHTML = '<option value="">請先選擇班別</option>'; fromSel.disabled = true;
      toSel.innerHTML   = '<option value="">請先選擇班別</option>'; toSel.disabled = true;
      tgtMap = new Map();
      return;
    }
    fromSel.innerHTML = '<option value="">請選擇</option>' + cls.upcoming
      .map(s => `<option value="${s.session_ref}" data-week="${s.week_num}">${s.date}（第${s.week_num}週）</option>`).join('');
    fromSel.disabled = false;
    toSel.innerHTML = '<option value="">請選擇</option>' + cls.targets
      .map(c => `<option value="${c.class_ref}">${c.class_name}</option>`).join('');
    toSel.disabled = false;
    tgtMap = new Map(cls.targets.map(c => [c.class_ref, new Map((c.sessions||[]).map(s=>[s.week_num,s.date]))]));
  });

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
    const srcVal = srcSel.value, fromVal = fromSel.value, toVal = toSel.value, dateVal = dateInp.value;
    let blocked = false;
    if (!srcVal)  { setWarn('tr-reg-srcclass-warn','⚠ 請選擇班別'); blocked=true; } else setWarn('tr-reg-srcclass-warn','');
    if (!fromVal) { setWarn('tr-reg-from-warn','⚠ 請選擇堂次'); blocked=true; } else setWarn('tr-reg-from-warn','');
    if (!toVal)   { setWarn('tr-reg-class-warn','⚠ 請選擇目標班'); blocked=true; } else setWarn('tr-reg-class-warn','');
    if (!dateVal) { setWarn('tr-reg-date-warn','⚠ 請選擇去上課日期'); blocked=true; } else setWarn('tr-reg-date-warn','');
    if (blocked) return;
    const memberDbId = classMap.get(srcVal)?.member_db_id;
    const note = form.querySelector('[name="note"]').value.trim() || null;
    btn.disabled = true; msg.textContent = '登記中…'; msg.style.color='var(--muted)';
    try {
      await onSubmit(memberDbId, Number(fromVal), Number(toVal), dateVal, note);
      msg.textContent = '✅ 日↔夜間調班補課已登記！'; msg.style.color='var(--ok-tx)'; btn.textContent='已登記';
    } catch (err) {
      msg.textContent = `❌ ${err.message}`; msg.style.color='var(--danger-tx)'; btn.disabled=false;
    }
  });
}

// ── 今日培訓補課清單 ──────────────────────────────────────────────
// 2026-07-22：比照影片補課，加上「到場（選機台）→ 此堂課尚未補完／補課完成」流程。
// 機台號碼跟影片補課共用同一個號碼池，所以 machineStatus/machineCount 直接沿用
// kiosk.js 算好的同一份資料（見 loadDay 裡 computeMachineStatus 已經把兩邊到場紀錄併在一起）。
// callbacks = {onAttend, onCancelAttend, onDepart, onComplete}
function renderTrainingMakeupsToday(trainingMakeups, callbacks, machineStatus, machineCount) {
  const { onAttend, onCancelAttend, onDepart, onComplete } = callbacks || {};
  const el = document.getElementById('kiosk-training-makeups');
  if (!el) return;
  if (!trainingMakeups.length) {
    el.innerHTML = '<p class="buke-empty">今日無培訓補課名單。</p>'; return;
  }
  el.innerHTML = trainingMakeups.map((m, i) => {
    const attendCount = m.attend_count || 0;
    const openAttendance = !!m.has_open_attendance;
    const badgeText = attendCount >= 1 ? '⏳ 尚未補完課' : '⏳ 待補課';
    const disAttr = openAttendance
      ? ` disabled title="已到場中，請先按「此堂課尚未補完」或「補課完成」結案"`
      : '';
    const disNext = attendCount < 1 ? ' disabled' : '';
    const openHint = openAttendance ? '<span style="font-size:12px;color:var(--warn-tx)">（已到場中，尚未結案）</span>' : '';
    return `<div class="buke-card warn" style="margin-bottom:10px">
      <div class="row">
        <div>
          <span class="name">${m.member_name}</span>
          <span class="meta">${m.class_name}</span>
        </div>
        <span class="buke-badge warn" id="tmk-badge-${i}">${badgeText}</span>
      </div>
      <div class="detail">課程：${m.topic || '—'}　課程日：${m.session_date}　時段：${m.planned_slot || '未填'}　${m.earphone ? '🎧耳機' : ''}${m.note ? `　備註：${m.note}` : ''}</div>
      <div style="margin-top:8px;display:flex;gap:8px;align-items:center;flex-wrap:wrap">
        <select class="buke-select tmk-machine-select" data-machine-select="${i}" style="font-size:13px;padding:4px 8px;min-height:30px;width:auto">${buildMachineOptions(machineStatus, machineCount)}</select>
        <button class="buke-btn" data-attend-training="${i}" style="font-size:13px;padding:5px 12px"${disAttr}>出席</button>
        ${openAttendance ? `<button class="buke-btn buke-btn-ghost" data-cancelattend-training="${i}" style="font-size:13px;padding:5px 12px">取消到場</button>` : ''}
        ${openHint}
        <button class="buke-btn" data-notdone-training="${i}"
                style="font-size:13px;padding:5px 12px;background:var(--warn-tx);border-color:var(--warn-tx)"${disNext}>
          此堂課尚未補完
        </button>
        <button class="buke-btn" data-complete-training="${i}"
                style="font-size:13px;padding:5px 12px;background:var(--ok-tx);border-color:var(--ok-tx)"${disNext}>
          補課完成
        </button>
        <span id="tmk-msg-${i}" style="font-size:13px"></span>
      </div>
    </div>`;
  }).join('');

  el.querySelectorAll('[data-attend-training]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const i = Number(btn.dataset.attendTraining);
      const msg = document.getElementById(`tmk-msg-${i}`);
      const machineSel = el.querySelector(`[data-machine-select="${i}"]`);
      const machineNumber = machineSel && machineSel.value ? Number(machineSel.value) : null;
      btn.disabled = true; msg.textContent = '記錄中…';
      try {
        await onAttend(trainingMakeups[i].training_makeup_id, machineNumber);
        msg.textContent = '✅ 已記錄出席'; msg.style.color = 'var(--ok-tx)';
        const card = btn.closest('.buke-card');
        card.querySelector('[data-notdone-training]')?.removeAttribute('disabled');
        card.querySelector('[data-complete-training]')?.removeAttribute('disabled');
      } catch (e) {
        msg.textContent = `❌ ${e.message}`; msg.style.color = 'var(--danger-tx)';
        btn.disabled = false;
      }
    });
  });

  el.querySelectorAll('[data-cancelattend-training]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const i   = Number(btn.dataset.cancelattendTraining);
      const msg = document.getElementById(`tmk-msg-${i}`);
      btn.disabled = true; msg.textContent = '取消中…';
      try {
        await onCancelAttend(trainingMakeups[i].training_makeup_id);
        msg.textContent = '✅ 已取消到場'; msg.style.color = 'var(--ok-tx)';
        const card = btn.closest('.buke-card');
        card.querySelector('[data-attend-training]')?.removeAttribute('disabled');
        card.querySelector('[data-notdone-training]')?.setAttribute('disabled', 'disabled');
        card.querySelector('[data-complete-training]')?.setAttribute('disabled', 'disabled');
        btn.remove();
      } catch (e) {
        msg.textContent = `❌ ${e.message}`; msg.style.color = 'var(--danger-tx)';
        btn.disabled = false;
      }
    });
  });

  el.querySelectorAll('[data-notdone-training]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const i   = Number(btn.dataset.notdoneTraining);
      const msg = document.getElementById(`tmk-msg-${i}`);
      btn.disabled = true;
      msg.textContent = '記錄中…'; msg.style.color = 'var(--muted)';
      try {
        await onDepart(trainingMakeups[i].training_makeup_id);
        msg.textContent = '✅ 已確認，尚未補完，下次再處理';
        msg.style.color = 'var(--ok-tx)';
        btn.closest('.buke-card').style.display = 'none';
      } catch (e) {
        msg.textContent = `❌ ${e.message}`; msg.style.color = 'var(--danger-tx)';
        btn.disabled = false;
      }
    });
  });

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
    el.innerHTML = '<p class="kiosk-listempty">今日尚無補課到場記錄。</p>';
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
    <thead><tr style="background:var(--surface-alt);color:var(--muted);text-align:left">
      <th style="padding:8px">姓名</th><th style="padding:8px">班別</th>
      <th style="padding:8px">缺課日</th><th style="padding:8px">到場</th>
      <th style="padding:8px">離場</th><th style="padding:8px">時長</th>
      <th style="padding:8px">機台</th>
      <th style="padding:8px">狀態</th>
    </tr></thead>
    <tbody>
      ${records.map((r, i) => `<tr style="border-top:1px solid var(--line);${i % 2 ? 'background:var(--surface-alt)' : ''}">
        <td style="padding:8px;font-weight:500">${r.member_name}</td>
        <td style="padding:8px;color:var(--muted)">${r.class_name}</td>
        <td style="padding:8px;color:var(--muted)">${r.session_date}</td>
        <td style="padding:8px">${timeStr(r.attended_at)}</td>
        <td style="padding:8px">${timeStr(r.departed_at)}</td>
        <td style="padding:8px">${durStr(r.attended_at, r.departed_at)}</td>
        <td style="padding:8px;color:var(--muted)">${r.machine_number ? `🖥️${r.machine_number}號機` : '—'}</td>
        <td style="padding:8px;color:${r.status==='已完成'?'var(--ok-tx)':'var(--warn-tx)'}">${r.status==='已完成'?'✅ 補完':'⏳ 尚未補完'}</td>
      </tr>`).join('')}
    </tbody>
  </table>`;
}

if (typeof window !== 'undefined') {
  window.KioskRender = { renderTransfers, renderMakeups, renderMakeupRegisterForm, renderTransferRegisterForm, renderTrainingMakeupsToday, renderTodayLog, updateMachineOptions, toggleEditMakeupForm, kioskInlineConfirm };
}
