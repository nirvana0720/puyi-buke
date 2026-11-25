-- 2026-11-25 測試庫專用（puyi-buke-test）：補建「培訓補課」資料表。
-- 原因：kiosk_get_today_log 會查 training_makeup_attendances，測試庫沒建過這幾張表，所以撤銷測試全部 404。
-- 全部是 IF NOT EXISTS，可重複執行；只貼測試庫，正式環境本來就有，不用貼。

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
