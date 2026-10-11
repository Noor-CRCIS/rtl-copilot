@echo off
chcp 65001 >nul
echo.
echo Noor Smart RTL v2.9.19 - Build Script (Windows)
echo =============================================
echo.

where node >nul 2>&1
if %errorlevel% neq 0 (
    echo [X] Node.js not found. https://nodejs.org
    pause
    exit /b 1
)

where npm >nul 2>&1
if %errorlevel% neq 0 (
    echo [X] npm not found
    pause
    exit /b 1
)

echo [OK] Node.js and npm found
echo.
echo [*] Installing dependencies...
call npm install --silent
if %errorlevel% neq 0 (
    echo [X] Install failed
    pause
    exit /b 1
)

echo [*] Building VSIX...
call npm test
if %errorlevel% neq 0 exit /b 1
call node_modules\.bin\vsce package --no-dependencies --allow-missing-repository
if %errorlevel% neq 0 (
    echo [X] Build failed
    pause
    exit /b 1
)

echo.
echo [OK] VSIX ready!
echo.
echo Install:
echo   code --install-extension rtl-copilot-2.9.19.vsix
echo   or: Ctrl+Shift+X - Install from VSIX
echo.
pause
