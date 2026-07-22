補課系統 — 自動化測試環境
========================

用途
----
以後貼 SQL 到「正式環境」（puyi-buke.vercel.app 用的 Supabase 專案）之前，
先在這個獨立的「測試專案」跑過一輪，確認主要 RPC 行為正常，再上正式環境。

跟正式環境是完全分開的兩個 Supabase 專案，這裡的操作不會影響任何真實學員資料。


第一次設定（或測試專案重建過，才需要重做）
------------------------------------------
1. 到測試專案（Supabase Dashboard → 選 puyi-buke-test 專案）的 SQL Editor，
   依序貼上執行：
   a) db/full_setup_all_in_one.sql   （建 16 張表、66 支函式）
   b) test/seed.sql                  （灌測試資料 + 建 2 支測試專用輔助 RPC）

2. 確認 test/config.json 裡的 SUPABASE_URL、SUPABASE_ANON_KEY 是測試專案的值
   （不是正式環境的！可以到 Settings → API 頁面複製）。
   如果檔案不存在，複製 config.example.json 改名成 config.json 再填。


平常怎麼用
----------
1. 改了 db/ 底下任何一支 RPC 主檔，準備要貼到正式環境之前
2. 先把改過的 SQL 貼到「測試專案」的 SQL Editor 跑一次（更新測試專案的函式定義）
3. 雙擊 test\run.bat
4. 全部綠燈（✅）再把同一份 SQL 貼到正式環境；有紅燈（❌）先不要貼，把畫面截圖
   或複製錯誤訊息回報，一起看是 SQL 本身的問題還是測試案例要調整


目前涵蓋的測試案例（會持續增加，不是一次寫完）
------------------------------------------------
- kiosk_lookup_member：補課期限公式（缺課日 + 40 天，不是舊的週數公式）
- ingest_kiosk_attendance：刷卡同步不能覆蓋既有的 group_id

之後要加新案例，照 test/run.js 裡 test(...) 的寫法複製一段來改；
需要新的種子資料（例如新學員、新班別），改 test/seed.sql 的 test_get_seed_ids()，
把新欄位加進去回傳的 jsonb 就好。

還沒覆蓋、之後可以再補的（技術上比較麻煩，需要額外做 Supabase Auth 登入才能測）：
- admin_transfer_mark_attended 等要求「authenticated」角色（後台登入後）的函式
- kiosk_register_transfer / kiosk_transfer_attend「今天調班不被誤擋」的情境
