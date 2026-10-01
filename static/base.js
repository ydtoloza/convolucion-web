// base.js — utilidades comunes a las tres páginas (/convolucion, /integrales, /teoria).
// Script clásico (sin módulos): se carga con defer ANTES de convolucion.js e
// integrales.js, que consumen estas funciones como globales de página.

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
let focusedExpr = null;  // última caja de texto con foco (para el teclado de símbolos)

// BUG-6: escape para interpolar texto en innerHTML. REGLA:
// - SÍ escapar con esc(): valores de inputs (a/b/expr), mensajes de error del
//   backend (contienen el texto que escribió el usuario) y títulos/notas.
// - NO escapar: bloques LaTeX del servidor (j.tramo_latex, paso1/2, integrales,
//   y_tramos_latex...) porque KaTeX necesita el fuente original; escaparlos
//   rompería el render. Esos LaTeX los genera SymPy (sp.latex), no el usuario.
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function renderLatex(el, tex, display = false) {
  try {
    if (window.katex) { window.katex.render(tex, el, { throwOnError: false, displayMode: display }); return; }
  } catch (e) { /* fallback */ }
  el.textContent = tex;
}
function renderAll(el) {
  if (window.renderMathInElement) {
    try { renderMathInElement(el, { delimiters: [{ left: '\\(', right: '\\)', display: false }, { left: '\\[', right: '\\]', display: true }, { left: '$$', right: '$$', display: true }, { left: '$', right: '$', display: false }] }); return; } catch (e) {}
  }
}

// ---------- tema (claro por defecto; oscuro con data-theme="dark") ----------
// El atributo data-theme se fija ANTES del CSS (script inline en <head>);
// aquí solo se alterna, se persiste y se avisa a la página para que repinte.
const PLOT_PALETTES = {
  light: {
    paper: '#ffffff', plot: '#ffffff', font: '#211d19',
    grid: '#eceae2', zero: '#c9c4ba',
    x: '#6f6a62', h: '#8c2f39', y: '#211d19',
    marker: '#8c2f39', crit: '#c9c4ba', prodFill: 'rgba(140,47,57,.14)'
  },
  dark: {
    paper: '#211d19', plot: '#211d19', font: '#ede8df',
    grid: '#332d27', zero: '#4a433b',
    x: '#a39b8f', h: '#d68f95', y: '#ede8df',
    marker: '#d68f95', crit: '#4a433b', prodFill: 'rgba(214,143,149,.16)'
  }
};
function currentTheme() {
  return document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
}
const plotColors = () => PLOT_PALETTES[currentTheme()];
function plotLayout(extra) {
  const c = plotColors();
  return Object.assign({
    margin: { t: 36, r: 10, l: 44, b: 36 },
    paper_bgcolor: c.paper, plot_bgcolor: c.plot,
    font: { color: c.font },
    xaxis: { gridcolor: c.grid, zerolinecolor: c.zero },
    yaxis: { gridcolor: c.grid, zerolinecolor: c.zero }
  }, extra || {});
}
const THEME_META = { light: '#f7f6f2', dark: '#161311' };
function syncThemeButton() {
  const b = $('#btnTema');
  if (!b) return;
  const dark = currentTheme() === 'dark';
  b.innerHTML = `<svg class="icon" aria-hidden="true"><use href="#i-${dark ? 'sun' : 'moon'}"/></svg>`;
  b.title = dark ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro';
  b.setAttribute('aria-label', b.title);
}
function applyTheme(t) {
  document.documentElement.setAttribute('data-theme', t);
  try { localStorage.setItem('tema', t); } catch (e) { /* modo privado */ }
  syncThemeButton();
  const meta = document.getElementById('metaTema');
  if (meta) meta.content = THEME_META[t];
  // Las gráficas viven en convolucion.js: la página registra window.repaintPlots
  // y aquí solo se le avisa. En páginas sin gráficas no hay nada que repintar.
  if (typeof window.repaintPlots === 'function') window.repaintPlots();
}

// ---------- inserción ----------
// El teclado inserta donde estés escribiendo: se sigue el foco de TODAS las
// cajas de texto (tramos, señal completa xSingle/hSingle, integrales). Se
// excluyen a propósito el slider (type=range), selects y botones.
document.addEventListener('focusin', (e) => {
  if (e.target.matches('input:not([type]), input[type="text"], input[type="search"], textarea')) focusedExpr = e.target;
});
function insertText(text) {
  const el = focusedExpr || $('#intExpr');
  if (!el || el.disabled) return;
  const s = el.selectionStart ?? el.value.length, en = el.selectionEnd ?? el.value.length;
  el.value = el.value.slice(0, s) + text + el.value.slice(en);
  el.focus();
  // coloca cursor dentro de paréntesis si aplica
  if (text.endsWith('()')) { el.selectionStart = el.selectionEnd = s + text.length - 1; }
  else { el.selectionStart = el.selectionEnd = s + text.length; }
  el.dispatchEvent(new Event('input', { bubbles: true }));
}
function bindPalette(id) {
  const pal = document.getElementById(id);
  if (!pal) return;
  pal.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-ins]');
    if (b) insertText(b.dataset.ins);
  });
}

// ---------- tiempos ----------
function debounce(fn, ms) {
  let h; return (...a) => { clearTimeout(h); h = setTimeout(() => fn(...a), ms); };
}
// El slider necesita THROTTLE, no debounce: con debounce la gráfica solo se
// actualizaba al soltar (cada movimiento reiniciaba el temporizador). Con
// throttle hay respuesta inmediata + como máximo una petición cada `ms`.
function throttle(fn, ms) {
  let last = 0, timer = null, lastArgs = null;
  return (...a) => {
    const now = Date.now(), rem = ms - (now - last);
    lastArgs = a;
    if (rem <= 0) { last = now; if (timer) { clearTimeout(timer); timer = null; } fn(...a); }
    else if (!timer) { timer = setTimeout(() => { last = Date.now(); timer = null; fn(...lastArgs); }, rem); }
  };
}

// ---------- portapapeles ----------
async function copyText(txt) {
  try { await navigator.clipboard.writeText(txt); return true; }
  catch (e) {
    // fallback para contextos sin Clipboard API (requiere activación de usuario)
    const ta = document.createElement('textarea');
    ta.value = txt;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed'; ta.style.top = '-9999px';
    document.body.appendChild(ta);
    ta.focus(); ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch (_) { /* noop */ }
    ta.remove(); return ok;
  }
}
function bindCopyButton(btn, getText) {
  if (!btn) return;
  btn.addEventListener('click', async () => {
    // Se guarda/restaura innerHTML (no textContent): el botón lleva un <svg>
    // dentro y textContent lo destruiría al mostrar «Copiado».
    const prev = btn.innerHTML;
    const ok = await copyText(getText());
    btn.innerHTML = ok ? 'Copiado' : 'No se pudo copiar';
    btn.classList.toggle('copy-ok', ok);
    setTimeout(() => { btn.innerHTML = prev; btn.classList.remove('copy-ok'); }, 1600);
  });
}

// ---------- errores ----------
// UX-3: errores técnicos de SymPy traducidos a guía para el estudiante.
// La usan la página de convolución (resolver) y la de integrales (resolverInt).
function friendlyError(msg) {
  msg = String(msg || 'Error desconocido');
  if (/interpretar/i.test(msg)) return msg + '\nRevisa la sintaxis: usa * para multiplicar (5*t), exp() para exponenciales y ^ para potencias.';
  if (/dimension|shape|broadcast/i.test(msg)) return msg + '\nParece un problema numérico en la gráfica; prueba simplificar los tramos.';
  if (/Failed to fetch|NetworkError|HTTP/i.test(msg)) return msg + '\nNo hay conexión con el servidor: verifica que app.py esté corriendo en http://127.0.0.1:5000.';
  return msg;
}

// ---------- procedimiento general (texto copiable, página de teoría) ----------
const PROC_GENERAL_TXT = `PROCEDIMIENTO GENERAL
Convolución  y(t) = x(t) ∗ h(t) = ∫ x(τ)·h(t−τ) dτ   (τ variable, t fijo)

PASO 1 · Obtener h(t−τ) «móvil» (reflejo + corrimiento), por cada tramo h_j:
  (1) Escribir h_j(t) con su soporte:  h_j(t) = f(t)  si  a_j ≤ t ≤ b_j ; 0 en otro caso
  (2) Sustituir t → t−τ en la fórmula Y en el soporte:  a_j ≤ t−τ ≤ b_j
  (3) Restar t en toda la desigualdad:  a_j−t ≤ −τ ≤ b_j−t
  (4) Multiplicar por −1 (¡las desigualdades se invierten!):  t−b_j ≤ τ ≤ t−a_j
  Resultado: h_j(t−τ) está activo solo en  t−b_j ≤ τ ≤ t−a_j.

PASO 2 · Obtener x(τ) «fija» (cambio de variable t→τ), por cada tramo x_i:
  Sustituir t → τ:  x_i(τ) activo en  a_i ≤ τ ≤ b_i.
  (Criterio de clase: si conviene, se intercambian x y h —fija la de soporte
  más ancho— porque x∗h = h∗x y el resultado no cambia.)

PASO 3 · Identificar intervalos de t y de τ (dónde inicia):
  (1) Puntos críticos:  t_c = (borde de x) + (borde de h), todas las
      combinaciones finitas; ordenarlos de menor a mayor.
  (2) Los críticos dividen la recta de t en intervalos; y(t) inicia donde
      aparece el primer solape.
  (3) En cada intervalo elegir un t de prueba y obtener el solape en τ:
      límites = [ máx(a_i, t−b_j) , mín(b_i, t−a_j) ].  Si queda vacío → y = 0.

PASO 4 · Multiplicar e integrar (para cada intervalo CON solape):
  (1) Plantear la integral con los límites reales:
        y(t) = ∫[lo → hi] (x_i(τ))·(h_j(t−τ)) dτ
      (si el solape entra y sale por tramos distintos, escribir una integral
      entrante y una saliente y sumarlas)
  (2) Expandir/simplificar el integrando sin saltarse operaciones.
  (3) Aplicar la regla que corresponda (potencia, exponencial, trigonometría
      o integración por partes) para obtener la primitiva F(τ).
  (4) Evaluar F(hi) y F(lo) por separado.
  (5) Restar (Teorema Fundamental del Cálculo):  y = F(hi) − F(lo), simplificar.

PASO 5 · ¿Fin o hay más intervalos?
  Repetir PASOS 3–4 hasta cubrir todos los intervalos. Respuesta final por
  tramos (y, si se pide, forma compacta con escalones u(t)).

ADAPTACIÓN A CUALQUIER INTEGRAL ∫ f(u) du (con o sin límites):
  (1) Transcribir el integrando tal cual.
  (2) Expandir/simplificar (agrupar términos semejantes).
  (3) Identificar la regla:  ∫ u^n du = u^(n+1)/(n+1)  ·  ∫ e^(ku) du = e^(ku)/k
      ∫ sen(ku) du = −cos(ku)/k  ·  ∫ cos(ku) du = sen(ku)/k
      polinomio×exponencial o ×trig → integración por partes (tabular).
  (4) Integrar término a término → primitiva F(u) + C.
  (5) Verificar derivando:  dF/du debe devolver f(u).
  (6) Si hay límites: evaluar F(superior) y F(inferior) por separado.
  (7) Restar (TFC):  ∫[a → b] f(u) du = F(b) − F(a), simplificar.`;

// ---------- wiring común (con guards: no todos los elementos existen en todas las páginas) ----------
bindPalette('palette'); bindPalette('palette2');
if ($('#btnCopiarProc')) bindCopyButton($('#btnCopiarProc'), () => PROC_GENERAL_TXT);
// (el botón de tema va aparte: no es una pestaña)
if ($('#btnTema')) $('#btnTema').onclick = () => applyTheme(currentTheme() === 'dark' ? 'light' : 'dark');
syncThemeButton();  // sincroniza icono/título con el tema fijado en <head>
renderAll(document.body);
// KaTeX carga diferido: re-render genérico cuando esté listo (los re-renders
// específicos de cada página van en su archivo).
window.addEventListener('load', () => renderAll(document.body));
