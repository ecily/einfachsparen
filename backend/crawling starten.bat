@echo off
setlocal

cd /d "%~dp0"

echo ==========================================
echo Einfachsparen - Vollstaendiges Crawling
echo ==========================================
echo.
echo Dieser Lauf:
echo - aktualisiert die Source-Registry
echo - startet das komplette Crawling
echo - fuehrt Normalisierung und Klassifizierung aus
echo - baut Filter, Kategorien und Subkategorien neu auf
echo - aktualisiert Dedupe und Ranking-Metadaten
echo.

node scripts\run-full-crawl.js
set EXIT_CODE=%ERRORLEVEL%

echo.
if %EXIT_CODE% EQU 0 (
  echo Crawling erfolgreich abgeschlossen.
) else (
  echo Crawling fehlgeschlagen. Exit-Code: %EXIT_CODE%
)

echo.
pause
exit /b %EXIT_CODE%
