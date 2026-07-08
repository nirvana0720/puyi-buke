// 職責：義工帳號面板——列出、新增、重設密碼、停用/啟用
// ⚠️ 永不讀取 password_hash；建立/改密碼全走 SECURITY DEFINER RPC
// inline 確認；不用瀏覽器 confirm

'use strict';

(function () {

  // ── 主入口 ───────────────────────────────────────────────────

  async function loadVolunteersPanel(sb, container) {
    container.innerHTML = '<p class="buke-empty">載入中…</p>';
    try {
      const list = await fetchStaff(sb);
      renderShell(sb, container, list);
    } catch (e) {
      container.innerHTML = `<div class="buke-msg err">❌ ${e.message}</div>`;
    }
  }

  async function fetchStaff(sb) {
    const { data, error } = await sb
      .from('staff_accounts')
      .select('id,username,display_name,role,is_active,created_at')
      .order('created_at');
    if (error) throw new Error(`讀取失敗：${error.message}`);
    return data || [];
  }

  // ── 外殼渲染 ─────────────────────────────────────────────────

  function renderShell(sb, container, list) {
    container.innerHTML = `
      <p style="font-size:14px;color:var(--muted);margin-bottom:16px">
        義工用帳號名＋密碼登入，只進櫃台頁（不進管理員後台）。密碼以 bcrypt 雜湊儲存，後台不顯示原始密碼。
      </p>

      <!-- 新增表單 -->
      <div class="buke-card" style="margin-bottom:16px">
        <div style="font-weight:500;margin-bottom:12px">新增義工帳號</div>
        <div style="display:flex;flex-direction:column;gap:10px;max-width:400px">
          <label style="font-size:15px">帳號名稱
            <input id="v-username" class="buke-input" style="margin-top:4px;width:100%"
                   placeholder="例：櫃台1（登入時使用）">
          </label>
          <label style="font-size:15px">密碼（至少 6 碼）
            <input id="v-password" type="password" class="buke-input" style="margin-top:4px;width:100%"
                   placeholder="••••••">
          </label>
          <label style="font-size:15px">顯示名稱（選填）
            <input id="v-dispname" class="buke-input" style="margin-top:4px;width:100%"
                   placeholder="例：義工甲">
          </label>
          <div style="display:flex;gap:10px;align-items:center">
            <button id="v-btn-create" class="buke-btn" style="font-size:14px;padding:7px 20px">建立帳號</button>
            <span id="v-create-msg" style="font-size:14px"></span>
          </div>
        </div>
      </div>

      <!-- 義工清單 -->
      <div id="v-list"></div>`;

    container.querySelector('#v-btn-create').addEventListener('click', () =>
      handleCreate(sb, container));

    container.querySelector('#v-username').addEventListener('keydown', e => {
      if (e.key === 'Enter') container.querySelector('#v-password').focus();
    });
    container.querySelector('#v-password').addEventListener('keydown', e => {
      if (e.key === 'Enter') handleCreate(sb, container);
    });

    renderList(sb, container, list);
  }

  // ── 新增義工 ─────────────────────────────────────────────────

  async function handleCreate(sb, container) {
    const username  = container.querySelector('#v-username').value.trim();
    const password  = container.querySelector('#v-password').value;
    const dispname  = container.querySelector('#v-dispname').value.trim() || null;
    const msgEl     = container.querySelector('#v-create-msg');
    const btn       = container.querySelector('#v-btn-create');

    if (!username) { msgEl.textContent = '請填帳號名稱'; msgEl.style.color = 'var(--danger-tx)'; return; }
    if (password.length < 6) { msgEl.textContent = '密碼至少 6 碼'; msgEl.style.color = 'var(--danger-tx)'; return; }

    btn.disabled = true;
    msgEl.textContent = '建立中…';
    msgEl.style.color = 'var(--muted)';

    try {
      const { error } = await sb.rpc('create_staff', {
        p_username:     username,
        p_password:     password,
        p_display_name: dispname,
        p_role:         'volunteer',
      });
      if (error) throw new Error(error.message);

      // 清空輸入
      container.querySelector('#v-username').value = '';
      container.querySelector('#v-password').value = '';
      container.querySelector('#v-dispname').value = '';
      msgEl.textContent = `✅ 已建立「${username}」`;
      msgEl.style.color = 'var(--ok-tx)';

      // 重載清單
      const list = await fetchStaff(sb);
      renderList(sb, container, list);
    } catch (e) {
      msgEl.textContent = `❌ ${e.message}`;
      msgEl.style.color = 'var(--danger-tx)';
    } finally {
      btn.disabled = false;
    }
  }

  // ── 清單渲染 ─────────────────────────────────────────────────

  function renderList(sb, container, list) {
    const listEl = container.querySelector('#v-list');
    if (!list.length) {
      listEl.innerHTML = '<p class="buke-empty">尚未建立任何義工帳號。</p>';
      return;
    }
    listEl.innerHTML = `<div class="buke-section" style="margin-bottom:10px">目前義工帳號（${list.length} 筆）</div>`;
    list.forEach(staff => listEl.appendChild(buildStaffCard(sb, container, staff)));
  }

  // ── 義工卡片 ─────────────────────────────────────────────────

  function buildStaffCard(sb, container, staff) {
    const card = document.createElement('div');
    card.className = `buke-card ${staff.is_active ? '' : 'care'}`;
    card.style.cssText = 'margin-bottom:10px;opacity:' + (staff.is_active ? 1 : 0.65);

    const badge = staff.is_active
      ? '<span class="buke-badge pass">啟用中</span>'
      : '<span class="buke-badge warn">已停用</span>';

    card.innerHTML = `
      <div class="row" style="flex-wrap:wrap;gap:8px">
        <div>
          <span class="name">${staff.display_name || staff.username}</span>
          <span class="meta">帳號：${staff.username}　${staff.role === 'admin' ? '管理員' : '義工'}</span>
        </div>
        ${badge}
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px">
        <button class="buke-btn buke-btn-ghost btn-reset-pw" style="font-size:13px;padding:4px 12px;min-height:30px">
          重設密碼
        </button>
        <button class="buke-btn ${staff.is_active ? 'buke-btn-ghost' : ''} btn-toggle-active"
                style="font-size:13px;padding:4px 12px;min-height:30px${!staff.is_active ? ';background:var(--ok-bar);color:#fff' : ''}">
          ${staff.is_active ? '停用' : '啟用'}
        </button>
      </div>
      <div class="pw-form" style="display:none;margin-top:10px;max-width:360px">
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
          <input type="password" class="buke-input inp-new-pw" placeholder="新密碼（至少 6 碼）"
                 style="font-size:14px;flex:1;min-width:160px">
          <button class="buke-btn btn-save-pw" style="font-size:13px;padding:4px 14px;min-height:30px">確定</button>
          <button class="buke-btn buke-btn-ghost btn-cancel-pw" style="font-size:13px;padding:4px 14px;min-height:30px">取消</button>
        </div>
        <div class="pw-msg" style="font-size:13px;margin-top:6px"></div>
      </div>
      <div class="toggle-confirm" style="display:none;margin-top:10px;padding:10px;
           background:var(--surface);border:1px solid var(--line);border-radius:var(--r-md)">
        <p class="tc-msg" style="font-size:14px;margin-bottom:8px"></p>
        <div style="display:flex;gap:8px">
          <button class="buke-btn tc-yes" style="font-size:13px;padding:4px 12px;min-height:30px">確定</button>
          <button class="buke-btn buke-btn-ghost tc-no" style="font-size:13px;padding:4px 12px;min-height:30px">取消</button>
        </div>
        <div class="tc-result" style="font-size:13px;margin-top:6px"></div>
      </div>`;

    // 重設密碼
    const pwForm   = card.querySelector('.pw-form');
    const pwMsg    = card.querySelector('.pw-msg');
    card.querySelector('.btn-reset-pw').addEventListener('click', () => {
      pwForm.style.display = pwForm.style.display === 'none' ? '' : 'none';
    });
    card.querySelector('.btn-cancel-pw').addEventListener('click', () => {
      pwForm.style.display = 'none';
      card.querySelector('.inp-new-pw').value = '';
      pwMsg.textContent = '';
    });
    card.querySelector('.btn-save-pw').addEventListener('click', async () => {
      const pw  = card.querySelector('.inp-new-pw').value;
      const btn = card.querySelector('.btn-save-pw');
      if (pw.length < 6) { pwMsg.textContent = '密碼至少 6 碼'; pwMsg.style.color = 'var(--danger-tx)'; return; }
      btn.disabled = true;
      pwMsg.textContent = '更新中…'; pwMsg.style.color = 'var(--muted)';
      try {
        const { error } = await sb.rpc('set_staff_password', { p_id: staff.id, p_password: pw });
        if (error) throw new Error(error.message);
        pwMsg.textContent = '✅ 密碼已更新'; pwMsg.style.color = 'var(--ok-tx)';
        card.querySelector('.inp-new-pw').value = '';
      } catch (e) {
        pwMsg.textContent = `❌ ${e.message}`; pwMsg.style.color = 'var(--danger-tx)';
      } finally { btn.disabled = false; }
    });

    // 停用/啟用（inline confirm）
    const confirmEl = card.querySelector('.toggle-confirm');
    const tcMsg     = card.querySelector('.tc-msg');
    const tcResult  = card.querySelector('.tc-result');
    card.querySelector('.btn-toggle-active').addEventListener('click', () => {
      const action = staff.is_active ? '停用' : '啟用';
      tcMsg.textContent = `確定${action}「${staff.display_name || staff.username}」的帳號？`;
      tcResult.textContent = '';
      confirmEl.style.display = '';
    });
    card.querySelector('.tc-yes').addEventListener('click', async () => {
      tcResult.textContent = '處理中…'; tcResult.style.color = 'var(--muted)';
      try {
        const { error } = await sb
          .from('staff_accounts')
          .update({ is_active: !staff.is_active })
          .eq('id', staff.id);
        if (error) throw new Error(error.message);
        const list = await fetchStaff(sb);
        renderList(sb, container, list);
      } catch (e) {
        tcResult.textContent = `❌ ${e.message}`; tcResult.style.color = 'var(--danger-tx)';
      }
    });
    card.querySelector('.tc-no').addEventListener('click', () => { confirmEl.style.display = 'none'; });

    return card;
  }

  window.PanelVolunteers = { loadVolunteersPanel };
})();
