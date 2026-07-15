@echo off
setlocal
cd /d "%~dp0Scada.Api"
dotnet build Scada.Api.csproj -c Debug
if errorlevel 1 exit /b %errorlevel%
"%~dp0Scada.Api\bin\Debug\net8.0\Scada.Api.exe" --urls http://0.0.0.0:5000
endlocal
