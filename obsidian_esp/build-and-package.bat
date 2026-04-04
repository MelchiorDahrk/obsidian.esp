@echo off
setlocal EnableExtensions EnableDelayedExpansion

cd /d "%~dp0"
set "ROOT_DIR=%CD%"
set "PLUGIN_DIR=%ROOT_DIR%\obsidian_plugin"

if not exist "%PLUGIN_DIR%\package.json" (
  echo [ERROR] Could not find plugin directory at %PLUGIN_DIR%.
  exit /b 1
)

echo.
echo === Obsidian plugin build + package ===
echo Repo root:         %ROOT_DIR%
echo Plugin directory:  %PLUGIN_DIR%

where wasm-pack >nul 2>nul
if errorlevel 1 (
  echo [ERROR] wasm-pack was not found on PATH. Install wasm-pack and try again.
  exit /b 1
)

where npm >nul 2>nul
if errorlevel 1 (
  echo [ERROR] npm was not found on PATH. Install Node.js and try again.
  exit /b 1
)

echo.
echo [1/6] Rebuilding WASM package...
pushd "%ROOT_DIR%"
call wasm-pack build --release --target web --out-dir obsidian_plugin/pkg
if errorlevel 1 (
  echo [ERROR] wasm-pack build failed.
  popd
  exit /b 1
)

node scripts/patch-wasm-loader.cjs
if errorlevel 1 (
  echo [ERROR] Failed to patch generated wasm loader.
  popd
  exit /b 1
)

popd

pushd "%PLUGIN_DIR%"

if not exist "node_modules" (
  echo.
  echo [2/6] Installing npm dependencies...
  call npm install
  if errorlevel 1 (
    echo [ERROR] npm install failed.
    popd
    exit /b 1
  )
) else (
  echo.
  echo [2/6] Dependencies already present. Skipping npm install.
)

echo.
echo [3/6] Running production build...
call npm run build
if errorlevel 1 (
  echo [ERROR] Build failed.
  popd
  exit /b 1
)

if not exist "main.js" (
  echo [ERROR] Build completed but main.js was not found.
  popd
  exit /b 1
)

if not exist "manifest.json" (
  echo [ERROR] manifest.json was not found.
  popd
  exit /b 1
)

echo.
echo [4/6] Reading plugin metadata...
for /f "usebackq delims=" %%I in (`powershell -NoProfile -Command "(Get-Content -Raw 'manifest.json' | ConvertFrom-Json).id"`) do set "PLUGIN_ID=%%I"
for /f "usebackq delims=" %%I in (`powershell -NoProfile -Command "(Get-Content -Raw 'manifest.json' | ConvertFrom-Json).version"`) do set "PLUGIN_VERSION=%%I"

if not defined PLUGIN_ID (
  echo [ERROR] Could not read plugin id from manifest.json.
  popd
  exit /b 1
)

if not defined PLUGIN_VERSION (
  echo [ERROR] Could not read plugin version from manifest.json.
  popd
  exit /b 1
)

set "RELEASE_ROOT=release"
set "PACKAGE_DIR=%RELEASE_ROOT%\%PLUGIN_ID%"
set "ZIP_PATH=%RELEASE_ROOT%\%PLUGIN_ID%-%PLUGIN_VERSION%.zip"

echo.
echo [5/6] Preparing package directory...
if exist "%PACKAGE_DIR%" rmdir /s /q "%PACKAGE_DIR%"
if exist "%ZIP_PATH%" del /f /q "%ZIP_PATH%"

mkdir "%PACKAGE_DIR%" >nul
if errorlevel 1 (
  echo [ERROR] Could not create %PACKAGE_DIR%.
  popd
  exit /b 1
)

copy /y "manifest.json" "%PACKAGE_DIR%\manifest.json" >nul
if errorlevel 1 (
  echo [ERROR] Failed to copy manifest.json.
  popd
  exit /b 1
)

copy /y "main.js" "%PACKAGE_DIR%\main.js" >nul
if errorlevel 1 (
  echo [ERROR] Failed to copy main.js.
  popd
  exit /b 1
)

if exist "styles.css" (
  copy /y "styles.css" "%PACKAGE_DIR%\styles.css" >nul
  if errorlevel 1 (
    echo [ERROR] Failed to copy styles.css.
    popd
    exit /b 1
  )
)

if exist "pkg" (
  robocopy "pkg" "%PACKAGE_DIR%\pkg" /E >nul
  set "ROBOCOPY_EXIT=%ERRORLEVEL%"
  if !ROBOCOPY_EXIT! GEQ 8 (
    echo [ERROR] Failed to copy pkg directory.
    popd
    exit /b 1
  )
)

echo.
echo [6/6] Creating zip archive...
powershell -NoProfile -Command "Compress-Archive -Path '%PACKAGE_DIR%\*' -DestinationPath '%ZIP_PATH%' -Force"
if errorlevel 1 (
  echo [ERROR] Failed to create zip archive.
  popd
  exit /b 1
)

echo.
echo Build and packaging complete.
echo Folder: %PLUGIN_DIR%\%PACKAGE_DIR%
echo Zip:    %PLUGIN_DIR%\%ZIP_PATH%
echo.

popd
pause
