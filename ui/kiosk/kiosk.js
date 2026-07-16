// 職責：義工櫃台頁——登入邏輯、RPC 包裝、shell 初始化、今日清單載入、現場登記流程
// 不負責：DOM 渲染細節（kiosk_render.js）

'use strict';

const KIOSK_KEY = 'buke_kiosk_staff';

// ── RPC 包裝 ─────────────────────────────────────────────────────

async function staffLoginRpc(sb, username, password) {
  const { data, error } = await sb.rpc('staff_login', { p_username: username, p_password: password });
  if (error) throw new Error(error.message);
  return data; // null = 帳密錯誤
}

async function kioskGetDay(sb, staffId, date) {
  const { data, error } = await sb.rpc('kiosk_get_day', { p_staff_id: staffId, p_date: date });
  if (error) throw new Error(error.message);
  return data || { transfers: [], makeups: [], training_makeups: [] };
}

async function kioskTransferAttend(sb, staffId, transferId) {
  const { data, error } = await sb.rpc('kiosk_transfer_attend', { p_staff_id: staffId, p_transfer_id: transferId });
  if (error) throw new Error(error.message);
  return data;
}

async function kioskMakeupAttend(sb, staffId, makeupId, machineNumber) {
  const { data, error } = await sb.rpc('kiosk_makeup_attend', {
    p_staff_id: staffId, p_makeup_id: makeupId, p_machine_number: machineNumber ?? null,
  });
  if (error) throw new Error(error.message);
  return data;
}

// 依「今日到場記錄」推算目前使用中的機台（departed_at 未填＋有選機台）
function computeMachineStatus(records) {
  return (records || [])
    .filter(r => !r.departed_at && r.machine_number != null)
    .map(r => ({ machine_number: r.machine_number, member_name: r.member_name }));
}

async function kioskMakeupComplete(sb, staffId, makeupId) {
  const { data, error } = await sb.rpc('kiosk_makeup_complete', { p_staff_id: staffId, p_makeup_id: makeupId });
  if (error) throw new Error(error.message);
  return data;
}

async function kioskMakeupDepart(sb, staffId, makeupId) {
  const { data, error } = await sb.rpc('kiosk_makeup_depart', { p_staff_id: staffId, p_makeup_id: makeupId });
  if (error) throw new Error(error.message);
  return data;
}

async function kioskEditMakeup(sb, staffId, makeupId, sessionRef, earphone, plannedDate, plannedSlot, note) {
  const { data, error } = await sb.rpc('kiosk_edit_makeup', {
    p_staff_id: staffId, p_makeup_id: makeupId, p_session_ref: sessionRef,
    p_earphone: earphone, p_planned_date: plannedDate, p_planned_slot: plannedSlot, p_note: note
  });
  if (error) throw new Error(error.message);
  return data;
}

async function kioskGetTodayLog(sb, staffId) {
  const { data, error } = await sb.rpc('kiosk_get_today_log', { p_staff_id: staffId });
  if (error) throw new Error(error.message);
  return data || [];
}

async function kioskLookupMember(sb, staffId, memberCode) {
  const { data, error } = await sb.rpc('kiosk_lookup_member', { p_staff_id: staffId, p_member_code: memberCode });
  if (error) throw new Error(error.message);
  return data || { found: false };
}

async function kioskRegisterMakeup(sb, staffId, memberDbId, formData) {
  const { data, error } = await sb.rpc('kiosk_register_makeup', {
    p_staff_id:     staffId,
    p_member_db_id: memberDbId,
    p_session_ref:  formData.sessionRef,
    p_earphone:     formData.earphone ?? null,
    p_planned_date: formData.plannedDate || null,
    p_planned_slot: formData.plannedSlot || null,
    p_note:         formData.note || null,
  });
  if (error) throw new Error(error.message);
  return data;
}

async function kioskTrainingMakeupComplete(sb, staffId, trainingMakeupId) {
  const { data, error } = await sb.rpc('kiosk_training_makeup_complete', { p_staff_id: staffId, p_training_makeup_id: trainingMakeupId });
  if (error) throw new Error(error.message);
  return data;
}

async function fetchKioskTrainingClasses(sb) {
  const { data, error } = await sb.rpc('get_training_classes');
  if (error) throw new Error(error.message);
  return data || [];
}

async function fetchKioskTrainingSessions(sb, classRef) {
  const { data, error } = await sb.rpc('get_training_sessions', { p_class_ref: classRef });
  if (error) throw new Error(error.message);
  return data || [];
}

async function fetchKioskMakeupRules(sb) {
  try {
    const { data } = await sb.rpc('get_makeup_rules');
    return data ? { time_slots: [], ...data } : { notice: '', time_slots: [] };
  } catch (_) { return { notice: '', time_slots: [] }; }
}

async function kioskRegisterTrainingMakeup(sb, staffId, memberDbId, trainingSessionRef, note, plannedDate, plannedSlot, earphone) {
  const { data, error } = await sb.rpc('kiosk_register_training_makeup', {
    p_staff_id: staffId, p_member_db_id: memberDbId,
    p_training_session_ref: trainingSessionRef, p_note: note || null,
    p_planned_date: plannedDate || null, p_planned_slot: plannedSlot || null, p_earphone: earphone ?? null,
  });
  if (error) throw new Error(error.message);
  return data;
}

async function kioskRegisterTransfer(sb, staffId, memberDbId, fromSessionRef, toClassRef, toDate, note) {
  const { data, error } = await sb.rpc('kiosk_register_transfer', {
    p_staff_id:          staffId,
    p_member_db_id:      memberDbId,
    p_from_session_ref:  fromSessionRef,
    p_to_class_ref:      toClassRef,
    p_to_date:           toDate,
    p_note:              note || null,
  });
  if (error) throw new Error(error.message);
  return data;
}

async function kioskEditTransferNote(sb, staffId, transferId, note) {
  const { data, error } = await sb.rpc('kiosk_edit_transfer_note', { p_staff_id: staffId, p_transfer_id: transferId, p_note: note });
  if (error) throw new Error(error.message);
  return data;
}

async function kioskGetAttendanceAlerts(sb, staffId) {
  const { data, error } = await sb.rpc('kiosk_get_attendance_alerts', { p_staff_id: staffId });
  if (error) throw new Error(error.message);
  return data || { overdue_attendance: [], no_show: [] };
}

async function kioskMakeupCancelAttend(sb, staffId, makeupId) {
  const { data, error } = await sb.rpc('kiosk_makeup_cancel_attend', { p_staff_id: staffId, p_makeup_id: makeupId });
  if (error) throw new Error(error.message);
  return data;
}

async function kioskTransferResetToRegistered(sb, staffId, transferId) {
  const { data, error } = await sb.rpc('kiosk_transfer_reset_to_registered', { p_staff_id: staffId, p_transfer_id: transferId });
  if (error) throw new Error(error.message);
  return data;
}

async function kioskCancelMakeup(sb, staffId, makeupId) {
  const { data, error } = await sb.rpc('kiosk_cancel_makeup', { p_staff_id: staffId, p_makeup_id: makeupId });
  if (error) throw new Error(error.message);
  return data;
}

async function kioskCancelTransfer(sb, staffId, transferId) {
  const { data, error } = await sb.rpc('kiosk_cancel_transfer', { p_staff_id: staffId, p_transfer_id: transferId });
  if (error) throw new Error(error.message);
  return data;
}

async function kioskGetTodayRegistrations(sb, staffId) {
  const { data, error } = await sb.rpc('kiosk_get_today_registrations', { p_staff_id: staffId });
  if (error) throw new Error(error.message);
  return data || { makeups: [], transfers: [] };
}

// ── 今天日期（台北時間） ──────────────────────────────────────────
function todayStr() {
  return new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Taipei' });
}

// ── 主程式 ───────────────────────────────────────────────────────
(async function () {
  if (typeof CONFIG === 'undefined') return;
  document.title = `${CONFIG.TEMPLE_NAME}課務系統　義工櫃台`;
  const titleEl = document.querySelector('.title');
  if (titleEl) titleEl.textContent = `${CONFIG.TEMPLE_NAME}課務系統　義工櫃台`;
  const sb = window.supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY,
    { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
  const { renderTransfers, renderMakeups, renderMakeupRegisterForm, renderTransferRegisterForm } = window.KioskRender;

  const loginSection  = document.getElementById('login-section');
  const dashSection   = document.getElementById('dashboard-section');
  const staffNameEl   = document.getElementById('staff-name');
  const loginErrEl    = document.getElementById('login-err');
  const datePicker    = document.getElementById('date-picker');
  const sectionLabels = document.getElementById('kiosk-section-labels');

  let staff = null;
  try { staff = JSON.parse(sessionStorage.getItem(KIOSK_KEY)); } catch (_) {}

  // ── 登入狀態切換 ─────────────────────────────────────────────
  function showDashboard() {
    loginSection.style.display  = 'none';
    dashSection.style.display   = 'block';
    staffNameEl.textContent     = staff.display_name || staff.role;
    datePicker.value            = todayStr();
    loadDay(datePicker.value);
  }

  function showLogin() {
    loginSection.style.display  = 'block';
    dashSection.style.display   = 'none';
  }

  if (staff) { showDashboard(); } else { showLogin(); }

  // ── 登入表單 ─────────────────────────────────────────────────
  document.getElementById('login-form').addEventListener('submit', async e => {
    e.preventDefault();
    const btn  = e.target.querySelector('[type="submit"]');
    const user = e.target.querySelector('[name="username"]').value.trim();
    const pass = e.target.querySelector('[name="password"]').value;
    loginErrEl.textContent = '';
    btn.disabled = true; btn.textContent = '登入中…';
    try {
      const result = await staffLoginRpc(sb, user, pass);
      if (!result) {
        loginErrEl.textContent = '帳號或密碼錯誤，請重試。';
        btn.disabled = false; btn.textContent = '登入';
        return;
      }
      staff = result;
      sessionStorage.setItem(KIOSK_KEY, JSON.stringify(staff));
      showDashboard();
    } catch (err) {
      loginErrEl.textContent = `登入失敗：${err.message}`;
      btn.disabled = false; btn.textContent = '登入';
    }
  });

  // ── 登出 ─────────────────────────────────────────────────────
  document.getElementById('btn-logout').addEventListener('click', () => {
    sessionStorage.removeItem(KIOSK_KEY);
    staff = null;
    showLogin();
  });

  // ── 日期切換 ─────────────────────────────────────────────────
  datePicker.addEventListener('change', () => loadDay(datePicker.value));

  // ── 今日到場記錄＋機台使用狀況 ────────────────────────────────
  // 重新抓「今日到場記錄」，同時更新到場記錄表格與各卡片機台下拉選單的「使用中」提示
  async function refreshTodayLogAndMachines() {
    try {
      const records = await kioskGetTodayLog(sb, staff.staff_id);
      KioskRender.renderTodayLog(records);
      KioskRender.updateMachineOptions(computeMachineStatus(records));
    } catch (_) {}
  }

  // ── 到場提醒（B）＋ 今日登記清單（G） ────────────────────────
  async function loadAlertsAndRegistrations() {
    try {
      const alerts = await kioskGetAttendanceAlerts(sb, staff.staff_id);
      window.KioskAlerts.renderAttendanceAlerts(alerts);
    } catch (_) {}
    try {
      const regs = await kioskGetTodayRegistrations(sb, staff.staff_id);
      window.KioskAlerts.renderTodayRegistrations(regs, {
        onCancelMakeup: async (makeupId) => {
          await kioskCancelMakeup(sb, staff.staff_id, makeupId);
          await loadAlertsAndRegistrations();
        },
        onCancelTransfer: async (transferId) => {
          await kioskCancelTransfer(sb, staff.staff_id, transferId);
          await loadAlertsAndRegistrations();
        },
      });
    } catch (_) {}
  }

  // ── 載入今日清單 ──────────────────────────────────────────────
  async function loadDay(date) {
    document.getElementById('kiosk-transfers').innerHTML         = '<p style="color:var(--muted);font-size:14px">載入中…</p>';
    document.getElementById('kiosk-makeups').innerHTML           = '<p style="color:var(--muted);font-size:14px">載入中…</p>';
    document.getElementById('kiosk-training-makeups').innerHTML  = '<p style="color:var(--muted);font-size:14px">載入中…</p>';
    try {
      const [day, todayLogRecords] = await Promise.all([
        kioskGetDay(sb, staff.staff_id, date),
        kioskGetTodayLog(sb, staff.staff_id),
      ]);
      const today = todayStr();
      const makeups = (day.makeups || []).map(m => ({
        ...m,
        is_overdue: m.deadline_date != null && today > m.deadline_date,
      }));
      const machineStatus = computeMachineStatus(todayLogRecords);
      const machineCount = day.video_machine_count ?? (CONFIG.VIDEO_MACHINE_COUNT || 5);
      renderTransfers(day.transfers, {
        onAttend: async (transferId) => {
          await kioskTransferAttend(sb, staff.staff_id, transferId);
          loadDay(datePicker.value);
        },
        onEditNote: async (transferId, note) => {
          await kioskEditTransferNote(sb, staff.staff_id, transferId, note);
          loadDay(datePicker.value);
        },
        onReset: async (transferId) => {
          await kioskTransferResetToRegistered(sb, staff.staff_id, transferId);
          loadDay(datePicker.value);
        },
        onCancel: async (transferId) => {
          await kioskCancelTransfer(sb, staff.staff_id, transferId);
        },
      });
      renderMakeups(makeups, {
        onAttend: async (makeupId, machineNumber) => {
          await kioskMakeupAttend(sb, staff.staff_id, makeupId, machineNumber);
          await refreshTodayLogAndMachines();
        },
        onDepart: async (makeupId) => {
          await kioskMakeupDepart(sb, staff.staff_id, makeupId);
          await refreshTodayLogAndMachines();
        },
        onComplete: async (makeupId) => {
          await kioskMakeupComplete(sb, staff.staff_id, makeupId);
          await refreshTodayLogAndMachines();
        },
        onEdit: async (makeupId, sessionRef, earphone, plannedDate, plannedSlot, note) => {
          await kioskEditMakeup(sb, staff.staff_id, makeupId, sessionRef, earphone, plannedDate, plannedSlot, note);
          loadDay(datePicker.value);
        },
        lookupMember: async (memberCode) => kioskLookupMember(sb, staff.staff_id, memberCode),
        onCancelAttend: async (makeupId) => {
          await kioskMakeupCancelAttend(sb, staff.staff_id, makeupId);
          await refreshTodayLogAndMachines();
        },
        onCancelReg: async (makeupId) => {
          await kioskCancelMakeup(sb, staff.staff_id, makeupId);
        },
      }, machineStatus, machineCount);
      renderTrainingMakeupsToday(
        day.training_makeups || [],
        async (id) => { await kioskTrainingMakeupComplete(sb, staff.staff_id, id); }
      );
      KioskRender.renderTodayLog(todayLogRecords);
      await loadAlertsAndRegistrations();
    } catch (err) {
      document.getElementById('kiosk-transfers').innerHTML =
        `<p class="buke-msg err">❌ ${err.message}</p>`;
    }
  }

  // ── 現場查詢學員（補課） ──────────────────────────────────────
  {
    const form      = document.getElementById('mk-lookup-form');
    const inputEl   = document.getElementById('mk-lookup-input');
    const suggestEl = document.getElementById('mk-lookup-suggest');
    const msgEl     = document.getElementById('mk-lookup-msg');
    const resultEl  = document.getElementById('mk-lookup-result');

    function onFoundMakeup(result) {
      renderMakeupRegisterForm(
        'mk-lookup-result',
        result,
        result.classes || [],
        todayStr(),
        async (formData) => {
          await kioskRegisterMakeup(sb, staff.staff_id, formData.memberDbId, formData);
        },
        () => {
          loadDay(datePicker.value);
          resultEl.innerHTML = '';
          inputEl.value = '';
          suggestEl.innerHTML = '';
          msgEl.textContent = '✅ 已登記，清單已更新。可繼續輸入下一位學員。';
          msgEl.style.color = 'var(--ok-tx)';
        }
      );
    }

    form.addEventListener('submit', async e => {
      e.preventDefault();
      const value = inputEl.value.trim();
      const btn   = e.target.querySelector('[type="submit"]');
      btn.disabled = true; btn.textContent = '查詢中…';
      try {
        await window.KioskNameSearch.kioskSmartLookup(sb, staff.staff_id, value, {
          resultEl, msgEl, onFound: onFoundMakeup,
        });
      } catch (err) {
        msgEl.textContent = `❌ ${err.message}`; msgEl.style.color = 'var(--danger-tx)';
      }
      btn.disabled = false; btn.textContent = '查詢';
    });

    window.KioskNameSearch.attachLiveNameSearch(sb, () => staff.staff_id, {
      inputEl, suggestEl, resultEl, msgEl, onFound: onFoundMakeup,
    });
  }

  // ── 現場查詢學員（調班） ──────────────────────────────────────
  {
    const form      = document.getElementById('tr-lookup-form');
    const inputEl   = document.getElementById('tr-lookup-input');
    const suggestEl = document.getElementById('tr-lookup-suggest');
    const msgEl     = document.getElementById('tr-lookup-msg');
    const resultEl  = document.getElementById('tr-lookup-result');

    function onFoundTransfer(result) {
      renderTransferRegisterForm(
        'tr-lookup-result',
        result,
        result.classes || [],
        async (memberDbId, fromSessionRef, toClassRef, toDate, note) => {
          await kioskRegisterTransfer(sb, staff.staff_id, memberDbId, fromSessionRef, toClassRef, toDate, note);
          loadDay(datePicker.value);
          resultEl.innerHTML = '';
          inputEl.value = '';
          suggestEl.innerHTML = '';
          msgEl.textContent = '✅ 已登記，清單已更新。可繼續輸入下一位學員。';
          msgEl.style.color = 'var(--ok-tx)';
        }
      );
    }

    form.addEventListener('submit', async e => {
      e.preventDefault();
      const value = inputEl.value.trim();
      const btn   = e.target.querySelector('[type="submit"]');
      btn.disabled = true; btn.textContent = '查詢中…';
      try {
        await window.KioskNameSearch.kioskSmartLookup(sb, staff.staff_id, value, {
          resultEl, msgEl, onFound: onFoundTransfer,
        });
      } catch (err) {
        msgEl.textContent = `❌ ${err.message}`; msgEl.style.color = 'var(--danger-tx)';
      }
      btn.disabled = false; btn.textContent = '查詢';
    });

    window.KioskNameSearch.attachLiveNameSearch(sb, () => staff.staff_id, {
      inputEl, suggestEl, resultEl, msgEl, onFound: onFoundTransfer,
    });
  }

  // ── 現場查詢學員（培訓補課） ─────────────────────────────────
  {
    const form      = document.getElementById('training-lookup-form');
    const inputEl   = document.getElementById('training-lookup-input');
    const suggestEl = document.getElementById('training-lookup-suggest');
    const msgEl     = document.getElementById('training-lookup-msg');
    const resultEl  = document.getElementById('training-lookup-result');

    async function onFoundTraining(member) {
      const [classes, rules] = await Promise.all([
        fetchKioskTrainingClasses(sb),
        fetchKioskMakeupRules(sb),
      ]);
      window.KioskTrainingRender.renderTrainingRegisterForm(
        'training-lookup-result', member, classes, rules,
        (classRef) => fetchKioskTrainingSessions(sb, classRef),
        async (trainingSessionRef, note, plannedDate, plannedSlot, earphone) => {
          await kioskRegisterTrainingMakeup(sb, staff.staff_id, member.member_db_id, trainingSessionRef, note, plannedDate, plannedSlot, earphone);
          loadDay(datePicker.value);
          resultEl.innerHTML = '';
          inputEl.value = '';
          suggestEl.innerHTML = '';
          msgEl.textContent = '✅ 培訓補課已登記，清單已更新。可繼續輸入下一位學員。';
          msgEl.style.color = 'var(--ok-tx)';
        }
      );
    }

    form.addEventListener('submit', async e => {
      e.preventDefault();
      const value = inputEl.value.trim();
      const btn   = e.target.querySelector('[type="submit"]');
      btn.disabled = true; btn.textContent = '查詢中…';
      try {
        await window.KioskNameSearch.kioskSmartLookup(sb, staff.staff_id, value, {
          resultEl, msgEl, onFound: onFoundTraining,
        });
      } catch (err) {
        msgEl.textContent = `❌ ${err.message}`; msgEl.style.color = 'var(--danger-tx)';
      }
      btn.disabled = false; btn.textContent = '查詢';
    });

    window.KioskNameSearch.attachLiveNameSearch(sb, () => staff.staff_id, {
      inputEl, suggestEl, resultEl, msgEl, onFound: onFoundTraining,
    });
  }

  // ── 現場登記／預約分頁切換（同時只開一個，選中變深色） ──────────
  document.querySelectorAll('[data-tab-panel]').forEach(btn => {
    btn.addEventListener('click', () => {
      const alreadyActive = btn.classList.contains('active');
      document.querySelectorAll('[data-tab-panel]').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.kiosk-regpanel').forEach(p => { p.style.display = 'none'; });
      if (!alreadyActive) {
        btn.classList.add('active');
        document.getElementById(btn.dataset.tabPanel).style.display = 'block';
      }
    });
  });

  // ── 今日調班／今日補課／今日登記清單：標題點擊收合展開（登記多時避免畫面太長）──
  // 只切換內容 div 的 display，資料重新整理時只會換 innerHTML，收合狀態不受影響
  document.querySelectorAll('[data-collapse-target]').forEach(header => {
    header.addEventListener('click', () => {
      const target = document.getElementById(header.dataset.collapseTarget);
      if (!target) return;
      const collapsing = target.style.display !== 'none';
      target.style.display = collapsing ? 'none' : '';
      header.classList.toggle('collapsed', collapsing);
    });
  });
})();

if (typeof window !== 'undefined') {
  window.KioskLogic = {
    kioskGetDay, kioskTransferAttend, kioskMakeupAttend, kioskMakeupComplete,
    kioskMakeupDepart, kioskEditMakeup, kioskGetTodayLog,
    kioskLookupMember, kioskRegisterMakeup, kioskRegisterTransfer, kioskEditTransferNote,
    fetchKioskTrainingClasses, fetchKioskTrainingSessions, kioskRegisterTrainingMakeup,
    kioskTrainingMakeupComplete,
    kioskGetAttendanceAlerts, kioskMakeupCancelAttend, kioskTransferResetToRegistered,
    kioskCancelMakeup, kioskCancelTransfer, kioskGetTodayRegistrations,
  };
}
