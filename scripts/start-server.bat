@echo off
setlocal
set "ROOT=%~dp0.."
for %%I in ("%ROOT%") do set "ROOT=%%~fI"
set "NODE=%ROOT%\tools\node\node.exe"
if not exist "%NODE%" set "NODE=%ROOT%\..\tools\node\node.exe"
if not exist "%NODE%" (
  echo Node.js not found: %NODE%
  exit /b 1
)
if not exist "%ROOT%\.env" (
  echo Missing %ROOT%\.env
  exit /b 1
)
cd /d "%ROOT%"
"%NODE%" "%ROOT%\scripts\supervisor.mjs"
exit /b %ERRORLEVEL%
