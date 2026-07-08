// 職責：休學管理面板——選班 → 載入學員 → 切換在學/休學
// 依賴：window.AdminData（admin.js）

'use strict';

(function () {
  const { fetchClasses, fetchMembersWithStatus, setMemberStatusLocal, compareClassSchedule } = window.AdminData;

  async function loadLeavePanel(sb, container) {
    container.innerHTML = '<p class="buke-empty">載入中…</p>';
    try {
      const classes = await fetchClasses(sb);
      const opts = classes
        .filter(c => c.status !== '已結業')
        .sort(compareClassSchedule)
        .map(c => `<option value="${c.id}">${c.class_name}（${c.status}）</option>`)
        .join('');

      container.innerHTML = `
        <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:14px">
          <select class="buke-select" id="lv-sel-class" style="min-width:160px">
            <option value="">— 選班別 —</option>${opts}
          </select>
          <button class="buke-btn" id="lv-btn-load" style="font-size:14px">載入名單</button>
        </div>
        <p style="font-size:14px;color:var(--muted);margin-bottom:12px">
          休學者灰階顯示，不列入結業統計與風險分組。名單依出席堂數（少到多）排序，出席同樣少時再看缺課總數（多到少），
          方便在大班找出從沒來過或長期缺課的學員（缺課數若受限於官方名單缺洞而失真，出席堂數不受影響，較可靠）。
        </p>
        <div id="lv-list"></div>`;

      container.querySelector('#lv-btn-load').addEventListener('click', async () => {
        const classRef = Number(container.querySelector('#lv-sel-class').value);
        if (!classRef) return;
        await renderMemberList(sb, classRef, container.querySelector('#lv-list'));
      });
    } catch (e) {
      container.innerHTML = `<div class="buke-msg err">❌ ${e.message}</div>`;
    }
  }

  async function renderMemberList(sb, classRef, listEl) {
    listEl.innerHTML = '<p class="buke-empty">載入中…</p>';
    try {
      const [members, statsRows] = await Promise.all([
        fetchMembersWithStatus(sb, classRef),
        sb.rpc('admin_student_stats', { p_class_ref: classRef }).then(r => {
          if (r.error) throw new Error(`取出缺勤統計失敗：${r.error.message}`);
          return r.data || [];
        }),
      ]);
      if (!members.length) {
        listEl.innerHTML = '<p class="buke-empty">此班尚無學員資料。</p>';
        return;
      }

      // 併入出席／缺課統計（休學者或查無統計者為 null，排最後）
      // 「缺課總數」跟著官方上課紀錄名單走，學期中被剔除名單的人後面堂次不會有紀錄、算不出真實缺課數，
      // 所以排序改成優先看「出席堂數」（少到多）——沒來過的人出席一定是 0，不受名單缺洞影響。
      const statsMap = Object.fromEntries(statsRows.map(s => [s.member_db_id, s]));
      const withStats = members.map(m => ({
        ...m,
        phys:         statsMap[m.id]?.phys ?? null,
        total_absent: statsMap[m.id]?.total_absent ?? null,
      }));
      withStats.sort((a, b) => {
        const pa = a.phys ?? Infinity, pb = b.phys ?? Infinity;
        if (pa !== pb) return pa - pb;
        return (b.total_absent ?? -1) - (a.total_absent ?? -1);
      });

      listEl.innerHTML = withStats.map(m => {
        const active = m.status !== '休學';
        const physBadge = m.phys != null
          ? `<span class="buke-badge ${m.phys === 0 ? 'danger' : 'makeup'}">出席 ${m.phys} 堂</span>`
          : '';
        const absentBadge = m.total_absent != null
          ? `<span class="buke-badge ${m.total_absent > 3 ? 'danger' : m.total_absent > 0 ? 'warn' : 'makeup'}">缺課 ${m.total_absent} 堂</span>`
          : '';
        return `<div class="buke-card ${active ? '' : 'care'}"
                     style="margin-bottom:10px;opacity:${active ? 1 : 0.65}">
          <div class="row">
            <div>
              <span class="name">${m.name}</span>
              <span class="meta">${m.dharma_name || ''}　${m.group_id || ''}${m.group_num ? '-' + m.group_num : ''}</span>
            </div>
            <div style="display:flex;align-items:center;gap:8px">
              ${physBadge}
              ${absentBadge}
              <span class="buke-badge ${active ? 'pass' : 'warn'}">${active ? '在學' : '休學'}</span>
              <button class="buke-btn ${active ? 'buke-btn-ghost' : ''} btn-toggle"
                      style="font-size:14px;padding:5px 14px;min-height:36px"
                      data-id="${m.id}" data-name="${m.name}" data-status="${m.status}">
                ${active ? '設為休學' : '恢復在學'}
              </button>
            </div>
          </div>
        </div>`;
      }).join('');

      listEl.querySelectorAll('.btn-toggle').forEach(btn => {
        btn.addEventListener('click', async () => {
          const next = btn.dataset.status === '休學' ? '在學' : '休學';
          btn.disabled = true;
          btn.textContent = '處理中…';
          try {
            await setMemberStatusLocal(sb, Number(btn.dataset.id), next);
            await renderMemberList(sb, classRef, listEl);
          } catch (e) {
            btn.disabled = false;
            btn.textContent = btn.dataset.status === '休學' ? '恢復在學' : '設為休學';
            listEl.insertAdjacentHTML('afterbegin',
              `<div class="buke-msg err">❌ ${e.message}</div>`);
          }
        });
      });
    } catch (e) {
      listEl.innerHTML = `<div class="buke-msg err">❌ ${e.message}</div>`;
    }
  }

  window.PanelLeave = { loadLeavePanel };
})();
