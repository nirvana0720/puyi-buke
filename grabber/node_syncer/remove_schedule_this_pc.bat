@echo off
REM Remove the 12 PuyiZenclassSync_* scheduled tasks from THIS computer.
REM Reason: these were created here during development/testing. The kiosk
REM machine already has its own copy of the same 12 tasks and is the one
REM that should run the sync. Running both at once can cause duplicate /
REM out-of-order writes to Supabase.
REM Safe to double-click. If Windows asks for admin permission, click Yes.

schtasks /delete /tn "PuyiZenclassSync_0920" /f
schtasks /delete /tn "PuyiZenclassSync_0925" /f
schtasks /delete /tn "PuyiZenclassSync_0930" /f
schtasks /delete /tn "PuyiZenclassSync_1000" /f
schtasks /delete /tn "PuyiZenclassSync_1010" /f
schtasks /delete /tn "PuyiZenclassSync_1100" /f
schtasks /delete /tn "PuyiZenclassSync_1920" /f
schtasks /delete /tn "PuyiZenclassSync_1925" /f
schtasks /delete /tn "PuyiZenclassSync_1930" /f
schtasks /delete /tn "PuyiZenclassSync_2000" /f
schtasks /delete /tn "PuyiZenclassSync_2010" /f
schtasks /delete /tn "PuyiZenclassSync_2100" /f

echo.
echo Done. All 12 PuyiZenclassSync_* tasks removed from this computer.
echo The kiosk machine's schedule is untouched and will keep running.
pause
