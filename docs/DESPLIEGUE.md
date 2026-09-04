# Despliegue y operación

Guía operativa del flujo completo: código → CI → registro → VPS → HTTPS público.

> Credenciales y detalles sensibles (IP/puerto SSH del VPS, llaves) NO viven en
> este repo: están en la carpeta privada de credenciales del usuario.

## Arquitectura

```
push a main ──► GitHub Actions (build Docker) ──► ghcr.io/ydtoloza/convolucion-web
                                                        │ pull
                                                        ▼
usuario ──► Cloudflare (DNS systems.lzid.me) ──► nginx 443 (TLS certbot)
                                                   └─ proxy_pass ──► 127.0.0.1:8010
                                                                        │
                                                        contenedor convolucion-web
                                                        (gunicorn, Flask+SymPy)
```

| Pieza | Detalle |
|---|---|
| Imagen | `python:3.12-slim`, app como usuario sin privilegios (uid 10001), `HEALTHCHECK` sobre `/api/presets` |
| Servidor WSGI | Gunicorn, workers sync. `GUNICORN_WORKERS=2` en el VPS (SymPy es CPU puro) |
| Puerto | Contenedor escucha 5000; publicado **solo** en `127.0.0.1:8010` del host (nginx es la única puerta) |
| Límites | `--memory 512m --cpus 1.0` |
| Reinicio | `--restart unless-stopped` |
| TLS | Let's Encrypt (ECDSA) vía `certbot --nginx`, renovación automática con `certbot.timer` |

## Actualizar producción (flujo normal)

```bash
git push                                   # 1. dispara el build en Actions
# 2. espera el check verde en GitHub Actions
ssh <vps> /root/update-convolucion.sh      # 3. pull + recreate + health check
```

El script del VPS hace: `docker pull ghcr.io/ydtoloza/convolucion-web:latest`,
`docker rm -f convolucion-web`, recrea el contenedor con la misma configuración
y verifica `http://127.0.0.1:8010/api/presets` antes de reportar OK.

### Rollback

Cada build publica también el tag `sha-<commit>`. Para volver a una versión
anterior, recrea el contenedor pineando ese tag (mismos flags que el script de
actualización, cambiando `latest` por `sha-<commit>`).

## Provisionamiento (ya hecho; referencia)

1. **Imagen publicada por CI** — el paquete de GHCR quedó público (repo público),
   por eso el VPS no necesita `docker login`.
2. **Contenedor** (lo reproduce `update-convolucion.sh`):
   ```bash
   docker run -d --name convolucion-web --restart unless-stopped \
     -p 127.0.0.1:8010:5000 \
     -e GUNICORN_WORKERS=2 \
     --memory 512m --cpus 1.0 \
     ghcr.io/ydtoloza/convolucion-web:latest
   ```
3. **Vhost nginx** en `/etc/nginx/sites-available/systems.lzid.me` (enlazado en
   `sites-enabled/`):
   ```nginx
   server {
       listen 80;
       server_name systems.lzid.me;
       access_log /var/log/nginx/systems.lzid.me.access.log;
       error_log  /var/log/nginx/systems.lzid.me.error.log;
       location / {
           proxy_pass http://127.0.0.1:8010;
           proxy_http_version 1.1;
           proxy_set_header Host $host;
           proxy_set_header X-Real-IP $remote_addr;
           proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
           proxy_set_header X-Forwarded-Proto $scheme;
           proxy_read_timeout 90s;
       }
   }
   ```
   Tras certbot, el mismo vhost queda con el bloque 443 + redirect 80→443.
4. **Certificado:** `certbot --nginx -d systems.lzid.me --redirect`.
5. **DNS:** registro A de `systems.lzid.me` en Cloudflare apuntando al VPS.

## Salud y diagnóstico

```bash
# en el VPS
docker ps --filter name=convolucion-web          # estado + (healthy)
docker logs --tail 50 convolucion-web            # stdout/stderr de gunicorn
curl -s http://127.0.0.1:8010/api/presets        # health directo (sin nginx)

# fuera del VPS
curl -sI https://systems.lzid.me/api/presets     # ruta pública completa
certbot certificates                             # vencimiento del cert
systemctl is-active certbot.timer                # renovación automática
```

El endpoint barato de health check es `GET /api/presets` (no calcula nada, solo
sirve el diccionario de presets).

## Desarrollo local

Sin Docker (Windows): `iniciar.bat` (crea `.venv`, instala dependencias y abre
`http://127.0.0.1:5000`; debug solo con `FLASK_DEBUG=1`).

Con Docker: `docker compose up --build` → `http://localhost:8000`.

## Decisiones operativas

- **Puerto 8010 en loopback:** 8000/8081 estaban ocupados por otros contenedores
  del VPS; publicar solo en `127.0.0.1` garantiza que la única entrada pública
  sea nginx con TLS.
- **2 workers fijos:** el VPS comparte carga con otros servicios; 2 workers
  (~150–300 MB) sobran para una herramienta de curso y evitan presión de RAM.
- **Sin secretos en el repo:** el repo es público; credenciales/llaves viven en
  la carpeta privada local. El workflow usa el `GITHUB_TOKEN` efímero.
