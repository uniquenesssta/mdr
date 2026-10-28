@echo off
setlocal DisableDelayedExpansion

rem Scope temporary files to this command and its child processes.
set "TEMP=O:\Project\Markdown Rust\Temp"
set "TMP=%TEMP%"
if not exist "%TEMP%\" mkdir "%TEMP%"
if not exist "%TEMP%\" (
  echo [ERROR] Could not create the project temporary directory: "%TEMP%"
  endlocal
  exit /b 1
)

if "%~1"=="" (
  echo Project temporary directory: "%TEMP%"
  echo Usage: with-project-temp.cmd npm.cmd run dev
  endlocal
  exit /b 0
)

call %*
set "MDR_COMMAND_EXIT_CODE=%ERRORLEVEL%"
endlocal & exit /b %MDR_COMMAND_EXIT_CODE%
