@echo off

chcp 65001 >nul

REM ============================================================

REM   Persian RTL for VS Code Installer (Local UI)

REM   This batch file must be 100%% ASCII only.

REM   All Persian/UTF-8 text is printed by apply_patch.py,

REM   NOT by this file (cmd.exe mangles non-ASCII here).

REM   Uses stable paragraph-majority mode (v2.9.7): Persian text right,

REM   Latin text stays left. Code stays LTR with Persian comments

REM   The external runtime is CSP-compatible and code/terminal stay unchanged.

REM ============================================================

echo.

echo [1/2] Applying RTL patch (content-aware: Persian right / Latin left)...

python -u "%~dp0apply_patch.py"

if errorlevel 1 (

  echo.

  echo [ERROR] Patch failed.

  echo   Manual: apply_patch.py "C:\...\out\vs\workbench\workbench.esm.html"

  echo   Or run with --list to see detected paths.

  pause

  exit /b 1

)



echo.

echo [2/2] Done. Now FULLY close VS Code (File ^> Exit - not just Reload Window),

echo        then reopen it. Check "Output - Persian RTL for VS Code" for logs.

echo.

echo ============================================================

echo  NOTE

echo  - Integrity is preserved by updating only the workbench checksum.

echo  - To verify patch, runtime, and checksum:

echo    run:  apply_patch.py --verify

echo  - To remove the patch entirely:

echo    run:  apply_patch.py --restore

echo  - To list detected workbench files:

echo    run:  apply_patch.py --list

echo ============================================================

pause

