@echo off
REM Purpose: one-click manual test of schedule_sync.ps1, without waiting for a
REM scheduled time slot. Double-click this file any time to run a sync right
REM now and see the result printed in this window.
REM Uses %~dp0 (this .bat file's own folder), so it works no matter where the
REM grabber folder is copied to (temple relocation safe).

powershell.exe -ExecutionPolicy Bypass -File "%~dp0schedule_sync.ps1"

echo.
echo Done. Check grabber\sync_log.txt for the full history of every run.
pause
