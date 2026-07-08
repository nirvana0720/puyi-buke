// 職責：後台精舍培訓課程管理面板（兩層：班別 → 堂次，authenticated 直接 .from()）

'use strict';

const _hourOpts = Array.from({length:24}, (_, h) =>
  `<option value="${String(h).padStart(2,'0')}">${String(h).padStart(2,'0')}</option>`
).join('');
const _minOpts = Array.from({length:12}, (_, m) =>
  `<option value="${String(m*5).padStart(2,'0')}">${String(m*5).padStart(2,'0')}</option>`
).join('');

function _timeStr(t) { return t ? String(t).slice(0, 5) : '—'; }

async function loadTrainingPanel(sb, container) {
  container.innerHTML = '<p style="color:var(--muted)">載入中…</p>';
  try { await _renderClasses(sb, container); }
  catch (e) { container.innerHTML = `<div class="buke-msg err">❌ ${e.message}</div>`; }
}

// ── 上層：班別清單 ────────────────────────────────────────────────
async function _renderClasses(sb, container) {
  const { data: rows, error } = await sb
    .from('training_classes')
    .select('id,name,is_active')
    .order('name');
  if (error) throw new Error(error.message);

  const listHtml = (rows || []).map(r => `
    <tr>
      <td style="padding:10px 8px">${r.name}</td>
      <td style="padding:10px 8px">
        <span class="buke-badge ${r.is_active ? 'pass' : 'danger'}">${r.is_active ? '啟用' : '停用'}</span>
      </td>
      <td style="padding:10px 8px;white-space:nowrap">
        <button class="buke-btn btn-sessions" data-id="${r.id}" data-name="${r.name}"
                style="font-size:12px;padding:3px 10px;margin-right:4px">堂次管理</button>
        <button class="buke-btn btn-toggle-cls" data-id="${r.id}" data-active="${r.is_active}"
                style="font-size:12px;padding:3px 10px;margin-right:4px">
          ${r.is_active ? '停用' : '啟用'}</button>
        <button class="buke-btn btn-del-cls" data-id="${r.id}"
                style="font-size:12px;padding:3px 10px;background:var(--danger-tx);border-color:var(--danger-tx)">刪除</button>
        <span id="cls-msg-${r.id}" style="font-size:12px;margin-left:6px"></span>
      </td>
    </tr>`).join('');

  container.innerHTML = `
    <div style="margin-bottom:20px;background:var(--surface);border:1px solid var(--line);
                border-radius:var(--r);padding:16px">
      <div style="font-size:15px;font-weight:500;color:var(--header);margin-bottom:12px">新增培訓班別</div>
      <form id="cls-add-form" style="display:flex;gap:10px;align-items:flex-end;flex-wrap:wrap">
        <div>
          <div style="font-size:13px;margin-bottom:4px">班別名稱 *</div>
          <input type="text" name="name" class="buke-input" placeholder="例：禪修基礎班" required style="width:200px">
        </div>
        <div style="display:flex;align-items:center;gap:8px">
          <button type="submit" class="buke-btn" style="padding:8px 16px">新增</button>
          <span id="cls-add-msg" style="font-size:13px"></span>
        </div>
      </form>
    </div>

    <div style="background:var(--surface);border:1px solid var(--line);border-radius:var(--r);overflow:hidden">
      <table style="width:100%;border-collapse:collapse;font-size:14px">
        <thead>
          <tr style="background:var(--bg);border-bottom:1px solid var(--line)">
            <th style="padding:10px 8px;text-align:left;font-weight:500;color:var(--muted)">班別名稱</th>
            <th style="padding:10px 8px;text-align:left;font-weight:500;color:var(--muted)">狀態</th>
            <th style="padding:10px 8px;text-align:left;font-weight:500;color:var(--muted)">操作</th>
          </tr>
        </thead>
        <tbody>
          ${listHtml || '<tr><td colspan="3" style="padding:16px;color:var(--muted);text-align:center">尚無培訓班別</td></tr>'}
        </tbody>
      </table>
    </div>`;

  // 新增班別
  document.getElementById('cls-add-form').addEventListener('submit', async e => {
    e.preventDefault();
    const btn  = e.target.querySelector('[type="submit"]');
    const msg  = document.getElementById('cls-add-msg');
    const name = e.target.querySelector('[name="name"]').value.trim();
    if (!name) return;
    btn.disabled = true; msg.textContent = '新增中…'; msg.style.color = 'var(--muted)';
    try {
      const { error: err } = await sb.from('training_classes').insert({ name });
      if (err) throw new Error(err.message);
      msg.textContent = '✅ 已新增'; msg.style.color = 'var(--ok-tx)';
      e.target.reset();
      setTimeout(() => _renderClasses(sb, container), 600);
    } catch (ex) {
      msg.textContent = `❌ ${ex.message}`; msg.style.color = 'var(--danger-tx)';
      btn.disabled = false;
    }
  });

  // 進入堂次管理
  container.querySelectorAll('.btn-sessions').forEach(btn => {
    btn.addEventListener('click', () =>
      _renderSessions(sb, container, Number(btn.dataset.id), btn.dataset.name)
    );
  });

  // 停用/啟用
  container.querySelectorAll('.btn-toggle-cls').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id     = Number(btn.dataset.id);
      const active = btn.dataset.active === 'true';
      const msgEl  = document.getElementById(`cls-msg-${id}`);
      btn.disabled = true;
      try {
        const { error: err } = await sb.from('training_classes').update({ is_active: !active }).eq('id', id);
        if (err) throw new Error(err.message);
        _renderClasses(sb, container);
      } catch (ex) {
        msgEl.textContent = `❌ ${ex.message}`; msgEl.style.color = 'var(--danger-tx)';
        btn.disabled = false;
      }
    });
  });

  // 刪除（inline 兩段確認）
  container.querySelectorAll('.btn-del-cls').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id    = Number(btn.dataset.id);
      const msgEl = document.getElementById(`cls-msg-${id}`);
      if (btn.dataset.confirm !== '1') {
        btn.dataset.confirm = '1'; btn.textContent = '確定刪除？';
        setTimeout(() => { btn.dataset.confirm = ''; btn.textContent = '刪除'; }, 3000);
        return;
      }
      btn.disabled = true;
      try {
        const { error: err } = await sb.from('training_classes').delete().eq('id', id);
        if (err) throw new Error(err.message);
        _renderClasses(sb, container);
      } catch (ex) {
        msgEl.textContent = `❌ ${ex.message}`; msgEl.style.color = 'var(--danger-tx)';
        btn.disabled = false;
      }
    });
  });
}

// ── 下層：堂次清單 ────────────────────────────────────────────────
async function _renderSessions(sb, container, classId, className) {
  const { data: rows, error } = await sb
    .from('training_sessions')
    .select('id,session_date,session_time,topic,is_active')
    .eq('class_ref', classId)
    .order('session_date').order('session_time');
  if (error) {
    container.innerHTML = `<div class="buke-msg err">❌ ${error.message}</div>`; return;
  }

  const listHtml = (rows || []).map(r => `
    <tr>
      <td style="padding:10px 8px">${r.session_date}</td>
      <td style="padding:10px 8px">${_timeStr(r.session_time)}</td>
      <td style="padding:10px 8px">${r.topic || '—'}</td>
      <td style="padding:10px 8px">
        <span class="buke-badge ${r.is_active ? 'pass' : 'danger'}">${r.is_active ? '啟用' : '停用'}</span>
      </td>
      <td style="padding:10px 8px;white-space:nowrap">
        <button class="buke-btn btn-toggle-ses" data-id="${r.id}" data-active="${r.is_active}"
                style="font-size:12px;padding:3px 10px;margin-right:4px">
          ${r.is_active ? '停用' : '啟用'}</button>
        <button class="buke-btn btn-del-ses" data-id="${r.id}"
                style="font-size:12px;padding:3px 10px;background:var(--danger-tx);border-color:var(--danger-tx)">刪除</button>
        <span id="ses-msg-${r.id}" style="font-size:12px;margin-left:6px"></span>
      </td>
    </tr>`).join('');

  container.innerHTML = `
    <div style="display:flex;align-items:center;gap:12px;margin-bottom:16px">
      <button id="btn-back" class="buke-btn" style="font-size:13px;padding:5px 12px">← 返回班別</button>
      <span style="font-size:16px;font-weight:500;color:var(--header)">${className}</span>
    </div>

    <div style="margin-bottom:20px;background:var(--surface);border:1px solid var(--line);
                border-radius:var(--r);padding:16px">
      <div style="font-size:15px;font-weight:500;color:var(--header);margin-bottom:12px">新增堂次</div>
      <form id="ses-add-form" style="display:flex;gap:10px;align-items:flex-end;flex-wrap:wrap">
        <div>
          <div style="font-size:13px;margin-bottom:4px">日期 *</div>
          <input type="date" name="session_date" class="buke-input" required style="width:145px">
        </div>
        <div>
          <div style="font-size:13px;margin-bottom:4px">時間（24h）</div>
          <div style="display:flex;align-items:center;gap:4px">
            <select name="ses_hour" class="buke-select" style="width:68px">
              <option value="">時</option>${_hourOpts}
            </select>
            <span style="color:var(--muted)">:</span>
            <select name="ses_min" class="buke-select" style="width:68px">
              <option value="">分</option>${_minOpts}
            </select>
          </div>
        </div>
        <div>
          <div style="font-size:13px;margin-bottom:4px">主題</div>
          <input type="text" name="topic" class="buke-input" placeholder="（可空）" style="width:160px">
        </div>
        <div style="display:flex;align-items:center;gap:8px">
          <button type="submit" class="buke-btn" style="padding:8px 16px">新增</button>
          <span id="ses-add-msg" style="font-size:13px"></span>
        </div>
      </form>
    </div>

    <div style="background:var(--surface);border:1px solid var(--line);border-radius:var(--r);overflow:hidden">
      <table style="width:100%;border-collapse:collapse;font-size:14px">
        <thead>
          <tr style="background:var(--bg);border-bottom:1px solid var(--line)">
            <th style="padding:10px 8px;text-align:left;font-weight:500;color:var(--muted)">日期</th>
            <th style="padding:10px 8px;text-align:left;font-weight:500;color:var(--muted)">時間</th>
            <th style="padding:10px 8px;text-align:left;font-weight:500;color:var(--muted)">主題</th>
            <th style="padding:10px 8px;text-align:left;font-weight:500;color:var(--muted)">狀態</th>
            <th style="padding:10px 8px;text-align:left;font-weight:500;color:var(--muted)">操作</th>
          </tr>
        </thead>
        <tbody>
          ${listHtml || '<tr><td colspan="5" style="padding:16px;color:var(--muted);text-align:center">尚無堂次</td></tr>'}
        </tbody>
      </table>
    </div>`;

  document.getElementById('btn-back').addEventListener('click', () => _renderClasses(sb, container));

  // 新增堂次
  document.getElementById('ses-add-form').addEventListener('submit', async e => {
    e.preventDefault();
    const btn  = e.target.querySelector('[type="submit"]');
    const msg  = document.getElementById('ses-add-msg');
    const date  = e.target.querySelector('[name="session_date"]').value;
    const h     = e.target.querySelector('[name="ses_hour"]').value;
    const m     = e.target.querySelector('[name="ses_min"]').value;
    const topic = e.target.querySelector('[name="topic"]').value.trim() || null;
    const time  = (h && m) ? `${h}:${m}` : null;
    if (!date) return;
    btn.disabled = true; msg.textContent = '新增中…'; msg.style.color = 'var(--muted)';
    try {
      const { error: err } = await sb.from('training_sessions')
        .insert({ class_ref: classId, session_date: date, session_time: time, topic });
      if (err) throw new Error(err.message);
      msg.textContent = '✅ 已新增'; msg.style.color = 'var(--ok-tx)';
      e.target.reset();
      setTimeout(() => _renderSessions(sb, container, classId, className), 600);
    } catch (ex) {
      msg.textContent = `❌ ${ex.message}`; msg.style.color = 'var(--danger-tx)';
      btn.disabled = false;
    }
  });

  // 停用/啟用堂次
  container.querySelectorAll('.btn-toggle-ses').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id     = Number(btn.dataset.id);
      const active = btn.dataset.active === 'true';
      const msgEl  = document.getElementById(`ses-msg-${id}`);
      btn.disabled = true;
      try {
        const { error: err } = await sb.from('training_sessions').update({ is_active: !active }).eq('id', id);
        if (err) throw new Error(err.message);
        _renderSessions(sb, container, classId, className);
      } catch (ex) {
        msgEl.textContent = `❌ ${ex.message}`; msgEl.style.color = 'var(--danger-tx)';
        btn.disabled = false;
      }
    });
  });

  // 刪除堂次
  container.querySelectorAll('.btn-del-ses').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id    = Number(btn.dataset.id);
      const msgEl = document.getElementById(`ses-msg-${id}`);
      if (btn.dataset.confirm !== '1') {
        btn.dataset.confirm = '1'; btn.textContent = '確定刪除？';
        setTimeout(() => { btn.dataset.confirm = ''; btn.textContent = '刪除'; }, 3000);
        return;
      }
      btn.disabled = true;
      try {
        const { error: err } = await sb.from('training_sessions').delete().eq('id', id);
        if (err) throw new Error(err.message);
        _renderSessions(sb, container, classId, className);
      } catch (ex) {
        msgEl.textContent = `❌ ${ex.message}`; msgEl.style.color = 'var(--danger-tx)';
        btn.disabled = false;
      }
    });
  });
}

if (typeof window !== 'undefined') {
  window.PanelTraining = { loadTrainingPanel };
}
