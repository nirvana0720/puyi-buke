@echo off
cd /d "%~dp0"
git add -A
git commit -F deploy_commit_msg.txt
git push
echo.
echo Done. Press any key to close.
pause >nul
