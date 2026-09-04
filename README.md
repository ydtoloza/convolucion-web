# Convolución continua · paso a paso

Solucionador de la integral de convolución \( y(t) = x(t) * h(t) \) con desarrollo
paso a paso (metodología de 5 pasos de la guía de clase): h(t−τ) móvil, x(τ) fija,
regiones por puntos críticos, integración con TFC e integral entrante/saliente.
Incluye solucionador de integrales indefinidas/definidas con verificación de la primitiva.

**Demo:** https://systems.lzid.me

Stack: Flask + SymPy (motor simbólico) · Gunicorn (prod) · Docker · KaTeX + Plotly (frontend).

## Documentación

| Doc | Contenido |
|---|---|
| [docs/CHANGELOG.md](docs/CHANGELOG.md) | Todo lo trabajado: bugs corregidos, procedimiento paso a paso, UI, CI/CD, modo oscuro |
| [docs/DESPLIEGUE.md](docs/DESPLIEGUE.md) | Guía operativa: arquitectura, actualizar/rollback, nginx/certbot, salud y diagnóstico |
| [docs/DECISIONES.md](docs/DECISIONES.md) | Decisiones de diseño y su porqué (KISS/boring/YAGNI, matemática, técnica) |

## Uso local (sin Docker)

```bat
iniciar.bat
```

Abre http://127.0.0.1:5000

## Docker

```bash
docker compose up --build          # http://localhost:8000
```

## CI/CD

Cada push a `main` construye y publica la imagen en GHCR
(`.github/workflows/docker.yml`): `ghcr.io/ydtoloza/convolucion-web:latest`.

## Despliegue (VPS Contabo)

El contenedor corre con `--restart unless-stopped`, publicado en `127.0.0.1:8010`
y nginx hace de proxy inverso con TLS (certbot) para `systems.lzid.me`.

Para actualizar a la última imagen (tras un push a `main`):

```bash
ssh -p 22335 root@217.216.49.147 /root/update-convolucion.sh
```

Ese script hace: `docker pull` de `latest`, recreate del contenedor y health check.

## Estructura

| Archivo | Papel |
|---|---|
| `app.py` | Motor de convolución/integrales + API Flask |
| `gunicorn.conf.py` | Config de producción (workers sync, reciclado por max_requests) |
| `templates/`, `static/` | Interfaz (pestañas Convolución / Integrales / Teoría) |
| `Dockerfile`, `docker-compose.yml` | Imagen de producción (python:3.12-slim) |
