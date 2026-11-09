@echo off
chcp 65001 >nul
echo ============================================================
echo   🚀 PUSH TIKTOK BRUTAL CONTENT KE GITHUB
echo ============================================================
echo.
echo Pastikan Anda sudah membuat repository kosong di https://github.com/new
echo.
set /p REPO_URL="Masukkan URL Git Repository Anda (contoh: https://github.com/username/brutal-content-pro.git): "

if "%REPO_URL%"=="" (
    echo [ERROR] URL Repository tidak boleh kosong!
    pause
    exit /b
)

git remote remove origin 2>nul
git remote add origin %REPO_URL%
git branch -M main
echo.
echo Mengunggah file ke GitHub...
git push -u origin main

echo.
echo ============================================================
echo   🎉 SELESAI! Buka https://share.streamlit.io lalu Deploy!
echo ============================================================
pause
