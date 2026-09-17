@echo off
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Install Node.js 24 or newer from https://nodejs.org/en/download
  echo Then close and reopen this window.
  pause
  exit /b 1
)
node scripts\check-node.mjs
if errorlevel 1 (
  pause
  exit /b 1
)
echo.
echo ShopLink marketplace: http://localhost:3000
echo ShopLink ERP:         http://localhost:3000/erp
echo Keep this window open. Press Ctrl+C to stop the server.
echo.
node server\index.mjs
pause
