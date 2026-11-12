@echo off
rem One-time setup on a clean Windows machine (needs internet): Python venv, pinned packages, local models.
cd /d "%~dp0"
py -3.12 -m venv .venv || ( echo [!] Install Python 3.12 from python.org first. & pause & exit /b 1 )
.venv\Scripts\python.exe -m pip install --upgrade pip
.venv\Scripts\python.exe -m pip install -r requirements.lock.txt || ( echo [!] pip install failed. & pause & exit /b 1 )
if not exist ".env" copy ".env.example" ".env" >nul
set "OLLAMA=ollama"
where ollama >nul 2>&1 || set "OLLAMA=%LOCALAPPDATA%\Programs\Ollama\ollama.exe"
"%OLLAMA%" pull qwen2.5:7b-instruct-q4_K_M
echo Setup done. Put your ArcGIS key in .env (optional), then run start_demo.bat
pause
