@echo off
setlocal
cd /d "%~dp0Scada.Api"
"%~dp0Scada.Api\bin\Debug\net8.0\Scada.Api.exe" --urls http://0.0.0.0:5000
endlocal
