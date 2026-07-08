// 職責：學員狀態異動（setMemberStatus）—— 停修/恢復
// 不負責：出席計算、補課邏輯、DOM 渲染

'use strict';

/**
 * 更新學員狀態（在學 ↔ 停修）
 * @param {object} sb          supabase client
 * @param {number} memberDbId  members.id（Supabase PK）
 * @param {'在學'|'停修'} status
 * @returns {Promise<void>}
 */
async function setMemberStatus(sb, memberDbId, status) {
  if (status !== '在學' && status !== '休學') {
    throw new Error(`無效的狀態值：${status}`);
  }
  const { error } = await sb
    .from('members')
    .update({ status })
    .eq('id', memberDbId);
  if (error) throw new Error(`更新學員狀態失敗：${error.message}`);
}

if (typeof window !== 'undefined') window.MemberService = { setMemberStatus };
if (typeof module !== 'undefined') module.exports = { setMemberStatus };
