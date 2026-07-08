@echo off
REM Start the Buke (makeup) system local web server.
REM ASCII-only content per project rules.
cd /d "%~dp0.."
node tools\serve.js
pause
