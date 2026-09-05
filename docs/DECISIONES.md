# Decisiones de diseño

Registro corto de las decisiones importantes y su porqué, para que el próximo
que mantenga el código no tenga que re-derivarlas.

## Principios del backend: KISS / boring / YAGNI

Los tres principios aplican a niveles distintos y no compiten entre sí:

| Principio | Nivel | Aplicación a este proyecto |
|---|---|---|
| **Boring is good** | Tecnología | Flask + SymPy + NumPy: lo más probado que existe para este dominio. No cambiar a frameworks de moda, no añadir Redis/colas/microservicios. |
| **YAGNI** | Alcance | El riesgo real del proyecto es de alcance, no técnico: cada "que también sirva para X" invita a un motor genérico innecesario. No hay BD, ni usuarios, ni autenticación; las cachés en memoria bastan. |
| **KISS** | Código | Un solo módulo Python, funciones directas. Si el proyecto sigue creciendo, el siguiente paso natural sería partir `app.py` en parseo / motor / rutas — y no antes. |

**Criterio de decisión diario: YAGNI** (responde "¿construyo esto?") antes que
KISS ("¿cómo lo escribo simple?"). Aplicaciones concretas: no se construyó
exportación a Word/PDF (el copiado en texto plano cubre la necesidad real), ni
historial de ejercicios, ni motor genérico de transformadas, ni temas dinámicos
más allá de oscuro/claro.

## Decisiones de producto/matemática

- **El motor manda sobre la errata del PDF.** La guía escribe `3t²−16` en el
  Ejemplo 2 donde el valor correcto es 3(t²−16) = 3t²−48 (continuidad en t=0).
  El solucionador produce el valor correcto y no se "corrigió" para igualar la
  errata del material.
- **Partición del solape en críticos interiores (integral entrante/saliente).**
  Matemáticamente ∫ es lo mismo partida o no, pero el objetivo de la herramienta
  es enseñar el procedimiento de la guía; por eso cada solape se divide en los
  puntos críticos interiores y se etiqueta entrante (borde derecho, la parte
  nueva) → saliente (lo que deja el borde) → intermedia. Orden descendente para
  que la entrante aparezca primero, como en el PDF.
- **Procedimiento en texto plano unicode para copiar** (no LaTeX): el usuario
  pega en Word/notas/WhatsApp; `∫`, `≤`, `τ`, `e^(−3τ)` sobreviven a cualquier
  destino. LaTeX se queda para el render en pantalla (KaTeX).
- **Fija la señal de soporte más ancho** (criterio de clase): el resultado no
  cambia (x∗h = h∗x) pero reduce los casos de solape a dibujar a mano; la UI
  ofrece intercambiar con un clic cuando conviene.
- **Modo oscuro por defecto** (elección explícita del usuario), con claro
  opcional persistido en `localStorage`. No se usa `prefers-color-scheme` como
  base: el requisito era "oscuro por defecto", punto. La barra superior queda
  oscura en ambos temas por identidad visual.
  *(2026-09-05: invertido por nuevo requisito — el claro es el defecto, tema
  editorial; el oscuro queda como opción. Primera visita sigue
  `prefers-color-scheme`.)*
- **Regeneración local del procedimiento en el frontend:** el backend calcula y
  el frontend solo pinta; las gráficas se repintan al cambiar tema con los datos
  ya recibidos (sin recalcular en el servidor).
- **Tema claro editorial como identidad** (2026-09-05): el panel oscuro con cian
  leía «hecho por IA»; papel cálido + tinta + un solo acento guinda + serif en
  títulos lee «apunte de curso». Iconos SVG en sprite propio en vez de una
  librería: cero dependencias y control total del trazo.
- **Un solo ejemplo, el más completo** (2026-09-05): los 5 presets confundían;
  queda rampa × pulso (Lección 3 ej. 2), que es el caso con más intervalos y
  cubre todas las situaciones del método. Los demás eran subconjuntos suyos.
- **Solución solo-matemática** (2026-09-05): el objetivo de la tarjeta Solución
  es copiar rápido al cuaderno, no enseñar la teoría (para eso está la pestaña
  Teoría). Por eso se eliminaron los textos guía del render y del texto
  copiable, dejando únicamente la cadena de expresiones.
- **Integrales (0)·(h) visibles en los tramos de cero** (2026-09-05): los
  apuntes (Lección 3, p.14/23/30) escriben la integral con la señal en cero en
  el primer intervalo y como integral entrante cuando la ventana móvil pasó el
  último tramo de x; la herramienta lo replica para que lo copiado coincida
  con lo que el docente espera en la hoja de respuesta.

## Decisiones técnicas

- **Cachés en memoria del proceso** (`_integral_cache`, caché de lambdify) con
  tope y versión de contexto: suficiente para un solo contenedor; invalidar o
  persistir sería YAGNI.
- **`MAX_CONTENT_LENGTH` 64 KB + errores JSON:** límites razonables para un API
  pública de curso; los errores de parseo del usuario devuelven 400 con mensaje
  amable (no tracebacks).
- **Health check barato** (`GET /api/presets`, sin cálculo) para el
  `HEALTHCHECK` de Docker y el script de actualización.
- **Gunicorn sync + reciclado por `max_requests`**: SymPy no gana nada con
  hilos; el reciclado periódico de workers es higiene de memoria contra las
  cachés de SymPy.
- **Static/templates dentro de la imagen** (sin volúmenes): la imagen es
  inmutable y versionada por tag; actualizar = pull + recreate.
