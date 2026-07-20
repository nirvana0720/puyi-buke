// 職責：稽核比對書籤（唯讀）—— 把我方整期出缺勤快照跟官方 zenclass 報到系統逐堂比對，產出差異報告 CSV
// 不負責：資料同步/寫入（那是 grabber/bookmarklet.js 的職責，本檔全程不呼叫任何寫入 RPC）

// ================================================================
// 使用方式：
// 1. 複製 config/config.example.js 為 config.js，填入真實 Supabase URL/anonKey
// 2. 執行下方 build 指令，產出壓縮的書籤字串：
//    node grabber/bookmarklet_build.js audit_bookmarklet.js
// 3. 在 Chrome 書籤列新增書籤，網址填入產出的 javascript:... 字串
// 4. 在 zenclass kiosk（已登入）開著時點書籤 → 選班別 → 跑完自動下載差異報告 CSV
// ================================================================

(async function PUYI_AUDIT() {
  // ── 0. 設定（填入真實值）────────────────────────────────────
  var SUPABASE_URL      = 'REPLACE_YOUR_PROJECT_URL';
  var SUPABASE_ANON_KEY = 'REPLACE_YOUR_ANON_KEY';
  var API_BASE           = 'https://zenclass.ctcm.org.tw';

  // ── 1. 確認在正確頁面 ──────────────────────────────────────
  if (location.href.indexOf('zenclass.ctcm.org.tw') === -1) {
    alert('[補課系統] 請在 zenclass kiosk 頁面使用此書籤！');
    return;
  }

  // ── 2. 載入 supabase-js（CDN）──────────────────────────────
  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      if (document.querySelector('script[src="' + src + '"]')) { resolve(); return; }
      var s = document.createElement('script');
      s.src = src; s.onload = resolve; s.onerror = reject;
      document.head.appendChild(s);
    });
  }
  await loadScript('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js');
  var sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  // ── 3. 選要稽核的班別 ────────────────────────────────────────
  var clsRes = await sb.rpc('list_audit_classes');
  var clsErr = clsRes.error;
  if (clsErr) { alert('[補課系統] 取班別清單失敗：' + clsErr.message); return; }
  // 已結業班別不需要再稽核，只在這支「稽核比對」書籤自己過濾（不動共用的 list_audit_classes
  // RPC，那支還要給 grabber/bookmarklet.js 同步書籤補抓過去日期用，已結業班別對那個功能還有用）
  var classes = (clsRes.data || []).filter(function (c) { return c.status !== '已結業'; });
  if (!classes.length) {
    alert('[補課系統] 目前沒有可稽核的班別。');
    return;
  }

  var options = classes.map(function (c, i) {
    return (i + 1) + '. ' + c.class_name + '（' + c.status + '）';
  }).join('\n');
  var pick = prompt(
    '[補課系統] 請選擇要稽核的班別，輸入編號。\n'
    + '可一次稽核多班，用「、」或「,」分隔（例如：1、2、3）：\n' + options
  );
  if (pick === null) { alert('[補課系統] 已取消稽核。'); return; }

  // 支援全形頓號、半形逗號、全形逗號三種分隔符號；去重、去無效編號
  var seenIdx = new Set();
  var targetClasses = [];
  pick.split(/[、,，]/).forEach(function (s) {
    var idx = parseInt(s.trim(), 10) - 1;
    if (isNaN(idx) || idx < 0 || idx >= classes.length) return;
    if (seenIdx.has(idx)) return;
    seenIdx.add(idx);
    targetClasses.push(classes[idx]);
  });
  if (!targetClasses.length) {
    alert('[補課系統] 輸入的編號無效，已取消稽核。');
    return;
  }

  // ── 4. 浮動進度提示 ──────────────────────────────────────────
  var overlay = document.createElement('div');
  overlay.id = 'puyi-audit-overlay';
  overlay.style.cssText = 'position:fixed;right:16px;bottom:16px;z-index:999999;'
    + 'background:#fff;color:#000;padding:10px 16px;border-radius:6px;'
    + 'box-shadow:0 2px 10px rgba(0,0,0,.3);font-size:14px;font-family:sans-serif';
  document.body.appendChild(overlay);
  function setProgress(text) { overlay.textContent = text; }

  var includes = [
    'attendMark', 'memberId', 'aliasName', 'ctDharmaName',
    'classGroupId', 'memberGroupNum', 'attendCheckinDtTm',
    'classId', 'className', 'classStartTime', 'classEndTime', 'dayOfWeek', 'isDroppedClass'
  ].join(',');

  var allDiffRows = [];   // 所有班別合併的差異列，每列額外帶 class_name
  var totalSessions = 0;
  var skippedClasses = [];   // { class_name, reason }

  // ── 5. 依序稽核每一個選到的班別（班與班之間也不平行，避免打爆官方 API）──
  for (var ci = 0; ci < targetClasses.length; ci++) {
    var targetClass = targetClasses[ci];
    var classProgressPrefix = '班別 ' + (ci + 1) + '/' + targetClasses.length + '：' + targetClass.class_name + '　';
    setProgress(classProgressPrefix + '準備中…');

    // 5a. 防呆：MANUAL 佔位代碼還沒綁定真代碼，不能稽核，記錄下來最後一起報告
    if (targetClass.class_id.indexOf('MANUAL-') === 0) {
      skippedClasses.push({ class_name: targetClass.class_name, reason: '尚未綁定 zenclass 真代碼' });
      continue;
    }

    // 5b. 取我方目前資料庫快照
    var snapRes = await sb.rpc('get_class_audit_snapshot', { p_class_ref: targetClass.class_ref });
    var snapshot = snapRes.data;
    var snapErr = snapRes.error;
    if (snapErr) {
      skippedClasses.push({ class_name: targetClass.class_name, reason: '取快照失敗：' + snapErr.message });
      continue;
    }

    var sessions = snapshot.sessions || [];
    if (!sessions.length) {
      skippedClasses.push({ class_name: targetClass.class_name, reason: '尚無已上課次' });
      continue;
    }
    totalSessions += sessions.length;

    // 5c. 名冊現況（判斷已休學，避免舊生缺漏被誤判成異常）
    var rosterMap = new Map();
    var roster = snapshot.roster || [];
    for (var ri = 0; ri < roster.length; ri++) {
      rosterMap.set(roster[ri].member_id, roster[ri].status || '');
    }

    // 5d. 依序（不平行）逐堂呼叫官方 API 並比對
    var done = 0;
    for (var si = 0; si < sessions.length; si++) {
      var sess = sessions[si];
      done++;
      setProgress(classProgressPrefix + '第 ' + done + ' / ' + sessions.length + ' 堂：' + sess.date);

      var attendUrl = API_BASE + '/meditation/api/kiosk/class_attend_records'
        + '?classDate=' + sess.date + '&classId=' + snapshot.class_id
        + '&includes=' + encodeURIComponent(includes);

      var officialRecords;
      try {
        var res = await fetch(attendUrl, { credentials: 'include' });
        var json = await res.json();
        if (json.errCode !== 200) {
          allDiffRows.push({ class_name: targetClass.class_name, date: sess.date, member_id: '', name: '', status: '', official_mark: '', our_mark: '', source: '', type: '該日官方查詢失敗' });
          continue;
        }
        officialRecords = json.items || [];
      } catch (e) {
        allDiffRows.push({ class_name: targetClass.class_name, date: sess.date, member_id: '', name: '', status: '', official_mark: '', our_mark: '', source: '', type: '該日官方查詢失敗' });
        continue;
      }

      // 官方名單：member_id → { mark, name }（已退班的人濾掉，比對結果只看現在真的在學的人）
      var officialMap = new Map();
      for (var oi = 0; oi < officialRecords.length; oi++) {
        var r = officialRecords[oi];
        if (r.isDroppedClass === true) continue;
        officialMap.set(r.memberId, { mark: r.attendMark || '', name: r.aliasName || '' });
      }
      // 我方快照：member_id → { mark, source }
      var ourMap = new Map();
      var sessMembers = sess.members || [];
      for (var mi = 0; mi < sessMembers.length; mi++) {
        var m = sessMembers[mi];
        ourMap.set(m.member_id, { mark: m.mark || '', source: m.source || '' });
      }

      var allIds = new Set(Array.from(officialMap.keys()).concat(Array.from(ourMap.keys())));
      var idsIter = Array.from(allIds);
      for (var ii = 0; ii < idsIter.length; ii++) {
        var memberId = idsIter[ii];
        var off = officialMap.get(memberId);
        var our = ourMap.get(memberId);

        var memberStatus = rosterMap.get(memberId) || '';
        var isLeft = memberStatus === '休學';

        if (off && !our) {
          allDiffRows.push({
            class_name: targetClass.class_name, date: sess.date, member_id: memberId, name: off.name, status: memberStatus,
            official_mark: off.mark, our_mark: '', source: '',
            type: isLeft ? '缺漏（已休學，略過）' : '缺漏'
          });
          continue;
        }

        if (off && our) {
          // 官方對「沒來的人」通常留空、不主動記碼；我方規則是空白＝O。
          // 官方空白 ＋ 我方 O，代表同一件事（都是缺席），視為一致，不算不一致。
          var isSameAbsence = off.mark === '' && our.mark === 'O';
          if (off.mark === our.mark || isSameAbsence) continue; // 完全一致，不列入

          var isManuallyConfirmed = our.source === 'manual' && ['V', 'L', 'ML', 'M'].indexOf(our.mark) !== -1;
          allDiffRows.push({
            class_name: targetClass.class_name, date: sess.date, member_id: memberId, name: off.name, status: memberStatus,
            official_mark: off.mark, our_mark: our.mark, source: our.source,
            type: isLeft ? '不一致（已休學，略過）' : (isManuallyConfirmed ? '已人工確認差異（略過）' : '不一致')
          });
          continue;
        }

        if (!off && our) {
          allDiffRows.push({
            class_name: targetClass.class_name, date: sess.date, member_id: memberId, name: '', status: memberStatus,
            official_mark: '', our_mark: our.mark, source: our.source,
            type: isLeft ? '官方無此人（已休學，略過）' : '官方無此人'
          });
        }
      }
    }
  }

  overlay.remove();

  // ── 6. 總結 alert + 合併所有班別的 CSV 匯出 ─────────────────────
  var missingCount = allDiffRows.filter(function (r) { return r.type === '缺漏'; }).length;
  var mismatchCount = allDiffRows.filter(function (r) { return r.type === '不一致'; }).length;
  var confirmedCount = allDiffRows.filter(function (r) { return r.type === '已人工確認差異（略過）'; }).length;
  var leftCount = allDiffRows.filter(function (r) { return r.type.indexOf('已休學，略過') !== -1; }).length;

  var summary = '稽核完成：共查 ' + targetClasses.length + ' 班、' + totalSessions + ' 堂。';
  if (allDiffRows.length) {
    summary += '缺漏 ' + missingCount + ' 筆、不一致 ' + mismatchCount + ' 筆、'
      + '已人工確認差異 ' + confirmedCount + ' 筆、已休學舊生 ' + leftCount + ' 筆（後兩者略過不算異常）。';
  } else {
    summary += '🎉 完全吻合';
  }
  if (skippedClasses.length) {
    summary += '\n\n以下班別未稽核：\n' + skippedClasses.map(function (s) {
      return '・' + s.class_name + '：' + s.reason;
    }).join('\n');
  }
  alert('[補課系統] ' + summary);

  if (!allDiffRows.length) return;   // 完全吻合就不用產生一份空白 CSV

  var header = ['班別', '日期', '學員編號', '姓名', '目前狀態', '官方標記', '我方標記', '我方來源', '差異類型'];
  var lines = allDiffRows.map(function (r) {
    return [r.class_name, r.date, r.member_id, r.name, r.status, r.official_mark, r.our_mark, r.source, r.type]
      .map(function (v) { return '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"'; })
      .join(',');
  });
  var csv = [header.join(',')].concat(lines).join('\n');
  var blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a');
  a.href = url;
  var fileLabel = targetClasses.length === 1 ? targetClasses[0].class_name : (targetClasses.length + '班');
  a.download = '稽核比對_' + fileLabel + '_' + new Date().toLocaleDateString('sv-SE') + '.csv';
  a.click();
  URL.revokeObjectURL(url);
})();
