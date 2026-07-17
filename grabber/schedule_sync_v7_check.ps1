# 職責：現場電腦排程同步 -- 不靠人工點書籤，改由 Windows 工作排程器定時執行本檔，
#   邏輯比照 grabber/bookmarklet.js（組 p_class/p_records、呼叫 ingest_kiosk_attendance RPC），
#   但用 PowerShell 的 Invoke-RestMethod 取代瀏覽器 fetch，且自動判斷「今天」與「今天星期幾」
#   （比照 db/重構47_zenclass自動排程同步.sql 裡 cron_sync_kiosk_attendance() 的篩選邏輯）。
# 不負責：手動指定過去日期、手動選班別（那是 bookmarklet.js／bookmarklet_quick.js 的職責，
#   排程漏跑或需要補過去日期時改用書籤手動同步）。
#
# ⚠️ 設定值需跟 config/config.js 保持一致，換分院部署／重新搬到新電腦時記得一起改。
# ⚠️ 本檔與 setup_schedule.bat 放在同一個資料夾，換電腦只要複製整個 grabber/ 資料夾，
#   重新雙擊 setup_schedule.bat 即可重建排程，不用改路徑。
#   ⚠️ 2026-07-16 現場踩雷修正：不用 $PSScriptRoot（PowerShell 3.0 才有這個自動變數，
#   有些精舍電腦是舊版 PowerShell／精簡版 Windows，$PSScriptRoot 會是空值，導致
#   Join-Path/Add-Content 全部炸掉）。改用 $MyInvocation.MyCommand.Path，相容更舊版本。
#   同理，ConvertTo-Json 這個 cmdlet 在某些精簡版 PowerShell 環境會抓不到
#   （現場電腦實測過：Add-Content -Path 是 Null、ConvertTo-Json 無法辨識），
#   所以下面自己刻一個 ConvertTo-JsonCompat，不依賴系統模組是否有載入 ConvertTo-Json。
#   ⚠️ 2026-07-16 現場踩雷修正②：雙引號字串裡不要用 $(...) 子運算式（尤其一個字串裡
#   塞兩個以上 $(...)，或 $(...) 裡面又呼叫靜態方法如 [uri]::EscapeDataString(...)）。
#   現場實測會噴 ParserError: IncompleteDollarSubexpressionReference（PowerShell 2.0
#   對這種巢狀 $(...) 語法解析有問題）。全檔案改用 -f 格式化運算子組字串，這個語法
#   從 PowerShell 1.0 就支援，最保險。

# ── 0. 設定（比照 config/config.js 現有真實值）───────────────────
$SUPABASE_URL      = 'https://yiowkvxwvwpzebdriksu.supabase.co'
$SUPABASE_ANON_KEY = 'sb_publishable_HFFBTwTbvPNGi_WnUssBpQ_ps7PS1Ie'
$UNIT_ID            = 'UNIT01071'
$API_BASE           = 'https://zenclass.ctcm.org.tw'

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
if (-not $ScriptDir) { $ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition }
if (-not $ScriptDir) { $ScriptDir = (Get-Location).Path }
$LogFile   = Join-Path $ScriptDir 'sync_log.txt'

function Write-Log {
    param([string]$Message)
    $line = '[{0}] {1}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $Message
    Write-Output $line
    Add-Content -Path $LogFile -Value $line -Encoding UTF8
}

# ⚠️ 2026-07-16 現場踩雷修正④：字串裡的跳脫字元（反斜線、雙引號、`r `n `t）
# 一律改用 [char] 代碼組出來，不要在原始碼裡直接寫「反斜線接雙引號」這種組合，
# 也不要用反引號跳脫序列（`r `n `t）。現場這台 PowerShell 對「單引號字串裡的
# 反斜線」與「雙引號字串裡的反引號跳脫」解析都不穩定，會在完全不相關的行數
# 噴 ParserError: UnexpectedToken '}'（很難排查，錯誤位置跟真正肇因對不上）。
# 改用 .NET 的 .Replace() 字串方法（非 -replace regex 運算子）+ [char] 代碼，
# 從原始碼層級完全避開反斜線／反引號的解析歧義。
$script:JB = [char]92   # 反斜線 backslash
$script:JQ = [char]34   # 雙引號 double-quote

function ConvertTo-JsonEscapedString {
    param([string]$Text)
    if ($null -eq $Text) { return '' }
    $bs  = [string]$script:JB
    $dq  = [string]$script:JQ
    $out = $Text.Replace($bs, $bs + $bs)
    $out = $out.Replace($dq, $bs + $dq)
    $out = $out.Replace([string][char]13, $bs + 'r')
    $out = $out.Replace([string][char]10, $bs + 'n')
    $out = $out.Replace([string][char]9,  $bs + 't')
    return $out
}

# 手刻 JSON 序列化（不依賴 ConvertTo-Json，見上面 2026-07-16 踩雷說明）。
# 只需要處理本檔會用到的型別：字串／數字／布林／$null／雜湊表（含 [ordered]）／陣列。
function ConvertTo-JsonCompat {
    param($InputObject)
    if ($null -eq $InputObject) { return 'null' }
    if ($InputObject -is [bool]) { if ($InputObject) { return 'true' } else { return 'false' } }
    if ($InputObject -is [int] -or $InputObject -is [long] -or $InputObject -is [double]) { return "$InputObject" }
    if ($InputObject -is [System.Collections.IDictionary]) {
        $pairs = @()
        foreach ($key in $InputObject.Keys) {
            $escKey = ConvertTo-JsonEscapedString $key
            $pairs += ('"' + $escKey + '":' + (ConvertTo-JsonCompat $InputObject[$key]))
        }
        return '{' + ($pairs -join ',') + '}'
    }
    if ($InputObject -is [string]) {
        $esc = ConvertTo-JsonEscapedString $InputObject
        return '"' + $esc + '"'
    }
    if ($InputObject -is [System.Collections.IEnumerable]) {
        $items = @()
        foreach ($item in $InputObject) { $items += (ConvertTo-JsonCompat $item) }
        return '[' + ($items -join ',') + ']'
    }
    $esc = ConvertTo-JsonEscapedString "$InputObject"
    return '"' + $esc + '"'
}

# 呼叫 Supabase PostgREST 的 RPC 端點。JSON body 強制轉成 UTF-8 bytes 再送出，
# 避免 Windows PowerShell 5.1 在非 UTF-8 系統地區設定下把中文（法號、班名）送成亂碼。
function Invoke-SupabaseRpc {
    param(
        [Parameter(Mandatory = $true)][string]$FunctionName,
        [Parameter(Mandatory = $true)]$Body
    )
    $json = ConvertTo-JsonCompat $Body
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($json)
    $headers = @{
        'apikey'        = $SUPABASE_ANON_KEY
        'Authorization' = "Bearer $SUPABASE_ANON_KEY"
    }
    return Invoke-RestMethod -Uri "$SUPABASE_URL/rest/v1/rpc/$FunctionName" -Method Post -Headers $headers -Body $bytes -ContentType 'application/json; charset=utf-8' -TimeoutSec 30
}

# 寫一筆同步結果到 cron_sync_log（db/重構48_cron_sync_log開放anon寫入.sql 已開放 anon 寫入）。
# 純輔助紀錄用，失敗不影響主流程（catch 掉，只印在主控台，不寫進 sync_log.txt 造成誤判）。
function Write-CronSyncLog {
    param(
        [string]$ClassId,
        [string]$ClassName,
        [bool]$Ok,
        [int]$Synced = $null,
        [string]$ErrorMsg = $null
    )
    try {
        $row = @{ class_id = $ClassId; class_name = $ClassName; ok = $Ok }
        if ($null -ne $Synced)   { $row.synced = $Synced }
        if ($ErrorMsg)           { $row.error_msg = $ErrorMsg }
        $json = ConvertTo-JsonCompat $row
        $bytes = [System.Text.Encoding]::UTF8.GetBytes($json)
        $headers = @{
            'apikey'        = $SUPABASE_ANON_KEY
            'Authorization' = "Bearer $SUPABASE_ANON_KEY"
        }
        Invoke-RestMethod -Uri "$SUPABASE_URL/rest/v1/cron_sync_log" -Method Post -Headers $headers -Body $bytes -ContentType 'application/json; charset=utf-8' -TimeoutSec 15 | Out-Null
    } catch {
        Write-Output ("（cron_sync_log 寫入失敗，不影響同步結果：{0}）" -f $_.Exception.Message)
    }
}

# ── 1. 算今天日期／星期幾（用 Taipei 時區換算，不假設電腦系統時區一定是台北，比較保險）──
$nowTaipei = [System.TimeZoneInfo]::ConvertTimeBySystemTimeZoneId([DateTime]::UtcNow, 'Taipei Standard Time')
$dateStr  = $nowTaipei.ToString('yyyy-MM-dd')
$dowChars = @('日', '一', '二', '三', '四', '五', '六')   # Get-Date 的 DayOfWeek 是 0=Sunday...6=Saturday，順序對應
$dowStr   = $dowChars[[int]$nowTaipei.DayOfWeek]

Write-Log "===== 開始同步 $dateStr（星期$dowStr）====="
Write-Log ("（PowerShell 版本：{0}，日後排查用）" -f $PSVersionTable.PSVersion)

# ── 2. 取我方已建檔的班別清單（同 bookmarklet.js 用的 list_audit_classes RPC）──
try {
    # 注意：不可寫成 @(Invoke-SupabaseRpc ...)。Invoke-RestMethod 對 JSON 陣列回應會把整包陣列
    # 當成「單一物件」送進管線，若直接包 @() 會變成外層再包一層陣列（1 個元素＝整包內層陣列），
    # 造成 Where-Object 篩選全部失效（實測過，count 會變 1 而不是實際筆數）。
    # 正解：先直接賦值拿到真正的陣列，再用 @() 對「變數」做強制陣列化（這樣才不會再包一層）。
    $classesResult = Invoke-SupabaseRpc -FunctionName 'list_audit_classes' -Body @{}
    $classes = @($classesResult)
} catch {
    Write-Log ("X 取班別清單失敗：{0}" -f $_.Exception.Message)
    exit 1
}

if (-not $classes -or $classes.Count -eq 0) {
    Write-Log "(略) 目前沒有已建檔的班別，結束。"
    exit 0
}

# ── 3. 篩選今天要上課的班：進行中 + 星期符合 + 不是 MANUAL 佔位代碼 ─────
$matched = @($classes | Where-Object {
    $_.status -eq '進行中' -and
    $_.day_of_week -eq $dowStr -and
    -not ($_.class_id -like 'MANUAL-*')
})

if ($matched.Count -eq 0) {
    Write-Log "(略) 今天（星期$dowStr）沒有符合條件的班，結束。"
    exit 0
}

Write-Log ("找到 {0} 個班別：{1}" -f $matched.Count, ($matched.class_name -join '、'))

# ── 4. 逐一同步（單一班別失敗不中斷整支腳本，continue 下一班）─────────
$includes = 'attendMark,memberId,aliasName,ctDharmaName,classGroupId,memberGroupNum,' +
            'attendCheckinDtTm,classId,className,classStartTime,classEndTime,dayOfWeek,isDroppedClass'

foreach ($cls in $matched) {
    try {
        $classIdEnc  = [uri]::EscapeDataString($cls.class_id)
        $includesEnc = [uri]::EscapeDataString($includes)
        $attendUrl = "{0}/meditation/api/kiosk/class_attend_records?classDate={1}&classId={2}&includes={3}" -f $API_BASE, $dateStr, $classIdEnc, $includesEnc
        $attendResp = Invoke-RestMethod -Uri $attendUrl -Method Get -TimeoutSec 20

        if ($attendResp.errCode -ne 200) {
            throw ("取報到名單失敗（errCode {0}）" -f $attendResp.errCode)
        }
        $records = @($attendResp.items)

        $pClass = [ordered]@{
            class_id     = $cls.class_id
            class_name   = $cls.class_name
            level        = $cls.level
            day_night    = $cls.day_night
            day_of_week  = $cls.day_of_week
            start_time   = $cls.start_time
            end_time     = $cls.end_time
            period_num   = $null
            week_num     = $null
            is_cancelled = $false
        }

        # 已退班的人不寫入，避免舊生混進現有名單（比照 bookmarklet.js 的 filter 規則）
        $pRecords = @($records | Where-Object { $_.isDroppedClass -ne $true } | ForEach-Object {
            [ordered]@{
                member_id    = $_.memberId
                name         = if ($_.aliasName) { $_.aliasName } else { '' }
                dharma_name  = if ($_.ctDharmaName) { $_.ctDharmaName } else { '' }
                group_id     = if ($_.classGroupId) { $_.classGroupId } else { '' }
                group_num    = if ($_.memberGroupNum) { $_.memberGroupNum } else { '' }
                mark         = $_.attendMark
                checkin_time = $_.attendCheckinDtTm
                is_dropped   = ($_.isDroppedClass -eq $true)
            }
        })

        $result = Invoke-SupabaseRpc -FunctionName 'ingest_kiosk_attendance' -Body @{
            p_unit_id = $UNIT_ID
            p_date    = $dateStr
            p_class   = $pClass
            p_records = $pRecords
        }

        Write-Log ("OK {0}：同步成功，{1} 筆" -f $cls.class_name, $result.synced)
        Write-CronSyncLog -ClassId $cls.class_id -ClassName $cls.class_name -Ok $true -Synced $result.synced
    } catch {
        Write-Log ("X {0}：同步失敗 - {1}" -f $cls.class_name, $_.Exception.Message)
        Write-CronSyncLog -ClassId $cls.class_id -ClassName $cls.class_name -Ok $false -ErrorMsg $_.Exception.Message
    }
}

Write-Log "===== 同步結束 ====="
