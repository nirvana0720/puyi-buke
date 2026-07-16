# 職責：現場電腦排程同步 -- 不靠人工點書籤，改由 Windows 工作排程器定時執行本檔，
#   邏輯比照 grabber/bookmarklet.js（組 p_class/p_records、呼叫 ingest_kiosk_attendance RPC），
#   但用 PowerShell 的 Invoke-RestMethod 取代瀏覽器 fetch，且自動判斷「今天」與「今天星期幾」
#   （比照 db/重構47_zenclass自動排程同步.sql 裡 cron_sync_kiosk_attendance() 的篩選邏輯）。
# 不負責：手動指定過去日期、手動選班別（那是 bookmarklet.js／bookmarklet_quick.js 的職責，
#   排程漏跑或需要補過去日期時改用書籤手動同步）。
#
# ⚠️ 設定值需跟 config/config.js 保持一致，換分院部署／重新搬到新電腦時記得一起改。
# ⚠️ 本檔與 setup_schedule.bat 放在同一個資料夾，換電腦只要複製整個 grabber/ 資料夾，
#   重新雙擊 setup_schedule.bat 即可重建排程，不用改路徑（都用 $PSScriptRoot 抓自己所在資料夾）。

# ── 0. 設定（比照 config/config.js 現有真實值）───────────────────
$SUPABASE_URL      = 'https://yiowkvxwvwpzebdriksu.supabase.co'
$SUPABASE_ANON_KEY = 'sb_publishable_HFFBTwTbvPNGi_WnUssBpQ_ps7PS1Ie'
$UNIT_ID            = 'UNIT01071'
$API_BASE           = 'https://zenclass.ctcm.org.tw'

$ScriptDir = $PSScriptRoot
$LogFile   = Join-Path $ScriptDir 'sync_log.txt'

function Write-Log {
    param([string]$Message)
    $line = '[{0}] {1}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $Message
    Write-Output $line
    Add-Content -Path $LogFile -Value $line -Encoding UTF8
}

# 呼叫 Supabase PostgREST 的 RPC 端點。JSON body 強制轉成 UTF-8 bytes 再送出，
# 避免 Windows PowerShell 5.1 在非 UTF-8 系統地區設定下把中文（法號、班名）送成亂碼。
function Invoke-SupabaseRpc {
    param(
        [Parameter(Mandatory = $true)][string]$FunctionName,
        [Parameter(Mandatory = $true)]$Body
    )
    $json = $Body | ConvertTo-Json -Depth 10 -Compress
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($json)
    $headers = @{
        'apikey'        = $SUPABASE_ANON_KEY
        'Authorization' = "Bearer $SUPABASE_ANON_KEY"
    }
    return Invoke-RestMethod -Uri "$SUPABASE_URL/rest/v1/rpc/$FunctionName" -Method Post `
        -Headers $headers -Body $bytes -ContentType 'application/json; charset=utf-8' -TimeoutSec 30
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
        $json = $row | ConvertTo-Json -Compress
        $bytes = [System.Text.Encoding]::UTF8.GetBytes($json)
        $headers = @{
            'apikey'        = $SUPABASE_ANON_KEY
            'Authorization' = "Bearer $SUPABASE_ANON_KEY"
        }
        Invoke-RestMethod -Uri "$SUPABASE_URL/rest/v1/cron_sync_log" -Method Post `
            -Headers $headers -Body $bytes -ContentType 'application/json; charset=utf-8' -TimeoutSec 15 | Out-Null
    } catch {
        Write-Output "（cron_sync_log 寫入失敗，不影響同步結果：$($_.Exception.Message)）"
    }
}

# ── 1. 算今天日期／星期幾（用 Taipei 時區換算，不假設電腦系統時區一定是台北，比較保險）──
$nowTaipei = [System.TimeZoneInfo]::ConvertTimeBySystemTimeZoneId([DateTime]::UtcNow, 'Taipei Standard Time')
$dateStr  = $nowTaipei.ToString('yyyy-MM-dd')
$dowChars = @('日', '一', '二', '三', '四', '五', '六')   # Get-Date 的 DayOfWeek 是 0=Sunday...6=Saturday，順序對應
$dowStr   = $dowChars[[int]$nowTaipei.DayOfWeek]

Write-Log "===== 開始同步 $dateStr（星期$dowStr）====="

# ── 2. 取我方已建檔的班別清單（同 bookmarklet.js 用的 list_audit_classes RPC）──
try {
    # 注意：不可寫成 @(Invoke-SupabaseRpc ...)。Invoke-RestMethod 對 JSON 陣列回應會把整包陣列
    # 當成「單一物件」送進管線，若直接包 @() 會變成外層再包一層陣列（1 個元素＝整包內層陣列），
    # 造成 Where-Object 篩選全部失效（實測過，count 會變 1 而不是實際筆數）。
    # 正解：先直接賦值拿到真正的陣列，再用 @() 對「變數」做強制陣列化（這樣才不會再包一層）。
    $classesResult = Invoke-SupabaseRpc -FunctionName 'list_audit_classes' -Body @{}
    $classes = @($classesResult)
} catch {
    Write-Log "X 取班別清單失敗：$($_.Exception.Message)"
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
        $attendUrl = "$API_BASE/meditation/api/kiosk/class_attend_records" +
            "?classDate=$dateStr&classId=$($cls.class_id)&includes=$([uri]::EscapeDataString($includes))"
        $attendResp = Invoke-RestMethod -Uri $attendUrl -Method Get -TimeoutSec 20

        if ($attendResp.errCode -ne 200) {
            throw "取報到名單失敗（errCode $($attendResp.errCode)）"
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

        Write-Log "OK $($cls.class_name)：同步成功，$($result.synced) 筆"
        Write-CronSyncLog -ClassId $cls.class_id -ClassName $cls.class_name -Ok $true -Synced $result.synced
    } catch {
        Write-Log "X $($cls.class_name)：同步失敗 - $($_.Exception.Message)"
        Write-CronSyncLog -ClassId $cls.class_id -ClassName $cls.class_name -Ok $false -ErrorMsg $_.Exception.Message
    }
}

Write-Log "===== 同步結束 ====="
