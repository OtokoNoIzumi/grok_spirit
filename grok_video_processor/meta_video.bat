@echo off
chcp 65001
cd /d %~dp0
call %USERPROFILE%\anaconda3\Scripts\activate.bat workspace
REM 运行Python脚本
python meta_video.py

echo.
echo 按任意键退出...
pause >nul