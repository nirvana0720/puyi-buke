@echo off
REM Create 12 Windows Scheduled Tasks that run sync.js via the bundled node.exe
REM at fixed Taipei-time slots. Safe to re-run (/f overwrites). Uses %~dp0 so the
REM folder can be copied anywhere / to any temple and re-run to rebuild schedules.
if not exist "%~dp0node.exe" (
  echo node.exe NOT found. Run 1_download_node.bat first. Aborting.
  pause
  exit /b 1
)
set NODECMD="\"%~dp0node.exe\" \"%~dp0sync.js\""
schtasks /create /tn "PuyiZenclassSync_0920" /tr %NODECMD% /sc daily /st 09:20 /f
schtasks /create /tn "PuyiZenclassSync_0925" /tr %NODECMD% /sc daily /st 09:25 /f
schtasks /create /tn "PuyiZenclassSync_0930" /tr %NODECMD% /sc daily /st 09:30 /f
schtasks /create /tn "PuyiZenclassSync_1000" /tr %NODECMD% /sc daily /st 10:00 /f
schtasks /create /tn "PuyiZenclassSync_1010" /tr %NODECMD% /sc daily /st 10:10 /f
schtasks /create /tn "PuyiZenclassSync_1100" /tr %NODECMD% /sc daily /st 11:00 /f
schtasks /create /tn "PuyiZenclassSync_1920" /tr %NODECMD% /sc daily /st 19:20 /f
schtasks /create /tn "PuyiZenclassSync_1925" /tr %NODECMD% /sc daily /st 19:25 /f
schtasks /create /tn "PuyiZenclassSync_1930" /tr %NODECMD% /sc daily /st 19:30 /f
schtasks /create /tn "PuyiZenclassSync_2000" /tr %NODECMD% /sc daily /st 20:00 /f
schtasks /create /tn "PuyiZenclassSync_2010" /tr %NODECMD% /sc daily /st 20:10 /f
schtasks /create /tn "PuyiZenclassSync_2100" /tr %NODECMD% /sc daily /st 21:00 /f
echo.
echo Done. 12 scheduled tasks created or updated (PuyiZenclassSync_0920 ... _2100).
echo Open Task Scheduler (taskschd.msc) to review.
pause
