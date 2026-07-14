// 職責：點名視圖（角色＝點名）——只看整班「當天」出缺勤標記，唯讀，無補課/調課操作
// 資料取用：get_today_rollcall RPC；渲染獨立於 board.js/render.js（那兩支是學長/班長整期統計用）

'use strict';

const ROLLCALL_MARK_MAP = {
  V:  { label: '出席',           cls: 'pass'   },
  L:  { label: '遲到',           cls: 'warn'   },
  LL: { label: '靜坐遲到',       cls: 'warn'   },
  A:  { label: '晚到(≥60分)',    cls: 'danger' },
  O:  { label: '請假/缺席',      cls: 'danger' },
  M:  { label: '補課',           cls: 'makeup' },
  ML: { label: '靜坐補課',       cls: 'makeup' },
};

async function fetchTodayRollcallViaRpc(sb, memberDbId) {
  const { data, error } = await sb.rpc('get_today_rollcall', { p_member_db_id: memberDbId });
  if (error) throw new Error(`get_today_rollcall 失敗：${error.message}`);
  return data;
}

function _markBadge(mark) {
  if (!mark) return `<span class="buke-badge" style="background:var(--line);color:var(--muted)">—</span>`;
  const info = ROLLCALL_MARK_MAP[mark] || { label: mark, cls: '' };
  return `<span class="buke-badge ${info.cls}">${info.label}</span>`;
}

function _makeupTag(records) {
  if (!records || !records.length) return '';
  const dates = records.map(r => (r.session_date || '').slice(5)).join('、');
  return `<span class="buke-badge makeup" style="margin-left:4px">補課：${dates}</span>`;
}

function renderRollcall(container, data) {
  if (!container) return;

  const groups = new Map();
  for (const m of (data.members || [])) {
    const gid = m.group_id || '（未分組）';
    if (!groups.has(gid)) groups.set(gid, []);
    groups.get(gid).push(m);
  }

  const noticeHtml = (!data.has_session || !data.is_held)
    ? `<div class="buke-msg" style="background:var(--warn-bg);color:var(--warn-tx)">
         ⚠️ 今天尚無課堂資料，以下仍列出全班名單。
       </div>`
    : '';

  const groupsHtml = [...groups.entries()].map(([gid, members]) => `
    <div class="buke-section" style="margin-bottom:8px">${gid}</div>
    <div class="buke-grid" style="margin-bottom:16px">
      ${members.map(m => `
        <div class="buke-card">
          <div class="row">
            <div>
              <span class="name">${m.name}</span>${_makeupTag(m.makeup_records)}
              <span class="meta">${m.dharma_name || ''}　${m.group_id || ''}${m.group_num ? '-' + m.group_num : ''}</span>
            </div>
            ${_markBadge(m.mark)}
          </div>
        </div>`).join('')}
    </div>`).join('');

  container.innerHTML = `
    <div class="buke-progress-note" style="margin-bottom:12px">
      <span class="lead">${data.class_name || ''}</span>
      <span class="sub">${data.session_date || ''} 點名表</span>
    </div>
    ${noticeHtml}
    ${groupsHtml || '<p class="buke-empty">此班目前無在學學員。</p>'}
  `;
}

window.RollcallLogic  = { fetchTodayRollcallViaRpc };
window.RollcallRender = { renderRollcall };
