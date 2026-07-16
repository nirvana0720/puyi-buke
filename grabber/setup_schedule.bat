@echo off
REM Purpose: create 12 Windows Scheduled Tasks that run schedule_sync.ps1 daily
REM at fixed Taipei-time slots, so this computer syncs zenclass attendance
REM automatically without anyone clicking the bookmarklet.
REM
REM Safe to re-run: /f overwrites any existing task with the same name, so you
REM can just double-click this file again after moving the grabber folder to
REM a different computer (temple relocation). Uses %~dp0 (this .bat file's own
REM folder) instead of a hardcoded path, so it works no matter where the
REM grabber folder is copied to.
REM
REM Time table (12 slots, Taipei time) matches the db/*47*.sql pg_cron schedule this replaces.

schtasks /create /tn "PuyiZenclassSync_0920" /tr "powershell.exe -ExecutionPolicy Bypass -File \"%~dp0schedule_sync.ps1\"" /sc daily /st 09:20 /f
schtasks /create /tn "PuyiZenclassSync_0925" /tr "powershell.exe -ExecutionPolicy Bypass -File \"%~dp0schedule_sync.ps1\"" /sc daily /st 09:25 /f
schtasks /create /tn "PuyiZenclassSync_0930" /tr "powershell.exe -ExecutionPolicy Bypass -File \"%~dp0schedule_sync.ps1\"" /sc daily /st 09:30 /f
schtasks /create /tn "PuyiZenclassSync_1000" /tr "powershell.exe -ExecutionPolicy Bypass -File \"%~dp0schedule_sync.ps1\"" /sc daily /st 10:00 /f
schtasks /create /tn "PuyiZenclassSync_1010" /tr "powershell.exe -ExecutionPolicy Bypass -File \"%~dp0schedule_sync.ps1\"" /sc daily /st 10:10 /f
schtasks /create /tn "PuyiZenclassSync_1100" /tr "powershell.exe -ExecutionPolicy Bypass -File \"%~dp0schedule_sync.ps1\"" /sc daily /st 11:00 /f
schtasks /create /tn "PuyiZenclassSync_1920" /tr "powershell.exe -ExecutionPolicy Bypass -File \"%~dp0schedule_sync.ps1\"" /sc daily /st 19:20 /f
schtasks /create /tn "PuyiZenclassSync_1925" /tr "powershell.exe -ExecutionPolicy Bypass -File \"%~dp0schedule_sync.ps1\"" /sc daily /st 19:25 /f
schtasks /create /tn "PuyiZenclassSync_1930" /tr "powershell.exe -ExecutionPolicy Bypass -File \"%~dp0schedule_sync.ps1\"" /sc daily /st 19:30 /f
schtasks /create /tn "PuyiZenclassSync_2000" /tr "powershell.exe -ExecutionPolicy Bypass -File \"%~dp0schedule_sync.ps1\"" /sc daily /st 20:00 /f
schtasks /create /tn "PuyiZenclassSync_2010" /tr "powershell.exe -ExecutionPolicy Bypass -File \"%~dp0schedule_sync.ps1\"" /sc daily /st 20:10 /f
schtasks /create /tn "PuyiZenclassSync_2100" /tr "powershell.exe -ExecutionPolicy Bypass -File \"%~dp0schedule_sync.ps1\"" /sc daily /st 21:00 /f

echo.
echo Done. 12 scheduled tasks created or updated (PuyiZenclassSync_0920 ... PuyiZenclassSync_2100).
echo Open Task Scheduler (taskschd.msc) to review, or run: schtasks /query /tn "PuyiZenclassSync_0920"
pause
