@echo off
title Bot Pro League - local server (keep this window open)
cd /d "%~dp0"
echo.
echo   ============================================
echo     Bot Pro League - local server
echo   ============================================
echo.
echo   Starting up... your site will open in the browser in a few seconds.
echo.
echo   * KEEP THIS WINDOW OPEN while you use the site.
echo   * Close this window (or press Ctrl+C) to stop the server.
echo.
echo   Site address:  http://localhost:8099/#/admin
echo.
rem get the latest from GitHub first: the other computer may have published since this one was last used.
rem --ff-only never merges or overwrites anything; if it can't simply catch up, the site starts as it is.
where git >nul 2>nul
if errorlevel 1 (
  echo   [!] Git isn't installed, so this copy can't get the latest from GitHub.
  echo.
) else (
  echo   Getting the latest from GitHub...
  git pull --ff-only
  if errorlevel 1 (
    echo.
    echo   [!] Couldn't get the latest from GitHub: no internet, or this computer has
    echo       changes that aren't published yet. The site still starts.
    echo       If you have unpublished changes, Publish them, then restart this window.
  )
  echo.
)
rem open the browser a few seconds after the server has had time to start
start "" powershell -NoProfile -WindowStyle Hidden -Command "Start-Sleep 3; Start-Process 'http://localhost:8099/#/admin'"
python build\admin_server.py 8099
echo.
echo   Server stopped. You can close this window now.
pause
