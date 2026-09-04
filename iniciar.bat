@echo off
cd /d "%~dp0"
if not exist ".venv" (
  echo Creando entorno virtual .venv...
  python -m venv .venv
)
call ".venv\Scripts\activate"
REM UX-6: no reinstalar SymPy/numpy en cada arranque si requirements.txt no cambio.
REM Se guarda una copia del ultimo requirements instalado en .venv\installed-req.txt
REM y se compara con fc (binario). Si son iguales se salta pip install.
if not exist ".venv\installed-req.txt" goto :do_install
fc /b "requirements.txt" ".venv\installed-req.txt" >nul
if errorlevel 1 goto :do_install
echo Dependencias sin cambios, omitiendo pip install.
goto :run
:do_install
echo Instalando dependencias...
pip install -r requirements.txt
if errorlevel 1 (
  echo ERROR: fallo pip install. Revisa tu conexion y vuelve a intentarlo.
  pause
  exit /b 1
)
copy /y "requirements.txt" ".venv\installed-req.txt" >nul
:run
python app.py
pause
