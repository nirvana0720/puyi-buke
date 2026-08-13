// 職責：協調 renderBoard 呼叫、卡片相關渲染
// 純表格/名單渲染見 render_lists.js；資料取用見 board.js

'use strict';

const LEADER_MARK_LABEL = {
  O: '請假/缺席', A: '晚到(≥60分)', LL: '靜坐遲到(20~60分)',
  E: '早退', W: '公假', X: '中輟', S1: '特殊1', S2: '特殊2', S3: '特殊3',
};

/**
 * 在 #board 容器內渲染整班看板
 * @param {StudentRow[]} rows
 * @param {string}       mode         'leader' | 'class'
 * @param {number|null}  leaderDbId   登入者的 members.id（代登記用）
 * @param {object|null}  sb           Supabase client（代登記用）
 */
function renderBoard(rows, mode, leaderDbId, sb) {
  const container = document.getElementById('board');
  if (!container) return;
  container.innerHTML = '';

  if (!rows.length) {
    container.innerHTML = '<p class="buke-empty">尚無學員資料。</p>';
    return;
  }

  const active = rows.filter(r => r.status !== '休學');
  const closed = rows.filter(r => r.status === '休學');

  const className  = rows[0]?.class_name  || '';
  const total      = rows[0]?.total       || 0;
  const held       = rows[0]?.held        || 0;
  const needCredit = rows[0]?.need_credit || 0;

  // ── 班別標題 ────────────────────────────────────────────────
  const titleEl = document.createElement('div');
  titleEl.className = 'buke-progress-note';
  titleEl.innerHTML = `
    <span class="lead">${className}</span>
    <span class="sub">已上 ${held} / ${total} 堂　結業需達 ${needCredit} 堂（實體＋補課）</span>
  `;
  container.appendChild(titleEl);

  // ── 即將逾期（≤14 天，含已逾期）——先算好供 KPI 使用 ─────────
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const urgentMakeups = [];
  for (const r of active) {
    for (const mk of (r.makeups || [])) {
      const dl = mk.deadline_date ? new Date(mk.deadline_date) : null;
      const daysLeft = dl ? Math.ceil((dl - today) / 86400000) : null;
      if (mk.is_overdue || (daysLeft !== null && daysLeft <= 14)) {
        urgentMakeups.push({ row: r, mk, daysLeft });
      }
    }
  }
  urgentMakeups.sort((a, b) =>
    (a.mk.is_overdue ? -1 : 1) - (b.mk.is_overdue ? -1 : 1)
    || (a.mk.deadline_date || '').localeCompare(b.mk.deadline_date || '')
  );

  // ── 缺課未登記 ──────────────────────────────────────────────
  const unregistered = [];
  for (const r of active) {
    for (const abs of (r.unregistered_absences || [])) {
      unregistered.push({ row: r, abs });
    }
  }
  unregistered.sort((a, b) => (a.abs.session_date || '').localeCompare(b.abs.session_date || ''));

  // ── KPI 磚（render_lists.js）────────────────────────────────
  container.appendChild(buildKpiSection(active, mode, urgentMakeups));

  // ── 紅燈名單（永遠顯示，render_lists.js）────────────────────
  container.appendChild(buildRedLightList(active, mode));

  // ── 已登記補課（未逾期，可改時間，render_lists.js，2026-08-13 新增）───
  container.appendChild(buildRegisteredMakeupSection(active, mode, leaderDbId, sb));

  // ── 即將逾期表（render_lists.js）────────────────────────────
  if (urgentMakeups.length) container.appendChild(buildUrgentSection(urgentMakeups, mode, leaderDbId, sb));

  // ── 缺課未登記表（render_lists.js）──────────────────────────
  if (unregistered.length) container.appendChild(buildUnregisteredSection(unregistered, mode, leaderDbId, sb));

  // ── 搜尋框：緊接在下方卡片牆之前，人多的班找人用（2026-08-05）───
  // 放在這裡（不是頁面最上方）是刻意的：搜尋框跟它篩選的卡片牆黏在一起，
  // 打字馬上看得到下面的結果，不用往下滑一段距離才知道有沒有反應。
  const searchWrap = document.createElement('div');
  searchWrap.style.cssText = 'margin:16px 0 8px';
  searchWrap.innerHTML = `
    <input id="board-search" class="buke-input" type="search" placeholder="🔍 搜尋姓名／法名…"
           style="max-width:240px">`;
  container.appendChild(searchWrap);
  searchWrap.querySelector('#board-search').addEventListener('input', e => filterBoardByName(e.target.value));

  // ── 風險卡片區：班長依組別，學長攤平三色段 ──────────────────
  if (mode === 'class') {
    container.appendChild(buildGroupedRiskSection(active, needCredit, leaderDbId, sb));
  } else {
    const care = active.filter(r => r.red_light);
    const pass = active.filter(r => !r.red_light && r.can_graduate);
    const warn = active.filter(r => !r.red_light && !r.can_graduate);

    if (care.length) container.appendChild(buildSection('🔴 需要關懷（紅燈）', 'care', care, needCredit, leaderDbId, sb));
    if (warn.length) container.appendChild(buildSection('⏳ 穩定上課中',       'warn', warn, needCredit, leaderDbId, sb));
    if (pass.length) container.appendChild(buildSection('✅ 穩定達標',         'pass', pass, needCredit, leaderDbId, sb));
  }

  if (closed.length) container.appendChild(buildClosedSection(closed));
}

/** 建立一個風險區段（標題＋卡片網格） */
function buildSection(title, cls, members, needCredit, leaderDbId, sb) {
  const wrap = document.createElement('div');

  const h = document.createElement('div');
  h.className = `buke-section ${cls}`;
  h.textContent = title;
  wrap.appendChild(h);

  const grid = document.createElement('div');
  grid.className = 'buke-grid';
  for (const m of members) grid.appendChild(buildCard(m, cls, needCredit, leaderDbId, sb));
  wrap.appendChild(grid);

  return wrap;
}

/**
 * 班長視圖：依 group_id 分組，每組顯示小計標題 + 組內風險卡片
 * 2026-08-13 補記：班級人數一多（100+人）原本每組都全展開，頁面要滑到天荒地老。
 * 改成：①頂部加一排可點的組別導覽 pill（含紅燈組標紅字＋人數，點下去直接跳到該組）；
 * ②每組用 <details> 包起來，預設收合，只有組內有紅燈學員的組自動展開；③組內排序不變。
 * 用 120 人／8 組假資料量測過：頁面總高度從約 10280px 降到約 4260px（減少近六成）。
 * 搜尋框（filterBoardByName）搭配這裡新增的 dataset.defaultOpen，會在搜到人時自動展開
 * 該組、清空搜尋則還原成原本（有紅燈才展開）的收合狀態。
 */
function buildGroupedRiskSection(active, needCredit, leaderDbId, sb) {
  const wrap = document.createElement('div');

  const groupIds = [...new Set(active.map(r => r.group_id || ''))].sort();

  // ── 頂部導覽 pill 列：跳轉到任一組，紅燈組標紅字＋人數 ──
  const nav = document.createElement('div');
  nav.className = 'group-nav';
  for (const gid of groupIds) {
    const members = active.filter(r => (r.group_id || '') === gid);
    const careCount = members.filter(r => r.red_light).length;
    const anchor = `grp-${gid || '未分組'}`;
    const a = document.createElement('a');
    a.href = `#${anchor}`;
    a.textContent = careCount ? `${gid || '未分組'} 🔴${careCount}` : (gid || '未分組');
    if (careCount) a.classList.add('has-care');
    nav.appendChild(a);
  }
  wrap.appendChild(nav);

  for (const gid of groupIds) {
    const members = active.filter(r => (r.group_id || '') === gid);
    const count   = members.length;
    const careCount = members.filter(r => r.red_light).length;

    const avgAttend = count
      ? Math.round(members.reduce((s, r) => s + (r.held > 0 ? r.physical / r.held * 100 : 0), 0) / count)
      : 0;
    const avgCredit = count && needCredit > 0
      ? Math.round(members.reduce((s, r) => s + r.total_credit / needCredit * 100, 0) / count)
      : 0;

    const details = document.createElement('details');
    details.className = 'group-details';
    details.id = `grp-${gid || '未分組'}`;
    details.open = careCount > 0;
    details.dataset.defaultOpen = careCount > 0 ? '1' : '0';

    const groupTitle = document.createElement('summary');
    groupTitle.className = 'buke-section';
    groupTitle.innerHTML = `<span>${gid || '（未分組）'}</span>
      <span style="font-size:0.85em;font-weight:normal;margin-left:12px;color:var(--muted)">
        ${count} 人　出席率 ${avgAttend}%　預計結業率 ${avgCredit}%
      </span>
      ${careCount ? `<span class="buke-badge danger">🔴 ${careCount} 人需關懷</span>` : ''}
      <span class="buke-collapse-arrow">▶</span>`;
    details.appendChild(groupTitle);

    const sorted = [
      ...members.filter(r => r.red_light),
      ...members.filter(r => !r.red_light && !r.can_graduate),
      ...members.filter(r => r.can_graduate),
    ];

    const grid = document.createElement('div');
    grid.className = 'buke-grid';
    for (const m of sorted) {
      const sectionCls = m.red_light ? 'care' : m.can_graduate ? 'pass' : 'warn';
      grid.appendChild(buildCard(m, sectionCls, needCredit, leaderDbId, sb));
    }
    details.appendChild(grid);
    wrap.appendChild(details);
  }

  return wrap;
}

/** 建立單一在學學員卡片 */
function buildCard(m, sectionCls, needCredit, leaderDbId, sb) {
  const card = document.createElement('div');
  card.className = `buke-card ${sectionCls}`;
  // 供搜尋框比對用（人多的班要能直接打名字/法名找人，見 filterBoardByName）
  card.dataset.search = `${m.name || ''} ${m.dharma_name || ''}`.toLowerCase();

  const badgeText = sectionCls === 'care' ? '紅燈'
    : sectionCls === 'pass' ? '達標' : '上課中';
  const badgeCls  = sectionCls === 'care' ? 'danger'
    : sectionCls === 'pass' ? 'pass' : 'warn';

  const pct = needCredit > 0
    ? Math.min(100, Math.round((m.total_credit / needCredit) * 100))
    : 0;
  const barCls = sectionCls === 'care' ? 'danger'
    : sectionCls === 'pass' ? 'ok' : 'warn';

  const gap = m.need_credit - m.total_credit;
  const detailText = m.can_graduate
    ? '已達結業標準'
    : `出席 ${m.physical} · 補課 ${m.makeup} · 缺課 ${m.absent} ｜ 距結業還差 ${Math.max(0, gap)} 堂`;

  const today          = new Date().toLocaleDateString('sv-SE');
  const availableUnreg = (m.unregistered_absences || []).filter(a => !(a.deadline_date && a.deadline_date < today));
  const hasUnreg       = availableUnreg.length > 0;
  const proxyBtnId     = `card-proxy-${m.id}`;
  const proxyFormId    = `card-proxy-form-${m.id}`;
  const tfrBtnId       = `card-tfr-${m.id}`;
  const tfrFormId      = `card-tfr-form-${m.id}`;

  card.innerHTML = `
    <div class="row">
      <div>
        <span class="name">${m.name}</span>
        <span class="meta">${m.dharma_name || ''}　${m.group_id || ''}${m.group_num ? '-' + m.group_num : ''}</span>
      </div>
      <span class="buke-badge ${badgeCls}">${badgeText}</span>
    </div>
    <div class="buke-bar ${barCls}"><span style="width:${pct}%"></span></div>
    <div class="detail">${detailText}</div>
    <div class="card-actions" style="margin-top:8px;display:flex;gap:6px;flex-wrap:wrap">
      ${hasUnreg
        ? `<button id="${proxyBtnId}" class="buke-btn small">代為登記補課（${availableUnreg.length} 堂）</button>`
        : ''}
      <button id="${tfrBtnId}" class="buke-btn small" style="background:#1B4332;color:#fff">代為日↔夜間調班補課</button>
    </div>
    ${hasUnreg ? `<div id="${proxyFormId}" style="display:none;margin-top:6px"></div>` : ''}
    <div id="${tfrFormId}" style="display:none;margin-top:6px"></div>
  `;

  setTimeout(() => {
    const btn     = hasUnreg ? document.getElementById(proxyBtnId) : null;
    const form    = hasUnreg ? document.getElementById(proxyFormId) : null;
    const tfrBtn  = document.getElementById(tfrBtnId);
    const tfrForm = document.getElementById(tfrFormId);

    function closeTransfer() {
      tfrForm.style.display = 'none';
      tfrBtn.textContent = '代為日↔夜間調班補課';
    }

    // 代為登記補課：獨立全螢幕彈窗，不再跟調班鍵互相收合/淡化
    if (hasUnreg && btn && window.LeaderActions) {
      btn.addEventListener('click', () => {
        window.LeaderActions.renderProxyMakeupPicker(form, sb, m, leaderDbId);
      });
    }

    // 代為調班：維持原樣（本次不動）
    if (tfrBtn && tfrForm && window.LeaderActions) {
      tfrBtn.addEventListener('click', () => {
        if (tfrForm.style.display === 'none') {
          window.LeaderActions.renderProxyTransferForm(tfrForm, sb, m, leaderDbId, null);
          tfrForm.style.display = '';
          tfrBtn.textContent = '▲ 收起日↔夜間調班補課';
        } else {
          closeTransfer();
        }
      });
    }
  }, 0);

  return card;
}

/** 建立「已休學」唯讀區段 */
function buildClosedSection(members) {
  const wrap = document.createElement('div');

  const h = document.createElement('div');
  h.className = 'buke-section';
  h.style.color = 'var(--muted)';
  h.textContent = '📦 已休學';
  wrap.appendChild(h);

  const grid = document.createElement('div');
  grid.className = 'buke-grid';

  for (const m of members) {
    const card = document.createElement('div');
    card.className = 'buke-card';
    card.style.opacity = '0.6';
    card.dataset.search = `${m.name || ''} ${m.dharma_name || ''}`.toLowerCase();
    card.innerHTML = `
      <div class="row">
        <div>
          <span class="name">${m.name}</span>
          <span class="meta">${m.dharma_name || ''}　${m.group_id || ''}${m.group_num ? '-' + m.group_num : ''}</span>
        </div>
        <span class="buke-badge" style="background:var(--line);color:var(--muted)">休學</span>
      </div>
    `;
    grid.appendChild(card);
  }

  wrap.appendChild(grid);
  return wrap;
}

/**
 * 依姓名/法名關鍵字篩選看板上的學員卡片（人多的班用來直接找人）
 * 通用做法：找出每個 .buke-grid，過濾裡面的 .buke-card；卡片一個都不剩就把
 * 這個 grid 跟它前一個手足元素（各區塊/組別標題，都是 .buke-section）一起藏起來，
 * 不用去改 renderBoard 產生分組/分區塊的結構。
 */
function filterBoardByName(query) {
  const board = document.getElementById('board');
  if (!board) return;
  const q = (query || '').trim().toLowerCase();

  board.querySelectorAll('.buke-grid').forEach(grid => {
    let anyVisible = false;
    grid.querySelectorAll('.buke-card').forEach(card => {
      const match = !q || (card.dataset.search || '').includes(q);
      card.style.display = match ? '' : 'none';
      if (match) anyVisible = true;
    });
    const showGroup = !q || anyVisible;
    grid.style.display = showGroup ? '' : 'none';
    const header = grid.previousElementSibling;
    if (header && header.classList.contains('buke-section')) {
      header.style.display = showGroup ? '' : 'none';
    }
    // 2026-08-13 補記：已登記補課／依組別卡片牆這兩區現在包在可收合的 <details> 裡
    // （見 render_lists.js buildRegisteredMakeupSection、render.js buildGroupedRiskSection）。
    // 搜尋有命中時要自動展開該區塊，否則卡片雖然沒被 display:none，但因為外層 <details>
    // 是收合的，畫面上還是看不到；清空搜尋則還原成各自建立時記下的預設收合狀態
    // （dataset.defaultOpen：已登記補課永遠是 1，依組別卡片牆則是有紅燈學員才 1）。
    const details = grid.closest('details');
    if (details && details.dataset.defaultOpen !== undefined) {
      details.open = q ? anyVisible : details.dataset.defaultOpen === '1';
    }
  });
}

if (typeof window !== 'undefined') window.Render = { renderBoard, filterBoardByName };
if (typeof module !== 'undefined') module.exports = { renderBoard, filterBoardByName };
