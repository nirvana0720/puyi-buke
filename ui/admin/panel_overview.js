// 職責：各班總覽面板——每班一張卡（達標/全勤/勤學），可跳學員總表
// 依賴：window.AdminSwitchPanel（index.html 注入）

'use strict';

(function () {
  const { fetchClasses, compareClassSchedule } = window.AdminData;

  async function loadOverviewPanel(sb, container) {
    container.innerHTML = '<p class="buke-empty">載入中…</p>';
    try {
      const [{ data, error }, classes] = await Promise.all([
        sb.rpc('admin_student_stats', {}),
        fetchClasses(sb),
      ]);
      if (error) throw new Error(error.message);
      if (!data || !data.length) {
        container.innerHTML = '<p class="buke-empty">目前沒有進行中的班別資料。</p>';
        return;
      }
      // class_ref → 星期/日夜（供卡片排序用，admin_student_stats 本身不回傳這兩欄）
      const scheduleMap = new Map(classes.map(c => [c.id, c]));
      renderOverview(data, container, scheduleMap);
    } catch (e) {
      container.innerHTML = `<div class="buke-msg err">❌ ${e.message}</div>`;
    }
  }

  function renderOverview(rows, container, scheduleMap) {
    // 依 class_ref 聚合
    const classMap = new Map();
    for (const r of rows) {
      if (!classMap.has(r.class_ref)) {
        classMap.set(r.class_ref, { class_name: r.class_name, members: [] });
      }
      classMap.get(r.class_ref).members.push(r);
    }
    // 依星期一～日排序（同星期日間排夜間前面），查不到課表資料的排最後
    const sortedEntries = [...classMap.entries()].sort(([refA], [refB]) =>
      compareClassSchedule(scheduleMap.get(refA), scheduleMap.get(refB)));

    container.innerHTML = `
      <p style="font-size:14px;color:var(--muted);margin-bottom:16px">
        統計對象：所有「進行中」班的在學學員。「紅燈／可望結業／已達標」依目前出缺勤＋剩餘堂數推算，
        不必等上到最後一堂才知道。
      </p>
      <div class="buke-grid" style="grid-template-columns:repeat(auto-fit,minmax(280px,1fr))">
      </div>`;
    const grid = container.querySelector('.buke-grid');

    for (const [classRef, cls] of sortedEntries) {
      const members  = cls.members;
      const total    = members.length;
      const perfect  = members.filter(m => m.perfect).length;
      const diligent = members.filter(m => m.diligent === '已勤學').length;

      // 依目前進度推算：已達標／可望結業（進度正常）／紅燈（剩餘堂數全出席＋還沒過期的缺課全補完也補不回來）
      // 2026-07-03 修正：不用「目前還沒補的>3」無條件觸發（還沒過期的都還能補），改用 overdue_absent
      // （已逾期永久救不回來的堂數），跟 panel_risk.js 的 isUnrecoverable 同一套公式。
      let gradOk = 0, onTrack = 0, redLight = 0;
      for (const m of members) {
        if (m.grad_ok) { gradOk++; continue; }
        const held         = m.phys + m.absent + m.makeup;
        const remaining     = m.total - held;
        const needPhysical  = Math.ceil(m.cap / 2);
        const needCredit    = m.cap - 3;
        const totalCredit   = m.phys + m.makeup;
        const stillFixable  = m.absent - m.overdue_absent;
        const isRed = (m.phys + remaining) < needPhysical
          || m.overdue_absent > 3
          || (totalCredit + remaining + stillFixable) < needCredit;
        if (isRed) redLight++; else onTrack++;
      }

      const card = document.createElement('div');
      card.className = 'buke-card';
      card.innerHTML = `
        <div class="name" style="font-size:17px;margin-bottom:10px">${cls.class_name}</div>
        <div class="buke-stats" style="grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:12px">
          <div class="buke-stat danger" style="padding:10px">
            <div class="label">紅燈</div>
            <div class="num" style="font-size:20px">${redLight}</div>
          </div>
          <div class="buke-stat warn" style="padding:10px">
            <div class="label">可望結業</div>
            <div class="num" style="font-size:20px">${onTrack}</div>
          </div>
          <div class="buke-stat makeup" style="padding:10px">
            <div class="label">全勤</div>
            <div class="num" style="font-size:20px">${perfect}</div>
          </div>
          <div class="buke-stat warn" style="padding:10px">
            <div class="label">勤學</div>
            <div class="num" style="font-size:20px">${diligent}</div>
          </div>
        </div>
        <button class="buke-btn buke-btn-ghost btn-list" style="font-size:14px;padding:6px 14px;min-height:36px"
                data-class-ref="${classRef}" data-class-name="${cls.class_name}">
          看名單 →
        </button>`;

      card.querySelector('.btn-list').addEventListener('click', () => {
        if (window.AdminSwitchPanel) {
          window.AdminSwitchPanel('students', { classRef, className: cls.class_name });
        }
      });

      grid.appendChild(card);
    }
  }

  window.PanelOverview = { loadOverviewPanel };
})();
