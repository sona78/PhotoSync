@echo off
echo ============================================
echo PhotoSync mkcert Certificate Setup
echo ============================================
echo.

REM Install local CA
echo [1/4] Installing local CA root certificate...
mkcert -install
if errorlevel 1 (
    echo ERROR: Failed to install CA root certificate
    echo Make sure mkcert is installed and in your PATH
    pause
    exit /b 1
)
echo.

REM Get IP address
echo [2/4] Detecting network IP address...
for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /c:"IPv4 Address" ^| findstr /v "127.0.0.1"') do (
    set IP_ADDR=%%a
    goto :found_ip
)
:found_ip
set IP_ADDR=%IP_ADDR: =%
echo Detected IP: %IP_ADDR%
echo.

REM Backup old certificates
echo [3/4] Backing up old certificates...
if exist cert.pem (
    move /y cert.pem cert.pem.backup
    echo Backed up cert.pem
)
if exist key.pem (
    move /y key.pem key.pem.backup
    echo Backed up key.pem
)
echo.

REM Generate new certificates
echo [4/4] Generating certificates for:
echo   - localhost
echo   - 127.0.0.1
echo   - %IP_ADDR%
echo.
mkcert -cert-file cert.pem -key-file key.pem localhost 127.0.0.1 %IP_ADDR%
if errorlevel 1 (
    echo ERROR: Failed to generate certificates
    pause
    exit /b 1
)
echo.

echo ============================================
echo SUCCESS!
echo ============================================
echo Certificates generated:
echo   - cert.pem (certificate)
echo   - key.pem (private key)
echo.
echo NEXT STEPS:
echo 1. Export the root CA for your mobile device:
echo    mkcert -CAROOT
echo.
echo 2. Find the file "rootCA.pem" in the folder shown above
echo.
echo 3. Transfer rootCA.pem to your phone and install it
echo    (See instructions below)
echo.
echo ============================================
pause
