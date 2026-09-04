# Changelog

Registro de todo lo trabajado sobre este proyecto. Las etiquetas entre paréntesis
(`BUG-x`, `OPT-x`, `DESIGN-x`) son las que se usan en los comentarios del código.

## 2026-09-04 — Modo oscuro por defecto

- **Tema oscuro como tema por defecto.** `style.css` reescrito con variables CSS:
  `:root` define la paleta oscura (fondo `#0b1220`, tarjetas `#101a2e`, acento
  `#38bdf8`) y `[data-theme="light"]` sobreescribe con la paleta clara original.
  Todos los colores fijos del CSS anterior (botones, inputs, cajas de resultados,
  badges ok/warn/err) pasaron a variables.
- **Botón de alternancia** ☀️/🌙 en la barra superior. La preferencia se guarda en
  `localStorage` (`tema`); sin preferencia explícita, todo carga en oscuro.
- **Sin parpadeo al cargar:** un script inline en `<head>` fija `data-theme` antes
  de que el navegador pinte, así quien eligió claro no ve un destello oscuro.
- **Gráficas Plotly temáticas:** fondos, grilla, texto de ejes y marcador de `t`
  salen del tema activo (`plotTheme()`); al alternar se repintan con los datos ya
  calculados, sin recalcular en el servidor (`lastPlotData` / `lastSolapeData`).
- La barra superior y las pestañas permanecen oscuras en ambos temas (identidad
  visual de la página).
- Verificado: carga por defecto en oscuro, persistencia tras recargar, contraste
  del área de solución y de las 3 gráficas en ambos temas.

## 2026-09-04 — Repo, CI/CD y despliegue en el VPS

- **Repositorio:** [ydtoloza/convolucion-web](https://github.com/ydtoloza/convolucion-web),
  público, rama `main`.
- **CI/CD:** `.github/workflows/docker.yml` — en cada push a `main` (y disparo
  manual) construye la imagen y la publica en GHCR como
  `ghcr.io/ydtoloza/convolucion-web:latest` + tag `sha-<commit>`, con caché de
  capas (`type=gha`). Usa el `GITHUB_TOKEN` integrado (sin secretos manuales).
- **Primer build falló** y se corrigió: el Dockerfile copiaba solo
  `requirements-prod.txt`, pero ese archivo hace `-r requirements.txt`.
  Fix en `e00e517`: `COPY requirements.txt requirements-prod.txt ./`.
- **Despliegue (VPS):** contenedor `convolucion-web` con `--restart unless-stopped`,
  publicado solo en `127.0.0.1:8010` (8010 elegido por estar libre; 8000/8081
  ocupados), límites 512 MB RAM / 1 CPU, `GUNICORN_WORKERS=2`.
- **nginx + TLS:** vhost `systems.lzid.me` con proxy a `127.0.0.1:8010`
  (`X-Forwarded-*` incluidos), certificado Let's Encrypt (ECDSA) vía
  `certbot --nginx`, redirección HTTP→HTTPS activa, renovación automática
  (`certbot.timer`).
- **Script de actualización** `/root/update-convolucion.sh` en el VPS: pull de
  `latest`, recreación del contenedor y health check de `/api/presets` antes de
  reportar OK.
- Detalles operativos completos en [DESPLIEGUE.md](DESPLIEGUE.md).

## 2026-09-03 — Revisión de código: bugs, procedimiento y UI

### Bugs corregidos

1. **Pestañas que no ocultaban secciones** (BUG-14): faltaban las reglas
   `.tab { display:none }` / `.tab.active { display:block }` — las tres secciones
   siempre estaban visibles apiladas y los botones solo cambiaban el resaltado.
2. **JSON inválido con integrales divergentes** (BUG-12): `valor_num` podía ser
   `inf`, que se serializa como `Infinity` y rompe `JSON.parse` en el navegador.
   Ahora solo se incluye si es finito.
3. **Preset desincronizado con el selector** (BUG-13): la app aplicaba el preset
   "Taller Ej.1" pero el `<select>` mostraba "Ej.1". `applyPreset` ahora fija
   `sel.value` y limpia las cajas de "señal completa".
4. **`t0` sin validar en `/api/solape`:** un `NaN` envenenaba todo el grid en
   silencio; ahora responde con error amable.
5. **Vista previa de integrales demasiado quisquillosa:** enviaba los límites
   `a`/`b` al servidor, así que borrarlos o escribirlos a medias (`t-`) mostraba
   un error mientras se tecleaba. La vista previa ahora solo valida el integrando.
6. **Código muerto eliminado:** wrapper `solve_convolution` sin usar, campos
   `low_sym/high_sym` que nadie leía, y tres no-ops en JS
   (`replace('()','()')`, `if (v === '^2') v = '^2'`, un `forEach` vacío).
7. **Texto interno visible en la UI:** "(DESIGN-6: sin rango fijo)" eliminado del
   texto de usuario.

> Nota matemática: el motor siempre fue correcto. El PDF de la guía escribe
> `3t²−16` en el Ejemplo 2 donde en realidad es 3(t²−16) = 3t²−48 (verificable
> por continuidad en t=0 con el tramo siguiente). No se "corrigió" el motor para
> igualar la errata.

### Procedimiento matemático (formato guía de clase)

- **`procedimiento_txt` copiable:** el backend genera el procedimiento completo
  en texto plano unicode (incl. `∫ [0 → t] (2τ)(3) dτ = (3τ^2) evaluado …`), con
  los 5 pasos y subpasos numerados. Botón "📋 Copiar procedimiento" en la
  solución y "📋 Copiar" para el procedimiento general en Teoría.
- **Solución fiel a la documentación:** cada intervalo se presenta como en el
  PDF — encabezado "Intervalo k de N · tiempo de y(t)", línea de **integral
  entrante/saliente en τ**, planteo con los factores sin expandir
  `(x_i(τ))(h_j(t−τ))`, 6 subpasos (planteo → expandir → regla → primitiva →
  evaluar arriba/abajo → TFC) y tras **cada** intervalo la pregunta del ciclo
  "⟳ ¿Fin o hay más intervalos? SÍ — falta…".
- **Partición del solape (entrante/saliente):** donde la guía muestra
  `∫₀ᵗ + ∫_{t−4}^0`, el motor ahora divide el solape en los puntos críticos
  interiores y etiqueta entrante/saliente/intermedia (antes una sola integral
  combinada). Reproduce las páginas 27–28 del PDF exactamente.
- **Condiciones naturales en LaTeX** (`t \ge 0` en vez de `0 \le t \le \infty`)
  vía `cond_var_latex()`/`tramo_cases_latex()`, usadas en vista previa,
  descomponer y los pasos 1–2.
- **Pestaña Teoría rehecha:** procedimiento formal con subpasos, la sección
  "Adaptación a cualquier integral" (7 pasos), y texto copiable.

### UI

- **Indicador de intervalo en vivo** bajo el slider: "Intervalo 3 de 5 · 0 ≤ t < 4".
- **Gráfica y(t)** con líneas verticales punteadas en los puntos críticos y
  línea sólida en el `t` actual del slider.
- Pasos con chips numerados 1–5, tarjetas de intervalo con encabezado, resultado
  final en caja verde, estilos para el ciclo "¿fin?".
- `previewIntegral` ya no envía límites; `applyPreset` sincroniza el selector y
  limpia entradas.
