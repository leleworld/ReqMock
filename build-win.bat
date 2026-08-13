@echo off
setlocal

echo ============================================
echo  ReqMock Windows Installer Build
echo ============================================

echo.
echo [1/2] Building frontend assets (vite build) ...
call npx vite build
if errorlevel 1 (
  echo [ERROR] vite build failed.
  pause
  exit /b 1
)

echo.
echo [2/2] Packaging Windows installer (electron-builder) ...
call npx electron-builder --win --publish never
if errorlevel 1 (
  echo [ERROR] electron-builder failed.
  pause
  exit /b 1
)

echo.
echo ============================================
echo  Build finished. Artifacts in release\:
dir /b release\*.exe
echo ============================================

echo.
pause
endlocal
