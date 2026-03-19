@echo off
REM Avvia un semplice server HTTP sulla porta 8000 per eseguire l'app.
REM Uso: fai doppio clic su questo file nella cartella estratta.

SET PORT=8000
echo Avvio server locale, visita http://localhost:%PORT%

python -m http.server %PORT% --bind 127.0.0.1
pause