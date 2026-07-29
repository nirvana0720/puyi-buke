@echo off
cd /d %~dp0
if exist ".git\index.lock" del /f /q ".git\index.lock"
git rm --cached grabber/bookmarklet.min.txt
git rm --cached grabber/bookmarklet_quick.min.txt
git rm --cached grabber/audit_bookmarklet.min.txt
git add -A
git commit -F deploy_remove_leaked_keys_msg.txt
git push
echo.
echo Done. Press any key to close.
pause >nul
