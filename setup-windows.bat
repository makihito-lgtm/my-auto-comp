@echo off
echo [AutoComp] Windows Native OCR Setup...

where csc >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] 'csc' (C# Compiler) is not found.
    echo Please install .NET Framework SDK or Visual Studio Build Tools.
    pause
    exit /b
)

echo Compiling ocr.cs to ocr.exe...
csc /target:exe /out:ocr.exe ocr.cs /reference:System.Drawing.dll /reference:System.Runtime.WindowsRuntime.dll /reference:Windows.Media.dll

if %errorlevel% equ 0 (
    echo [SUCCESS] ocr.exe has been generated.
    echo Now you can run: npm run build:win
) else (
    echo [ERROR] Compilation failed.
)
pause
