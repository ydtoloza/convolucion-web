# Configuración de gunicorn para producción.
# Medido: ~76 MB RAM por worker, ~0.15 s por convolución.
import multiprocessing
import os

bind = f"0.0.0.0:{os.environ.get('PORT', '5000')}"
workers = int(os.environ.get('GUNICORN_WORKERS', min(4, multiprocessing.cpu_count() * 2 + 1)))
worker_class = 'sync'          # SymPy es CPU puro: hilos no ayudan
timeout = int(os.environ.get('GUNICORN_TIMEOUT', '60'))  # integrales pesadas pueden tardar
graceful_timeout = 30
max_requests = 500             # recicla workers: higiene de memoria (cachés de SymPy)
max_requests_jitter = 50
accesslog = '-'                # logs a stdout (los recoge el orquestador)
errorlog = '-'
