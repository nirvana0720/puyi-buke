// 職責：現場登記共用：判斷輸入框是編號還是姓名、撞名時的挑人畫面——補課／培訓補課／日夜補
// 三個表單共用，不要各寫一份

'use strict';

async function kioskLookupMemberByName(sb, staffId, name) {
  const { data, error } = await sb.rpc('kiosk_lookup_member_by_name', { p_staff_id: staffId, p_name: name });
  if (error) throw new Error(error.message);
  return data || { found: false };
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
      resultEl.innerHTML = '<p style="color:var(--muted);font-size:14px">查詢中…</p>';
      const result = await window.KioskLogic.kioskLookupMember(sb, staffId, candidateMemberId);
      if (!result.found) {
        resultEl.innerHTML = '';
        msgEl.textContent = `查無學員：${result.reason || ''}`;
        msgEl.style.color = 'var(--danger-tx)';
        return;
      }
      onFound(result);
    });
    return;
  }

  msgEl.textContent = `查無學員：${byName.reason || ''}`;
  msgEl.style.color = 'var(--danger-tx)';
}

/** 撞名挑人畫面：大按鈕（姓名＋班別），長輩義工用點的、不用打字挑、不用看下拉選單 */
function renderNameCandidates(container, candidates, onPick) {
  container.innerHTML = `
    <div style="font-size:14px;color:var(--muted);margin-bottom:8px">
      查到 ${candidates.length} 位同名學員，請確認是哪一位：
    </div>
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

if (typeof window !== 'undefined') {
  window.KioskNameSearch = { kioskSmartLookup };
}
