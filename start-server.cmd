@echo off
chcp 65001 >nul
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo 未找到 Node.js。请先安装 Node.js，或使用任意静态服务器打开本目录。
  echo 也可以直接双击 index.html 在电脑上使用。
  echo.
  pause
  exit /b 1
)

node server.mjs
pause
