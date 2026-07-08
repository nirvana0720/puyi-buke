// 職責：書籤腳本（bookmarklet）── 一鍵版，自動判斷「今天星期符合的班」全部一次同步，日常主要使用。
// 不負責：手動指定過去日期／手動挑班別（那是 grabber/bookmarklet.js 的職責，本檔自動判斷不到時才退回那套邏輯）。
//
// 2026-07-06：一天可能有早晚兩班（例如三日/三夜同一天不同時段），不看「現在幾點」猜只抓一班，
// 改成不管幾點點，只要是「今天星期符合」的進行中班別，全部一次抓完，一次點擊就能同步當天全部班別。

(async function PUYI_SYNC_QUICK() {
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

  // ── 3. 固定用今天，不彈 prompt 問日期 ────────────────────────
  const dateStr = new Date().toLocaleDateString('sv-SE');

  // ── 4. 取我方已建檔的班別清單（跟現有書籤同一支 RPC）─────────
  const { data: classes, error: clsErr } = await sb.rpc('list_audit_classes');
  if (clsErr) { alert(`[補課系統] 取班別清單失敗：${clsErr.message}`); return; }
  if (!classes || !classes.length) {
    alert('[補課系統] 目前沒有已建檔的班別，請先到後台「班別設定」建班。');
    return;
  }
  const activeClasses = classes.filter(c => c.status === '進行中');
  if (!activeClasses.length) {
    alert('[補課系統] 目前沒有「進行中」的班別，請先到後台「班別設定」確認班別狀態。');
    return;
  }

  // ── 5. 同步單一班別（比照 bookmarklet.js 現有寫法，抽成函式供迴圈呼叫）─────
  const includes = [
    'attendMark','memberId','aliasName','ctDharmaName',
    'classGroupId','memberGroupNum','attendCheckinDtTm',
    'classId','className','classStartTime','classEndTime','dayOfWeek','isDroppedClass',
  ].join(',');

  async function syncOneClass(targetClass) {
    if (targetClass.class_id.startsWith('MANUAL-')) {
      throw new Error('尚未綁定 zenclass 真代碼，無法同步（請到後台「班別設定」綁定）');
    }
    const attendUrl = `${API_BASE}/meditation/api/kiosk/class_attend_records`
      + `?classDate=${dateStr}&classId=${targetClass.class_id}&includes=${encodeURIComponent(includes)}`;
    const attendRes = await fetch(attendUrl, { credentials: 'include' });
    const attendJson = await attendRes.json();
    if (attendJson.errCode !== 200) {
      throw new Error(`取報到名單失敗 (errCode ${attendJson.errCode})`);
    }
    const records = attendJson.items || [];

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

    const { data: result, error: ingestErr } = await sb.rpc('ingest_kiosk_attendance', {
      p_unit_id: UNIT_ID,
      p_date:    dateStr,
      p_class,
      p_records,
    });
    if (ingestErr) throw new Error(ingestErr.message);
    return result.synced ?? 0;
  }

  // ── 5b. 同步前自動嘗試綁定 MANUAL 佔位班（用 class_date_infos 比對班名，
  //       這支在「現在正在上課附近」成功率高，點「同步今日」通常就是這個時機）───
  async function tryAutoBind(cls, dateInfos) {
    const match = (dateInfos || []).find(it => it.className === cls.class_name);
    if (!match) return { ok: false, reason: 'no_match' };
    const { data: bindResult, error: bindErr } = await sb.rpc('auto_bind_class_id', {
      p_class_ref: cls.class_ref,
      p_class_id:  match.classId,
    });
    if (bindErr) throw new Error(bindErr.message);
    return bindResult;
  }

  // ── 6. 自動篩選「今天星期符合的班」（不判斷現在幾點，只看星期）─────────
  const dowStr = ['日','一','二','三','四','五','六'][new Date().getDay()];
  const matchedClasses = activeClasses.filter(c => c.day_of_week === dowStr);

  if (matchedClasses.length) {
    // 這批裡若有 MANUAL 佔位班，先查一次 class_date_infos 供比對班名嘗試自動綁定
    let dateInfos = [];
    if (matchedClasses.some(c => c.class_id.startsWith('MANUAL-'))) {
      try {
        const infoUrl = `${API_BASE}/meditation/api/kiosk/class_date_infos?unitId=${UNIT_ID}&classDate=${dateStr}`;
        const infoRes  = await fetch(infoUrl, { credentials: 'include' });
        const infoJson = await infoRes.json();
        if (infoJson.errCode === 200) dateInfos = infoJson.items || [];
      } catch (e) { /* 查不到就維持空陣列，交給下面的「尚未綁定」訊息處理 */ }
    }

    // ≥1 筆 → 依序（不平行）逐一同步每一班，其中一班失敗不中斷整輪
    const summaryLines = [];
    for (const cls of matchedClasses) {
      if (cls.class_id.startsWith('MANUAL-')) {
        try {
          const bindResult = await tryAutoBind(cls, dateInfos);
          if (bindResult.ok) {
            cls.class_id = (dateInfos.find(it => it.className === cls.class_name) || {}).classId;
            const synced = await syncOneClass(cls);
            summaryLines.push(`・${cls.class_name}：✅ 首次綁定成功並同步：${synced} 筆`);
          } else if (bindResult.reason === 'conflict') {
            summaryLines.push(`・${cls.class_name}：⚠ 真代碼被其他班占用，請到後台「班別設定」手動處理合併`);
          } else {
            summaryLines.push(`・${cls.class_name}：⚠ 尚未綁定 zenclass 真代碼，無法同步（下次上課時間點同步書籤會自動嘗試綁定）`);
          }
        } catch (e) {
          summaryLines.push(`・${cls.class_name}：❌ ${e.message}`);
        }
        continue;
      }
      try {
        const synced = await syncOneClass(cls);
        summaryLines.push(`・${cls.class_name}：${synced} 筆`);
      } catch (e) {
        summaryLines.push(`・${cls.class_name}：❌ ${e.message}`);
      }
    }
    alert(`[補課系統] ✅ 今日同步完成（${dateStr}）\n${summaryLines.join('\n')}`);
    return;
  }

  // ── 7. 0 筆符合 → 退回手動選擇（比照 bookmarklet.js 現有邏輯）─────────
  const options = activeClasses.map((c, i) => `${i + 1}. ${c.class_name}`).join('\n');
  const pick = prompt(
    `[補課系統] ⚠ 找不到今天星期符合的班，請手動選擇：\n${dateStr} 要同步哪個班？請輸入編號：\n${options}`
  );
  const idx = parseInt(pick, 10) - 1;
  if (isNaN(idx) || idx < 0 || idx >= activeClasses.length) {
    alert('[補課系統] 取消同步。');
    return;
  }
  const targetClass = activeClasses[idx];

  try {
    const synced = await syncOneClass(targetClass);
    alert(`[補課系統] ✅ 同步完成！\n班別：${targetClass.class_name}\n日期：${dateStr}\n已同步：${synced} 筆`);
  } catch (e) {
    alert(`[補課系統] 同步失敗：${e.message}`);
  }
})();
