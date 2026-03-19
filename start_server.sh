#!/bin/bash
# Avvia un semplice server HTTP sulla porta 8000 per eseguire l'app.
# Uso: esegui questo script dalla cartella estratta per l'app web.

PORT=8000
echo "Avvio server locale, naviga su http://localhost:$PORT" 

if command -v python3 >/dev/null 2>&1; then
  python3 -m http.server "$PORT" --bind 127.0.0.1
elif command -v python >/dev/null 2>&1; then
  python -m http.server "$PORT" --bind 127.0.0.1
else
  echo "Python non è installato. Installa Python o usa un altro strumento per avviare un server HTTP."
  exit 1
fi