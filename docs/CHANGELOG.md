# Changelog

Registro de todo lo trabajado sobre este proyecto. Las etiquetas entre paréntesis
(`BUG-x`, `OPT-x`, `DESIGN-x`) son las que se usan en los comentarios del código.

## 2026-09-30 — Multipágina con soluciones compartibles por enlace

- **De SPA de pestañas a multipágina.** Cada sección pasa a ser una página con
  ruta propia: `/convolucion`, `/integrales` y `/teoria` (`/` redirige a
  `/convolucion`). La navegación del header deja los botones `data-tab` y usa
  enlaces reales (`<a class="tab-link">`) con clase `active` y
  `aria-current="page"` en la página actual: la nav funciona sin JS, cada
  sección tiene URL propia e histórica y las secciones `<section class="tab">`
  desaparecen.
- **Estado de la ecuación en la URL.** Al resolver, las entradas se serializan
  en la query string con `history.replaceState`: en Convolución los tramos de x
  e h (`x0a`/`x0b`/`x0e`, …), en Integrales `expr`, `var`, `a` y `b`. Al abrir
  un enlace compartido, la página se auto-resuelve con esas entradas (la URL
  solo lleva entradas: el servidor sigue siendo quien calcula).
- **Botón «Copiar enlace»** en las tarjetas de solución: copia la URL con el
  estado ya puesto en la query, lista para pegar y compartir la solución tal
  cual se resolvió.
- **JS dividido por página:** `app.js` se parte en `base.js` (tema, iconos,
  utilidades), `convolucion.js` e `integrales.js`; cada página carga solo el
  base y su script.
- **OG tags por página:** cada URL compartida tiene su propia vista previa
  (título/descripción) en redes y chats.
- **Fix:** el botón «Copiar» perdía su ícono al mostrar el estado «Copiado»;
  corregido para conservarlo.

## 2026-09-06 — Convergencia: «no converge» en vez de ∞ disfrazado (BUG-15)

- **Detección de integrales que no convergen.** Con tramos de soporte infinito
  el límite de integración puede ser infinito y la integral diverger: p. ej.
  x(t)=5e^(−3t) en (−∞,∞) con h(t)=u(t) da ∫[−∞→t] 5e^(−3τ)dτ = ∞. Antes el
  motor presentaba «y(t)=∞ para todo t» como si fuera una respuesta por
  tramos; ahora cada región evalúa sus límites infinitos y, si el valor sale
  ±∞ / zoo / nan / Acotado (oscilatorias), se marca `diverge`: la región
  responde **no converge**, la gráfica y(t) deja un hueco (null en el JSON, que
  además evita serializar NaN/Infinity inválidos — misma familia que BUG-12) y
  la lectura de área del solape muestra «no converge» en vez de un recorte
  numérico engañoso.
- **Aviso con la causa y la corrección del tramo.** Bajo el criterio de la
  fija aparece una tarjeta de advertencia: qué lado (τ→−∞ o τ→+∞) falla, a qué
  tiende el integrando en esa cola, la exigencia del método (Lección 3: el
  producto debe anularse/decaer en la cola infinita) y la pista de tramos:
  una señal f(t)·u(t) se separa en «desde 0 hasta ∞», no «desde −∞» (botón
  «Separar en tramos»). También en el texto copiable del procedimiento.
- **Paso 3 sin puntos críticos inventados.** Si no hay sumas de bordes finitos
  (todos los tramos tienen soporte infinito) ya no se muestra `t_c ∈ {0}` con
  un 0 falso: se indica «sin puntos críticos: un único intervalo de t» y
  `t_inicio` es null (antes 0). El texto copiable refleja lo mismo.
- **Tramo que cubre toda la recta bien escrito.** La vista previa y los pasos
  1–2 mostraban `{5e^{−3t}, t∈ℝ; 0, e.o.c.}` (contradictorio); ahora un tramo
  en toda la recta se escribe `f(t) = expr, t ∈ ℝ` (y en texto plano, solo la
  fórmula).
- **Verificado:** entrada del reporte (x en ℝ × u(t)) → aviso + «no converge»;
  taller Ej. 1 correcto (5e^(−3t)u(t) × u(t)) → críticos {0}, y=0 para t<0 y
  5/3(1−e^(−3t)) para t≥0 (Lección 3, ej. 1); rampa×pulso → resultados y
  críticos intactos (regresión); e^(−t)u(t) × e^(t)u(−t) → solape infinito que
  SÍ converge, valores ½e^(±t) sin falsos positivos; sen(t) en ℝ × u(t) →
  detectada como no convergente (oscila).

## 2026-09-05 — Rediseño editorial, ejemplo único y salida para el cuaderno

- **Rediseño completo de la interfaz** (se retira el look «panel oscuro + cian»):
  tema claro editorial (papel cálido, tinta, acento guinda), tipografías Inter
  (UI) y Source Serif 4 (títulos) vía Google Fonts, iconografía SVG propia
  (sprite inline estilo Lucide, sin dependencias nuevas), favicon, cabecera fija
  con desenfoque y pestañas subrayadas.
- **Modo oscuro invertido:** ahora el claro es el tema por defecto y el oscuro es
  opcional. Tokens oscuros cálidos en `:root[data-theme="dark"]`, botón sol/luna,
  preferencia en `localStorage`, `prefers-color-scheme` en la primera visita,
  script anti-destello en `<head>`, paletas Plotly por tema y `meta theme-color`
  dinámico. La impresión siempre sale en claro.
- **Un solo ejemplo de trabajo:** de los 5 presets queda el más completo (rampa ×
  pulso, Lección 3 ej. 2: críticos −4/0/4/8, cinco tramos, tres integrales). Se
  carga al abrir, con botón «Restablecer ejemplo». Se retiran las plantillas
  (pulso/rampa/exponencial/escalón) y los botones «Ej:» de la pestaña Integrales.
- **Solución solo-matemática para copiar al cuaderno:** fuera los textos guía del
  procedimiento (numeraciones ①–⑥, explicaciones de reglas, etiquetas
  entrante/saliente y las preguntas «¿Fin o hay más intervalos?»). Cada intervalo
  queda como la cadena planteo → integrando expandido → F(τ) → evaluación. El
  texto del botón «Copiar procedimiento» también pasó a formato cuaderno.
- **Integrales con la señal en cero, como en los apuntes** (Lección 3, p.14/23/30):
  los tramos sin solape muestran su integral explícita `(0)·(h) dτ = 0`
  (∫_{−∞}^t al inicio, ∫_t^∞ al final) y, cuando la ventana móvil ya pasó el
  último tramo de x, se escribe la integral entrante `∫_4^t (0)(3) dτ = 0`
  antes de la saliente. Los resultados no cambian (esas integrales valen 0).
- **Orden de bloques:** la tarjeta Solución encabeza la columna de resultados;
  gráficas y solape quedan como apoyo, con textos-guía en las gráficas vacías.
- **Detalles de producción:** `aria-label` en botones de solo icono, estados
  `:focus-visible`, spinner de carga, slider con relleno de progreso, numeración
  de tramos por contadores CSS, estilos de impresión y `prefers-reduced-motion`.
- Bugs corregidos durante el rediseño: contenedor `#criterioFija` faltante en el
  nuevo HTML (rompía el render de la solución), desborde de Plotly por
  `display:grid` en `.plot`, texto-guía de gráficas vacías que no se retiraba al
  dibujar, spinner siempre visible (`display:flex` anulaba `hidden`), clave
  `integrando_txt` inexistente y condición simbólica (`t > …`) al detectar la
  integral entrante cero.

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
