@echo off
cd /d "%~dp0"
echo ====================================================
echo   Deploy TikTok Brutal Content ke Hugging Face
echo ====================================================
python deploy_hf.py
pause
