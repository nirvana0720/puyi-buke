-- 職責：自動化測試專用種子資料 + 測試輔助 RPC（test_ 開頭）
-- ⚠️ 只能貼在「測試專案」的 SQL Editor 執行，絕對不要貼到正式環境！
--    正式環境網址是 puyi-buke.vercel.app 用的那個 Supabase 專案，跟這個測試專案是分開的兩個。
--
-- 用途：給 test/run.js 自動化測試用。日期用「今天」往前推算（CURRENT_DATE - N），
--       不管哪一天執行都有效，不會像固定日期的 db/seed_test_data.sql 那樣過一段時間就失效。
--
-- 執行前提：這個測試專案要先貼過 db/full_setup_all_in_one.sql 建好 16 張表、66 支函式。
--
-- 可重複執行：開頭會先清掉同一批測試資料（member_id 用 9 開頭，不會撞到真實學號）再重建。

BEGIN;

-- 先清掉舊的測試資料（cascade 會連帶刪 members / sessions / attendance）
DELETE FROM classes WHERE unit_id = 'TESTUNIT' AND class_id = 'TEST-CLASS-01';
DELETE FROM staff_accounts WHERE username = 'test_staff';

-- 1) 測試用義工帳號（kiosk_* 系列函式都要求 p_staff_id 是有效義工才能呼叫）
INSERT INTO staff_accounts (username, password_hash, display_name, role, is_active)
VALUES ('test_staff', 'not_a_real_hash_only_for_test', '測試義工', 'volunteer', true);

-- 2) 測試班 + 2 名測試學員（member_id 用 900000001/900000002，一看就知道是測試用）
WITH c AS (
  INSERT INTO classes (unit_id, class_id, class_name, level, day_of_week, day_night, total_sessions, teacher)
  VALUES ('TESTUNIT', 'TEST-CLASS-01', '測試班', '中', '三', '夜', 20, '測試法師')
  RETURNING id
)
INSERT INTO members (member_id, name, dharma_name, gender, group_id, group_num, class_ref)
SELECT v.member_id, v.name, v.dharma_name, v.gender, v.group_id, v.group_num, c.id
FROM c, (VALUES
  ('900000001', '測試甲', '傳測', '男', '男1組', '1-1'),
  ('900000002', '測試乙', '傳試', '女', '女1組', '1-1')
) AS v(member_id, name, dharma_name, gender, group_id, group_num);

-- 3) 兩堂課：10 天前（用來測缺課補課期限）、今天（用來測「今天調班/補課」不被誤擋）
INSERT INTO sessions (class_ref, date, week_num, is_held)
SELECT cl.id, d.date, d.wk, true
FROM classes cl, (VALUES
  (CURRENT_DATE - 10, 1),
  (CURRENT_DATE,       2)
) AS d(date, wk)
WHERE cl.unit_id = 'TESTUNIT' AND cl.class_id = 'TEST-CLASS-01';

-- 4) 出勤：測試甲 10 天前缺課(O)，其餘都出席
INSERT INTO attendance (member_ref, session_ref, mark, source)
SELECT mem.id, ses.id,
  CASE WHEN mem.member_id = '900000001' AND ses.date = CURRENT_DATE - 10 THEN 'O' ELSE 'V' END,
  'api'
FROM members mem
JOIN classes  cl  ON cl.id  = mem.class_ref
JOIN sessions ses ON ses.class_ref = cl.id
WHERE cl.unit_id = 'TESTUNIT' AND cl.class_id = 'TEST-CLASS-01';

COMMIT;

-- ============================================================
-- 測試輔助 RPC（只存在於測試專案，正式環境不需要也不會有這兩支）
-- ============================================================

-- test_get_seed_ids：把上面種下去的資料實際拿到的自動編號（BIGSERIAL id）撈出來，
-- 讓 run.js 不用猜 id，呼叫這支就能拿到所有測試要用的 id。
CREATE OR REPLACE FUNCTION test_get_seed_ids()
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'staff_id',        (SELECT id FROM staff_accounts WHERE username = 'test_staff'),
    'class_id',        (SELECT id FROM classes WHERE unit_id = 'TESTUNIT' AND class_id = 'TEST-CLASS-01'),
    'member_甲_id',     (SELECT id FROM members WHERE member_id = '900000001'),
    'member_甲_code',   '900000001',
    'member_乙_id',     (SELECT id FROM members WHERE member_id = '900000002'),
    'session_absent_id', (SELECT s.id FROM sessions s JOIN classes c ON c.id = s.class_ref
                           WHERE c.unit_id = 'TESTUNIT' AND c.class_id = 'TEST-CLASS-01' AND s.date = CURRENT_DATE - 10),
    'session_today_id',  (SELECT s.id FROM sessions s JOIN classes c ON c.id = s.class_ref
                           WHERE c.unit_id = 'TESTUNIT' AND c.class_id = 'TEST-CLASS-01' AND s.date = CURRENT_DATE),
    'absence_date',      (CURRENT_DATE - 10)
  );
$$;
REVOKE EXECUTE ON FUNCTION test_get_seed_ids() FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION test_get_seed_ids() TO anon;

-- test_get_member_group：只給測試用來核對 group_id 有沒有被覆蓋（kiosk_lookup_member
-- 等正式 RPC 不會回傳 group_id，前端本來就不需要，所以另外開一支小的驗證用）。
CREATE OR REPLACE FUNCTION test_get_member_group(p_member_id text)
RETURNS text
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT group_id FROM members WHERE member_id = p_member_id LIMIT 1;
$$;
REVOKE EXECUTE ON FUNCTION test_get_member_group(text) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION test_get_member_group(text) TO anon;

-- ============================================================
-- 2026-11-25 新增：櫃台「撤銷這筆」（kiosk_undo_makeup_attendance）測試用輔助 RPC
-- ============================================================

-- test_reset_makeup：把某學員某堂的補課登記清掉重建成「待補課」、出勤還原成 O，回傳新的 makeup id
CREATE OR REPLACE FUNCTION test_reset_makeup(p_member_db_id bigint, p_session_ref bigint)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_id bigint;
BEGIN
  DELETE FROM makeup_attendances WHERE makeup_ref IN (
    SELECT id FROM makeups WHERE member_ref = p_member_db_id AND session_ref = p_session_ref);
  DELETE FROM makeups WHERE member_ref = p_member_db_id AND session_ref = p_session_ref;
  UPDATE attendance SET mark = 'O', source = 'api', updated_at = now()
   WHERE member_ref = p_member_db_id AND session_ref = p_session_ref;
  INSERT INTO makeups (member_ref, session_ref, method, earliest_date, deadline_date, status, registered_by)
  VALUES (p_member_db_id, p_session_ref, '影音', CURRENT_DATE - 10, CURRENT_DATE + 30, '待補課', '櫃台')
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;
REVOKE EXECUTE ON FUNCTION test_reset_makeup(bigint, bigint) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION test_reset_makeup(bigint, bigint) TO anon;

-- test_get_makeup_state：回傳補課狀態、完成日、對應出勤代碼、到場紀錄筆數
CREATE OR REPLACE FUNCTION test_get_makeup_state(p_makeup_id bigint)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'status',           mk.status,
    'completed_date',   mk.completed_date,
    'mark',             (SELECT a.mark FROM attendance a
                          WHERE a.member_ref = mk.member_ref AND a.session_ref = mk.session_ref),
    'attendance_count', (SELECT count(*) FROM makeup_attendances ma WHERE ma.makeup_ref = mk.id)
  )
  FROM makeups mk WHERE mk.id = p_makeup_id;
$$;
REVOKE EXECUTE ON FUNCTION test_get_makeup_state(bigint) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION test_get_makeup_state(bigint) TO anon;

-- test_shift_attendance_days：把某筆到場紀錄的時間往前推 N 天（測「非當天不能撤銷」）
CREATE OR REPLACE FUNCTION test_shift_attendance_days(p_attendance_id bigint, p_days int)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE makeup_attendances
     SET attended_at = attended_at - make_interval(days => p_days),
         departed_at = departed_at - make_interval(days => p_days)
   WHERE id = p_attendance_id;
$$;
REVOKE EXECUTE ON FUNCTION test_shift_attendance_days(bigint, int) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION test_shift_attendance_days(bigint, int) TO anon;

-- 驗收：應該要看到 staff_id 跟兩個 member 的 id 都不是 null
SELECT test_get_seed_ids();
