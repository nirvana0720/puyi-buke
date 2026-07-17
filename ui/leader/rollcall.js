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

// 全班補課完成清單（後端已依「補課完成日期最新在前」排序好，這裡照原順序列出全部，不截斷）
function _renderMakeupCompletions(records) {
  if (!records || !records.length) return '';
  const rows = records.map(r => {
    const label = ROLLCALL_MARK_MAP[r.mark]?.label || r.mark || '補課';
    const sd = (r.session_date || '').slice(5);
    const cd = (r.completed_date || '').slice(5) || '—';
    return `
      <div style="display:grid;grid-template-columns:1fr 1fr 80px 70px;gap:8px;padding:10px 12px;
                  border-top:1px solid var(--line);align-items:center;font-size:18px">
        <div style="font-weight:500">${r.member_name}</div>
        <div style="color:var(--muted)">${sd}</div>
        <div style="color:var(--header)">${cd}</div>
        <div><span class="buke-badge makeup" style="font-size:15px">${label}</span></div>
      </div>`;
  }).join('');
  return `
    <div class="buke-section" style="margin:0 0 4px">補課完成名單</div>
    <p style="font-size:15px;color:var(--muted);margin:0 0 8px">依最新完成日期排序，方便對照紙本紀錄補登。</p>
    <div style="border:1px solid var(--line);border-radius:var(--r-md);overflow:hidden;margin-bottom:20px">
      <div style="display:grid;grid-template-columns:1fr 1fr 80px 70px;gap:8px;padding:8px 12px;
                  background:var(--surface-alt);font-size:14px;color:var(--muted)">
        <div>學員</div><div>缺課日</div><div>完成日</div><div>標記</div>
      </div>
      ${rows}
    </div>`;
}

const ATTENDED_MARKS = new Set(['V', 'L', 'LL', 'A', 'M', 'ML']);

function renderRollcall(container, data) {
  if (!container) return;

  const groups = new Map();
  for (const m of (data.members || [])) {
    const gid = m.group_id || '（未分組）';
    if (!groups.has(gid)) groups.set(gid, []);
    groups.get(gid).push(m);
  }

  const members = data.members || [];
  const attendedCount = members.filter(m => ATTENDED_MARKS.has(m.mark)).length;
  const absentCount = members.length - attendedCount;
  const summaryHtml = members.length
    ? `<div class="buke-msg" style="background:var(--surface-alt);color:var(--header);font-size:16px;margin-bottom:12px">
         目前報到 ${attendedCount} 人，未到 ${absentCount} 人
       </div>`
    : '';

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
        </div>`).join('')}
    </div>`).join('');

  container.innerHTML = `
    <div class="buke-progress-note" style="margin-bottom:12px">
      <span class="lead">${data.class_name || ''}</span>
      <span class="sub">${data.session_date || ''} 點名表</span>
    </div>
    ${summaryHtml}
    ${noticeHtml}
    ${_renderMakeupCompletions(data.makeup_completions)}
    ${groupsHtml || '<p class="buke-empty">此班目前無在學學員。</p>'}
  `;
}

window.RollcallLogic  = { fetchTodayRollcallViaRpc };
window.RollcallRender = { renderRollcall };
