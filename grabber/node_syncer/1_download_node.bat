@echo off
REM STEP 1 - run this ONCE on a computer WITH internet (e.g. the dev machine),
REM NOT on the old Win7 kiosk. It downloads the official signed node.exe
REM (v12.22.12, 32-bit, still runs on Windows 7) into this folder.
set URL=https://nodejs.org/dist/v12.22.12/win-x86/node.exe
echo Downloading node.exe ...
echo   %URL%
powershell -Command "[Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12; Invoke-WebRequest -Uri '%URL%' -OutFile '%~dp0node.exe'"
if exist "%~dp0node.exe" (
  echo.
  echo OK. node.exe saved into this folder. Now copy the WHOLE folder to the kiosk.
) else (
  echo.
  echo FAILED. Open this URL in a browser, download node.exe, and place it in this folder:
  echo   %URL%
)
pause
