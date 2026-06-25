@echo off
setlocal

cd /d "%~dp0scada-web"
call npm.cmd run build
if errorlevel 1 exit /b %errorlevel%

cd /d "%~dp0Scada.Api"
dotnet build Scada.Api.csproj -c Debug
if errorlevel 1 exit /b %errorlevel%

start "" /d "%~dp0Scada.Api" "%~dp0Scada.Api\bin\Debug\net8.0\Scada.Api.exe" --urls http://0.0.0.0:5000

echo SCADA server started.
echo Open from this PC: http://127.0.0.1:5000
echo Open from LAN PCs: http://192.168.88.100:5000

endlocal
