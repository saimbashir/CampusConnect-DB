@echo off
cd /d "%~dp0"
echo.
echo ==============================================
echo       CampusConnect - Viva Final Project
echo ==============================================
echo.
where node >nul 2>nul
if errorlevel 1 (
  echo ERROR: Node.js was not found.
  echo Please install Node.js 22 or newer from https://nodejs.org/
  pause
  exit /b 1
)
for /f "tokens=*" %%v in ('node -v') do echo Node version: %%v
echo.
echo Starting CampusConnect...
echo Open: http://127.0.0.1:3000
echo Press Ctrl+C to stop the server.
echo.
node server.js
if errorlevel 1 (
  echo.
  echo Server stopped with an error. Please copy the message above.
  pause
)
