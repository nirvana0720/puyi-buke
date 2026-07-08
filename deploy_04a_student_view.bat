@echo off
cd /d %~dp0
if exist ".git\index.lock" del /f /q ".git\index.lock"
git add ui/student/student.js ui/student/render.js ui/home/index.html
git commit -F COMMIT_MSG_04a_student_view.txt
git push
echo Done.
pause
