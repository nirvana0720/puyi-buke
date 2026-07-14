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

// 已補課完成清單（後端已依「補課完成日期最新在前」排序好，這裡照原順序列出全部，不截斷）
function _makeupList(records) {
  if (!records || !records.length) return '';
  const rows = records.map(r => {
    const label = ROLLCALL_MARK_MAP[r.mark]?.label || r.mark || '補課';
    const sd = (r.session_date || '').slice(5);
    return `<div style="font-size:12px;color:var(--muted)">補課完成：${sd}（${label}）</div>`;
  }).join('');
  return `<div style="margin-top:2px">${rows}</div>`;
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
              <span class="name">${m.name}</span>
              <span class="meta">${m.dharma_name || ''}　${m.group_id || ''}${m.group_num ? '-' + m.group_num : ''}</span>
            </div>
            ${_markBadge(m.mark)}
          </div>
          ${_makeupList(m.makeup_records)}
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
