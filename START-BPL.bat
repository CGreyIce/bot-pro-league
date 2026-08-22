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
rem open the browser a few seconds after the server has had time to start
start "" powershell -NoProfile -WindowStyle Hidden -Command "Start-Sleep 3; Start-Process 'http://localhost:8099/#/admin'"
python build\admin_server.py 8099
echo.
echo   Server stopped. You can close this window now.
pause
