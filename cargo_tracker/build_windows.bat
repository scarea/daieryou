@echo off
setlocal
cd /d "%~dp0"

py -m venv .venv
if errorlevel 1 goto :error

call .venv\Scripts\activate
python -m pip install --upgrade pip
pip install -r requirements.txt
pip install pyinstaller
if errorlevel 1 goto :error

pyinstaller --onefile --windowed --name EthiopianCargoTracker tracker_gui.py
if errorlevel 1 goto :error

echo.
echo 打包完成：
echo %cd%\dist\EthiopianCargoTracker.exe
echo.
pause
exit /b 0

:error
echo.
echo 打包失败，请把上面的错误截图发给技术同事。
pause
exit /b 1
