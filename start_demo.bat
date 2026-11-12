@echo off
rem Ask the Satellite - stage launcher. Starts Ollama, warms the model, starts the API on :8000 and opens the browser full screen.
rem Set NO_BROWSER=1 to skip opening the browser (used for testing).
setlocal EnableDelayedExpansion
cd /d "%~dp0"

set OLLAMA_KEEP_ALIVE=24h
set "LLM_MODEL=qwen2.5:7b-instruct-q4_K_M"
for /f "usebackq tokens=1,* delims==" %%a in (".env") do if "%%a"=="LLM_MODEL" if not "%%b"=="" set "LLM_MODEL=%%b"

set "OLLAMA=ollama"
where ollama >nul 2>&1 || set "OLLAMA=%LOCALAPPDATA%\Programs\Ollama\ollama.exe"

if not exist ".venv\Scripts\python.exe" (
  echo [!] No .venv found. Run setup.bat once first.
  pause
  exit /b 1
)

echo [1/4] Ollama
tasklist /fi "imagename eq ollama.exe" | find /i "ollama.exe" >nul || start "Ollama" /min "%OLLAMA%" serve
ping -n 4 127.0.0.1 >nul

echo [2/4] Warming %LLM_MODEL% (first load can take 20 s)
powershell -NoProfile -Command "try { Invoke-RestMethod -Uri http://127.0.0.1:11434/api/generate -Method Post -ContentType 'application/json' -Body (@{model=$env:LLM_MODEL; prompt='OK'; stream=$false; keep_alive='24h'; options=@{num_predict=1}} | ConvertTo-Json) -TimeoutSec 180 | Out-Null; Write-Host '      model warm' } catch { Write-Host '      Ollama not answering: the app will use the rule router and templates' }"

echo [3/4] API on http://localhost:8000
start "Ask the Satellite API" /min cmd /c ".venv\Scripts\python.exe -m uvicorn main:app --port 8000 --app-dir backend --env-file .env"
set /a tries=0
:wait
set /a tries+=1
powershell -NoProfile -Command "try { Invoke-WebRequest -UseBasicParsing http://127.0.0.1:8000/api/presets -TimeoutSec 2 | Out-Null; exit 0 } catch { exit 1 }"
if errorlevel 1 (
  if !tries! geq 40 ( echo [!] The API did not start. Check the "Ask the Satellite API" window. & pause & exit /b 1 )
  ping -n 2 127.0.0.1 >nul
  goto wait
)
echo       API ready

if "%NO_BROWSER%"=="1" goto done
echo [4/4] Browser (full screen; press F11 to leave)
set "CHROME=%ProgramFiles%\Google\Chrome\Application\chrome.exe"
if exist "%CHROME%" (
  start "" "%CHROME%" --start-fullscreen --new-window http://localhost:8000/
) else (
  start "" msedge --start-fullscreen --new-window http://localhost:8000/
)
:done
echo Ready. Pitch scenes: 1 = Palm 2001 to 2008, 2 = UAE flood 2024, 3 = Lake Mead. P = projector mode.
endlocal
