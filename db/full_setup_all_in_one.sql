-- ============================================================
-- 補課系統 — 完整資料庫建置（合併版 full_setup_all_in_one.sql）
-- 產生日期：2026-07-21
--
-- 用途／使用時機：
--   把 db/執行順序.md 記錄的 80 幾步（外加多支該表完全沒提到、但實際生效中的
--   bugfix_*/fix_*/重構42~51 檔案）依「最終累積結果」攤平、組裝成這一支檔案。
--   全新精舍要獨立部署這套系統時（Fork 程式碼＋開自己的 Supabase 專案），
--   只需要貼這一支到 SQL Editor 執行一次即可，不用照 執行順序.md 貼 80 幾次。
--   既有正式環境（目前普宜精舍在跑的那個 Supabase 專案）不要重跑這支，
--   會因為 CREATE TABLE 沒資料保護、settings 預設列 INSERT 等語句而不適用於已有資料的庫。
--
-- 執行角色：Supabase 專案的 SQL Editor（postgres 角色，擁有建表/建函式權限）。
--   不是 anon、不是 authenticated。
--
-- 執行後還要另外做的事（這支 SQL 做不到）：
--   1. 前端三支書籤（grabber/bookmarklet.js、bookmarklet_quick.js、audit_bookmarklet.js）
--      要重新指到新專案的 Supabase URL／anon key，重新產生書籤連結。
--   2. grabber/ 下 node_syncer（若有用）的 config.json 要自己填新專案連線資訊。
--   3. 前端 config/config.js（或對應設定檔）要 Fork 後自己填新專案的 SUPABASE_URL／SUPABASE_ANON_KEY。
--   4. 到 Supabase → Authentication → Users 建立管理員帳號（email+密碼），
--      前端後台用這組帳密登入（對應 authenticated 角色）。
--   5. 義工櫃台帳號改用 create_staff() RPC 建立（不是 Supabase Auth），
--      用管理員登入後台後從介面呼叫，或在 SQL Editor 手動下 SELECT create_staff(...)。
--   6. 若要啟用「zenclass 自動排程同步」：本檔只建 cron_sync_kiosk_attendance() 函式定義，
--      不會自動排程（Supabase 端 pg_cron/pg_net 連不到 zenclass.ctcm.org.tw，本會期已證實
--      走不通，正式環境改用現場電腦 PowerShell + Windows 工作排程器，見 grabber/setup_schedule.bat）。
--      新精舍若要用這個函式，v_api_base／v_unit_id 是寫死普宜精舍的值，須自行改成自己精舍的。
--   7. settings 表已自動插入一筆全域預設列（class_ref IS NULL），多數函式假設這筆存在，
--      不要刪除；各項門檻（遲到分鐘數、補課期限天數等）可在後台「系統設定」頁調整。
--
-- ⚠️ 已知「判定信心不高」項目（詳見檔尾註記＋任務回報）：
--   get_today_rollcall／ingest_kiosk_attendance／kiosk_lookup_member
--   三支函式在組裝過程中發現疑似「改函式時拿到舊底稿、不小心蓋掉先前修正」的情況，
--   已在下方對應函式定義前用註解標註，建議部署前人工比對 db/ 對應原始檔案。
-- ============================================================


-- ============================================================
-- 第 0 節：擴充套件
-- ============================================================
CREATE EXTENSION IF NOT EXISTS pgcrypto;   -- 義工帳密 bcrypt 雜湊（staff_accounts）需要

-- 以下兩個是「zenclass 自動排程同步」用的，若不打算啟用可以略過這兩行
-- （即使啟用失敗，不影響其餘資料表／RPC 正常運作）：
DO $$ BEGIN
  CREATE EXTENSION IF NOT EXISTS pg_cron;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'pg_cron 啟用失敗（可能該方案不支援），略過，不影響其餘功能：%', SQLERRM;
END $$;
DO $$ BEGIN
  CREATE EXTENSION IF NOT EXISTS pg_net;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'pg_net 啟用失敗（可能該方案不支援），略過，不影響其餘功能：%', SQLERRM;
END $$;


-- ============================================================
-- 第 1 節：資料表（共 16 張，欄位已把所有後續 ALTER TABLE 併入）
-- ============================================================

-- ── 1. classes — 班別 ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS classes (
  id             BIGSERIAL   PRIMARY KEY,
  unit_id        TEXT        NOT NULL,                 -- 精舍代號，例：UNIT01071
  class_id       TEXT        NOT NULL,                 -- zenclass classId，例：CLS115031900005（手動建班可用 MANUAL-xxx 佔位）
  class_name     TEXT        NOT NULL,
  level          TEXT        NOT NULL CHECK (level IN ('初','中','高','研')),
  day_of_week    TEXT,                                 -- 一/二/三/四/五/六/日
  day_night      TEXT        CHECK (day_night IN ('日','夜')),
  period_num     INTEGER,                              -- 第幾期
  teacher        TEXT,
  start_time     TIME,
  end_time       TIME,
  total_sessions INTEGER     NOT NULL DEFAULT 20,
  status         TEXT        NOT NULL DEFAULT '進行中'
                   CHECK (status IN ('準備中','進行中','已結業')),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (unit_id, class_id)
);

-- ── 2. members — 學員名冊 ──────────────────────────────────
CREATE TABLE IF NOT EXISTS members (
  id                BIGSERIAL   PRIMARY KEY,
  member_id         TEXT        NOT NULL,              -- zenclass 學員編號
  name              TEXT        NOT NULL,
  alias_name        TEXT,
  dharma_name       TEXT,
  gender            TEXT        CHECK (gender IN ('男','女')),
  group_id          TEXT,                              -- 組別，格式如「男1組」
  group_num         TEXT,                              -- 組號
  leader_member_id  TEXT,                              -- 所屬學長的學員編號（可空，目前保留未用）
  class_ref         BIGINT      NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  status            TEXT        NOT NULL DEFAULT '在學' CHECK (status IN ('在學','休學')),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (class_ref, member_id)
);
CREATE INDEX IF NOT EXISTS idx_members_class_ref ON members(class_ref);
CREATE INDEX IF NOT EXISTS idx_members_group     ON members(class_ref, group_id);

-- ── 3. sessions — 課程堂次 ─────────────────────────────────
CREATE TABLE IF NOT EXISTS sessions (
  id          BIGSERIAL   PRIMARY KEY,
  class_ref   BIGINT      NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  date        DATE        NOT NULL,
  week_num    INTEGER,
  is_held     BOOLEAN     NOT NULL DEFAULT false,       -- 「今天的同步是否跑過」，不等於「這堂實際上完」，見 kiosk_lookup_member 等函式改用日期判斷
  topic       TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (class_ref, date)
);
CREATE INDEX IF NOT EXISTS idx_sessions_class_date ON sessions(class_ref, date);

-- ── 4. attendance — 出席紀錄 ───────────────────────────────
CREATE TABLE IF NOT EXISTS attendance (
  id            BIGSERIAL   PRIMARY KEY,
  member_ref    BIGINT      NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  session_ref   BIGINT      NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  mark          TEXT        CHECK (mark IN ('V','L','ML','M','A','O','LL')),
  source        TEXT        NOT NULL DEFAULT 'api' CHECK (source IN ('api','manual')),
  checkin_time  TIMESTAMPTZ,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (member_ref, session_ref)
);
CREATE INDEX IF NOT EXISTS idx_attendance_session ON attendance(session_ref);
CREATE INDEX IF NOT EXISTS idx_attendance_member  ON attendance(member_ref);

-- ── 5. settings — 全域／各班設定（class_ref 為 NULL＝全域預設）──
CREATE TABLE IF NOT EXISTS settings (
  id                     BIGSERIAL   PRIMARY KEY,
  class_ref              BIGINT      REFERENCES classes(id) ON DELETE CASCADE,
  late_L_max_min         INTEGER     NOT NULL DEFAULT 20,
  late_LL_max_min        INTEGER     NOT NULL DEFAULT 60,
  makeup_earliest_days   INTEGER     NOT NULL DEFAULT 7,
  makeup_deadline_weeks  INTEGER     NOT NULL DEFAULT 4,    -- 舊欄位，保留不用（實際計算改用 makeup_deadline_days）
  makeup_required_marks  TEXT[]      NOT NULL DEFAULT ARRAY['O','LL','A'],
  makeup_earliest_mode   TEXT        DEFAULT '下週一' CHECK (makeup_earliest_mode IN ('下週一','缺課後N天')),
  makeup_time_slots      JSONB,                              -- 每日開放補課時段，例：[{"day":"週六","start":"13:00","end":"17:00"}]
  makeup_notice          TEXT,
  makeup_deadline_days   INTEGER     NOT NULL DEFAULT 40,    -- 補課期限＝缺課日＋此天數
  makeup_blackout_dates  JSONB,                              -- 黑名單日期，例：[{"date":"2026-08-01","reason":"精舍法會","start":"13:00","end":"17:00"}]（無 start/end＝整天不開放）
  video_machine_count    INTEGER     NOT NULL DEFAULT 5,
  extra_json             JSONB,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (class_ref)
);

-- ── 6. makeups — 補課登記（禪修班影音／精舍培訓課程）────────
CREATE TABLE IF NOT EXISTS makeups (
  id                 BIGSERIAL   PRIMARY KEY,
  member_ref         BIGINT      NOT NULL REFERENCES members(id)  ON DELETE CASCADE,
  session_ref        BIGINT      NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  method             TEXT        NOT NULL CHECK (method IN ('影音','精舍培訓課程')),
  training_name      TEXT,
  earphone           BOOLEAN,
  note               TEXT,
  planned_date       DATE,
  planned_slot       TEXT,
  earliest_date      DATE        NOT NULL,
  deadline_date      DATE        NOT NULL,
  status             TEXT        NOT NULL DEFAULT '待補課' CHECK (status IN ('待補課','已完成')),
  -- 2026-07-21 修正：原本這裡沒有「班長」，但 _verify_leader_scope() 代登記時會回傳「班長」，
  -- 導致班長代登記補課失敗（見 db/fix_補課登記缺少班長身分檢核.sql，正式環境已另外補這條 ALTER）。
  -- 全新建置直接建對，不用再補跑那支修正檔。
  registered_by      TEXT        NOT NULL CHECK (registered_by IN ('本人','學長','班長','精舍','櫃台')),
  completed_date     DATE,
  ctis_synced        BOOLEAN     NOT NULL DEFAULT false,
  is_late_exception  BOOLEAN     NOT NULL DEFAULT false,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (member_ref, session_ref)
);
CREATE INDEX IF NOT EXISTS idx_makeups_member  ON makeups(member_ref);
CREATE INDEX IF NOT EXISTS idx_makeups_session ON makeups(session_ref);
CREATE INDEX IF NOT EXISTS idx_makeups_status  ON makeups(status);

-- ── 7. assignments — 角色指派（學員/學長/班長/點名）─────────
-- UNIQUE 用 (member_id, class_ref, role)：重構45 放寬，讓同一人同一班可同時
-- 持有一筆基本身分（學員/學長/班長）＋一筆「點名」。
CREATE TABLE IF NOT EXISTS assignments (
  id           BIGSERIAL   PRIMARY KEY,
  member_id    TEXT        NOT NULL,
  class_ref    BIGINT      NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  role         TEXT        NOT NULL CHECK (role IN ('學員','學長','班長','點名')),
  scope_group  TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (member_id, class_ref, role)
);
CREATE INDEX IF NOT EXISTS idx_assignments_member ON assignments(member_id);
CREATE INDEX IF NOT EXISTS idx_assignments_class  ON assignments(class_ref);

-- ── 8. transfers — 日夜補（調班）登記 ─────────────────────
CREATE TABLE IF NOT EXISTS transfers (
  id               BIGSERIAL   PRIMARY KEY,
  member_ref       BIGINT      NOT NULL REFERENCES members(id)  ON DELETE CASCADE,
  from_session_ref BIGINT      NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  to_class_ref     BIGINT      NOT NULL REFERENCES classes(id)  ON DELETE CASCADE,
  to_date          DATE        NOT NULL,
  status           TEXT        NOT NULL DEFAULT '已登記' CHECK (status IN ('已登記','已出席','未到')),
  attended_at      TIMESTAMPTZ,
  late_mark        TEXT        CHECK (late_mark IN ('準時','L','LL','A')),
  registered_by    TEXT        NOT NULL CHECK (registered_by IN ('本人','學長','班長','精舍','櫃台')),
  note             TEXT,
  ctis_updated     BOOLEAN     NOT NULL DEFAULT false,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (member_ref, from_session_ref)
);
CREATE INDEX IF NOT EXISTS idx_transfers_member  ON transfers(member_ref);
CREATE INDEX IF NOT EXISTS idx_transfers_session ON transfers(from_session_ref);

-- ── 9. makeup_attendances — 補課到場事件（影音補課現場刷卡）──
-- ⚠️ departed_at 這個欄位在 db/ 所有 .sql 檔案裡都找不到對應的 ALTER TABLE 語句，
-- 但 kiosk_makeup_attend/kiosk_makeup_depart/kiosk_makeup_complete/
-- kiosk_get_attendance_alerts 等多支現行函式都會讀寫它，判斷是正式環境曾經
-- 透過 Supabase Dashboard「Table Editor」直接手動加欄位、沒有留下 SQL 檔案紀錄。
-- 這裡依函式實際用法補回這個欄位，建議之後比對正式環境 Table Editor 現況確認型別一致。
CREATE TABLE IF NOT EXISTS makeup_attendances (
  id              BIGSERIAL   PRIMARY KEY,
  makeup_ref      BIGINT      REFERENCES makeups(id) ON DELETE SET NULL,
  member_ref      BIGINT      NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  attended_at     TIMESTAMPTZ NOT NULL,
  departed_at     TIMESTAMPTZ,                          -- ⚠️ 推斷補回的欄位，見上方說明
  late_mark       TEXT        CHECK (late_mark IN ('準時','L','LL','A')),
  recorded_by     TEXT        NOT NULL,
  machine_number  INTEGER,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_makeup_att_makeup ON makeup_attendances(makeup_ref);
CREATE INDEX IF NOT EXISTS idx_makeup_att_member ON makeup_attendances(member_ref);

-- ── 10. staff_accounts — 義工帳號（自建帳密，不走 Supabase Auth）──
CREATE TABLE IF NOT EXISTS staff_accounts (
  id            BIGSERIAL   PRIMARY KEY,
  username      TEXT        NOT NULL UNIQUE,
  password_hash TEXT        NOT NULL,
  display_name  TEXT,
  role          TEXT        NOT NULL DEFAULT 'volunteer' CHECK (role IN ('volunteer','admin')),
  is_active     BOOLEAN     NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── 11~13. 精舍培訓課程子系統（與禪修班/makeups 完全獨立）───
CREATE TABLE IF NOT EXISTS training_classes (
  id         BIGSERIAL   PRIMARY KEY,
  name       TEXT        NOT NULL,
  is_active  BOOLEAN     NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS training_sessions (
  id           BIGSERIAL   PRIMARY KEY,
  class_ref    BIGINT      NOT NULL REFERENCES training_classes(id) ON DELETE CASCADE,
  session_date DATE        NOT NULL,
  session_time TIME,
  topic        TEXT,
  is_active    BOOLEAN     NOT NULL DEFAULT true,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_training_sessions_class ON training_sessions(class_ref);

CREATE TABLE IF NOT EXISTS training_makeups (
  id                    BIGSERIAL   PRIMARY KEY,
  member_ref            BIGINT      NOT NULL REFERENCES members(id)          ON DELETE CASCADE,
  training_session_ref  BIGINT      NOT NULL REFERENCES training_sessions(id) ON DELETE CASCADE,
  note                  TEXT,
  status                TEXT        NOT NULL DEFAULT '待補課' CHECK (status IN ('待補課','已完成')),
  attended_at           TIMESTAMPTZ,
  registered_by         TEXT        NOT NULL CHECK (registered_by IN ('本人','櫃台','精舍')),
  planned_date          DATE,
  planned_slot          TEXT,
  earphone              BOOLEAN,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (member_ref, training_session_ref)
);
CREATE INDEX IF NOT EXISTS idx_training_makeups_member  ON training_makeups(member_ref);
CREATE INDEX IF NOT EXISTS idx_training_makeups_session ON training_makeups(training_session_ref);

-- ── 14. training_courses — 精舍培訓課程場次表（get_training_courses 用）──
CREATE TABLE IF NOT EXISTS training_courses (
  id          BIGSERIAL   PRIMARY KEY,
  name        TEXT        NOT NULL,
  course_date DATE        NOT NULL,
  course_time TIME,
  is_active   BOOLEAN     NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_training_courses_date ON training_courses(course_date);

-- ── 14b. training_makeup_attendances — 培訓補課的到場/離開/機台紀錄（重構50，2026-07-22）──
-- training_makeup_ref 用 ON DELETE SET NULL（跟 makeup_attendances 一致）：萬一培訓補課登記
-- 被取消刪除，到場紀錄本身還留著，不會跟著消失，方便日後查核。
CREATE TABLE IF NOT EXISTS training_makeup_attendances (
  id                    BIGSERIAL   PRIMARY KEY,
  training_makeup_ref   BIGINT      REFERENCES training_makeups(id) ON DELETE SET NULL,
  member_ref            BIGINT      NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  attended_at           TIMESTAMPTZ NOT NULL,
  departed_at           TIMESTAMPTZ,
  machine_number        INTEGER,
  recorded_by           TEXT        NOT NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_training_makeup_attendances_ref    ON training_makeup_attendances(training_makeup_ref);
CREATE INDEX IF NOT EXISTS idx_training_makeup_attendances_member ON training_makeup_attendances(member_ref);

-- ── 15. attendance_edit_log — 出缺勤手動編輯稽核表（重構46）──
CREATE TABLE IF NOT EXISTS attendance_edit_log (
  id             BIGSERIAL PRIMARY KEY,
  attendance_id  BIGINT NOT NULL REFERENCES attendance(id) ON DELETE CASCADE,
  member_ref     BIGINT NOT NULL REFERENCES members(id),
  session_ref    BIGINT NOT NULL REFERENCES sessions(id),
  old_mark       TEXT,
  new_mark       TEXT,
  makeup_deleted BOOLEAN NOT NULL DEFAULT false,
  edited_by      TEXT,
  edited_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_attendance_edit_log_attendance ON attendance_edit_log(attendance_id);

-- ── 16. cron_sync_log — zenclass 自動排程同步紀錄（重構47/48）──
CREATE TABLE IF NOT EXISTS cron_sync_log (
  id          BIGSERIAL PRIMARY KEY,
  run_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  class_id    TEXT,
  class_name  TEXT,
  ok          BOOLEAN NOT NULL,
  synced      INT,
  error_msg   TEXT
);
CREATE INDEX IF NOT EXISTS idx_cron_sync_log_run_at ON cron_sync_log(run_at);


-- ============================================================
-- 第 2 節：settings 全域預設列（很多函式假設這筆存在，務必保留）
-- ============================================================
INSERT INTO settings (class_ref)
SELECT NULL
WHERE NOT EXISTS (SELECT 1 FROM settings WHERE class_ref IS NULL);


-- ============================================================
-- 第 3 節：資料表層級授權（anon／authenticated 都先給базовый存取，
-- 實際能看到哪些資料列由第 4 節的 RLS 政策決定；SECURITY DEFINER 的
-- RPC 函式不受此限，用函式擁有者權限執行）
-- ============================================================
GRANT USAGE ON SCHEMA public TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO anon, authenticated;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO anon, authenticated;


-- ============================================================
-- 第 4 節：Row Level Security（RLS）
-- 模型：anon 不給任何政策（等於全擋，只能透過下面的 SECURITY DEFINER
-- RPC 函式間接存取）；authenticated（後台管理員登入身分）全表讀寫。
-- cron_sync_log 額外開放 anon INSERT（現場電腦排程腳本用 anon key 寫入同步紀錄）。
-- ============================================================
ALTER TABLE classes              ENABLE ROW LEVEL SECURITY;
ALTER TABLE members              ENABLE ROW LEVEL SECURITY;
ALTER TABLE sessions             ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendance           ENABLE ROW LEVEL SECURITY;
ALTER TABLE settings             ENABLE ROW LEVEL SECURITY;
ALTER TABLE makeups              ENABLE ROW LEVEL SECURITY;
ALTER TABLE assignments          ENABLE ROW LEVEL SECURITY;
ALTER TABLE transfers            ENABLE ROW LEVEL SECURITY;
ALTER TABLE makeup_attendances   ENABLE ROW LEVEL SECURITY;
ALTER TABLE staff_accounts       ENABLE ROW LEVEL SECURITY;
ALTER TABLE training_classes     ENABLE ROW LEVEL SECURITY;
ALTER TABLE training_sessions    ENABLE ROW LEVEL SECURITY;
ALTER TABLE training_makeups     ENABLE ROW LEVEL SECURITY;
ALTER TABLE training_courses     ENABLE ROW LEVEL SECURITY;
ALTER TABLE training_makeup_attendances ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendance_edit_log  ENABLE ROW LEVEL SECURITY;
ALTER TABLE cron_sync_log        ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "auth_all_classes"             ON classes;
DROP POLICY IF EXISTS "auth_all_members"             ON members;
DROP POLICY IF EXISTS "auth_all_sessions"            ON sessions;
DROP POLICY IF EXISTS "auth_all_attendance"          ON attendance;
DROP POLICY IF EXISTS "auth_all_settings"             ON settings;
DROP POLICY IF EXISTS "auth_all_makeups"              ON makeups;
DROP POLICY IF EXISTS "auth_all_assignments"          ON assignments;
DROP POLICY IF EXISTS "auth_all_transfers"            ON transfers;
DROP POLICY IF EXISTS "auth_all_makeup_attendances"   ON makeup_attendances;
DROP POLICY IF EXISTS "auth_all_staff_accounts"       ON staff_accounts;
DROP POLICY IF EXISTS "auth_all_training_classes"     ON training_classes;
DROP POLICY IF EXISTS "auth_all_training_sessions"    ON training_sessions;
DROP POLICY IF EXISTS "auth_all_training_makeups"     ON training_makeups;
DROP POLICY IF EXISTS "auth_all_training_courses"     ON training_courses;
DROP POLICY IF EXISTS "auth_all_training_makeup_attendances" ON training_makeup_attendances;
DROP POLICY IF EXISTS "auth_all_attendance_edit_log"  ON attendance_edit_log;
DROP POLICY IF EXISTS "auth_all_cron_sync_log"        ON cron_sync_log;
DROP POLICY IF EXISTS "anon_insert_cron_sync_log"     ON cron_sync_log;

CREATE POLICY "auth_all_classes"            ON classes             FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_all_members"            ON members             FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_all_sessions"           ON sessions            FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_all_attendance"         ON attendance          FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_all_settings"           ON settings            FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_all_makeups"            ON makeups             FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_all_assignments"        ON assignments         FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_all_transfers"          ON transfers           FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_all_makeup_attendances" ON makeup_attendances  FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_all_staff_accounts"     ON staff_accounts      FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_all_training_classes"   ON training_classes    FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_all_training_sessions"  ON training_sessions   FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_all_training_makeups"   ON training_makeups    FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_all_training_courses"   ON training_courses    FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_all_training_makeup_attendances" ON training_makeup_attendances FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_all_attendance_edit_log" ON attendance_edit_log FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_all_cron_sync_log"      ON cron_sync_log       FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "anon_insert_cron_sync_log"   ON cron_sync_log       FOR INSERT TO anon WITH CHECK (true);


-- ============================================================
-- 第 5 節：共用觸發器（updated_at 自動更新）
-- ============================================================
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_classes_updated_at    ON classes;
DROP TRIGGER IF EXISTS trg_members_updated_at    ON members;
DROP TRIGGER IF EXISTS trg_sessions_updated_at   ON sessions;
DROP TRIGGER IF EXISTS trg_attendance_updated_at ON attendance;
DROP TRIGGER IF EXISTS trg_makeups_updated_at    ON makeups;
DROP TRIGGER IF EXISTS trg_assignments_updated_at ON assignments;
DROP TRIGGER IF EXISTS trg_transfers_updated_at ON transfers;
DROP TRIGGER IF EXISTS trg_makeup_attendances_updated_at ON makeup_attendances;
DROP TRIGGER IF EXISTS trg_staff_accounts_updated_at ON staff_accounts;

CREATE TRIGGER trg_classes_updated_at    BEFORE UPDATE ON classes    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_members_updated_at    BEFORE UPDATE ON members    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_sessions_updated_at   BEFORE UPDATE ON sessions   FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_attendance_updated_at BEFORE UPDATE ON attendance FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_makeups_updated_at    BEFORE UPDATE ON makeups    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_assignments_updated_at BEFORE UPDATE ON assignments FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_transfers_updated_at BEFORE UPDATE ON transfers FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_makeup_attendances_updated_at BEFORE UPDATE ON makeup_attendances FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_staff_accounts_updated_at BEFORE UPDATE ON staff_accounts FOR EACH ROW EXECUTE FUNCTION set_updated_at();


-- ============================================================
-- 第 6 節：內部共用函式（_ 開頭，只給其他 SECURITY DEFINER 函式呼叫，
-- 不對 anon/authenticated 開放 EXECUTE，見第 8 節 GRANT）
-- ============================================================

-- 義工櫃台身分驗證
CREATE OR REPLACE FUNCTION _kiosk_verify_staff(p_staff_id bigint)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM staff_accounts WHERE id = p_staff_id AND is_active = true
  ) THEN
    RAISE EXCEPTION '義工身分無效';
  END IF;
END;
$$;

-- 驗證學長/班長代登記範圍，回傳 registered_by 字串（'學長' 或 '班長'）
CREATE OR REPLACE FUNCTION _verify_leader_scope(
  p_acting_leader_db_id bigint,
  p_target_member_db_id bigint
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_leader RECORD;
  v_target RECORD;
BEGIN
  SELECT m.class_ref, a.role, a.scope_group
    INTO v_leader
    FROM members m
    LEFT JOIN assignments a
      ON a.member_id = m.member_id AND a.class_ref = m.class_ref
   WHERE m.id = p_acting_leader_db_id
   LIMIT 1;

  IF v_leader.role NOT IN ('學長', '班長') THEN
    RAISE EXCEPTION '此帳號無代理權限';
  END IF;

  SELECT class_ref, group_id INTO v_target
    FROM members WHERE id = p_target_member_db_id;

  IF v_target.class_ref IS DISTINCT FROM v_leader.class_ref THEN
    RAISE EXCEPTION '此學員不在您負責的班別內';
  END IF;

  IF v_leader.role = '學長' AND v_target.group_id IS DISTINCT FROM v_leader.scope_group THEN
    RAISE EXCEPTION '此學員不在您負責的組別內';
  END IF;

  RETURN v_leader.role;
END;
$$;

-- 黑名單日期（可只擋某時段）＋ 每日補課時段檢查，供多支補課登記/編輯 RPC 共用
-- （最終版本，含重構41「黑名單只擋某時段」＋2026-07-19 併回主檔的擋位置）
CREATE OR REPLACE FUNCTION _check_makeup_slot_allowed(
  p_planned_date date,
  p_planned_slot text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_slots  jsonb;
  v_slot   jsonb;
  v_black  jsonb;
  v_item   jsonb;
  v_dow    text;
  v_in_window bool;
BEGIN
  IF p_planned_date IS NULL OR p_planned_slot IS NULL THEN
    RETURN;
  END IF;

  SELECT makeup_time_slots, makeup_blackout_dates INTO v_slots, v_black
  FROM settings WHERE class_ref IS NULL LIMIT 1;

  IF v_black IS NOT NULL THEN
    FOR v_item IN SELECT value FROM jsonb_array_elements(v_black) LOOP
      IF (v_item->>'date')::date = p_planned_date THEN
        IF (v_item->>'start') IS NULL OR (v_item->>'end') IS NULL THEN
          RAISE EXCEPTION '此日期精舍不開放補課：%', COALESCE(v_item->>'reason', p_planned_date::text);
        ELSIF p_planned_slot >= (v_item->>'start') AND p_planned_slot <= (v_item->>'end') THEN
          RAISE EXCEPTION '此時段精舍不開放補課：%', COALESCE(v_item->>'reason', p_planned_date::text);
        END IF;
      END IF;
    END LOOP;
  END IF;

  IF v_slots IS NOT NULL AND jsonb_array_length(v_slots) > 0 THEN
    v_dow := CASE extract(dow from p_planned_date)
      WHEN 0 THEN '週日' WHEN 1 THEN '週一' WHEN 2 THEN '週二' WHEN 3 THEN '週三'
      WHEN 4 THEN '週四' WHEN 5 THEN '週五' WHEN 6 THEN '週六'
    END;
    v_in_window := false;
    FOR v_slot IN SELECT value FROM jsonb_array_elements(v_slots) LOOP
      IF v_slot->>'day' = v_dow
         AND p_planned_slot >= v_slot->>'start'
         AND p_planned_slot <= v_slot->>'end' THEN
        v_in_window := true;
        EXIT;
      END IF;
    END LOOP;
    IF NOT v_in_window THEN
      RAISE EXCEPTION '預約時間不在開放補課時段內';
    END IF;
  END IF;
END;
$$;

-- 取某班（某組）所有在學學員＋出席 marks／補課／未登記缺課（最終版本：重構27，deadline 用天數公式）
CREATE OR REPLACE FUNCTION _members_with_marks(p_class_ref bigint, p_group_id text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_class   RECORD;
  v_result  jsonb;
BEGIN
  SELECT class_name, total_sessions INTO v_class
  FROM classes WHERE id = p_class_ref;

  SELECT jsonb_build_object(
    'class_name',     v_class.class_name,
    'total_sessions', v_class.total_sessions,
    'members', COALESCE(jsonb_agg(
      jsonb_build_object(
        'id',          m.id,
        'member_id',   m.member_id,
        'name',        m.name,
        'dharma_name', m.dharma_name,
        'group_id',    m.group_id,
        'group_num',   m.group_num,
        'status',      m.status,
        'marks', (
          SELECT COALESCE(jsonb_agg(a.mark ORDER BY s.date), '[]'::jsonb)
          FROM attendance a
          JOIN sessions s ON s.id = a.session_ref
          WHERE a.member_ref = m.id
            AND s.is_held = true
            AND a.mark IS NOT NULL
        ),
        'makeups', (
          SELECT COALESCE(jsonb_agg(jsonb_build_object(
            'session_ref',   mk.session_ref,
            'session_date',  s.date,
            'status',        mk.status,
            'deadline_date', mk.deadline_date,
            'planned_date',  mk.planned_date,
            'planned_slot',  mk.planned_slot,
            'attend_count',  (SELECT count(*) FROM makeup_attendances ma WHERE ma.makeup_ref = mk.id),
            'is_overdue',    (mk.deadline_date < current_date)
          ) ORDER BY s.date), '[]'::jsonb)
          FROM makeups mk
          JOIN sessions s ON s.id = mk.session_ref
          WHERE mk.member_ref = m.id
            AND mk.status <> '已完成'
        ),
        'unregistered_absences', (
          SELECT COALESCE(jsonb_agg(jsonb_build_object(
            'session_ref',   a.session_ref,
            'session_date',  s.date,
            'mark',          a.mark,
            'deadline_date', dl.deadline_date
          ) ORDER BY s.date), '[]'::jsonb)
          FROM attendance a
          JOIN sessions s ON s.id = a.session_ref
          CROSS JOIN LATERAL (
            SELECT s.date + COALESCE(
                     (SELECT makeup_deadline_days FROM settings WHERE class_ref IS NULL LIMIT 1), 40
                   ) AS deadline_date
          ) dl
          WHERE a.member_ref = m.id
            AND s.is_held = true
            AND a.mark = ANY(
              COALESCE(
                (SELECT makeup_required_marks FROM settings WHERE class_ref IS NULL LIMIT 1),
                ARRAY['O','LL','A']
              )
            )
            AND NOT EXISTS (
              SELECT 1 FROM makeups mk2
              WHERE mk2.member_ref = m.id AND mk2.session_ref = a.session_ref
            )
        )
      )
    ), '[]'::jsonb)
  )
  INTO v_result
  FROM members m
  WHERE m.class_ref = p_class_ref
    AND (p_group_id IS NULL OR m.group_id = p_group_id);

  RETURN v_result;
END;
$$;

-- 培訓課程預約時間驗證（過去擋＋時段窗口）
CREATE OR REPLACE FUNCTION _validate_training_timing(p_planned_date date, p_planned_slot text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_slots jsonb; v_slot jsonb; v_dow text; v_ok bool;
BEGIN
  IF p_planned_date IS NULL OR p_planned_slot IS NULL THEN
    RAISE EXCEPTION '請填預約日期與時間';
  END IF;
  IF (p_planned_date + p_planned_slot::time) < now() THEN
    RAISE EXCEPTION '不能登記已過去的時間';
  END IF;
  SELECT makeup_time_slots INTO v_slots FROM settings WHERE class_ref IS NULL LIMIT 1;
  IF v_slots IS NOT NULL AND jsonb_array_length(v_slots) > 0 THEN
    v_dow := CASE extract(dow from p_planned_date)
      WHEN 0 THEN '週日' WHEN 1 THEN '週一' WHEN 2 THEN '週二' WHEN 3 THEN '週三'
      WHEN 4 THEN '週四' WHEN 5 THEN '週五' WHEN 6 THEN '週六'
    END;
    v_ok := false;
    FOR v_slot IN SELECT value FROM jsonb_array_elements(v_slots) LOOP
      IF v_slot->>'day'=v_dow AND p_planned_slot>=v_slot->>'start' AND p_planned_slot<=v_slot->>'end' THEN
        v_ok := true; EXIT;
      END IF;
    END LOOP;
    IF NOT v_ok THEN RAISE EXCEPTION '預約時間不在開放補課時段內'; END IF;
  END IF;
END;
$$;


-- ============================================================
-- 第 7 節：對外 RPC 函式
-- ============================================================

-- ── 7.1 登入 ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION login_by_member(p_code text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_member_id  text;
  v_member     RECORD;
  v_assign     RECORD;
BEGIN
  v_member_id := (regexp_match(p_code, '\d{9}'))[1];
  IF v_member_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT m.id, m.member_id, m.name, m.dharma_name, m.class_ref, m.status
  INTO v_member
  FROM members m
  WHERE m.member_id = v_member_id
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  SELECT a.role, a.scope_group
  INTO v_assign
  FROM assignments a
  WHERE a.member_id = v_member_id
    AND a.class_ref = v_member.class_ref;

  RETURN jsonb_build_object(
    'member_db_id', v_member.id,
    'member_id',    v_member.member_id,
    'name',         v_member.name,
    'dharma_name',  v_member.dharma_name,
    'class_ref',    v_member.class_ref,
    'status',       v_member.status,
    'role',         COALESCE(v_assign.role, '學員'),
    'scope_group',  v_assign.scope_group
  );
END;
$$;

-- 回傳該學員所有「進行中」班別＋各班身分（學員視圖 + 有 assignment 的班另補一筆管理視圖）
CREATE OR REPLACE FUNCTION login_my_classes(p_code text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_member_id text;
  v_result    jsonb;
BEGIN
  v_member_id := (regexp_match(p_code, '\d{9}'))[1];
  IF v_member_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT jsonb_agg(
    jsonb_build_object(
      'member_db_id', sub.member_db_id,
      'member_id',    sub.member_id,
      'name',         sub.name,
      'class_ref',    sub.class_id,
      'class_name',   sub.class_name,
      'role',         sub.role,
      'scope_group',  sub.scope_group
    )
    ORDER BY sub.class_name, sub.role
  )
  INTO v_result
  FROM (
    SELECT m.id AS member_db_id, m.member_id, m.name,
           c.id AS class_id, c.class_name,
           '學員'::text AS role, NULL::text AS scope_group
    FROM members m
    JOIN classes c ON c.id = m.class_ref
    WHERE m.member_id = v_member_id
      AND m.status    = '在學'
      AND c.status    = '進行中'

    UNION ALL

    SELECT m.id AS member_db_id, m.member_id, m.name,
           c.id AS class_id, c.class_name,
           a.role, a.scope_group
    FROM members m
    JOIN classes c ON c.id = m.class_ref
    JOIN assignments a
      ON a.member_id = m.member_id
     AND a.class_ref = c.id
    WHERE m.member_id = v_member_id
      AND m.status    = '在學'
      AND c.status    = '進行中'
  ) sub;

  RETURN v_result;
END;
$$;

-- ── 7.2 查詢視圖 ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION get_student_view(p_member_db_id bigint)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_member  RECORD;
  v_class   RECORD;
  v_set     RECORD;
  v_attend  jsonb;
  v_makeups jsonb;
BEGIN
  SELECT m.*, c.class_name, c.total_sessions
  INTO v_member
  FROM members m
  JOIN classes c ON c.id = m.class_ref
  WHERE m.id = p_member_db_id;

  IF NOT FOUND THEN RETURN NULL; END IF;

  SELECT *
  INTO v_set
  FROM settings
  WHERE class_ref = v_member.class_ref OR class_ref IS NULL
  ORDER BY class_ref NULLS LAST
  LIMIT 1;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id',           a.id,
    'session_id',   a.session_ref,
    'date',         s.date,
    'week_num',     s.week_num,
    'mark',         a.mark,
    'source',       a.source,
    'checkin_time', a.checkin_time
  ) ORDER BY s.date), '[]'::jsonb)
  INTO v_attend
  FROM attendance a
  JOIN sessions s ON s.id = a.session_ref
  WHERE a.member_ref = p_member_db_id
    AND s.is_held = true;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id',             mk.id,
    'session_ref',    mk.session_ref,
    'session_date',   s.date,
    'method',         mk.method,
    'planned_date',   mk.planned_date,
    'planned_slot',   mk.planned_slot,
    'earliest_date',  mk.earliest_date,
    'deadline_date',  mk.deadline_date,
    'status',         mk.status,
    'registered_by',  mk.registered_by,
    'completed_date', mk.completed_date,
    'attend_count',     (SELECT count(*) FROM makeup_attendances ma WHERE ma.makeup_ref = mk.id),
    'last_attended_at', (SELECT ma.attended_at FROM makeup_attendances ma WHERE ma.makeup_ref = mk.id ORDER BY ma.attended_at DESC LIMIT 1),
    'last_late_mark',   (SELECT ma.late_mark   FROM makeup_attendances ma WHERE ma.makeup_ref = mk.id ORDER BY ma.attended_at DESC LIMIT 1)
  ) ORDER BY s.date), '[]'::jsonb)
  INTO v_makeups
  FROM makeups mk
  JOIN sessions s ON s.id = mk.session_ref
  WHERE mk.member_ref = p_member_db_id;

  RETURN jsonb_build_object(
    'member_db_id',    p_member_db_id,
    'member_id',       v_member.member_id,
    'name',            v_member.name,
    'dharma_name',     v_member.dharma_name,
    'group_id',        v_member.group_id,
    'group_num',       v_member.group_num,
    'status',          v_member.status,
    'class_ref',       v_member.class_ref,
    'class_name',      v_member.class_name,
    'total_sessions',  v_member.total_sessions,
    'attendance',      v_attend,
    'makeups',         v_makeups,
    'settings', jsonb_build_object(
      'makeup_earliest_days', COALESCE(v_set.makeup_earliest_days, 7),
      'makeup_deadline_days', COALESCE(v_set.makeup_deadline_days, 40)
    )
  );
END;
$$;

CREATE OR REPLACE FUNCTION get_group_view(p_member_db_id bigint)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_member_id text;
  v_class_ref bigint;
  v_assign    RECORD;
BEGIN
  SELECT member_id, class_ref INTO v_member_id, v_class_ref
  FROM members WHERE id = p_member_db_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION '查無學員（id=%）', p_member_db_id;
  END IF;

  SELECT role, scope_group INTO v_assign
  FROM assignments
  WHERE member_id = v_member_id AND class_ref = v_class_ref;

  IF NOT FOUND OR v_assign.role <> '學長' THEN
    RAISE EXCEPTION '此學員（id=%）未被指派為學長', p_member_db_id;
  END IF;

  IF v_assign.scope_group IS NULL THEN
    RAISE EXCEPTION '學長（id=%）未設定負責組別', p_member_db_id;
  END IF;

  RETURN _members_with_marks(v_class_ref, v_assign.scope_group);
END;
$$;

CREATE OR REPLACE FUNCTION get_class_view(p_member_db_id bigint)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_member_id text;
  v_class_ref bigint;
  v_role      text;
BEGIN
  SELECT member_id, class_ref INTO v_member_id, v_class_ref
  FROM members WHERE id = p_member_db_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION '查無學員（id=%）', p_member_db_id;
  END IF;

  SELECT role INTO v_role
  FROM assignments
  WHERE member_id = v_member_id AND class_ref = v_class_ref;

  IF v_role IS NULL OR v_role <> '班長' THEN
    RAISE EXCEPTION '此學員（id=%）未被指派為班長', p_member_db_id;
  END IF;

  RETURN _members_with_marks(v_class_ref, NULL);
END;
$$;

-- ⚠️ 判定信心不高：get_today_rollcall 有兩條獨立修改分支疑似互相覆蓋──
-- 分支A（重構45_點名學長兼任.sql）：把角色檢查從「SELECT role INTO」改成 EXISTS 寫法，
-- 目的是讓「學長兼點名」（assignments 同人同班可有兩筆）能正確判斷，否則 SELECT INTO
-- 可能撈到錯的那一筆、誤判「未被指派為點名」。
-- 分支B（fix_點名補課完成名單與到場提醒排除已完成.sql，內文有 2026-07-21 追加修正字樣，
-- 是目前 db/ 資料夾裡日期最新的修改紀錄）：makeup_records 改成回傳「已完成＋M/ML」名單。
-- 兩支各自從不同的舊底稿改起，分支B目前的角色檢查寫法是舊版「SELECT role INTO」，
-- 沒有帶到分支A的 EXISTS 修正。下面採用「日期最新＝分支B」的完整函式主體（機率較高
-- 是目前線上實際生效的版本），但把分支A的 EXISTS 判斷法一併套用，因為這只是
-- SQL 寫法上的等價替換、不影響任何業務邏輯，不算「blend 兩種設計」；
-- 如果日後仍有「學長兼點名」查無資料的異常，優先檢查這裡。
-- 2026-07-21 校正：組裝時原本誤採 重構45 的 per-member「makeup_records」版本，
-- 但前端 ui/leader/rollcall.js 第 105 行實際讀的是頂層陣列 data.makeup_completions，
-- 證實真正的現行版本是 fix_點名頁補課完成清單改全班列表.sql（全班一張清單，非各自小標籤），
-- 已改用該版本（role 判斷沿用重構45的 EXISTS 寫法，兩者本來就是同一條線的先後版本）。
CREATE OR REPLACE FUNCTION get_today_rollcall(p_member_db_id bigint)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_member_id text;
  v_class_ref bigint;
  v_class     RECORD;
  v_today     date := (now() AT TIME ZONE 'Asia/Taipei')::date;
  v_session   RECORD;
  v_result    jsonb;
BEGIN
  SELECT member_id, class_ref INTO v_member_id, v_class_ref
  FROM members WHERE id = p_member_db_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION '查無學員（id=%）', p_member_db_id;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM assignments
    WHERE member_id = v_member_id AND class_ref = v_class_ref AND role = '點名'
  ) THEN
    RAISE EXCEPTION '此學員（id=%）未被指派為點名', p_member_db_id;
  END IF;

  SELECT class_name INTO v_class FROM classes WHERE id = v_class_ref;

  SELECT id, is_held INTO v_session
  FROM sessions WHERE class_ref = v_class_ref AND date = v_today;

  SELECT jsonb_build_object(
    'class_name',   v_class.class_name,
    'session_date', v_today,
    'has_session',  FOUND,
    'is_held',      COALESCE(v_session.is_held, false),
    'members', (
      SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
          'id',          m.id,
          'member_id',   m.member_id,
          'name',        m.name,
          'dharma_name', m.dharma_name,
          'group_id',    m.group_id,
          'group_num',   m.group_num,
          'mark', (
            SELECT a.mark FROM attendance a
            WHERE a.member_ref = m.id AND a.session_ref = v_session.id
          )
        ) ORDER BY m.group_id, m.group_num, m.name
      ), '[]'::jsonb)
      FROM members m
      WHERE m.class_ref = v_class_ref AND m.status = '在學'
    ),
    -- 全班補課完成清單（不分組別），依完成日期新到舊排序，供點名的人對照紙本紀錄
    'makeup_completions', (
      SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
          'member_name',    m2.name,
          'session_date',   s2.date,
          'completed_date', mk.completed_date,
          'mark',           a2.mark
        ) ORDER BY mk.completed_date DESC NULLS LAST, s2.date DESC
      ), '[]'::jsonb)
      FROM makeups mk
      JOIN members  m2 ON m2.id = mk.member_ref
      JOIN sessions s2 ON s2.id = mk.session_ref
      JOIN attendance a2 ON a2.member_ref = mk.member_ref AND a2.session_ref = mk.session_ref
      WHERE m2.class_ref = v_class_ref
        AND m2.status = '在學'
        AND mk.status = '已完成'
        AND a2.mark IN ('M', 'ML')
    )
  ) INTO v_result;

  RETURN v_result;
END;
$$;

-- ── 7.3 補課登記／取消（學員本人／學長班長代登記）────────────
-- register_makeup（8 參數版，2026-07-19 最終版：deadline=缺課日+makeup_deadline_days，
-- 呼叫共用函式 _check_makeup_slot_allowed 擋黑名單日期／非開放時段）
DROP FUNCTION IF EXISTS register_makeup(bigint, bigint, text, date, text);
DROP FUNCTION IF EXISTS register_makeup(bigint, bigint, text, text, bool, date, text);

CREATE OR REPLACE FUNCTION register_makeup(
  p_member_db_id         bigint,
  p_session_ref          bigint,
  p_method               text,
  p_training_name        text    DEFAULT NULL,
  p_earphone             bool    DEFAULT NULL,
  p_planned_date         date    DEFAULT NULL,
  p_planned_slot         text    DEFAULT NULL,
  p_acting_leader_db_id  bigint  DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_member         RECORD;
  v_session        RECORD;
  v_set            RECORD;
  v_mode           text;
  v_days           int;
  v_deadline_days  int;
  v_next_mon       date;
  v_earliest       date;
  v_deadline       date;
  v_registered     text := '本人';
BEGIN
  IF p_acting_leader_db_id IS NOT NULL THEN
    v_registered := _verify_leader_scope(p_acting_leader_db_id, p_member_db_id);
  END IF;

  SELECT id, class_ref, status INTO v_member
  FROM members WHERE id = p_member_db_id;
  IF NOT FOUND OR v_member.status <> '在學' THEN
    RAISE EXCEPTION '查無在學學員（id=%）', p_member_db_id;
  END IF;

  SELECT id, date, class_ref INTO v_session
  FROM sessions WHERE id = p_session_ref;
  IF NOT FOUND OR v_session.class_ref <> v_member.class_ref THEN
    RAISE EXCEPTION '堂次不存在或不屬於此學員班級';
  END IF;

  IF p_method NOT IN ('影音', '精舍培訓課程') THEN
    RAISE EXCEPTION '無效的補課方式：%（應為 影音 或 精舍培訓課程）', p_method;
  END IF;

  SELECT makeup_earliest_mode, makeup_earliest_days, makeup_deadline_days
  INTO v_set
  FROM settings WHERE class_ref IS NULL LIMIT 1;

  v_mode          := COALESCE(v_set.makeup_earliest_mode, '下週一');
  v_days          := COALESCE(v_set.makeup_earliest_days,  7);
  v_deadline_days := COALESCE(v_set.makeup_deadline_days, 40);

  v_next_mon := (date_trunc('week', v_session.date::timestamp)::date + 7);

  v_earliest := CASE
    WHEN v_mode = '下週一' THEN v_next_mon
    ELSE v_session.date + v_days
  END;

  v_deadline := v_session.date + v_deadline_days;

  IF p_planned_date IS NULL OR p_planned_slot IS NULL THEN
    RAISE EXCEPTION '請填預約日期與時間';
  END IF;

  IF current_date > v_deadline THEN
    RAISE EXCEPTION '補課期限（%）已過，無法登記', v_deadline;
  END IF;

  PERFORM _check_makeup_slot_allowed(p_planned_date, p_planned_slot);

  INSERT INTO makeups (
    member_ref, session_ref, method, training_name, earphone,
    planned_date, planned_slot, earliest_date, deadline_date,
    status, registered_by
  ) VALUES (
    p_member_db_id, p_session_ref, p_method, p_training_name, p_earphone,
    p_planned_date, p_planned_slot, v_earliest, v_deadline,
    '待補課', v_registered
  )
  ON CONFLICT (member_ref, session_ref) DO UPDATE SET
    method        = EXCLUDED.method,
    training_name = EXCLUDED.training_name,
    earphone      = EXCLUDED.earphone,
    planned_date  = EXCLUDED.planned_date,
    planned_slot  = EXCLUDED.planned_slot,
    earliest_date = EXCLUDED.earliest_date,
    deadline_date = EXCLUDED.deadline_date,
    status        = '待補課',
    registered_by = EXCLUDED.registered_by,
    updated_at    = now();

  RETURN jsonb_build_object(
    'ok',        true,
    'session_ref', p_session_ref,
    'earliest',  v_earliest,
    'deadline',  v_deadline
  );
END;
$$;

DROP FUNCTION IF EXISTS cancel_makeup(bigint, bigint);

CREATE OR REPLACE FUNCTION cancel_makeup(
  p_member_db_id        bigint,
  p_session_ref         bigint,
  p_acting_leader_db_id bigint DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_makeup RECORD;
BEGIN
  IF p_acting_leader_db_id IS NOT NULL THEN
    PERFORM _verify_leader_scope(p_acting_leader_db_id, p_member_db_id);
  END IF;

  SELECT * INTO v_makeup
  FROM makeups
  WHERE member_ref = p_member_db_id
    AND session_ref = p_session_ref;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', '查無補課登記');
  END IF;

  IF v_makeup.status = '已完成' THEN
    RAISE EXCEPTION '已完成的補課不能取消，請洽精舍';
  END IF;

  IF v_makeup.status <> '待補課' THEN
    RETURN jsonb_build_object('ok', false, 'reason', '查無待補課登記');
  END IF;

  DELETE FROM makeup_attendances WHERE makeup_ref = v_makeup.id;

  DELETE FROM makeups
  WHERE member_ref = p_member_db_id
    AND session_ref = p_session_ref
    AND status = '待補課';

  RETURN jsonb_build_object('ok', true);
END;
$$;

-- ── 7.4 日夜補（調班）─────────────────────────────────────
-- （最終版本：fix_調班日期誤擋今天.sql——把「是否已上課」判斷從 is_held 改成日期基準，
-- 避免當天同步跑過後，學員反而選不到「今天」臨時調班）
CREATE OR REPLACE FUNCTION get_transfer_view(p_member_db_id bigint)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_class_ref bigint;
  v_level     text;
BEGIN
  SELECT m.class_ref, c.level
    INTO v_class_ref, v_level
    FROM members m
    JOIN classes c ON c.id = m.class_ref
   WHERE m.id = p_member_db_id AND m.status = '在學'
   LIMIT 1;

  IF v_class_ref IS NULL THEN
    RAISE EXCEPTION '查無在學學員（id=%）', p_member_db_id;
  END IF;

  RETURN jsonb_build_object(
    'upcoming', (
      SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
          'session_ref', s.id,
          'date',        s.date,
          'week_num',    s.week_num
        ) ORDER BY s.date
      ), '[]'::jsonb)
      FROM sessions s
      WHERE s.class_ref  = v_class_ref
        AND s.date      >= current_date
    ),
    'targets', (
      SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
          'class_ref',   c2.id,
          'class_name',  c2.class_name,
          'day_of_week', c2.day_of_week,
          'day_night',   c2.day_night,
          'sessions',    (
            SELECT COALESCE(jsonb_agg(
              jsonb_build_object('week_num', s2.week_num, 'date', s2.date)
              ORDER BY s2.week_num
            ), '[]'::jsonb)
            FROM sessions s2
            WHERE s2.class_ref = c2.id
          )
        )
      ), '[]'::jsonb)
      FROM classes c2
      WHERE c2.level  = v_level
        AND c2.status = '進行中'
        AND c2.id    <> v_class_ref
    ),
    'transfers', (
      SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
          'from_session_ref', t.from_session_ref,
          'from_date',        s.date,
          'to_class_ref',     t.to_class_ref,
          'to_class_name',    c3.class_name,
          'to_date',          t.to_date,
          'status',           t.status
        ) ORDER BY t.created_at DESC
      ), '[]'::jsonb)
      FROM transfers t
      JOIN sessions s  ON s.id  = t.from_session_ref
      JOIN classes  c3 ON c3.id = t.to_class_ref
      WHERE t.member_ref = p_member_db_id
    )
  );
END;
$$;

DROP FUNCTION IF EXISTS register_transfer(bigint, bigint, bigint, date);
DROP FUNCTION IF EXISTS register_transfer(bigint, bigint, bigint, date, bigint);

CREATE OR REPLACE FUNCTION register_transfer(
  p_member_db_id         bigint,
  p_from_session_ref     bigint,
  p_to_class_ref         bigint,
  p_to_date              date,
  p_acting_leader_db_id  bigint DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_class_ref      bigint;
  v_level          text;
  v_session_class  bigint;
  v_session_date   date;
  v_target_level   text;
  v_target_status  text;
  v_row            transfers;
  v_registered     text := '本人';
BEGIN
  IF p_acting_leader_db_id IS NOT NULL THEN
    v_registered := _verify_leader_scope(p_acting_leader_db_id, p_member_db_id);
  END IF;

  SELECT m.class_ref, c.level
    INTO v_class_ref, v_level
    FROM members m
    JOIN classes c ON c.id = m.class_ref
   WHERE m.id = p_member_db_id AND m.status = '在學'
   LIMIT 1;

  IF v_class_ref IS NULL THEN
    RAISE EXCEPTION '查無在學學員';
  END IF;

  SELECT class_ref, date
    INTO v_session_class, v_session_date
    FROM sessions
   WHERE id = p_from_session_ref;

  IF v_session_class IS DISTINCT FROM v_class_ref THEN
    RAISE EXCEPTION '該堂次不屬於學員所在班別';
  END IF;
  IF v_session_date < current_date THEN
    RAISE EXCEPTION '此堂次已過期，不可調班';
  END IF;

  SELECT level, status
    INTO v_target_level, v_target_status
    FROM classes
   WHERE id = p_to_class_ref;

  IF v_target_level IS DISTINCT FROM v_level THEN
    RAISE EXCEPTION '目標班別級別不符';
  END IF;
  IF v_target_status <> '進行中' THEN
    RAISE EXCEPTION '目標班別非進行中';
  END IF;
  IF p_to_class_ref = v_class_ref THEN
    RAISE EXCEPTION '不能調到自己的班';
  END IF;

  IF p_to_date IS NULL THEN
    RAISE EXCEPTION '請填寫調班去上課的日期';
  END IF;

  INSERT INTO transfers (member_ref, from_session_ref, to_class_ref, to_date, status, registered_by)
  VALUES (p_member_db_id, p_from_session_ref, p_to_class_ref, p_to_date, '已登記', v_registered)
  ON CONFLICT (member_ref, from_session_ref)
  DO UPDATE SET
    to_class_ref    = EXCLUDED.to_class_ref,
    to_date         = EXCLUDED.to_date,
    status          = '已登記',
    registered_by   = EXCLUDED.registered_by
  RETURNING * INTO v_row;

  RETURN row_to_json(v_row)::jsonb;
END;
$$;

DROP FUNCTION IF EXISTS cancel_transfer(bigint, bigint);

CREATE OR REPLACE FUNCTION cancel_transfer(
  p_member_db_id         bigint,
  p_from_session_ref     bigint,
  p_acting_leader_db_id  bigint DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_status text;
BEGIN
  IF p_acting_leader_db_id IS NOT NULL THEN
    PERFORM _verify_leader_scope(p_acting_leader_db_id, p_member_db_id);
  END IF;
  SELECT status INTO v_status
    FROM transfers
   WHERE member_ref       = p_member_db_id
     AND from_session_ref = p_from_session_ref
   LIMIT 1;

  IF v_status IS NULL THEN
    RETURN '{"ok":false,"reason":"查無此調班記錄"}'::jsonb;
  END IF;

  IF v_status = '已出席' THEN
    RAISE EXCEPTION '已出席的調班不能取消，請洽精舍';
  END IF;

  DELETE FROM transfers
   WHERE member_ref       = p_member_db_id
     AND from_session_ref = p_from_session_ref
     AND status           = '已登記';

  RETURN '{"ok":true}'::jsonb;
END;
$$;

-- ── 7.5 義工帳號 ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION create_staff(
  p_username     text,
  p_password     text,
  p_display_name text DEFAULT NULL,
  p_role         text DEFAULT 'volunteer'
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_id bigint;
BEGIN
  IF auth.role() <> 'authenticated' THEN
    RAISE EXCEPTION '需管理員身分才能建立義工帳號';
  END IF;

  IF p_username IS NULL OR trim(p_username) = '' THEN
    RAISE EXCEPTION '帳號名不可空白';
  END IF;
  IF p_password IS NULL OR length(p_password) < 6 THEN
    RAISE EXCEPTION '密碼長度至少 6 碼';
  END IF;

  BEGIN
    INSERT INTO staff_accounts (username, password_hash, display_name, role)
    VALUES (
      trim(p_username),
      crypt(p_password, gen_salt('bf')),
      p_display_name,
      p_role
    )
    RETURNING id INTO v_id;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION '帳號名「%」已存在，請換一個', p_username;
  END;

  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION set_staff_password(p_id bigint, p_password text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF auth.role() <> 'authenticated' THEN
    RAISE EXCEPTION '需管理員身分才能重設密碼';
  END IF;
  IF p_password IS NULL OR length(p_password) < 6 THEN
    RAISE EXCEPTION '密碼長度至少 6 碼';
  END IF;

  UPDATE staff_accounts
     SET password_hash = crypt(p_password, gen_salt('bf'))
   WHERE id = p_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION '找不到 staff_id=%', p_id;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION staff_login(p_username text, p_password text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_row staff_accounts%ROWTYPE;
BEGIN
  SELECT * INTO v_row
    FROM staff_accounts
   WHERE username = trim(p_username)
     AND is_active = true;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  IF v_row.password_hash <> crypt(p_password, v_row.password_hash) THEN
    RETURN NULL;
  END IF;

  RETURN jsonb_build_object(
    'staff_id',     v_row.id,
    'display_name', v_row.display_name,
    'role',         v_row.role
  );
END;
$$;

-- ── 7.6 補課規則／後台統計 ─────────────────────────────────
CREATE OR REPLACE FUNCTION get_makeup_rules()
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'notice',         COALESCE(makeup_notice, ''),
    'earliest_mode',  COALESCE(makeup_earliest_mode, '下週一'),
    'earliest_days',  COALESCE(makeup_earliest_days,  7),
    'deadline_days',  COALESCE(makeup_deadline_days, 40),
    'time_slots',     COALESCE(makeup_time_slots, '[]'::jsonb)
  )
  FROM settings
  WHERE class_ref IS NULL
  LIMIT 1;
$$;

DROP FUNCTION IF EXISTS admin_student_stats(bigint);

CREATE OR REPLACE FUNCTION admin_student_stats(p_class_ref bigint DEFAULT NULL)
RETURNS TABLE(
  member_db_id   bigint,
  member_id      text,
  name           text,
  class_ref      bigint,
  class_name     text,
  group_id       text,
  phys           int,
  absent         int,
  makeup         int,
  total          int,
  cap            int,
  grad_ok        bool,
  short          int,
  perfect        bool,
  diligent       text,
  total_absent   int,
  overdue_absent int,
  overdue_dates  date[]
)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
AS $$
DECLARE
  v_deadline_days   int;
  v_required_marks  text[];
BEGIN
  SELECT COALESCE(s.makeup_deadline_days, 40), COALESCE(s.makeup_required_marks, ARRAY['O','LL','A'])
  INTO v_deadline_days, v_required_marks
  FROM settings s WHERE s.class_ref IS NULL LIMIT 1;

  IF v_deadline_days IS NULL THEN v_deadline_days := 40; END IF;
  IF v_required_marks IS NULL THEN v_required_marks := ARRAY['O','LL','A']; END IF;

  RETURN QUERY
  WITH base AS (
    SELECT
      m.id                                                                     AS member_db_id,
      m.member_id,
      m.name,
      c.id                                                                     AS class_ref,
      c.class_name,
      m.group_id,
      c.total_sessions                                                        AS total,
      LEAST(c.total_sessions, 20)                                             AS cap,
      COUNT(a.id) FILTER (WHERE a.mark IN ('V','L','ML'))::int                AS phys,
      COUNT(a.id) FILTER (WHERE a.mark IN ('A','O','LL'))::int                AS absent,
      COUNT(a.id) FILTER (WHERE a.mark = 'M')::int                            AS makeup,
      COUNT(a.id) FILTER (WHERE a.mark = 'ML')::int                           AS ml_makeup,
      (
        COUNT(a.id) FILTER (WHERE a.mark IS NOT NULL) > 0
        AND COUNT(a.id) FILTER (WHERE a.mark <> 'V') = 0
      )                                                                        AS perfect,
      COUNT(*) FILTER (
        WHERE a.mark = ANY(v_required_marks)
          AND current_date > GREATEST(
                s.date + v_deadline_days,
                COALESCE(
                  (SELECT mk.deadline_date FROM makeups mk
                    WHERE mk.member_ref = m.id AND mk.session_ref = a.session_ref),
                  '1970-01-01'::date
                )
              )
      )::int                                                                   AS overdue_absent,
      array_agg(s.date ORDER BY s.date) FILTER (
        WHERE a.mark = ANY(v_required_marks)
          AND current_date > GREATEST(
                s.date + v_deadline_days,
                COALESCE(
                  (SELECT mk.deadline_date FROM makeups mk
                    WHERE mk.member_ref = m.id AND mk.session_ref = a.session_ref),
                  '1970-01-01'::date
                )
              )
      )                                                                        AS overdue_dates
    FROM members m
    JOIN classes c ON c.id = m.class_ref
    LEFT JOIN attendance a ON a.member_ref = m.id
    LEFT JOIN sessions   s ON s.id = a.session_ref
    WHERE m.status = '在學'
      AND (
        (p_class_ref IS NOT NULL AND c.id = p_class_ref)
        OR (p_class_ref IS NULL  AND c.status = '進行中')
      )
    GROUP BY m.id, m.member_id, m.name, c.id, c.class_name, m.group_id, c.total_sessions
  )
  SELECT
    b.member_db_id, b.member_id, b.name, b.class_ref, b.class_name, b.group_id,
    b.phys, b.absent, b.makeup, b.total, b.cap,
    (
      b.phys >= CEIL(b.cap::numeric / 2)
      AND b.absent <= 3
      AND (b.phys + b.makeup) >= b.cap - 3
    )                                                                          AS grad_ok,
    GREATEST(0, (b.cap - 3) - (b.phys + b.makeup))::int                        AS short,
    b.perfect,
    CASE
      WHEN (b.absent + b.makeup + b.ml_makeup) = 0                                    THEN '目前全勤'
      WHEN (b.absent + b.makeup + b.ml_makeup) BETWEEN 1 AND 3 AND b.absent = 0        THEN '已勤學'
      WHEN (b.absent + b.makeup + b.ml_makeup) BETWEEN 1 AND 3 AND b.absent > 0        THEN '可勤學'
      ELSE '無法勤學'
    END                                                                        AS diligent,
    (b.absent + b.makeup + b.ml_makeup)                                       AS total_absent,
    b.overdue_absent,
    COALESCE(b.overdue_dates, ARRAY[]::date[])                                AS overdue_dates
  FROM base b
  ORDER BY b.class_name, b.group_id NULLS LAST, b.name;
END;
$$;

-- ── 7.7 補課完成／取消完成／後台補登 ───────────────────────
CREATE OR REPLACE FUNCTION complete_makeup(
  p_makeup_id      bigint,
  p_completed_date date DEFAULT current_date
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_member_ref  bigint;
  v_session_ref bigint;
  v_cur_mark    text;
  v_new_mark    text;
BEGIN
  SELECT member_ref, session_ref
    INTO v_member_ref, v_session_ref
    FROM makeups
   WHERE id = p_makeup_id;

  IF v_member_ref IS NULL THEN
    RAISE EXCEPTION '找不到 makeup id=%', p_makeup_id;
  END IF;

  SELECT mark INTO v_cur_mark
    FROM attendance
   WHERE member_ref = v_member_ref AND session_ref = v_session_ref;

  v_new_mark := CASE WHEN v_cur_mark = 'LL' THEN 'ML' ELSE 'M' END;

  INSERT INTO attendance (member_ref, session_ref, mark, source)
  VALUES (v_member_ref, v_session_ref, v_new_mark, 'manual')
  ON CONFLICT (member_ref, session_ref)
  DO UPDATE SET mark       = v_new_mark,
                source     = 'manual',
                updated_at = now();

  UPDATE makeups
     SET status         = '已完成',
         completed_date = p_completed_date
   WHERE id = p_makeup_id;
END;
$$;

CREATE OR REPLACE FUNCTION uncomplete_makeup(p_makeup_id bigint)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_member_ref  bigint;
  v_session_ref bigint;
  v_cur_mark    text;
BEGIN
  SELECT member_ref, session_ref
    INTO v_member_ref, v_session_ref
    FROM makeups
   WHERE id = p_makeup_id;

  IF v_member_ref IS NULL THEN
    RAISE EXCEPTION '找不到 makeup id=%', p_makeup_id;
  END IF;

  SELECT mark INTO v_cur_mark
    FROM attendance
   WHERE member_ref = v_member_ref AND session_ref = v_session_ref;

  IF v_cur_mark = 'ML' THEN
    UPDATE attendance
       SET mark = 'LL', source = 'manual', updated_at = now()
     WHERE member_ref = v_member_ref AND session_ref = v_session_ref;
  ELSIF v_cur_mark = 'M' THEN
    UPDATE attendance
       SET mark = 'O',  source = 'manual', updated_at = now()
     WHERE member_ref = v_member_ref AND session_ref = v_session_ref;
  END IF;

  UPDATE makeups
     SET status         = '待補課',
         completed_date = null
   WHERE id = p_makeup_id;
END;
$$;

CREATE OR REPLACE FUNCTION admin_backfill_makeup(
  p_member_db_id   bigint,
  p_session_ref    bigint,
  p_method         text,
  p_training_name  text DEFAULT NULL,
  p_earphone       bool DEFAULT NULL,
  p_note           text DEFAULT NULL,
  p_planned_date   date DEFAULT NULL,
  p_planned_slot   text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_member        RECORD;
  v_session       RECORD;
  v_deadline_days int;
  v_deadline      date;
BEGIN
  SELECT id, class_ref, status INTO v_member
  FROM members WHERE id = p_member_db_id;
  IF NOT FOUND OR v_member.status <> '在學' THEN
    RAISE EXCEPTION '查無在學學員（id=%）', p_member_db_id;
  END IF;

  SELECT id, date, class_ref INTO v_session
  FROM sessions WHERE id = p_session_ref;
  IF NOT FOUND OR v_session.class_ref <> v_member.class_ref THEN
    RAISE EXCEPTION '堂次不存在或不屬於此學員班級';
  END IF;

  IF p_method NOT IN ('影音', '精舍培訓課程') THEN
    RAISE EXCEPTION '無效的補課方式：%（應為 影音 或 精舍培訓課程）', p_method;
  END IF;

  SELECT COALESCE(makeup_deadline_days, 40) INTO v_deadline_days
  FROM settings WHERE class_ref IS NULL LIMIT 1;
  v_deadline := v_session.date + v_deadline_days;

  PERFORM _check_makeup_slot_allowed(p_planned_date, p_planned_slot);

  INSERT INTO makeups (
    member_ref, session_ref, method, training_name, earphone, note,
    planned_date, planned_slot, earliest_date, deadline_date,
    status, registered_by
  ) VALUES (
    p_member_db_id, p_session_ref, p_method, p_training_name, p_earphone, p_note,
    p_planned_date, p_planned_slot, v_session.date, v_deadline,
    '待補課', '精舍'
  )
  ON CONFLICT (member_ref, session_ref) DO UPDATE SET
    method        = EXCLUDED.method,
    training_name = EXCLUDED.training_name,
    earphone      = EXCLUDED.earphone,
    note          = EXCLUDED.note,
    planned_date  = EXCLUDED.planned_date,
    planned_slot  = EXCLUDED.planned_slot,
    deadline_date = EXCLUDED.deadline_date,
    status        = '待補課',
    registered_by = '精舍';

  RETURN '{"ok":true}'::jsonb;
END;
$$;

CREATE OR REPLACE FUNCTION admin_register_late_makeup(
  p_member_db_id   bigint,
  p_session_ref    bigint,
  p_method         text,
  p_training_name  text DEFAULT NULL,
  p_earphone       bool DEFAULT NULL,
  p_note           text DEFAULT NULL,
  p_planned_date   date DEFAULT NULL,
  p_planned_slot   text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_member        RECORD;
  v_session       RECORD;
  v_deadline_days int;
  v_deadline      date;
BEGIN
  SELECT id, class_ref, status INTO v_member
  FROM members WHERE id = p_member_db_id;
  IF NOT FOUND OR v_member.status <> '在學' THEN
    RAISE EXCEPTION '查無在學學員（id=%）', p_member_db_id;
  END IF;

  SELECT id, date, class_ref INTO v_session
  FROM sessions WHERE id = p_session_ref;
  IF NOT FOUND OR v_session.class_ref <> v_member.class_ref THEN
    RAISE EXCEPTION '堂次不存在或不屬於此學員班級';
  END IF;

  IF p_method NOT IN ('影音', '精舍培訓課程') THEN
    RAISE EXCEPTION '無效的補課方式：%（應為 影音 或 精舍培訓課程）', p_method;
  END IF;

  IF p_planned_date IS NULL OR p_planned_slot IS NULL THEN
    RAISE EXCEPTION '請填預約日期與時間';
  END IF;

  PERFORM _check_makeup_slot_allowed(p_planned_date, p_planned_slot);

  SELECT COALESCE(makeup_deadline_days, 40) INTO v_deadline_days
  FROM settings WHERE class_ref IS NULL LIMIT 1;
  v_deadline := v_session.date + v_deadline_days;

  INSERT INTO makeups (
    member_ref, session_ref, method, training_name, earphone, note,
    planned_date, planned_slot, earliest_date, deadline_date,
    status, registered_by, is_late_exception
  ) VALUES (
    p_member_db_id, p_session_ref, p_method, p_training_name, p_earphone, p_note,
    p_planned_date, p_planned_slot, v_session.date, v_deadline,
    '待補課', '精舍', true
  )
  ON CONFLICT (member_ref, session_ref) DO UPDATE SET
    method            = EXCLUDED.method,
    training_name     = EXCLUDED.training_name,
    earphone          = EXCLUDED.earphone,
    note              = EXCLUDED.note,
    planned_date      = EXCLUDED.planned_date,
    planned_slot      = EXCLUDED.planned_slot,
    deadline_date     = EXCLUDED.deadline_date,
    status            = '待補課',
    registered_by     = '精舍',
    is_late_exception = true,
    updated_at        = now();

  RETURN jsonb_build_object('ok', true, 'deadline', v_deadline);
END;
$$;

CREATE OR REPLACE FUNCTION admin_transfer_mark_attended(p_transfer_id bigint, p_late_mark text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_member_ref       bigint;
  v_from_session_ref bigint;
  v_mark              text;
BEGIN
  SELECT member_ref, from_session_ref INTO v_member_ref, v_from_session_ref
    FROM transfers WHERE id = p_transfer_id;

  IF v_member_ref IS NULL THEN
    RAISE EXCEPTION '找不到日夜補登記（id=%）', p_transfer_id;
  END IF;

  UPDATE transfers
     SET status = '已出席', attended_at = now(), late_mark = p_late_mark
   WHERE id = p_transfer_id;

  v_mark := CASE WHEN p_late_mark = '準時' THEN 'V' ELSE p_late_mark END;

  INSERT INTO attendance (member_ref, session_ref, mark, source)
  VALUES (v_member_ref, v_from_session_ref, v_mark, 'manual')
  ON CONFLICT (member_ref, session_ref)
  DO UPDATE SET mark = v_mark, source = 'manual', updated_at = now();

  RETURN '{"ok":true}'::jsonb;
END;
$$;

CREATE OR REPLACE FUNCTION admin_transfer_mark_absent(p_transfer_id bigint)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE transfers SET status = '未到' WHERE id = p_transfer_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION '找不到日夜補登記（id=%）', p_transfer_id;
  END IF;

  RETURN '{"ok":true}'::jsonb;
END;
$$;

CREATE OR REPLACE FUNCTION admin_transfer_set_ctis_updated(p_transfer_id bigint, p_value boolean)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE transfers SET ctis_updated = p_value WHERE id = p_transfer_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION '找不到日夜補登記（id=%）', p_transfer_id;
  END IF;

  RETURN '{"ok":true}'::jsonb;
END;
$$;

-- 後台單筆修改出缺勤標記（重構46）
CREATE OR REPLACE FUNCTION admin_edit_attendance_mark(
  p_attendance_id bigint,
  p_new_mark      text,
  p_delete_makeup boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_att       RECORD;
  v_makeup    RECORD;
  v_had_makeup     boolean := false;
  v_makeup_deleted boolean := false;
BEGIN
  IF p_new_mark NOT IN ('V','L','ML','M','A','O','LL') THEN
    RAISE EXCEPTION '無效的出缺勤標記：%（應為 V/L/ML/M/A/O/LL 之一）', p_new_mark;
  END IF;

  SELECT id, member_ref, session_ref, mark
  INTO v_att
  FROM attendance
  WHERE id = p_attendance_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION '查無出缺勤紀錄（id=%）', p_attendance_id;
  END IF;

  SELECT id INTO v_makeup
  FROM makeups
  WHERE member_ref = v_att.member_ref AND session_ref = v_att.session_ref;

  v_had_makeup := FOUND;

  IF v_had_makeup AND p_delete_makeup THEN
    DELETE FROM makeups WHERE id = v_makeup.id;
    v_makeup_deleted := true;
  END IF;

  UPDATE attendance
     SET mark = p_new_mark, source = 'manual', updated_at = now()
   WHERE id = p_attendance_id;

  INSERT INTO attendance_edit_log (
    attendance_id, member_ref, session_ref, old_mark, new_mark, makeup_deleted, edited_by
  ) VALUES (
    p_attendance_id, v_att.member_ref, v_att.session_ref, v_att.mark, p_new_mark, v_makeup_deleted,
    auth.email()
  );

  RETURN jsonb_build_object(
    'ok', true,
    'had_makeup', v_had_makeup,
    'makeup_deleted', v_makeup_deleted
  );
END;
$$;

-- ── 7.8 精舍培訓課程子系統 ─────────────────────────────────
CREATE OR REPLACE FUNCTION get_training_classes()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id',id,'name',name) ORDER BY name),'[]'::jsonb)
  FROM training_classes WHERE is_active = true;
$$;

CREATE OR REPLACE FUNCTION get_training_sessions(p_class_ref bigint)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object('id',id,'session_date',session_date,'session_time',to_char(session_time,'HH24:MI'),'topic',topic)
    ORDER BY session_date, session_time
  ),'[]'::jsonb)
  FROM training_sessions WHERE class_ref = p_class_ref AND is_active = true;
$$;

CREATE OR REPLACE FUNCTION get_my_training_makeups(p_member_db_id bigint)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'training_session_ref', tm.training_session_ref,
      'class_name',    tc.name,
      'session_date',  ts.session_date,
      'session_time',  to_char(ts.session_time,'HH24:MI'),
      'topic',         ts.topic,
      'note',          tm.note,
      'planned_date',  tm.planned_date,
      'planned_slot',  tm.planned_slot,
      'earphone',      tm.earphone,
      'status',        tm.status
    ) ORDER BY ts.session_date, ts.session_time
  ),'[]'::jsonb)
  FROM training_makeups tm
  JOIN training_sessions ts ON ts.id = tm.training_session_ref
  JOIN training_classes  tc ON tc.id = ts.class_ref
  WHERE tm.member_ref = p_member_db_id;
$$;

CREATE OR REPLACE FUNCTION register_training_makeup(
  p_member_db_id         bigint,
  p_training_session_ref bigint,
  p_note                 text    DEFAULT NULL,
  p_planned_date         date    DEFAULT NULL,
  p_planned_slot         text    DEFAULT NULL,
  p_earphone             bool    DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_row training_makeups;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM members WHERE id = p_member_db_id AND status = '在學') THEN
    RAISE EXCEPTION '查無在學學員';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM training_sessions WHERE id = p_training_session_ref AND is_active = true) THEN
    RAISE EXCEPTION '培訓堂次不存在或已停用';
  END IF;
  PERFORM _validate_training_timing(p_planned_date, p_planned_slot);

  INSERT INTO training_makeups
    (member_ref, training_session_ref, note, planned_date, planned_slot, earphone, status, registered_by)
  VALUES
    (p_member_db_id, p_training_session_ref, p_note, p_planned_date, p_planned_slot, p_earphone, '待補課', '本人')
  ON CONFLICT (member_ref, training_session_ref) DO UPDATE SET
    note = EXCLUDED.note, planned_date = EXCLUDED.planned_date,
    planned_slot = EXCLUDED.planned_slot, earphone = EXCLUDED.earphone,
    status = '待補課', registered_by = '本人'
  RETURNING * INTO v_row;

  RETURN row_to_json(v_row)::jsonb;
END;
$$;

CREATE OR REPLACE FUNCTION cancel_training_makeup(
  p_member_db_id bigint, p_training_session_ref bigint
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_status text;
BEGIN
  SELECT status INTO v_status FROM training_makeups
   WHERE member_ref=p_member_db_id AND training_session_ref=p_training_session_ref;
  IF v_status IS NULL THEN RETURN '{"ok":false,"reason":"查無此登記"}'::jsonb; END IF;
  IF v_status = '已完成' THEN RAISE EXCEPTION '已完成的登記不能取消，請洽精舍'; END IF;
  DELETE FROM training_makeups
   WHERE member_ref=p_member_db_id AND training_session_ref=p_training_session_ref AND status='待補課';
  RETURN '{"ok":true}'::jsonb;
END;
$$;

CREATE OR REPLACE FUNCTION kiosk_register_training_makeup(
  p_staff_id             bigint,
  p_member_db_id         bigint,
  p_training_session_ref bigint,
  p_note                 text    DEFAULT NULL,
  p_planned_date         date    DEFAULT NULL,
  p_planned_slot         text    DEFAULT NULL,
  p_earphone             bool    DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_row training_makeups;
BEGIN
  PERFORM _kiosk_verify_staff(p_staff_id);
  IF NOT EXISTS (SELECT 1 FROM members WHERE id = p_member_db_id AND status = '在學') THEN
    RAISE EXCEPTION '查無在學學員';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM training_sessions WHERE id = p_training_session_ref AND is_active = true) THEN
    RAISE EXCEPTION '培訓堂次不存在或已停用';
  END IF;
  PERFORM _validate_training_timing(p_planned_date, p_planned_slot);

  INSERT INTO training_makeups
    (member_ref, training_session_ref, note, planned_date, planned_slot, earphone, status, registered_by)
  VALUES
    (p_member_db_id, p_training_session_ref, p_note, p_planned_date, p_planned_slot, p_earphone, '待補課', '櫃台')
  ON CONFLICT (member_ref, training_session_ref) DO UPDATE SET
    note = EXCLUDED.note, planned_date = EXCLUDED.planned_date,
    planned_slot = EXCLUDED.planned_slot, earphone = EXCLUDED.earphone,
    status = '待補課', registered_by = '櫃台'
  RETURNING * INTO v_row;

  RETURN row_to_json(v_row)::jsonb;
END;
$$;

-- ── 7.9 刷卡資料寫入管道 ───────────────────────────────────
-- ⚠️ 判定信心不高：ingest_kiosk_attendance 有兩條獨立修改分支，這裡採用「較新/較完整」
-- 那支但補回可能被覆蓋掉的舊修正──
-- 分支A（重構26_組別加性別與刷卡不覆蓋組別.sql）：member upsert 的 ON CONFLICT 更新
-- 刻意「不」把 group_id 寫進 UPDATE SET，避免刷卡系統的純數字組別蓋掉「匯入資料」
-- 寫好的「男1組」格式。
-- 分支B（重構36_退班學員誤同步修正與資料清理.sql，檔名編號較新）：加上
-- 「p_records 若帶 is_dropped=true 就整筆跳過」的防呆，但這支的 UPDATE SET 子句
-- 又把 group_id = EXCLUDED.group_id 寫回去了——看起來是改這支時，底稿是重構26
-- 之前的舊版本，不小心把分支A的修正蓋掉。以下保留分支B的 is_dropped 防呆（明確
-- 是後來才加的必要修正），但沿用分支A「不覆蓋 group_id」的寫法，因為重構26的
-- 文件說明這是刻意設計、不是失誤，兩者互不衝突。建議部署前人工比對
-- db/重構26_組別加性別與刷卡不覆蓋組別.sql 與 db/重構36_退班學員誤同步修正與資料清理.sql。
CREATE OR REPLACE FUNCTION ingest_kiosk_attendance(
  p_unit_id  text,
  p_date     date,
  p_class    jsonb,
  p_records  jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_class_ref   bigint;
  v_session_ref bigint;
  v_member_ref  bigint;
  v_cur_mark    text;
  v_cur_source  text;
  v_final_mark  text;
  v_synced      int := 0;
  r             jsonb;
  PROTECTED     text[] := ARRAY['V','L','ML','M'];
BEGIN
  INSERT INTO classes (unit_id, class_id, class_name, level, day_night,
                       day_of_week, start_time, end_time, period_num)
  VALUES (
    p_unit_id,
    p_class->>'class_id',
    p_class->>'class_name',
    p_class->>'level',
    p_class->>'day_night',
    p_class->>'day_of_week',
    NULLIF(p_class->>'start_time', '')::time,
    NULLIF(p_class->>'end_time', '')::time,
    (p_class->>'period_num')::int
  )
  ON CONFLICT (unit_id, class_id) DO UPDATE SET
    class_name  = EXCLUDED.class_name,
    level       = EXCLUDED.level,
    day_night   = EXCLUDED.day_night,
    day_of_week = EXCLUDED.day_of_week,
    start_time  = EXCLUDED.start_time,
    end_time    = EXCLUDED.end_time,
    period_num  = EXCLUDED.period_num
  RETURNING id INTO v_class_ref;

  INSERT INTO sessions (class_ref, date, is_held, week_num)
  VALUES (
    v_class_ref,
    p_date,
    NOT COALESCE((p_class->>'is_cancelled')::bool, false),
    (p_class->>'week_num')::int
  )
  ON CONFLICT (class_ref, date) DO UPDATE SET
    is_held  = NOT COALESCE((p_class->>'is_cancelled')::bool, false),
    week_num = COALESCE((p_class->>'week_num')::int, sessions.week_num)
  RETURNING id INTO v_session_ref;

  FOR r IN SELECT * FROM jsonb_array_elements(p_records) LOOP

    IF COALESCE((r->>'is_dropped')::bool, false) THEN
      CONTINUE;
    END IF;

    INSERT INTO members (class_ref, member_id, name, alias_name, dharma_name, group_id, group_num)
    VALUES (
      v_class_ref,
      r->>'member_id',
      COALESCE(r->>'name', ''),
      COALESCE(r->>'name', ''),
      COALESCE(r->>'dharma_name', ''),
      COALESCE(r->>'group_id', ''),
      COALESCE(r->>'group_num', '')
    )
    ON CONFLICT (class_ref, member_id) DO UPDATE SET
      name        = EXCLUDED.name,
      alias_name  = EXCLUDED.alias_name,
      dharma_name = EXCLUDED.dharma_name,
      group_num   = EXCLUDED.group_num
      -- group_id 刻意不更新（刷卡系統沒有性別資訊，不能蓋掉已經組合好的「男1組」格式）
    RETURNING id INTO v_member_ref;

    SELECT mark, source
    INTO v_cur_mark, v_cur_source
    FROM attendance
    WHERE member_ref = v_member_ref AND session_ref = v_session_ref;

    IF v_cur_source = 'manual' AND v_cur_mark = ANY(PROTECTED) THEN
      CONTINUE;
    END IF;
    IF v_cur_mark = ANY(PROTECTED) AND (r->>'mark') IS NULL THEN
      CONTINUE;
    END IF;

    v_final_mark := COALESCE(NULLIF(r->>'mark', ''), 'O');

    INSERT INTO attendance (member_ref, session_ref, mark, source, checkin_time)
    VALUES (
      v_member_ref,
      v_session_ref,
      v_final_mark,
      'api',
      (r->>'checkin_time')::timestamptz
    )
    ON CONFLICT (member_ref, session_ref) DO UPDATE SET
      mark         = EXCLUDED.mark,
      source       = EXCLUDED.source,
      checkin_time = EXCLUDED.checkin_time;

    v_synced := v_synced + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'ok',          true,
    'class_ref',   v_class_ref,
    'session_ref', v_session_ref,
    'synced',      v_synced
  );
END;
$$;

-- ── 7.10 稽核比對／首頁警示／MANUAL 班別綁定 ───────────────
-- 2026-07-24：原本連「已結業」也一起回傳，理由是讓 grabber/bookmarklet.js（一般同步）
-- 能回頭補抓已結業班漏掉的刷卡資料——但這只是當初的推測，開發紀錄裡沒有真的發生過一次。
-- 實際代價是：已結業班永遠留在清單裡、越積越多，且曾發生舊 MANUAL 佔位班已結業封存、
-- 新真代碼班同名進行中，兩者在選單裡撞名選錯（見 補課系統_開發紀錄.md 同日條目）。
-- 改回只回傳「進行中」，真的要補已結業班的資料，去後台「班別設定」暫時改回進行中即可。
CREATE OR REPLACE FUNCTION list_audit_classes()
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'class_ref',   id,
      'class_name',  class_name,
      'unit_id',     unit_id,
      'class_id',    class_id,
      'status',      status,
      'level',       level,
      'day_night',   day_night,
      'day_of_week', day_of_week,
      'start_time',  start_time,
      'end_time',    end_time
    ) ORDER BY class_name
  ), '[]'::jsonb)
  FROM classes
  WHERE status = '進行中';
$$;

CREATE OR REPLACE FUNCTION get_class_audit_snapshot(p_class_ref bigint)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT jsonb_build_object(
    'unit_id',    c.unit_id,
    'class_id',   c.class_id,
    'class_name', c.class_name,
    'roster', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'member_id', m.member_id,
        'status',    m.status
      )), '[]'::jsonb)
      FROM members m
      WHERE m.class_ref = p_class_ref
    ),
    'sessions', (
      SELECT COALESCE(jsonb_agg(sess ORDER BY (sess->>'date')::date), '[]'::jsonb)
      FROM (
        SELECT jsonb_build_object(
          'date', s.date,
          'members', (
            SELECT COALESCE(jsonb_agg(jsonb_build_object(
              'member_id', m.member_id,
              'mark',      a.mark,
              'source',    a.source
            )), '[]'::jsonb)
            FROM attendance a
            JOIN members m ON m.id = a.member_ref
            WHERE a.session_ref = s.id
          )
        ) AS sess
        FROM sessions s
        WHERE s.class_ref = p_class_ref AND s.is_held = true
      ) sub
    )
  )
  FROM classes c
  WHERE c.id = p_class_ref;
$$;

CREATE OR REPLACE FUNCTION merge_manual_class_into_real(
  p_manual_class_ref bigint,
  p_real_class_ref   bigint
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_moved_members  int := 0;
  v_moved_sessions int := 0;
BEGIN
  UPDATE members m
  SET class_ref = p_real_class_ref
  WHERE m.class_ref = p_manual_class_ref
    AND NOT EXISTS (
      SELECT 1 FROM members m2
      WHERE m2.class_ref = p_real_class_ref AND m2.member_id = m.member_id
    );
  GET DIAGNOSTICS v_moved_members = ROW_COUNT;

  UPDATE sessions s
  SET class_ref = p_real_class_ref
  WHERE s.class_ref = p_manual_class_ref
    AND NOT EXISTS (
      SELECT 1 FROM sessions s2
      WHERE s2.class_ref = p_real_class_ref AND s2.date = s.date
    );
  GET DIAGNOSTICS v_moved_sessions = ROW_COUNT;

  UPDATE classes SET status = '進行中' WHERE id = p_real_class_ref;
  UPDATE classes SET status = '已結業' WHERE id = p_manual_class_ref;

  RETURN jsonb_build_object(
    'moved_members', v_moved_members,
    'moved_sessions', v_moved_sessions,
    'duplicate_members', (
      SELECT COALESCE(jsonb_agg(m.member_id), '[]'::jsonb)
      FROM members m
      WHERE m.class_ref = p_manual_class_ref
        AND EXISTS (
          SELECT 1 FROM members m2
          WHERE m2.class_ref = p_real_class_ref AND m2.member_id = m.member_id
        )
    ),
    'duplicate_sessions', (
      SELECT COALESCE(jsonb_agg(s.date), '[]'::jsonb)
      FROM sessions s
      WHERE s.class_ref = p_manual_class_ref
        AND EXISTS (
          SELECT 1 FROM sessions s2
          WHERE s2.class_ref = p_real_class_ref AND s2.date = s.date
        )
    )
  );
END;
$$;

CREATE OR REPLACE FUNCTION auto_bind_class_id(
  p_class_ref bigint,
  p_class_id  text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cur_class_id text;
  v_conflict_ref  bigint;
BEGIN
  SELECT class_id INTO v_cur_class_id FROM classes WHERE id = p_class_ref;

  IF v_cur_class_id IS NULL OR v_cur_class_id NOT LIKE 'MANUAL-%' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_manual');
  END IF;

  SELECT id INTO v_conflict_ref FROM classes
    WHERE class_id = p_class_id AND id != p_class_ref;
  IF v_conflict_ref IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'conflict', 'conflict_class_ref', v_conflict_ref);
  END IF;

  UPDATE classes SET class_id = p_class_id WHERE id = p_class_ref;
  RETURN jsonb_build_object('ok', true);
END;
$$;

CREATE OR REPLACE FUNCTION remove_dropped_members(
  p_class_ref  bigint,
  p_member_ids text[]
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_deleted int;
BEGIN
  DELETE FROM members
  WHERE class_ref = p_class_ref
    AND member_id = ANY(p_member_ids);
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN jsonb_build_object('ok', true, 'deleted_members', v_deleted);
END;
$$;

-- ── 7.11 義工櫃台（kiosk）RPC ──────────────────────────────
-- 先讓 transfers.registered_by 允許 '櫃台'（原本 CREATE TABLE 已含，這裡保留
-- DROP/ADD CONSTRAINT 寫法方便之後若要再調整可安全重跑）
ALTER TABLE transfers DROP CONSTRAINT IF EXISTS transfers_registered_by_check;
ALTER TABLE transfers ADD CONSTRAINT transfers_registered_by_check
  CHECK (registered_by IN ('本人','學長','班長','精舍','櫃台'));

-- 共用：到場時查「這個學員是否還有更早缺課尚未補完」（甲案，2026-07-22）
-- 用 attendance.mark 當永久依據，不是查 makeups 登記表，就算學員把更早那堂的補課登記取消
-- 刪除，這裡還是查得到「還欠」。p_before_date 傳「這次要到場補課那一堂」的原始缺課日。
CREATE OR REPLACE FUNCTION _kiosk_check_earlier_absence(
  p_member_ref bigint,
  p_before_date date,
  p_exclude_session_ref bigint DEFAULT NULL
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_earliest_date date;
  v_count         int;
BEGIN
  SELECT min(s.date), count(*)
    INTO v_earliest_date, v_count
  FROM attendance a
  JOIN sessions s ON s.id = a.session_ref
  LEFT JOIN makeups mk ON mk.member_ref = a.member_ref AND mk.session_ref = a.session_ref
  CROSS JOIN LATERAL (
    SELECT s.date + COALESCE(st.makeup_deadline_days, 40) AS deadline_date,
           COALESCE(st.makeup_required_marks, ARRAY['O','LL','A']) AS makeup_required_marks
    FROM settings st WHERE st.class_ref IS NULL LIMIT 1
  ) dl
  WHERE a.member_ref = p_member_ref
    AND a.mark = ANY (dl.makeup_required_marks)
    AND mk.status IS DISTINCT FROM '已完成'
    AND current_date <= GREATEST(dl.deadline_date, COALESCE(mk.deadline_date, '1970-01-01'::date))
    AND s.date < p_before_date
    AND (p_exclude_session_ref IS NULL OR a.session_ref <> p_exclude_session_ref);

  IF COALESCE(v_count, 0) = 0 THEN
    RETURN NULL;
  END IF;

  RETURN format(
    '這位學員還有 %s 堂更早的缺課尚未補完（最早一堂缺課日：%s），請跟學員確認今天是否該從那一堂開始補',
    v_count, v_earliest_date
  );
END;
$$;

CREATE OR REPLACE FUNCTION kiosk_get_day(p_staff_id bigint, p_date date)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM _kiosk_verify_staff(p_staff_id);

  RETURN jsonb_build_object(
    'transfers', (
      SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
          'transfer_id',    t.id,
          'member_name',    m.name,
          'from_class_name', fc.class_name,
          'to_class_name',  tc.class_name,
          'status',         t.status,
          'note',           t.note
        ) ORDER BY m.name
      ), '[]'::jsonb)
      FROM transfers t
      JOIN members  m  ON m.id  = t.member_ref
      JOIN sessions s  ON s.id  = t.from_session_ref
      JOIN classes  fc ON fc.id = s.class_ref
      JOIN classes  tc ON tc.id = t.to_class_ref
      WHERE t.to_date = p_date
    ),
    'makeups', (
      SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
          'makeup_id',     mk.id,
          'member_id',     m.member_id,
          'member_name',   m.name,
          'class_name',    c.class_name,
          'session_date',  s.date,
          'planned_slot',  mk.planned_slot,
          'earphone',      mk.earphone,
          'note',          mk.note,
          'status',        mk.status,
          'deadline_date', mk.deadline_date,
          'attend_count',  (SELECT count(*) FROM makeup_attendances ma WHERE ma.makeup_ref = mk.id),
          'has_open_attendance', EXISTS (
            SELECT 1 FROM makeup_attendances ma2
            WHERE ma2.makeup_ref = mk.id AND ma2.departed_at IS NULL
          )
        ) ORDER BY mk.planned_slot, m.name
      ), '[]'::jsonb)
      FROM makeups mk
      JOIN members m ON m.id  = mk.member_ref
      JOIN classes c ON c.id  = m.class_ref
      JOIN sessions s ON s.id = mk.session_ref
      WHERE mk.planned_date = p_date
        AND mk.status = '待補課'
    ),
    'training_makeups', (
      SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
          'training_makeup_id', tm.id,
          'member_ref',         m.id,
          'member_name',        m.name,
          'class_name',         tc.name,
          'topic',              ts.topic,
          'session_date',       ts.session_date,
          'planned_slot',       tm.planned_slot,
          'earphone',           tm.earphone,
          'note',               tm.note,
          'attend_count',       (SELECT count(*) FROM training_makeup_attendances tma WHERE tma.training_makeup_ref = tm.id),
          'has_open_attendance', EXISTS (
            SELECT 1 FROM training_makeup_attendances tma2
            WHERE tma2.training_makeup_ref = tm.id AND tma2.departed_at IS NULL
          )
        ) ORDER BY tm.planned_slot, m.name
      ), '[]'::jsonb)
      FROM training_makeups tm
      JOIN training_sessions ts ON ts.id = tm.training_session_ref
      JOIN training_classes  tc ON tc.id = ts.class_ref
      JOIN members           m  ON m.id  = tm.member_ref
      WHERE tm.planned_date = p_date
        AND tm.status = '待補課'
    ),
    'video_machine_count', (SELECT video_machine_count FROM settings WHERE class_ref IS NULL LIMIT 1)
  );
END;
$$;

-- kiosk_training_makeup_attend（2026-07-22 新增，比照影片補課三步驟＋機台共用）
-- 機台號碼池跟影片補課共用（同一批機台號碼），佔用狀態靠 kiosk_get_today_log 把兩邊
-- 到場紀錄合併查詢，前端不用分開算。
CREATE OR REPLACE FUNCTION kiosk_training_makeup_attend(
  p_staff_id           bigint,
  p_training_makeup_id bigint,
  p_machine_number     integer DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_member_ref   bigint;
  v_status       text;
  v_session_date date;
  v_warning      text;
BEGIN
  PERFORM _kiosk_verify_staff(p_staff_id);

  SELECT tm.member_ref, tm.status, ts.session_date
    INTO v_member_ref, v_status, v_session_date
    FROM training_makeups tm JOIN training_sessions ts ON ts.id = tm.training_session_ref
    WHERE tm.id = p_training_makeup_id;

  IF v_member_ref IS NULL THEN
    RAISE EXCEPTION '找不到培訓補課登記（id=%）', p_training_makeup_id;
  END IF;

  IF v_status = '已完成' THEN
    RAISE EXCEPTION '此堂培訓補課已完成，無法再次登記出席';
  END IF;

  IF EXISTS (
    SELECT 1 FROM training_makeup_attendances
    WHERE training_makeup_ref = p_training_makeup_id AND departed_at IS NULL
  ) THEN
    RAISE EXCEPTION '此堂培訓補課已到場，尚未結束，請先按「此堂課尚未補完」或「補課完成」';
  END IF;

  INSERT INTO training_makeup_attendances (training_makeup_ref, member_ref, attended_at, recorded_by, machine_number)
  VALUES (p_training_makeup_id, v_member_ref, now(), '櫃台', p_machine_number);

  -- 2026-07-22 甲案：培訓補課沒有像 attendance 那種「補完就永久改標記」的表，只能查目前
  -- 還存在、還「待補課」的培訓登記——如果那筆更早的登記被取消刪除，這裡就查不到了，
  -- 這點跟影片補課（查 attendance 永久標記）不同，請知悉這個限制。
  SELECT format(
    '這位學員還有 %s 堂更早的培訓補課登記尚未完成（最早一堂：%s），請跟學員確認今天是否該從那一堂開始補',
    count(*), min(ts2.session_date)
  )
  INTO v_warning
  FROM training_makeups tm2
  JOIN training_sessions ts2 ON ts2.id = tm2.training_session_ref
  WHERE tm2.member_ref = v_member_ref
    AND tm2.status = '待補課'
    AND tm2.id <> p_training_makeup_id
    AND ts2.session_date < v_session_date
  HAVING count(*) > 0;

  RETURN jsonb_build_object('ok', true, 'warning', v_warning);
END;
$$;

CREATE OR REPLACE FUNCTION kiosk_training_makeup_depart(p_staff_id bigint, p_training_makeup_id bigint)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_status text;
BEGIN
  PERFORM _kiosk_verify_staff(p_staff_id);

  SELECT status INTO v_status FROM training_makeups WHERE id = p_training_makeup_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION '找不到培訓補課登記（id=%）', p_training_makeup_id;
  END IF;
  IF v_status = '已完成' THEN
    RAISE EXCEPTION '此堂培訓補課已完成，無需再標記尚未補完';
  END IF;

  UPDATE training_makeup_attendances
  SET departed_at = now()
  WHERE training_makeup_ref = p_training_makeup_id
    AND departed_at IS NULL
    AND attended_at = (
      SELECT MAX(tma2.attended_at) FROM training_makeup_attendances tma2
      WHERE tma2.training_makeup_ref = p_training_makeup_id AND tma2.departed_at IS NULL
    );

  RETURN '{"ok":true}'::jsonb;
END;
$$;

CREATE OR REPLACE FUNCTION kiosk_training_makeup_complete(p_staff_id bigint, p_training_makeup_id bigint)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM _kiosk_verify_staff(p_staff_id);

  UPDATE training_makeups
     SET status      = '已完成',
         attended_at = now()
   WHERE id = p_training_makeup_id
     AND status = '待補課';

  IF NOT FOUND THEN
    RAISE EXCEPTION '找不到待補課的培訓登記（id=%）', p_training_makeup_id;
  END IF;

  -- 2026-07-22 比照影片補課：完成時順便關掉最新一筆未離場的到場紀錄
  UPDATE training_makeup_attendances
  SET departed_at = now()
  WHERE training_makeup_ref = p_training_makeup_id
    AND departed_at IS NULL
    AND attended_at = (
      SELECT MAX(tma2.attended_at) FROM training_makeup_attendances tma2
      WHERE tma2.training_makeup_ref = p_training_makeup_id AND tma2.departed_at IS NULL
    );

  RETURN '{"ok":true}'::jsonb;
END;
$$;

-- kiosk_transfer_attend：標已出席時同步 upsert 原班原堂次 attendance；
-- late_mark 依到場時間自動判定，準時→V、L/LL/A 直接對應（已修正舊版寫死 V 的 bug）
CREATE OR REPLACE FUNCTION kiosk_transfer_attend(p_staff_id bigint, p_transfer_id bigint)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_member_ref       bigint;
  v_from_session_ref bigint;
  v_to_date    date;
  v_start_time time;
  v_L          integer;
  v_LL         integer;
  v_diff       numeric;
  v_late_mark  text;
  v_mark       text;
BEGIN
  PERFORM _kiosk_verify_staff(p_staff_id);

  -- 取調班學員／原堂次、調班目標日期與目標班別上課時間
  SELECT t.member_ref, t.from_session_ref, t.to_date, c.start_time
    INTO v_member_ref, v_from_session_ref, v_to_date, v_start_time
    FROM transfers t
    JOIN classes c ON c.id = t.to_class_ref
   WHERE t.id = p_transfer_id;

  -- 取全域遲到門檻
  SELECT late_L_max_min, late_LL_max_min
    INTO v_L, v_LL
    FROM settings WHERE class_ref IS NULL LIMIT 1;

  -- 若日期或時間任一為 NULL，late_mark 維持 NULL
  IF v_to_date IS NOT NULL AND v_start_time IS NOT NULL THEN
    v_diff := EXTRACT(EPOCH FROM (
      (now() AT TIME ZONE 'Asia/Taipei')
      - (v_to_date + v_start_time)::timestamp
    )) / 60.0;

    v_late_mark := CASE
      WHEN v_diff <= 0                        THEN '準時'
      WHEN v_diff <= v_L                      THEN 'L'
      WHEN v_diff <= v_LL                     THEN 'LL'
      ELSE                                         'A'
    END;
  END IF;

  UPDATE transfers
     SET status      = '已出席',
         attended_at = now(),
         late_mark   = v_late_mark
   WHERE id = p_transfer_id AND status = '已登記';

  IF NOT FOUND THEN
    RAISE EXCEPTION '找不到可出席的調班（id=%）', p_transfer_id;
  END IF;

  -- 同步寫回原班原堂次出席紀錄（依自動判定的遲到狀態同步，準時→V，L/LL/A 直接對應；
  -- 判定不出來（日期時間缺）時比照舊行為預設 V，避免此分支反而卡住整支流程）
  IF v_member_ref IS NOT NULL AND v_from_session_ref IS NOT NULL THEN
    v_mark := CASE WHEN v_late_mark IS NULL OR v_late_mark = '準時' THEN 'V' ELSE v_late_mark END;

    INSERT INTO attendance (member_ref, session_ref, mark, source)
    VALUES (v_member_ref, v_from_session_ref, v_mark, 'manual')
    ON CONFLICT (member_ref, session_ref)
    DO UPDATE SET mark = v_mark, source = 'manual', updated_at = now();
  END IF;

  RETURN '{"ok":true}'::jsonb;
END;
$$;

CREATE OR REPLACE FUNCTION kiosk_makeup_attend(p_staff_id bigint, p_makeup_id bigint, p_machine_number integer DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_member_ref   bigint;
  v_session_ref  bigint;
  v_session_date date;
  v_planned_date date;
  v_planned_slot text;
  v_status       text;
  v_L            integer;
  v_LL           integer;
  v_diff         numeric;
  v_late_mark    text;
  v_warning      text;
BEGIN
  PERFORM _kiosk_verify_staff(p_staff_id);

  SELECT mk.member_ref, mk.session_ref, s.date, mk.planned_date, mk.planned_slot, mk.status
    INTO v_member_ref, v_session_ref, v_session_date, v_planned_date, v_planned_slot, v_status
    FROM makeups mk JOIN sessions s ON s.id = mk.session_ref
    WHERE mk.id = p_makeup_id;

  IF v_member_ref IS NULL THEN
    RAISE EXCEPTION '找不到補課登記（id=%）', p_makeup_id;
  END IF;

  IF v_status = '已完成' THEN
    RAISE EXCEPTION '此堂補課已完成，無法再次登記出席';
  END IF;

  IF EXISTS (
    SELECT 1 FROM makeup_attendances
    WHERE makeup_ref = p_makeup_id AND departed_at IS NULL
  ) THEN
    RAISE EXCEPTION '此堂補課已到場，尚未結束，請先按「此堂課尚未補完」或「補課完成」';
  END IF;

  -- 取全域遲到門檻
  SELECT late_L_max_min, late_LL_max_min
    INTO v_L, v_LL
    FROM settings WHERE class_ref IS NULL LIMIT 1;

  -- 若日期或時間任一為 NULL，late_mark 維持 NULL
  IF v_planned_date IS NOT NULL AND v_planned_slot IS NOT NULL THEN
    v_diff := EXTRACT(EPOCH FROM (
      (now() AT TIME ZONE 'Asia/Taipei')
      - (v_planned_date + v_planned_slot::time)::timestamp
    )) / 60.0;

    v_late_mark := CASE
      WHEN v_diff <= 0                        THEN '準時'
      WHEN v_diff <= v_L                      THEN 'L'
      WHEN v_diff <= v_LL                     THEN 'LL'
      ELSE                                         'A'
    END;
  END IF;

  INSERT INTO makeup_attendances (makeup_ref, member_ref, attended_at, late_mark, recorded_by, machine_number)
  VALUES (p_makeup_id, v_member_ref, now(), v_late_mark, '櫃台', p_machine_number);

  -- 2026-07-22 甲案：查這個學員是否還有比這堂更早、還沒補完的缺課
  v_warning := _kiosk_check_earlier_absence(v_member_ref, v_session_date, v_session_ref);

  RETURN jsonb_build_object('ok', true, 'warning', v_warning);
END;
$$;

CREATE OR REPLACE FUNCTION kiosk_makeup_complete(p_staff_id bigint, p_makeup_id bigint)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_member_ref  bigint;
  v_session_ref bigint;
  v_deadline    date;
  v_status      text;
  v_cur_mark    text;
  v_new_mark    text;
BEGIN
  PERFORM _kiosk_verify_staff(p_staff_id);

  SELECT member_ref, session_ref, deadline_date, status
    INTO v_member_ref, v_session_ref, v_deadline, v_status
    FROM makeups WHERE id = p_makeup_id;

  IF v_member_ref IS NULL THEN
    RAISE EXCEPTION '找不到補課登記（id=%）', p_makeup_id;
  END IF;

  IF v_status = '已完成' THEN
    RAISE EXCEPTION '此堂補課已經完成過了，請勿重複操作';
  END IF;

  IF current_date > v_deadline THEN
    RAISE EXCEPTION '已逾期（截止日 %），無法完成補課', v_deadline;
  END IF;

  SELECT mark INTO v_cur_mark
    FROM attendance WHERE member_ref = v_member_ref AND session_ref = v_session_ref;

  v_new_mark := CASE WHEN v_cur_mark = 'LL' THEN 'ML' ELSE 'M' END;

  INSERT INTO attendance (member_ref, session_ref, mark, source)
  VALUES (v_member_ref, v_session_ref, v_new_mark, 'manual')
  ON CONFLICT (member_ref, session_ref)
  DO UPDATE SET mark = v_new_mark, source = 'manual', updated_at = now();

  UPDATE makeups
     SET status = '已完成', completed_date = current_date
   WHERE id = p_makeup_id;

  -- 記錄離場（最新一筆未離場的出席紀錄）
  UPDATE makeup_attendances
  SET departed_at = now()
  WHERE makeup_ref = p_makeup_id
    AND departed_at IS NULL
    AND attended_at = (
      SELECT MAX(ma2.attended_at) FROM makeup_attendances ma2
      WHERE ma2.makeup_ref = p_makeup_id AND ma2.departed_at IS NULL
    );

  RETURN '{"ok":true}'::jsonb;
END;
$$;

CREATE OR REPLACE FUNCTION kiosk_makeup_depart(p_staff_id bigint, p_makeup_id bigint)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_status text;
BEGIN
  PERFORM _kiosk_verify_staff(p_staff_id);

  SELECT status INTO v_status FROM makeups WHERE id = p_makeup_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION '找不到補課登記（id=%）', p_makeup_id;
  END IF;
  IF v_status = '已完成' THEN
    RAISE EXCEPTION '此堂補課已完成，無需再標記尚未補完';
  END IF;

  UPDATE makeup_attendances
  SET departed_at = now()
  WHERE makeup_ref = p_makeup_id
    AND departed_at IS NULL
    AND attended_at = (
      SELECT MAX(ma2.attended_at) FROM makeup_attendances ma2
      WHERE ma2.makeup_ref = p_makeup_id AND ma2.departed_at IS NULL
    );

  RETURN '{"ok":true}'::jsonb;
END;
$$;

CREATE OR REPLACE FUNCTION kiosk_lookup_member(p_staff_id bigint, p_member_code text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_member_id  text;
  v_name       text;
  v_primary    RECORD;  -- 第一筆，供頂層 member_db_id/class_name 顯示用
BEGIN
  PERFORM _kiosk_verify_staff(p_staff_id);

  v_member_id := (regexp_match(p_member_code, '\d{9}'))[1];
  IF v_member_id IS NULL THEN
    RETURN '{"found":false,"reason":"無法解析學員編號"}'::jsonb;
  END IF;

  -- 取第一筆（主班）供頂層顯示用
  SELECT m.id, m.name, m.class_ref INTO v_primary
    FROM members m WHERE m.member_id = v_member_id AND m.status = '在學'
   ORDER BY m.id LIMIT 1;

  IF NOT FOUND THEN
    RETURN '{"found":false,"reason":"查無在學學員"}'::jsonb;
  END IF;

  RETURN jsonb_build_object(
    'found',        true,
    'member_db_id', v_primary.id,   -- 主班 member_db_id（給調班/培訓用）
    'name',         v_primary.name,
    'class_name',   (SELECT class_name FROM classes WHERE id = v_primary.class_ref),
    -- 多班缺堂（每班獨立一筆，含各班 member_db_id）
    'classes', (
      SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
          'member_db_id', m.id,
          'class_ref',    m.class_ref,
          'class_name',   c.class_name,
          'absences', (
            SELECT COALESCE(jsonb_agg(
              jsonb_build_object(
                'session_ref',        a.session_ref,
                'date',               s.date,
                'week_num',           s.week_num,
                'deadline_date',      dl.deadline_date,
                'already_registered', (mk.status = '待補課'),
                'planned_date',       mk.planned_date,
                'planned_slot',       mk.planned_slot,
                'attend_count',       (SELECT count(*) FROM makeup_attendances ma WHERE ma.makeup_ref = mk.id)
              ) ORDER BY s.date
            ), '[]'::jsonb)
            FROM attendance a
            JOIN sessions s ON s.id = a.session_ref
            LEFT JOIN makeups mk ON mk.member_ref = a.member_ref AND mk.session_ref = a.session_ref
            CROSS JOIN LATERAL (
              -- 2026-07-21 修正：這裡一直停在舊的「週數」公式，跟 2026-07-06 重構27 已經改過的
              -- 「缺課日+40天」對不上——07-15 修調班日期誤擋今天那次，是從更早的舊版本改起，
              -- 不小心把 重構27 這個公式修正蓋掉了，一直沒被發現。改回缺課日+天數，
              -- 跟 register_makeup／kiosk_edit_makeup 等其他地方一致。
              SELECT s.date + COALESCE(st.makeup_deadline_days, 40) AS deadline_date,
                     COALESCE(st.makeup_required_marks, ARRAY['O','LL','A']) AS makeup_required_marks
              FROM settings st WHERE st.class_ref IS NULL LIMIT 1
            ) dl
            WHERE a.member_ref = m.id AND a.mark = ANY (dl.makeup_required_marks)
              AND mk.status IS DISTINCT FROM '已完成'
              AND current_date <= GREATEST(dl.deadline_date, COALESCE(mk.deadline_date, '1970-01-01'::date))
          ),
          -- 本班未上堂次（供調班用）
          'upcoming', (
            SELECT COALESCE(jsonb_agg(
              jsonb_build_object('session_ref', s3.id, 'date', s3.date, 'week_num', s3.week_num) ORDER BY s3.date
            ), '[]'::jsonb)
            FROM sessions s3 WHERE s3.class_ref = m.class_ref AND s3.date >= current_date
          ),
          -- 本班同級別他班（供調班用）
          'targets', (
            SELECT COALESCE(jsonb_agg(
              jsonb_build_object(
                'class_ref',  c2.id, 'class_name', c2.class_name,
                'sessions', (
                  SELECT COALESCE(jsonb_agg(jsonb_build_object('week_num', s2.week_num, 'date', s2.date) ORDER BY s2.week_num), '[]'::jsonb)
                  FROM sessions s2 WHERE s2.class_ref = c2.id
                )
              )
            ), '[]'::jsonb)
            FROM classes c2 WHERE c2.level = c.level AND c2.status = '進行中' AND c2.id <> m.class_ref
          )
        ) ORDER BY m.id
      ), '[]'::jsonb)
      FROM members m JOIN classes c ON c.id = m.class_ref
      WHERE m.member_id = v_member_id AND m.status = '在學'
    )
  );
END;
$$;

CREATE OR REPLACE FUNCTION kiosk_register_makeup(
  p_staff_id     bigint,
  p_member_db_id bigint,
  p_session_ref  bigint,
  p_earphone     bool    DEFAULT NULL,
  p_planned_date date    DEFAULT NULL,
  p_planned_slot text    DEFAULT NULL,
  p_note         text    DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_member   RECORD;
  v_session  RECORD;
  v_set      RECORD;
  v_next_mon date;
  v_earliest date;
  v_deadline date;
BEGIN
  PERFORM _kiosk_verify_staff(p_staff_id);

  SELECT id, class_ref, status INTO v_member FROM members WHERE id = p_member_db_id;
  IF NOT FOUND OR v_member.status <> '在學' THEN
    RAISE EXCEPTION '查無在學學員';
  END IF;

  SELECT id, date, class_ref INTO v_session FROM sessions WHERE id = p_session_ref;
  IF NOT FOUND OR v_session.class_ref <> v_member.class_ref THEN
    RAISE EXCEPTION '堂次不存在或不屬於此學員班級';
  END IF;

  IF p_planned_date IS NULL OR p_planned_slot IS NULL THEN
    RAISE EXCEPTION '請填預約日期與時間';
  END IF;

  -- 黑名單日期＋每日補課時段檢查（共用函式，定義於 rpc_04a_register_makeup.sql）
  PERFORM _check_makeup_slot_allowed(p_planned_date, p_planned_slot);

  SELECT makeup_earliest_mode, makeup_earliest_days, makeup_deadline_days
    INTO v_set FROM settings WHERE class_ref IS NULL LIMIT 1;

  v_next_mon := date_trunc('week', v_session.date::timestamp)::date + 7;
  v_earliest := CASE
    WHEN COALESCE(v_set.makeup_earliest_mode,'下週一') = '下週一' THEN v_next_mon
    ELSE v_session.date + COALESCE(v_set.makeup_earliest_days, 7)
  END;
  v_deadline := v_session.date + COALESCE(v_set.makeup_deadline_days, 40);

  INSERT INTO makeups (
    member_ref, session_ref, method, earphone,
    planned_date, planned_slot, earliest_date, deadline_date, note, status, registered_by
  ) VALUES (
    p_member_db_id, p_session_ref, '影音', p_earphone,
    p_planned_date, p_planned_slot, v_earliest, v_deadline, p_note, '待補課', '櫃台'
  )
  ON CONFLICT (member_ref, session_ref) DO UPDATE SET
    earphone = EXCLUDED.earphone, planned_date = EXCLUDED.planned_date,
    planned_slot = EXCLUDED.planned_slot, earliest_date = EXCLUDED.earliest_date,
    deadline_date = EXCLUDED.deadline_date, note = EXCLUDED.note,
    status = '待補課', registered_by = '櫃台', updated_at = now();

  RETURN '{"ok":true}'::jsonb;
END;
$$;

CREATE OR REPLACE FUNCTION kiosk_edit_makeup(
  p_staff_id     bigint,
  p_makeup_id    bigint,
  p_session_ref  bigint,
  p_earphone     bool DEFAULT NULL,
  p_planned_date date DEFAULT NULL,
  p_planned_slot text DEFAULT NULL,
  p_note         text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_makeup   RECORD;
  v_session  RECORD;
  v_days     int;
  v_deadline date;
BEGIN
  PERFORM _kiosk_verify_staff(p_staff_id);

  SELECT id, member_ref, session_ref, status INTO v_makeup
  FROM makeups WHERE id = p_makeup_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION '查無此補課登記';
  END IF;
  IF v_makeup.status = '已完成' THEN
    RAISE EXCEPTION '此筆補課已完成，無法編輯';
  END IF;

  SELECT id, date, class_ref INTO v_session FROM sessions WHERE id = p_session_ref;
  IF NOT FOUND THEN
    RAISE EXCEPTION '查無此堂次';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM members m WHERE m.id = v_makeup.member_ref AND m.class_ref = v_session.class_ref
  ) THEN
    RAISE EXCEPTION '此堂次不屬於該學員的班級';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM attendance a WHERE a.member_ref = v_makeup.member_ref AND a.session_ref = p_session_ref
  ) THEN
    RAISE EXCEPTION '該學員此堂次無出缺勤紀錄，不可設為補課堂次';
  END IF;

  PERFORM _check_makeup_slot_allowed(p_planned_date, p_planned_slot);

  SELECT COALESCE(makeup_deadline_days, 40) INTO v_days FROM settings WHERE class_ref IS NULL LIMIT 1;
  v_deadline := v_session.date + v_days;   -- 期限一律系統重算，不接受前端傳入

  IF current_date > v_deadline THEN
    RAISE EXCEPTION '補課期限（%）已過，無法編輯至此堂次', v_deadline;
  END IF;

  BEGIN
    UPDATE makeups SET
      session_ref   = p_session_ref,
      earphone      = p_earphone,
      planned_date  = p_planned_date,
      planned_slot  = p_planned_slot,
      note          = p_note,
      deadline_date = v_deadline,
      updated_at    = now()
    WHERE id = p_makeup_id;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION '該堂次已有其他補課登記，不能重複';
  END;

  RETURN jsonb_build_object('ok', true, 'deadline', v_deadline);
END;
$$;

-- kiosk_register_transfer：6 參數（加 p_note），驗證改用日期基準（fix_調班日期誤擋今天.sql 最終版）
DROP FUNCTION IF EXISTS kiosk_register_transfer(bigint, bigint, bigint, bigint, date);

CREATE OR REPLACE FUNCTION kiosk_register_transfer(
  p_staff_id         bigint,
  p_member_db_id     bigint,
  p_from_session_ref bigint,
  p_to_class_ref     bigint,
  p_to_date          date,
  p_note             text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_class_ref    bigint;
  v_level        text;
  v_sess_class   bigint;
  v_sess_date    date;
  v_tgt_level    text;
  v_tgt_status   text;
BEGIN
  PERFORM _kiosk_verify_staff(p_staff_id);

  SELECT m.class_ref, c.level INTO v_class_ref, v_level
    FROM members m JOIN classes c ON c.id = m.class_ref
   WHERE m.id = p_member_db_id AND m.status = '在學' LIMIT 1;

  IF v_class_ref IS NULL THEN RAISE EXCEPTION '查無在學學員'; END IF;

  SELECT class_ref, date INTO v_sess_class, v_sess_date
    FROM sessions WHERE id = p_from_session_ref;
  IF v_sess_class IS DISTINCT FROM v_class_ref THEN RAISE EXCEPTION '堂次不屬於學員所在班別'; END IF;
  IF v_sess_date < current_date THEN RAISE EXCEPTION '此堂次已過期，不可調班'; END IF;

  SELECT level, status INTO v_tgt_level, v_tgt_status FROM classes WHERE id = p_to_class_ref;
  IF v_tgt_level IS DISTINCT FROM v_level THEN RAISE EXCEPTION '目標班別級別不符'; END IF;
  IF v_tgt_status <> '進行中' THEN RAISE EXCEPTION '目標班別非進行中'; END IF;
  IF p_to_class_ref = v_class_ref THEN RAISE EXCEPTION '不能調到自己的班'; END IF;
  IF p_to_date IS NULL THEN RAISE EXCEPTION '請填寫去上課日期'; END IF;

  INSERT INTO transfers (member_ref, from_session_ref, to_class_ref, to_date, status, registered_by, note)
  VALUES (p_member_db_id, p_from_session_ref, p_to_class_ref, p_to_date, '已登記', '櫃台', p_note)
  ON CONFLICT (member_ref, from_session_ref)
  DO UPDATE SET to_class_ref = EXCLUDED.to_class_ref, to_date = EXCLUDED.to_date,
                status = '已登記', registered_by = '櫃台', note = EXCLUDED.note;

  RETURN '{"ok":true}'::jsonb;
END;
$$;

-- kiosk_edit_transfer_note（transfers 表本身有 updated_at 觸發器，這裡不用另外手動設 updated_at）
CREATE OR REPLACE FUNCTION kiosk_edit_transfer_note(p_staff_id bigint, p_transfer_id bigint, p_note text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM _kiosk_verify_staff(p_staff_id);

  UPDATE transfers SET note = p_note WHERE id = p_transfer_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION '找不到日夜補登記（id=%）', p_transfer_id;
  END IF;

  RETURN '{"ok":true}'::jsonb;
END;
$$;

-- kiosk_get_today_registrations：today = created_at 或 updated_at 是今天（fix_今日登記清單含編輯.sql 最終版）
CREATE OR REPLACE FUNCTION kiosk_get_today_registrations(p_staff_id bigint)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM _kiosk_verify_staff(p_staff_id);

  RETURN jsonb_build_object(
    'makeups', (
      SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
          'makeup_id',     mk.id,
          'member_name',   m.name,
          'class_name',    c.class_name,
          'session_date',  s.date,
          'planned_date',  mk.planned_date,
          'planned_slot',  mk.planned_slot,
          'status',        mk.status,
          'attend_count',  (SELECT count(*) FROM makeup_attendances ma WHERE ma.makeup_ref = mk.id)
        ) ORDER BY mk.created_at
      ), '[]'::jsonb)
      FROM makeups mk
      JOIN members m  ON m.id  = mk.member_ref
      JOIN classes c  ON c.id  = m.class_ref
      JOIN sessions s ON s.id  = mk.session_ref
      WHERE (mk.created_at AT TIME ZONE 'Asia/Taipei')::date
          = (now()         AT TIME ZONE 'Asia/Taipei')::date
         OR (mk.updated_at AT TIME ZONE 'Asia/Taipei')::date
          = (now()         AT TIME ZONE 'Asia/Taipei')::date
    ),
    'transfers', (
      SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
          'transfer_id',     t.id,
          'member_name',     m.name,
          'from_class_name', fc.class_name,
          'to_class_name',   tc.class_name,
          'to_date',         t.to_date,
          'status',          t.status
        ) ORDER BY t.created_at
      ), '[]'::jsonb)
      FROM transfers t
      JOIN members  m  ON m.id  = t.member_ref
      JOIN sessions s  ON s.id  = t.from_session_ref
      JOIN classes  fc ON fc.id = s.class_ref
      JOIN classes  tc ON tc.id = t.to_class_ref
      WHERE (t.created_at AT TIME ZONE 'Asia/Taipei')::date
          = (now()        AT TIME ZONE 'Asia/Taipei')::date
         OR (t.updated_at AT TIME ZONE 'Asia/Taipei')::date
          = (now()        AT TIME ZONE 'Asia/Taipei')::date
    )
  );
END;
$$;

-- kiosk_get_attendance_alerts：到場提醒＋完全沒到場警示（fix_點名補課完成名單與到場提醒排除已完成.sql 最終版，
-- no_show 區塊已補 member_id/session_date/earphone/note 供前端顯示「編輯」「取消登記」按鈕）
CREATE OR REPLACE FUNCTION kiosk_get_attendance_alerts(p_staff_id bigint)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM _kiosk_verify_staff(p_staff_id);

  RETURN jsonb_build_object(
    -- 到場中超過 3 小時，還沒按「此堂課尚未補完」或「補課完成」結案
    -- （加 mk.status='待補課'：已完成的補課裡，殘留沒關閉的舊到場紀錄不要再算）
    'overdue_attendance', (
      SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
          'makeup_id',    mk.id,
          'member_name',  m.name,
          'class_name',   c.class_name,
          'attended_at',  ma.attended_at
        ) ORDER BY ma.attended_at
      ), '[]'::jsonb)
      FROM makeup_attendances ma
      JOIN makeups mk ON mk.id = ma.makeup_ref
      JOIN members m  ON m.id  = mk.member_ref
      JOIN classes c  ON c.id  = m.class_ref
      WHERE ma.departed_at IS NULL
        AND ma.attended_at <= now() - interval '3 hours'
        AND mk.status = '待補課'
    ),
    -- 已登記補課、預約時段已過（緩衝 1 小時），完全沒有到場紀錄
    -- member_id/session_date/earphone/note：給前端「編輯」表單用（改期或補資料），
    -- 跟今日補課清單卡片的編輯表單需要的欄位一致
    'no_show', (
      SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
          'makeup_id',     mk.id,
          'member_id',     m.member_id,
          'member_name',   m.name,
          'class_name',    c.class_name,
          'session_date',  s.date,
          'earphone',      mk.earphone,
          'note',          mk.note,
          'planned_date',  mk.planned_date,
          'planned_slot',  mk.planned_slot
        ) ORDER BY mk.planned_date, mk.planned_slot
      ), '[]'::jsonb)
      FROM makeups mk
      JOIN members m  ON m.id  = mk.member_ref
      JOIN classes c  ON c.id  = m.class_ref
      JOIN sessions s ON s.id  = mk.session_ref
      WHERE mk.status = '待補課'
        AND mk.planned_date IS NOT NULL
        AND mk.planned_slot IS NOT NULL
        AND (now() AT TIME ZONE 'Asia/Taipei') - interval '1 hour'
              >= (mk.planned_date + mk.planned_slot::time)::timestamp
        AND NOT EXISTS (
          SELECT 1 FROM makeup_attendances ma2 WHERE ma2.makeup_ref = mk.id
        )
    ),
    -- 2026-07-24 新增：已登記日↔夜間調班補課、目標班上課時間已過（緩衝 1 小時），
    -- 狀態仍是「已登記」（沒人標已出席也沒人標未到）。時間判斷比照 kiosk_transfer_attend
    -- 算遲到用的同一組欄位（t.to_date + tc.start_time），跟補課 no_show 用的緩衝一致（1 小時）。
    'transfer_no_show', (
      SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
          'transfer_id',     t.id,
          'member_name',     m.name,
          'from_class_name', fc.class_name,
          'to_class_name',   tc.class_name,
          'to_date',         t.to_date,
          'note',            t.note
        ) ORDER BY t.to_date
      ), '[]'::jsonb)
      FROM transfers t
      JOIN members  m  ON m.id  = t.member_ref
      JOIN sessions s  ON s.id  = t.from_session_ref
      JOIN classes  fc ON fc.id = s.class_ref
      JOIN classes  tc ON tc.id = t.to_class_ref
      WHERE t.status = '已登記'
        AND tc.start_time IS NOT NULL
        AND (now() AT TIME ZONE 'Asia/Taipei') - interval '1 hour'
              >= (t.to_date + tc.start_time)::timestamp
    )
  );
END;
$$;

CREATE OR REPLACE FUNCTION kiosk_makeup_cancel_attend(p_staff_id bigint, p_makeup_id bigint)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM _kiosk_verify_staff(p_staff_id);

  DELETE FROM makeup_attendances
  WHERE id = (
    SELECT id FROM makeup_attendances
    WHERE makeup_ref = p_makeup_id AND departed_at IS NULL
    ORDER BY attended_at DESC LIMIT 1
  );

  IF NOT FOUND THEN
    RAISE EXCEPTION '找不到進行中的到場紀錄（makeup_id=%）', p_makeup_id;
  END IF;

  RETURN '{"ok":true}'::jsonb;
END;
$$;

-- kiosk_training_makeup_cancel_attend（2026-07-22 新增，培訓補課版本）
CREATE OR REPLACE FUNCTION kiosk_training_makeup_cancel_attend(p_staff_id bigint, p_training_makeup_id bigint)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM _kiosk_verify_staff(p_staff_id);

  DELETE FROM training_makeup_attendances
  WHERE id = (
    SELECT id FROM training_makeup_attendances
    WHERE training_makeup_ref = p_training_makeup_id AND departed_at IS NULL
    ORDER BY attended_at DESC LIMIT 1
  );

  IF NOT FOUND THEN
    RAISE EXCEPTION '找不到進行中的到場紀錄（training_makeup_id=%）', p_training_makeup_id;
  END IF;

  RETURN '{"ok":true}'::jsonb;
END;
$$;

CREATE OR REPLACE FUNCTION admin_makeup_cancel_attend(p_attendance_id bigint)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM makeup_attendances WHERE id = p_attendance_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION '找不到到場紀錄（id=%）', p_attendance_id;
  END IF;

  RETURN '{"ok":true}'::jsonb;
END;
$$;

CREATE OR REPLACE FUNCTION kiosk_transfer_reset_to_registered(p_staff_id bigint, p_transfer_id bigint)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM _kiosk_verify_staff(p_staff_id);

  UPDATE transfers
     SET status = '已登記', attended_at = NULL, late_mark = NULL
   WHERE id = p_transfer_id AND status IN ('已出席', '未到');

  IF NOT FOUND THEN
    RAISE EXCEPTION '找不到可重設的日夜補登記（id=%），僅「已出席」或「未到」狀態可重設', p_transfer_id;
  END IF;

  RETURN '{"ok":true}'::jsonb;
END;
$$;

CREATE OR REPLACE FUNCTION admin_transfer_reset_to_registered(p_transfer_id bigint)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE transfers
     SET status = '已登記', attended_at = NULL, late_mark = NULL
   WHERE id = p_transfer_id AND status IN ('已出席', '未到');

  IF NOT FOUND THEN
    RAISE EXCEPTION '找不到可重設的日夜補登記（id=%），僅「已出席」或「未到」狀態可重設', p_transfer_id;
  END IF;

  RETURN '{"ok":true}'::jsonb;
END;
$$;

CREATE OR REPLACE FUNCTION kiosk_cancel_makeup(p_staff_id bigint, p_makeup_id bigint)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_status       text;
  v_attend_count integer;
BEGIN
  PERFORM _kiosk_verify_staff(p_staff_id);

  SELECT status INTO v_status FROM makeups WHERE id = p_makeup_id;
  IF v_status IS NULL THEN
    RAISE EXCEPTION '找不到補課登記（id=%）', p_makeup_id;
  END IF;

  SELECT count(*) INTO v_attend_count FROM makeup_attendances WHERE makeup_ref = p_makeup_id;

  IF v_status <> '待補課' OR v_attend_count > 0 THEN
    RAISE EXCEPTION '已有到場紀錄，請洽後台處理';
  END IF;

  DELETE FROM makeups WHERE id = p_makeup_id;

  RETURN '{"ok":true}'::jsonb;
END;
$$;

CREATE OR REPLACE FUNCTION kiosk_cancel_transfer(p_staff_id bigint, p_transfer_id bigint)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_status text;
BEGIN
  PERFORM _kiosk_verify_staff(p_staff_id);

  SELECT status INTO v_status FROM transfers WHERE id = p_transfer_id;
  IF v_status IS NULL THEN
    RAISE EXCEPTION '找不到日夜補登記（id=%）', p_transfer_id;
  END IF;

  IF v_status <> '已登記' THEN
    RAISE EXCEPTION '已有到場紀錄，請洽後台處理';
  END IF;

  DELETE FROM transfers WHERE id = p_transfer_id;

  RETURN '{"ok":true}'::jsonb;
END;
$$;

-- kiosk_transfer_mark_absent（2026-07-24 新增）：對應「調班未到」警示區塊的「標未到」按鈕，
-- 義工端版本，比照既有後台 admin_transfer_mark_absent 的邏輯，僅加上 staff 驗證與狀態檢查
-- （只允許「已登記」狀態才能標未到，避免誤按覆蓋已出席的紀錄）。
CREATE OR REPLACE FUNCTION kiosk_transfer_mark_absent(p_staff_id bigint, p_transfer_id bigint)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM _kiosk_verify_staff(p_staff_id);

  UPDATE transfers SET status = '未到' WHERE id = p_transfer_id AND status = '已登記';

  IF NOT FOUND THEN
    RAISE EXCEPTION '找不到可標未到的日夜補登記（id=%），僅「已登記」狀態可標未到', p_transfer_id;
  END IF;

  RETURN '{"ok":true}'::jsonb;
END;
$$;

-- 義工櫃台姓名查詢（完整姓名精確比對，撞名時回候選清單）
CREATE OR REPLACE FUNCTION kiosk_lookup_member_by_name(p_staff_id bigint, p_name text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_name text := trim(p_name);
  v_ids  text[];
BEGIN
  PERFORM _kiosk_verify_staff(p_staff_id);

  IF v_name = '' THEN
    RETURN '{"found":false,"reason":"請輸入姓名"}'::jsonb;
  END IF;

  SELECT array_agg(DISTINCT m.member_id) INTO v_ids
    FROM members m WHERE m.name ILIKE v_name AND m.status = '在學';

  IF v_ids IS NULL OR array_length(v_ids, 1) = 0 THEN
    RETURN '{"found":false,"reason":"查無在學學員，請確認姓名完整正確，或改用編號查詢"}'::jsonb;
  END IF;

  -- 只有一位（不論該生是不是多班在學）：直接沿用既有編號查詢邏輯回傳完整資料，不重複寫一份
  IF array_length(v_ids, 1) = 1 THEN
    RETURN kiosk_lookup_member(p_staff_id, v_ids[1]);
  END IF;

  -- 撞名（多位不同學員同名同姓）：回傳候選人清單，每人一筆＋一個代表班別，供前端做挑人畫面
  RETURN jsonb_build_object(
    'found', false,
    'multiple', true,
    'candidates', (
      SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
          'member_id',  m.member_id,
          'name',       m.name,
          'class_name', (SELECT class_name FROM classes WHERE id = m.class_ref)
        ) ORDER BY m.member_id
      ), '[]'::jsonb)
      FROM (
        SELECT DISTINCT ON (m2.member_id) m2.id, m2.member_id, m2.name, m2.class_ref
        FROM members m2 WHERE m2.member_id = ANY(v_ids) AND m2.status = '在學'
        ORDER BY m2.member_id, m2.id
      ) m
    )
  );
END;
$$;

-- 義工櫃台即時姓名搜尋（局部比對，固定回傳建議清單）
CREATE OR REPLACE FUNCTION kiosk_search_members_by_name(p_staff_id bigint, p_query text, p_limit int DEFAULT 15)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_query text := trim(p_query);
  v_limit int  := LEAST(GREATEST(COALESCE(p_limit, 15), 1), 30);
BEGIN
  PERFORM _kiosk_verify_staff(p_staff_id);

  IF v_query = '' THEN
    RETURN '[]'::jsonb;
  END IF;

  RETURN (
    SELECT COALESCE(jsonb_agg(
      jsonb_build_object('member_id', y.member_id, 'name', y.name, 'class_name', y.class_name)
    ), '[]'::jsonb)
    FROM (
      SELECT x.member_id, x.name, x.class_name
      FROM (
        -- 同一人多班在學只取一筆代表班別（跟重構42 撞名清單同樣做法）
        SELECT DISTINCT ON (m.member_id)
               m.member_id, m.name, (SELECT class_name FROM classes WHERE id = m.class_ref) AS class_name
        FROM members m
        WHERE m.name ILIKE '%' || v_query || '%' AND m.status = '在學'
        ORDER BY m.member_id, m.id
      ) x
      ORDER BY x.name
      LIMIT v_limit
    ) y
  );
END;
$$;

-- 舊前端相容用（get_training_courses，已停用但保留）
CREATE OR REPLACE FUNCTION get_training_courses()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'id',          id,
      'name',        name,
      'course_date', course_date,
      'course_time', to_char(course_time, 'HH24:MI')
    ) ORDER BY course_date, course_time
  ), '[]'::jsonb)
  FROM training_courses
  WHERE is_active = true
    AND course_date >= current_date;
$$;

-- 義工櫃台今日操作紀錄（顯示今天所有到場/離場事件）
CREATE OR REPLACE FUNCTION kiosk_get_today_log(p_staff_id bigint)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM _kiosk_verify_staff(p_staff_id);

  -- 2026-07-22 培訓補課加入到場/機台流程後，機台號碼跟影片補課共用同一批，
  -- 「今日到場記錄」（機台佔用狀態的依據，見 kiosk.js computeMachineStatus）
  -- 要把培訓補課的到場紀錄一起 UNION 進來，不然同一台機台被培訓補課佔用時，
  -- 義工端的機台選單還是會誤判成空機、造成兩邊同時選同一台。
  RETURN COALESCE((
    SELECT jsonb_agg(row_data ORDER BY (row_data->>'attended_at')::timestamptz)
    FROM (
      SELECT jsonb_build_object(
        'attended_at',    ma.attended_at,
        'departed_at',    ma.departed_at,
        'late_mark',      ma.late_mark,
        'machine_number', ma.machine_number,
        'member_name',    m.name,
        'class_name',     c.class_name,
        'session_date',   s.date,
        'status',         mk.status
      ) AS row_data
      FROM makeup_attendances ma
      JOIN makeups  mk ON mk.id  = ma.makeup_ref
      JOIN members  m  ON m.id   = ma.member_ref
      JOIN sessions s  ON s.id   = mk.session_ref
      JOIN classes  c  ON c.id   = m.class_ref
      WHERE (ma.attended_at AT TIME ZONE 'Asia/Taipei')::date
          = (now()          AT TIME ZONE 'Asia/Taipei')::date

      UNION ALL

      SELECT jsonb_build_object(
        'attended_at',    tma.attended_at,
        'departed_at',    tma.departed_at,
        'late_mark',      NULL,
        'machine_number', tma.machine_number,
        'member_name',    m.name,
        'class_name',     tc.name,
        'session_date',   ts.session_date,
        'status',         tm.status
      ) AS row_data
      FROM training_makeup_attendances tma
      JOIN training_makeups  tm ON tm.id  = tma.training_makeup_ref
      JOIN members           m  ON m.id   = tma.member_ref
      JOIN training_sessions ts ON ts.id  = tm.training_session_ref
      JOIN training_classes  tc ON tc.id  = ts.class_ref
      WHERE (tma.attended_at AT TIME ZONE 'Asia/Taipei')::date
          = (now()           AT TIME ZONE 'Asia/Taipei')::date
    ) combined
  ), '[]'::jsonb);
END;
$$;

-- ── 7.12 zenclass 自動排程同步（函式保留，預設不排程，見檔頭說明）──
CREATE OR REPLACE FUNCTION cron_sync_kiosk_attendance()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_api_base   CONSTANT text := 'https://zenclass.ctcm.org.tw';  -- ⚠️ 寫死普宜精舍網域，其他精舍需自行確認
  v_unit_id    CONSTANT text := 'UNIT01071';                     -- ⚠️ 寫死普宜精舍代號，其他精舍需自行改成自己的
  v_includes   CONSTANT text :=
    'attendMark,memberId,aliasName,ctDharmaName,classGroupId,memberGroupNum,'
    || 'attendCheckinDtTm,classId,className,classStartTime,classEndTime,dayOfWeek,isDroppedClass';
  v_today      date := (now() AT TIME ZONE 'Asia/Taipei')::date;
  v_dow        text;
  v_class      RECORD;
  v_req_id     bigint;
  v_batch      jsonb := '[]'::jsonb;
  v_item       jsonb;
  v_total_ok   int := 0;
  v_total_fail int := 0;
BEGIN
  v_dow := CASE extract(dow from v_today)
    WHEN 0 THEN '日' WHEN 1 THEN '一' WHEN 2 THEN '二' WHEN 3 THEN '三'
    WHEN 4 THEN '四' WHEN 5 THEN '五' WHEN 6 THEN '六'
  END;

  FOR v_class IN
    SELECT id, class_id, class_name, level, day_night, day_of_week, start_time, end_time
    FROM classes
    WHERE day_of_week = v_dow
      AND status = '進行中'
      AND class_id NOT LIKE 'MANUAL-%'
  LOOP
    BEGIN
      v_req_id := net.http_get(
        url := v_api_base || '/meditation/api/kiosk/class_attend_records'
               || '?classDate=' || v_today::text
               || '&classId=' || v_class.class_id
               || '&includes=' || v_includes,
        timeout_milliseconds := 5000
      );
      v_batch := v_batch || jsonb_build_object(
        'request_id',  v_req_id,
        'class_ref',   v_class.id,
        'class_id',    v_class.class_id,
        'class_name',  v_class.class_name,
        'level',       v_class.level,
        'day_night',   v_class.day_night,
        'day_of_week', v_class.day_of_week,
        'start_time',  v_class.start_time,
        'end_time',    v_class.end_time
      );
    EXCEPTION WHEN OTHERS THEN
      v_total_fail := v_total_fail + 1;
      INSERT INTO cron_sync_log (class_id, class_name, ok, error_msg)
      VALUES (v_class.class_id, v_class.class_name, false, 'http_get 發送失敗：' || SQLERRM);
      RAISE WARNING '[cron_sync_kiosk_attendance] % 發送 http_get 失敗：%', v_class.class_name, SQLERRM;
    END;
  END LOOP;

  IF jsonb_array_length(v_batch) = 0 THEN
    RETURN jsonb_build_object('ok', true, 'date', v_today, 'day_of_week', v_dow,
                               'success', 0, 'failed', v_total_fail, 'note', '今天沒有符合條件的班');
  END IF;

  PERFORM pg_sleep(3);

  FOR v_item IN SELECT * FROM jsonb_array_elements(v_batch)
  LOOP
    DECLARE
      v_resp      RECORD;
      v_json      jsonb;
      v_items     jsonb;
      v_p_class   jsonb;
      v_p_records jsonb;
      v_result    jsonb;
      v_cid       text := v_item->>'class_id';
      v_cname     text := v_item->>'class_name';
    BEGIN
      SELECT status_code, content INTO v_resp
      FROM net._http_response
      WHERE id = (v_item->>'request_id')::bigint;

      IF NOT FOUND OR v_resp.status_code IS DISTINCT FROM 200 THEN
        RAISE EXCEPTION 'zenclass API 無回應或非 200（status_code=%）', v_resp.status_code;
      END IF;

      v_json := v_resp.content::jsonb;
      IF (v_json->>'errCode')::int IS DISTINCT FROM 200 THEN
        RAISE EXCEPTION 'zenclass errCode=%', v_json->>'errCode';
      END IF;

      v_items := COALESCE(v_json->'items', '[]'::jsonb);

      v_p_class := jsonb_build_object(
        'class_id',     v_cid,
        'class_name',   v_cname,
        'level',        v_item->>'level',
        'day_night',    v_item->>'day_night',
        'day_of_week',  v_item->>'day_of_week',
        'start_time',   v_item->>'start_time',
        'end_time',     v_item->>'end_time',
        'period_num',   NULL,
        'week_num',     NULL,
        'is_cancelled', false
      );

      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'member_id',    it->>'memberId',
        'name',         COALESCE(it->>'aliasName', ''),
        'dharma_name',  COALESCE(it->>'ctDharmaName', ''),
        'group_id',     COALESCE(it->>'classGroupId', ''),
        'group_num',    COALESCE(it->>'memberGroupNum', ''),
        'mark',         it->>'attendMark',
        'checkin_time', it->>'attendCheckinDtTm',
        'is_dropped',   COALESCE((it->>'isDroppedClass')::bool, false)
      )), '[]'::jsonb)
      INTO v_p_records
      FROM jsonb_array_elements(v_items) AS it
      WHERE COALESCE((it->>'isDroppedClass')::bool, false) = false;

      v_result := ingest_kiosk_attendance(v_unit_id, v_today, v_p_class, v_p_records);

      v_total_ok := v_total_ok + 1;
      INSERT INTO cron_sync_log (class_id, class_name, ok, synced)
      VALUES (v_cid, v_cname, true, (v_result->>'synced')::int);
    EXCEPTION WHEN OTHERS THEN
      v_total_fail := v_total_fail + 1;
      INSERT INTO cron_sync_log (class_id, class_name, ok, error_msg)
      VALUES (v_cid, v_cname, false, SQLERRM);
      RAISE WARNING '[cron_sync_kiosk_attendance] % 同步失敗：%', v_cname, SQLERRM;
    END;
  END LOOP;

  RETURN jsonb_build_object(
    'ok', true, 'date', v_today, 'day_of_week', v_dow,
    'success', v_total_ok, 'failed', v_total_fail
  );
END;
$$;
-- 不主動 cron.schedule：Supabase 端 pg_net 連不到 zenclass.ctcm.org.tw（本會期已證實走不通），
-- 正式環境改用現場電腦 PowerShell + Windows 工作排程器（grabber/setup_schedule.bat）。
-- 若新精舍要嘗試啟用，自行執行 SELECT cron.schedule(...) 並先改好 v_api_base／v_unit_id。


-- ============================================================
-- 第 8 節：函式執行權限（REVOKE PUBLIC → 只 GRANT 需要的角色）
-- 內部函式（_ 開頭）：只 REVOKE，不對外 GRANT。
-- ============================================================

-- 8.1 登入
REVOKE EXECUTE ON FUNCTION login_by_member(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION login_my_classes(text) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION login_by_member(text) TO anon;
GRANT  EXECUTE ON FUNCTION login_my_classes(text) TO anon;

-- 8.2 查詢視圖 ＋ 稽核／首頁警示
REVOKE EXECUTE ON FUNCTION _members_with_marks(bigint, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION get_student_view(bigint)          FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION get_group_view(bigint)             FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION get_class_view(bigint)             FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION get_today_rollcall(bigint)         FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION list_audit_classes()               FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION get_class_audit_snapshot(bigint)   FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION auto_bind_class_id(bigint, text)   FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION get_student_view(bigint)           TO anon;
GRANT  EXECUTE ON FUNCTION get_group_view(bigint)             TO anon;
GRANT  EXECUTE ON FUNCTION get_class_view(bigint)             TO anon;
GRANT  EXECUTE ON FUNCTION get_today_rollcall(bigint)         TO anon;
GRANT  EXECUTE ON FUNCTION list_audit_classes()               TO anon, authenticated;
GRANT  EXECUTE ON FUNCTION get_class_audit_snapshot(bigint)   TO anon;
GRANT  EXECUTE ON FUNCTION auto_bind_class_id(bigint, text)   TO anon;

-- 8.3 補課規則
REVOKE EXECUTE ON FUNCTION get_makeup_rules() FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION get_makeup_rules() TO anon, authenticated;

-- 8.4a 補課登記／取消（學員本人／學長班長代登記）
REVOKE EXECUTE ON FUNCTION _verify_leader_scope(bigint, bigint)                                    FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION _check_makeup_slot_allowed(date, text)                                   FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION register_makeup(bigint, bigint, text, text, bool, date, text, bigint)     FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION cancel_makeup(bigint, bigint, bigint)                                    FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION _check_makeup_slot_allowed(date, text)                                   TO anon, authenticated;
GRANT  EXECUTE ON FUNCTION register_makeup(bigint, bigint, text, text, bool, date, text, bigint)     TO anon;
GRANT  EXECUTE ON FUNCTION cancel_makeup(bigint, bigint, bigint)                                    TO anon;

-- 8.4b 日夜補（調班）
REVOKE EXECUTE ON FUNCTION get_transfer_view(bigint)                              FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION register_transfer(bigint, bigint, bigint, date, bigint) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION cancel_transfer(bigint, bigint, bigint)                 FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION get_transfer_view(bigint)                              TO anon;
GRANT  EXECUTE ON FUNCTION register_transfer(bigint, bigint, bigint, date, bigint) TO anon;
GRANT  EXECUTE ON FUNCTION cancel_transfer(bigint, bigint, bigint)                 TO anon;

-- 8.5 後台管理（authenticated 限定）
REVOKE EXECUTE ON FUNCTION admin_student_stats(bigint)                                                     FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION complete_makeup(bigint, date)                                                    FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION uncomplete_makeup(bigint)                                                        FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION admin_backfill_makeup(bigint, bigint, text, text, bool, text, date, text)        FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION admin_register_late_makeup(bigint, bigint, text, text, bool, text, date, text)   FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION merge_manual_class_into_real(bigint, bigint)                                     FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION remove_dropped_members(bigint, text[])                                           FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION admin_transfer_mark_attended(bigint, text)                                       FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION admin_transfer_mark_absent(bigint)                                               FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION admin_transfer_set_ctis_updated(bigint, boolean)                                 FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION admin_edit_attendance_mark(bigint, text, boolean)                                FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION admin_makeup_cancel_attend(bigint)                                               FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION admin_transfer_reset_to_registered(bigint)                                       FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION admin_student_stats(bigint)                                                     TO authenticated;
GRANT  EXECUTE ON FUNCTION complete_makeup(bigint, date)                                                    TO authenticated;
GRANT  EXECUTE ON FUNCTION uncomplete_makeup(bigint)                                                        TO authenticated;
GRANT  EXECUTE ON FUNCTION admin_backfill_makeup(bigint, bigint, text, text, bool, text, date, text)        TO authenticated;
GRANT  EXECUTE ON FUNCTION admin_register_late_makeup(bigint, bigint, text, text, bool, text, date, text)   TO authenticated;
GRANT  EXECUTE ON FUNCTION merge_manual_class_into_real(bigint, bigint)                                     TO authenticated;
GRANT  EXECUTE ON FUNCTION remove_dropped_members(bigint, text[])                                           TO authenticated;
GRANT  EXECUTE ON FUNCTION admin_transfer_mark_attended(bigint, text)                                       TO authenticated;
GRANT  EXECUTE ON FUNCTION admin_transfer_mark_absent(bigint)                                               TO authenticated;
GRANT  EXECUTE ON FUNCTION admin_transfer_set_ctis_updated(bigint, boolean)                                 TO authenticated;
GRANT  EXECUTE ON FUNCTION admin_edit_attendance_mark(bigint, text, boolean)                                TO authenticated;
GRANT  EXECUTE ON FUNCTION admin_makeup_cancel_attend(bigint)                                               TO authenticated;
GRANT  EXECUTE ON FUNCTION admin_transfer_reset_to_registered(bigint)                                       TO authenticated;

-- 8.6 義工帳號
REVOKE EXECUTE ON FUNCTION create_staff(text, text, text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION set_staff_password(bigint, text)      FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION staff_login(text, text)                FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION create_staff(text, text, text, text) TO authenticated;
GRANT  EXECUTE ON FUNCTION set_staff_password(bigint, text)      TO authenticated;
GRANT  EXECUTE ON FUNCTION staff_login(text, text)                TO anon, authenticated;

-- 8.7 義工櫃台（kiosk）
REVOKE EXECUTE ON FUNCTION _kiosk_verify_staff(bigint)                                          FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION kiosk_get_day(bigint, date)                                          FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION kiosk_training_makeup_complete(bigint, bigint)                       FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION kiosk_training_makeup_attend(bigint, bigint, integer)                FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION kiosk_training_makeup_depart(bigint, bigint)                         FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION kiosk_training_makeup_cancel_attend(bigint, bigint)                  FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION kiosk_transfer_attend(bigint, bigint)                                FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION kiosk_makeup_attend(bigint, bigint, integer)                         FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION kiosk_makeup_complete(bigint, bigint)                                FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION kiosk_makeup_depart(bigint, bigint)                                  FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION kiosk_lookup_member(bigint, text)                                    FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION kiosk_register_makeup(bigint, bigint, bigint, bool, date, text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION kiosk_edit_makeup(bigint, bigint, bigint, bool, date, text, text)     FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION kiosk_register_transfer(bigint, bigint, bigint, bigint, date, text)   FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION kiosk_edit_transfer_note(bigint, bigint, text)                        FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION kiosk_get_today_registrations(bigint)                                FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION kiosk_get_attendance_alerts(bigint)                                  FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION kiosk_makeup_cancel_attend(bigint, bigint)                            FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION kiosk_transfer_reset_to_registered(bigint, bigint)                    FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION kiosk_cancel_makeup(bigint, bigint)                                  FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION kiosk_cancel_transfer(bigint, bigint)                                FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION kiosk_transfer_mark_absent(bigint, bigint)                           FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION kiosk_lookup_member_by_name(bigint, text)                            FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION kiosk_search_members_by_name(bigint, text, int)                      FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION kiosk_get_today_log(bigint)                                          FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION kiosk_get_day(bigint, date)                                          TO anon;
GRANT  EXECUTE ON FUNCTION kiosk_training_makeup_complete(bigint, bigint)                       TO anon;
GRANT  EXECUTE ON FUNCTION kiosk_training_makeup_attend(bigint, bigint, integer)                TO anon;
GRANT  EXECUTE ON FUNCTION kiosk_training_makeup_depart(bigint, bigint)                         TO anon;
GRANT  EXECUTE ON FUNCTION kiosk_training_makeup_cancel_attend(bigint, bigint)                  TO anon;
GRANT  EXECUTE ON FUNCTION kiosk_transfer_attend(bigint, bigint)                                TO anon;
GRANT  EXECUTE ON FUNCTION kiosk_makeup_attend(bigint, bigint, integer)                         TO anon;
GRANT  EXECUTE ON FUNCTION kiosk_makeup_complete(bigint, bigint)                                TO anon;
GRANT  EXECUTE ON FUNCTION kiosk_makeup_depart(bigint, bigint)                                  TO anon;
GRANT  EXECUTE ON FUNCTION kiosk_lookup_member(bigint, text)                                    TO anon;
GRANT  EXECUTE ON FUNCTION kiosk_register_makeup(bigint, bigint, bigint, bool, date, text, text) TO anon;
GRANT  EXECUTE ON FUNCTION kiosk_edit_makeup(bigint, bigint, bigint, bool, date, text, text)     TO anon;
GRANT  EXECUTE ON FUNCTION kiosk_register_transfer(bigint, bigint, bigint, bigint, date, text)   TO anon;
GRANT  EXECUTE ON FUNCTION kiosk_edit_transfer_note(bigint, bigint, text)                        TO anon;
GRANT  EXECUTE ON FUNCTION kiosk_get_today_registrations(bigint)                                TO anon;
GRANT  EXECUTE ON FUNCTION kiosk_get_attendance_alerts(bigint)                                  TO anon;
GRANT  EXECUTE ON FUNCTION kiosk_makeup_cancel_attend(bigint, bigint)                            TO anon;
GRANT  EXECUTE ON FUNCTION kiosk_transfer_reset_to_registered(bigint, bigint)                    TO anon;
GRANT  EXECUTE ON FUNCTION kiosk_cancel_makeup(bigint, bigint)                                  TO anon;
GRANT  EXECUTE ON FUNCTION kiosk_cancel_transfer(bigint, bigint)                                TO anon;
GRANT  EXECUTE ON FUNCTION kiosk_transfer_mark_absent(bigint, bigint)                           TO anon;
GRANT  EXECUTE ON FUNCTION kiosk_lookup_member_by_name(bigint, text)                            TO anon;
GRANT  EXECUTE ON FUNCTION kiosk_search_members_by_name(bigint, text, int)                      TO anon;
GRANT  EXECUTE ON FUNCTION kiosk_get_today_log(bigint)                                          TO anon;

-- get_training_courses：舊前端已停用但保留相容
REVOKE EXECUTE ON FUNCTION get_training_courses() FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION get_training_courses() TO anon, authenticated;

-- 8.8 培訓課程子系統
REVOKE EXECUTE ON FUNCTION _validate_training_timing(date, text)                                          FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION get_training_classes()                                                          FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION get_training_sessions(bigint)                                                   FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION get_my_training_makeups(bigint)                                                 FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION register_training_makeup(bigint, bigint, text, date, text, bool)                FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION cancel_training_makeup(bigint, bigint)                                          FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION kiosk_register_training_makeup(bigint, bigint, bigint, text, date, text, bool)  FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION get_training_classes()                                                          TO anon, authenticated;
GRANT  EXECUTE ON FUNCTION get_training_sessions(bigint)                                                   TO anon, authenticated;
GRANT  EXECUTE ON FUNCTION get_my_training_makeups(bigint)                                                 TO anon, authenticated;
GRANT  EXECUTE ON FUNCTION register_training_makeup(bigint, bigint, text, date, text, bool)                TO anon;
GRANT  EXECUTE ON FUNCTION cancel_training_makeup(bigint, bigint)                                          TO anon;
GRANT  EXECUTE ON FUNCTION kiosk_register_training_makeup(bigint, bigint, bigint, text, date, text, bool)  TO anon;

-- 8.9 刷卡資料寫入管道
REVOKE EXECUTE ON FUNCTION ingest_kiosk_attendance(text, date, jsonb, jsonb) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION ingest_kiosk_attendance(text, date, jsonb, jsonb) TO anon;

-- 8.10 zenclass 自動排程同步：內部/手動測試用，不對 anon、authenticated 開放
REVOKE EXECUTE ON FUNCTION cron_sync_kiosk_attendance() FROM PUBLIC;


-- ============================================================
-- 完成！可用以下查詢確認資料表都已建立（應看到 16 張加上 auth 系統表）：
--
-- SELECT table_name FROM information_schema.tables
-- WHERE table_schema = 'public' ORDER BY table_name;
--
-- 確認函式數量（應有 60+ 支 public 函式）：
--
-- SELECT count(*) FROM pg_proc p
-- JOIN pg_namespace n ON n.oid = p.pronamespace
-- WHERE n.nspname = 'public';
-- ============================================================
