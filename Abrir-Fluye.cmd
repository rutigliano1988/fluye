@echo off
setlocal
cd /d "%~dp0"
title Fluye
call npm run dev
if errorlevel 1 (
  echo.
  echo No se pudo abrir Fluye. Revisa el mensaje anterior.
  pause
)
