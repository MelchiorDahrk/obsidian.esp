@echo off
setlocal EnableExtensions EnableDelayedExpansion

cd /d "%~dp0"

echo.
echo === Obsidian plugin build + package ===
echo Working directory: %CD%

where npm >nul 2>nul
if errorlevel 1 (
  echo [ERROR] npm was not found on PATH. Install Node.js and try again.
  exit /b 1
)

if not exist "node_modules" (
  echo.
  echo [1/5] Installing npm dependencies...
  call npm install
  if errorlevel 1 (
    echo [ERROR] npm install failed.
    exit /b 1
  )
) else (
  echo.
  echo [1/5] Dependencies already present. Skipping npm install.
)

echo.
echo [2/5] Running production build...
call npm run build
if errorlevel 1 (
  echo [ERROR] Build failed.
  exit /b 1
)

if not exist "main.js" (
  echo [ERROR] Build completed but main.js was not found.
  exit /b 1
)

if not exist "manifest.json" (
  echo [ERROR] manifest.json was not found.
  exit /b 1
)

echo.
echo [3/5] Reading plugin metadata...
for /f "usebackq delims=" %%I in (`powershell -NoProfile -Command "(Get-Content -Raw 'manifest.json' | ConvertFrom-Json).id"`) do set "PLUGIN_ID=%%I"
for /f "usebackq delims=" %%I in (`powershell -NoProfile -Command "(Get-Content -Raw 'manifest.json' | ConvertFrom-Json).version"`) do set "PLUGIN_VERSION=%%I"

if not defined PLUGIN_ID (
  echo [ERROR] Could not read plugin id from manifest.json.
  exit /b 1
)

if not defined PLUGIN_VERSION (
  echo [ERROR] Could not read plugin version from manifest.json.
  exit /b 1
)

set "RELEASE_ROOT=release"
set "PACKAGE_DIR=%RELEASE_ROOT%\%PLUGIN_ID%"
set "ZIP_PATH=%RELEASE_ROOT%\%PLUGIN_ID%-%PLUGIN_VERSION%.zip"

echo.
echo [4/5] Preparing package directory...
if exist "%PACKAGE_DIR%" rmdir /s /q "%PACKAGE_DIR%"
if exist "%ZIP_PATH%" del /f /q "%ZIP_PATH%"

mkdir "%PACKAGE_DIR%" >nul
if errorlevel 1 (
  echo [ERROR] Could not create %PACKAGE_DIR%.
  exit /b 1
)

copy /y "manifest.json" "%PACKAGE_DIR%\manifest.json" >nul
if errorlevel 1 (
  echo [ERROR] Failed to copy manifest.json.
  exit /b 1
)

copy /y "main.js" "%PACKAGE_DIR%\main.js" >nul
if errorlevel 1 (
  echo [ERROR] Failed to copy main.js.
  exit /b 1
)

if exist "styles.css" (
  copy /y "styles.css" "%PACKAGE_DIR%\styles.css" >nul
  if errorlevel 1 (
    echo [ERROR] Failed to copy styles.css.
    exit /b 1
  )
)

if exist "pkg" (
  robocopy "pkg" "%PACKAGE_DIR%\pkg" /E >nul
  set "ROBOCOPY_EXIT=%ERRORLEVEL%"
  if !ROBOCOPY_EXIT! GEQ 8 (
    echo [ERROR] Failed to copy pkg directory.
    exit /b 1
  )
)

echo.
echo [5/5] Creating zip archive...
powershell -NoProfile -Command "Compress-Archive -Path '%PACKAGE_DIR%\*' -DestinationPath '%ZIP_PATH%' -Force"
if errorlevel 1 (
  echo [ERROR] Failed to create zip archive.
  exit /b 1
)

echo.
echo Build and packaging complete.
echo Folder: %CD%\%PACKAGE_DIR%
echo Zip:    %CD%\%ZIP_PATH%
echo.
pause
