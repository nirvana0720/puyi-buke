// 職責：現場登記共用：判斷輸入框是編號還是姓名、即時姓名搜尋建議清單、撞名時的挑人畫面——
// 補課／培訓補課／日夜補三個表單共用，不要各寫一份

'use strict';

async function kioskLookupMemberByName(sb, staffId, name) {
  const { data, error } = await sb.rpc('kiosk_lookup_member_by_name', { p_staff_id: staffId, p_name: name });
  if (error) throw new Error(error.message);
  return data || { found: false };
}

async function kioskSearchMembersByName(sb, staffId, query, limit) {
  const { data, error } = await sb.rpc('kiosk_search_members_by_name', {
    p_staff_id: staffId, p_query: query, p_limit: limit || 15,
  });
  if (error) throw new Error(error.message);
  return data || [];
}

/**
 * 輸入框同時支援 9 碼編號或姓名：含連續 9 碼數字＝當編號查（沿用 window.KioskLogic.kioskLookupMember），
 * 否則當姓名查。撞名時在 resultEl 顯示大按鈕清單，義工點選後改用該學員 9 碼編號重新查一次
 * （沿用既有編號查詢與下游渲染，不重複邏輯）。查到結果（不論一開始就查到、或挑人後查到）一律呼叫
 * onFound(result) 交給呼叫端渲染登記表單。
 */
async function kioskSmartLookup(sb, staffId, rawInput, { resultEl, msgEl, onFound }) {
  msgEl.textContent = '';
  resultEl.innerHTML = '';

  const digits = (rawInput.match(/\d{9}/) || [])[0];
  if (digits) {
    const result = await window.KioskLogic.kioskLookupMember(sb, staffId, digits);
    if (!result.found) {
      msgEl.textContent = `查無學員：${result.reason || ''}`;
      msgEl.style.color = 'var(--danger-tx)';
      return;
    }
    onFound(result);
    return;
  }

  const name = rawInput.trim();
  if (!name) {
    msgEl.textContent = '請輸入 9 碼編號或姓名';
    msgEl.style.color = 'var(--danger-tx)';
    return;
  }

  const byName = await kioskLookupMemberByName(sb, staffId, name);
  if (byName.found) { onFound(byName); return; }

  if (byName.multiple && (byName.candidates || []).length) {
    renderNameCandidates(resultEl, byName.candidates, async (candidateMemberId) => {
      await _resolveAndFound(sb, staffId, candidateMemberId, { resultEl, msgEl, onFound });
    }, `查到 ${byName.candidates.length} 位同名學員，請確認是哪一位：`);
    return;
  }

  msgEl.textContent = `查無學員：${byName.reason || ''}`;
  msgEl.style.color = 'var(--danger-tx)';
}

/** 用 member_id 查完整資料→找不到就顯示錯誤→找到就 onFound，供撞名點選、即時搜尋點選共用 */
async function _resolveAndFound(sb, staffId, memberId, { resultEl, msgEl, onFound }) {
  resultEl.innerHTML = '<p style="color:var(--muted);font-size:14px">查詢中…</p>';
  const result = await window.KioskLogic.kioskLookupMember(sb, staffId, memberId);
  if (!result.found) {
    resultEl.innerHTML = '';
    msgEl.textContent = `查無學員：${result.reason || ''}`;
    msgEl.style.color = 'var(--danger-tx)';
    return;
  }
  onFound(result);
}

/** 撞名／即時搜尋共用的挑人畫面：大按鈕（姓名＋班別），長輩義工用點的、不用打字挑、不用看下拉選單
 *  introText 可選：撞名清單需要「查到 N 位同名學員」提示文字，即時建議清單不需要 */
function renderNameCandidates(container, candidates, onPick, introText) {
  container.innerHTML = `
    ${introText ? `<div style="font-size:14px;color:var(--muted);margin-bottom:8px">${introText}</div>` : ''}
    <div style="display:flex;flex-direction:column;gap:8px">
      ${candidates.map((c, i) => `
        <button type="button" class="buke-btn buke-btn-ghost cand-btn" data-i="${i}"
                style="text-align:left;padding:14px 16px;font-size:16px;width:100%">
          ${c.name}　<span style="color:var(--muted);font-size:14px">${c.class_name || '—'}</span>
        </button>`).join('')}
    </div>`;
  container.querySelectorAll('.cand-btn').forEach(btn => {
    btn.addEventListener('click', () => onPick(candidates[Number(btn.dataset.i)].member_id));
  });
}

/**
 * 掛在輸入框上：打字（含連續 9 碼數字時不觸發，因為那是編號路徑，交給 submit 送出）就 debounce
 * 300ms 後查 kiosk_search_members_by_name，結果顯示在 suggestEl（大按鈕清單，沿用撞名同一套
 * renderNameCandidates）。點下去＝直接完成查詢：清空輸入框跟建議清單、呼叫 onFound。
 * 查詢失敗（網路等）靜默略過，不影響義工改用「打完整姓名按查詢」或「打編號」這兩條備用路徑。
 */
function attachLiveNameSearch(sb, getStaffId, { inputEl, suggestEl, resultEl, msgEl, onFound }) {
  let timer = null;
  inputEl.addEventListener('input', () => {
    clearTimeout(timer);
    const raw    = inputEl.value;
    const digits = (raw.match(/\d{9}/) || [])[0];
    const query  = raw.trim();
    if (digits || !query) { suggestEl.innerHTML = ''; return; }
    timer = setTimeout(async () => {
      try {
        const staffId = getStaffId();
        const list = await kioskSearchMembersByName(sb, staffId, query);
        if (!list.length) { suggestEl.innerHTML = ''; return; }
        renderNameCandidates(suggestEl, list, (memberId) => {
          suggestEl.innerHTML = '';
          inputEl.value = '';
          _resolveAndFound(sb, staffId, memberId, { resultEl, msgEl, onFound });
        });
      } catch (_) { /* 即時建議失敗就靜默略過 */ }
    }, 300);
  });
}

if (typeof window !== 'undefined') {
  window.KioskNameSearch = { kioskSmartLookup, attachLiveNameSearch };
}
