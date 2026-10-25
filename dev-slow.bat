@echo off
cd /d "%~dp0"
echo.
echo  ================================================
echo   NET//ETHER — DEV MODE, SLOW LAPTOP SIMULATION
echo  ================================================
echo   Every process launch is held 2000 ms — what a
echo   locked-down fleet laptop feels like. Change the
echo   number below to taste (0 = off, max 10000).
echo  ================================================
echo.
if not exist "node_modules" (
    call npm install
    if errorlevel 1 ( echo  ERROR: npm install failed. & exit /b 1 )
)
set NET_ETHER_SPAWN_DELAY_MS=2000
npx electron . --dev
