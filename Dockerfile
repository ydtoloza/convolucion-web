# syntax=docker/dockerfile:1
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    FLASK_DEBUG=0 \
    PORT=5000

WORKDIR /app

# Dependencias primero (aprovecha caché de capas si solo cambia tu código)
COPY requirements.txt requirements-prod.txt ./
RUN pip install --no-cache-dir -r requirements-prod.txt

COPY app.py gunicorn.conf.py ./
COPY templates/ ./templates/
COPY static/ ./static/

# Usuario sin privilegios
RUN useradd -m -u 10001 appuser && chown -R appuser:appuser /app
USER appuser

EXPOSE 5000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD python -c "import os,urllib.request,json;print(json.load(urllib.request.urlopen(f\"http://127.0.0.1:{os.environ.get('PORT','5000')}/api/presets\")) and 'ok')"

CMD ["sh", "-c", "gunicorn -c gunicorn.conf.py app:app"]
