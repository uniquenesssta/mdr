@echo off
setlocal
title MDR - Desktop Development
cd /d "%~dp0"
if errorlevel 1 goto failed

where node.exe >nul 2>&1
if errorlevel 1 (
  echo [ERROR] Node.js was not found. Install Node.js and reopen this launcher.
  goto failed
)
where npm.cmd >nul 2>&1
if errorlevel 1 (
  echo [ERROR] npm was not found. Check your Node.js installation.
  goto failed
)
where cargo.exe >nul 2>&1
if errorlevel 1 (
  echo [ERROR] Cargo was not found. Install the Rust toolchain and reopen this launcher.
  goto failed
)

echo Starting the MDR desktop app from:
echo %CD%
echo The first Rust compilation may take a while.
echo Keep this console open while using the development app.
echo An available frontend port will be selected automatically.
echo.
call "%~dp0with-project-temp.cmd" node scripts\start-desktop.mjs
if errorlevel 1 goto failed
endlocal
exit /b 0

:failed
echo.
echo [ERROR] MDR could not start. See the error above.
pause
endlocal
exit /b 1
