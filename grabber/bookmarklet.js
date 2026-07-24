// 職責：書籤腳本（bookmarklet）── 手動指定日期／班別的完整版，用於補抓過去日期或自動判斷失敗時的備用。
// 日常同步請改用 grabber/bookmarklet_quick.js（一鍵版，自動判斷今天正在上課的班，不用手動選）。
// 不負責：自動輪詢（留 Phase 1b extension）
//
// 2026-07-03 改版：原本用 zenclass 的 class_date_infos 端點查「當天有哪些班」，但實測發現該端點對
// 過去日期查詢不可靠（不管查哪天，都只回傳「今天實際排課」的班別，導致補抓過去日期時抓錯班）。
// 改成直接從我方資料庫（list_audit_classes RPC）取得已建檔的班別清單讓使用者選，
// 再用班別的 class_id 直接呼叫 class_attend_records（這支對過去日期已驗證可靠，稽核書籤也是這樣用）。

(async function PUYI_SYNC() {
  // ── 0. 設定（填入真實值）────────────────────────────────────
  const SUPABASE_URL     = 'REPLACE_YOUR_PROJECT_URL';
  const SUPABASE_ANON_KEY = 'REPLACE_YOUR_ANON_KEY';
  const UNIT_ID          = 'UNIT01071';
  const API_BASE         = 'https://zenclass.ctcm.org.tw';

  // ── 1. 確認在正確頁面 ──────────────────────────────────────
  if (!location.href.includes('zenclass.ctcm.org.tw')) {
    alert('[補課系統] 請在 zenclass kiosk 頁面使用此書籤！');
    return;
  }

  // ── 2. 載入 supabase-js（CDN）──────────────────────────────
  async function loadScript(src) {
    return new Promise((resolve, reject) => {
      if (document.querySelector(`script[src="${src}"]`)) { resolve(); return; }
      const s = document.createElement('script');
      s.src = src; s.onload = resolve; s.onerror = reject;
      document.head.appendChild(s);
    });
  }
  await loadScript('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js');
  const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  // ── 3. 取日期（預設今天，可手動輸入過去日期補抓）─────────
  const todayStr = new Date().toLocaleDateString('sv-SE');
  const inputDate = prompt(
    `[補課系統] 要同步哪一天？（YYYY-MM-DD，直接按確定＝今天 ${todayStr}）`,
    todayStr
  );
  // 使用者按取消
  if (inputDate === null) { return; }
  const trimmedDate = inputDate.trim();
  const isValidDate = /^\d{4}-\d{2}-\d{2}$/.test(trimmedDate);
  if (!isValidDate) {
    alert(`[補課系統] 「${trimmedDate}」不是有效日期格式（要 YYYY-MM-DD），已改用今天 ${todayStr}，請重新點書籤再試一次。`);
    return;
  }
  const dateStr = trimmedDate;

  // ── 4. 選要同步哪個班（從我方已建檔的班級清單選，不依賴 zenclass 當日排課查詢）───
  const { data: classes, error: clsErr } = await sb.rpc('list_audit_classes');
  if (clsErr) { alert(`[補課系統] 取班別清單失敗：${clsErr.message}`); return; }
  if (!classes || !classes.length) {
    alert('[補課系統] 目前沒有已建檔的班別，請先到後台「班別設定」建班。');
    return;
  }

  let targetClass = classes[0];
  if (classes.length > 1) {
    const options = classes.map((c, i) => `${i + 1}. ${c.class_name}（${c.status}）`).join('\n');
    const pick = prompt(`[補課系統] ${dateStr} 要同步哪個班？請輸入編號：\n${options}`);
    const idx = parseInt(pick, 10) - 1;
    if (isNaN(idx) || idx < 0 || idx >= classes.length) {
      alert('[補課系統] 取消同步。');
      return;
    }
    targetClass = classes[idx];
  }

  // ── 4b. 防呆：MANUAL 佔位代碼還沒綁定真代碼，不能同步 ─────────
  if (targetClass.class_id.startsWith('MANUAL-')) {
    alert(`[補課系統] ${targetClass.class_name}：尚未綁定 zenclass 真代碼，無法同步（請到後台「班別設定」綁定）`);
    return;
  }

  // ── 5. 直接用該班 class_id 取當天報到名單（class_attend_records 對過去日期可靠）──
  const includes = [
    'attendMark','memberId','aliasName','ctDharmaName',
    'classGroupId','memberGroupNum','attendCheckinDtTm',
    'classId','className','classStartTime','classEndTime','dayOfWeek','isDroppedClass',
  ].join(',');

  const attendUrl = `${API_BASE}/meditation/api/kiosk/class_attend_records`
    + `?classDate=${dateStr}&classId=${targetClass.class_id}&includes=${encodeURIComponent(includes)}`;
  const attendRes = await fetch(attendUrl, { credentials: 'include' });
  const attendJson = await attendRes.json();
  if (attendJson.errCode !== 200) {
    alert(`[補課系統] 取報到名單失敗 (errCode ${attendJson.errCode})`);
    return;
  }
  const records = attendJson.items || [];

  // ── 6. 組好 p_class / p_records（p_class 直接用我方資料庫已有的班別資料，
  //       不再依賴 zenclass 當日排課查詢；period_num/week_num 這種「第幾堂」資訊
  //       交給我方 sessions 自己依日期排序算，不需要 zenclass 提供）───
  const p_class = {
    class_id:     targetClass.class_id,
    class_name:   targetClass.class_name,
    level:        targetClass.level || null,
    day_night:    targetClass.day_night || null,
    day_of_week:  targetClass.day_of_week || null,
    start_time:   targetClass.start_time || null,
    end_time:     targetClass.end_time || null,
    period_num:   null,
    week_num:     null,
    is_cancelled: false,
  };

  if (!records.length) {
    alert(`[補課系統] ${targetClass.class_name}（${dateStr}）名單為空，仍會建立堂次紀錄。`);
  }

  const p_records = records
    .filter(r => r.isDroppedClass !== true)   // 已退班的人不寫入，避免舊生混進現有名單
    .map(r => ({
      member_id:    r.memberId,
      name:         r.aliasName || '',
      dharma_name:  r.ctDharmaName || '',
      group_id:     r.classGroupId || '',
      group_num:    r.memberGroupNum || '',
      mark:         r.attendMark || null,
      checkin_time: r.attendCheckinDtTm || null,
      is_dropped:   r.isDroppedClass === true,
    }));

  // ── 7. 呼叫 RPC（SECURITY DEFINER，繞過 RLS 直接寫表）──
  const { data: result, error: ingestErr } = await sb.rpc('ingest_kiosk_attendance', {
    p_unit_id: UNIT_ID,
    p_date:    dateStr,
    p_class,
    p_records,
  });
  if (ingestErr) { alert(`[補課系統] 同步失敗：${ingestErr.message}`); return; }

  alert(`[補課系統] ✅ 同步完成！\n班別：${targetClass.class_name}\n日期：${dateStr}\n已同步：${result.synced ?? 0} 筆`);
})();
