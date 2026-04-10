@echo off
setlocal
cd /d "%~dp0Scada.Api\bin\Debug\net8.0"
Scada.Api.exe --urls http://localhost:5000
endlocal
