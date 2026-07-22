@echo off
REM Launcher for the makeup-system automated test runner (test Supabase project only).
cd /d "%~dp0"

if not exist "config.json" (
  echo config.json not found in test folder.
  echo Copy config.example.json to config.json and fill in the test project URL/key.
  pause
  exit /b 1
)

if exist "..\grabber\node_syncer\node.exe" (
  "..\grabber\node_syncer\node.exe" "run.js"
) else (
  where node >nul 2>nul
  if errorlevel 1 (
    echo node.exe not found, and no system-installed node command found either.
    echo Run 1_download_node.bat in the grabber\node_syncer folder first.
    pause
    exit /b 1
  )
  node "run.js"
)

echo.
pause
