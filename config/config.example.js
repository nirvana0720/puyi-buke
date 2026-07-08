// 職責：全系統集中設定（佔位版，良師父複製成 config.js 並填入真實值）
// 不負責：任何商業邏輯或資料存取

const CONFIG = {
  // === 分院名稱（換分院部署時只改這裡，各頁標題會自動帶入）===
  TEMPLE_NAME: 'REPLACE_YOUR_TEMPLE_NAME',  // 例如：普宜精舍

  // === Supabase 連線（複製成 config.js 後填入真實值）===
  SUPABASE_URL: 'https://REPLACE_YOUR_PROJECT.supabase.co',
  SUPABASE_ANON_KEY: 'REPLACE_YOUR_ANON_KEY',

  // === zenclass kiosk API（同網域，不需額外金鑰）===
  API_BASE: 'https://zenclass.ctcm.org.tw',
  UNIT_ID: 'REPLACE_YOUR_UNIT_ID',  // 各分院代號，不同分院要換這個

  // === 遲到分級（分鐘）===
  LATE: {
    L_MAX_MIN: 20,    // ≤20 分 → L（遲到，算出席）
    LL_MAX_MIN: 60,   // 20~60 分 → LL（靜坐遲到，需補）
    // ≥60 分 → A（需補課）
  },

  // === 補課期限（全系統統一）===
  MAKEUP: {
    DEADLINE_WEEKS: 4,      // 該堂當週結束後，下週一起 4 週截止
    EARLIEST_DAYS: 7,       // 預設：課後 7 天（下週一）才能補，各精舍可調
  },

  // === 標記碼分類（哪些碼算什麼，改規則只改這裡）===
  MARK: {
    PHYSICAL_ATTEND: ['V', 'L', 'ML'],   // 實體出席
    ABSENT: ['A', 'O', 'LL'],            // 缺課
    MAKEUP_CREDIT: ['M'],                // 補課採計（不算實體出席）
    ALL_VALID: ['V', 'L', 'ML', 'M', 'A', 'O', 'LL'],
  },

  // === 結業門檻（依總堂數套用；>20 堂套 20 那列）===
  // 通用公式：實體出席 ≥ ceil(total/2)、缺課 ≤ 3、實體+補 ≥ total-3
  GRADUATION: {
    MAX_SESSIONS_FOR_CAP: 20,  // 超過此堂數，門檻不再升高
    MAX_ABSENT: 3,             // 缺課上限
  },
};

// Node.js 環境
if (typeof module !== 'undefined') module.exports = CONFIG;
// 瀏覽器環境（bookmarklet / 看板 HTML 直接引用）
if (typeof window !== 'undefined') window.CONFIG = CONFIG;
