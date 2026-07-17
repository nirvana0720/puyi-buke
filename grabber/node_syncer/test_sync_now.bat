@echo off
REM One-click manual test: run one sync right now and show the result.
REM Requires node.exe in this same folder (run 1_download_node.bat first).
if not exist "%~dp0node.exe" (
  echo node.exe NOT found in this folder.
  echo Please run 1_download_node.bat on a computer with internet first, or
  echo download it manually from https://nodejs.org/dist/v12.22.12/win-x86/node.exe
  echo and put node.exe in this folder.
  pause
  exit /b 1
)
"%~dp0node.exe" "%~dp0sync.js"
echo.
echo Done. See sync_log.txt in this folder for full history.
pause
