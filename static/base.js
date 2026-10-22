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
    paper: '#ffffff', plot: '#ffffff', font: '#111215',
    grid: '#ececE8', zero: '#b9bbc0',
    x: '#1f5fd1', h: '#d63d27', y: '#111215',
    marker: '#d63d27', crit: '#d6d6d1', prodFill: 'rgba(214,61,39,.14)'
  },
  dark: {
    paper: '#18191c', plot: '#18191c', font: '#ecedef',
    grid: '#26282d', zero: '#4a4d55',
    x: '#7aaeff', h: '#ff8a72', y: '#ecedef',
    marker: '#ff8a72', crit: '#3a3d44', prodFill: 'rgba(240,85,58,.18)'
  }
};
function currentTheme() {
  return document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
}
const plotColors = () => PLOT_PALETTES[currentTheme()];
function plotLayout(extra) {
  const c = plotColors();
  // En celular: ejes fijos (arrastrar desplaza la página en vez de hacer zoom)
  // y leyenda abajo para que la curva use todo el ancho.
  const touch = isTouchNarrow();
  return Object.assign({
    margin: touch ? { t: 36, r: 8, l: 40, b: 30 } : { t: 36, r: 10, l: 44, b: 36 },
    paper_bgcolor: c.paper, plot_bgcolor: c.plot,
    font: { color: c.font },
    xaxis: { gridcolor: c.grid, zerolinecolor: c.zero, fixedrange: touch },
    yaxis: { gridcolor: c.grid, zerolinecolor: c.zero, fixedrange: touch },
    dragmode: touch ? false : 'zoom',
    legend: touch ? { orientation: 'h', x: 0, y: -0.18 } : {}
  }, extra || {});
}
// La barra de herramientas de Plotly sale al pasar el mouse; en pantallas
// táctiles queda fija sobre el título, así que ahí se oculta.
function plotConfig() {
  return isTouchNarrow() ? { responsive: true, displayModeBar: false } : { responsive: true, displaylogo: false };
}
const THEME_META = { light: '#ffffff', dark: '#18191c' };
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

// ---------- teclado matemático en celular (estilo Photomath) ----------
// En pantallas táctiles angostas los campos usan inputmode="none" (no sale el
// teclado del sistema) y se muestra este teclado anclado abajo. «ABC» vuelve
// al teclado del sistema para ese campo hasta que pierda el foco.
const EXPR_SEL = 'input:not([type]), input[type="text"], input[type="search"], textarea';
const isTouchNarrow = () => window.matchMedia('(pointer: coarse) and (max-width: 900px)').matches;
const KP_TABS = {
  num: [
    ['t', 't', 'var'], ['τ', 'tau', 'var'], ['7', '7'], ['8', '8'], ['9', '9'], ['÷', '/', 'op'],
    ['(', '(', 'op'], [')', ')', 'op'], ['4', '4'], ['5', '5'], ['6', '6'], ['×', '*', 'op'],
    ['x²', '^2', 'op'], ['xʸ', '^', 'op'], ['1', '1'], ['2', '2'], ['3', '3'], ['−', '-', 'op'],
    ['u(t)', 'u(t)', 'fn'], ['∞', 'oo', 'op'], ['0', '0'], ['.', '.'], ['⌫', '', 'act', 'back'], ['+', '+', 'op']
  ],
  fn: [
    ['exp( )', 'exp()', 'fn'], ['e^( )', 'e^()', 'fn'], ['sin( )', 'sin()', 'fn'], ['cos( )', 'cos()', 'fn'],
    ['√( )', 'sqrt()', 'fn'], ['u( )', 'u()', 'fn'], ['( )', '()', 'fn'], ['π', 'pi', 'fn'],
    ['∞', 'oo', 'fn'], ['−∞', '-oo', 'fn'], ['t', 't', 'var'], ['τ', 'tau', 'var']
  ]
};
let kp = null, kpTab = 'num';
function kpTarget() { const el = document.activeElement; return el && el.matches(EXPR_SEL) && !el.dataset.abc ? el : null; }
function kpRender() {
  kp.querySelector('.kp-grid').className = 'kp-grid kp-' + kpTab;
  kp.querySelector('.kp-grid').innerHTML = KP_TABS[kpTab].map(([lbl, ins, cls = 'num', act]) =>
    `<button type="button" class="kp-key ${cls}" ${act ? `data-act="${act}" aria-label="Borrar"` : `data-ins="${ins}"`}>${lbl}</button>`).join('');
  kp.querySelectorAll('[data-tab]').forEach(b => b.setAttribute('aria-pressed', b.dataset.tab === kpTab));
}
function kpMove(el, d) {
  const p = Math.max(0, Math.min(el.value.length, (d < 0 ? el.selectionStart : el.selectionEnd) + d));
  el.selectionStart = el.selectionEnd = p;
}
function kpBack(el) {
  let s = el.selectionStart, en = el.selectionEnd;
  if (s === en) { if (!s) return; s -= 1; }
  el.value = el.value.slice(0, s) + el.value.slice(en);
  el.selectionStart = el.selectionEnd = s;
  el.dispatchEvent(new Event('input', { bubbles: true }));
}
function kpShow(show) {
  if (!kp) return;
  kp.hidden = !show;
  document.body.classList.toggle('kp-open', show);
  document.body.style.setProperty('--kp-h', show ? kp.offsetHeight + 'px' : '0px');
}
// Solo se desplaza si el campo quedó tapado por el teclado o por la barra
// superior, y sin animación: un scroll suave aquí peleaba con el ajuste
// propio de iOS Safari al enfocar y la página «rebotaba».
function kpReveal(el) {
  const r = el.getBoundingClientRect(), kpTop = kp.getBoundingClientRect().top;
  const barBottom = ($('.topbar')?.getBoundingClientRect().bottom ?? 0) + 8;
  let dy = 0;
  if (r.bottom > kpTop - 12) dy = r.bottom - kpTop + 24;
  else if (r.top < barBottom) dy = r.top - barBottom - 8;
  if (dy) window.scrollBy({ top: dy, behavior: 'instant' });
}
function buildKeypad() {
  kp = document.createElement('div');
  kp.className = 'keypad'; kp.hidden = true;
  kp.setAttribute('role', 'group'); kp.setAttribute('aria-label', 'Teclado matemático');
  kp.innerHTML = `<div class="kp-bar">
      <button type="button" class="kp-tab" data-tab="num">123</button>
      <button type="button" class="kp-tab" data-tab="fn">f(x)</button>
      <button type="button" class="kp-tab" data-act="abc">ABC</button>
      <span class="kp-sp"></span>
      <button type="button" class="kp-tab" data-act="left" aria-label="Mover cursor a la izquierda">←</button>
      <button type="button" class="kp-tab" data-act="right" aria-label="Mover cursor a la derecha">→</button>
      <button type="button" class="kp-done" data-act="done">Listo</button>
    </div><div class="kp-grid"></div>`;
  // pointerdown sin foco: el campo de texto conserva el foco y el cursor
  kp.addEventListener('pointerdown', (e) => { if (e.target.closest('button')) e.preventDefault(); });
  kp.addEventListener('click', (e) => {
    const b = e.target.closest('button'); const el = kpTarget();
    if (!b || !el) return;
    if (b.dataset.tab) { kpTab = b.dataset.tab; kpRender(); kpShow(true); kpReveal(el); return; }
    const act = b.dataset.act;
    if (act === 'back') kpBack(el);
    else if (act === 'left') kpMove(el, -1);
    else if (act === 'right') kpMove(el, 1);
    else if (act === 'done') el.blur();
    else if (act === 'abc') { kpShow(false); el.blur(); el.dataset.abc = '1'; el.inputMode = 'text'; el.focus(); }
    else if (b.dataset.ins) insertText(b.dataset.ins);
  });
  document.body.appendChild(kp);
  kpRender();
}
// iOS Safari desplaza la página por su cuenta al enfocar un campo con un toque
// (no hay atributo que lo desactive). Como hace react-aria (usePreventScroll):
// se cancela el touchend nativo y se enfoca a mano con preventScroll; luego
// kpReveal mueve la página solo si el campo quedó tapado. Si el dedo se movió
// era un scroll, no un toque, y no se intercepta.
let kpTouch = null;
document.addEventListener('touchstart', (e) => {
  const el = e.target.closest && e.target.closest(EXPR_SEL);
  kpTouch = el && isTouchNarrow() ? { el, x: e.touches[0].clientX, y: e.touches[0].clientY } : null;
  if (kpTouch && !el.dataset.abc) el.inputMode = 'none';
}, { passive: true, capture: true });
document.addEventListener('touchend', (e) => {
  const t = kpTouch; kpTouch = null;
  if (!t || t.el.dataset.abc || document.activeElement === t.el) return;
  const p = e.changedTouches[0];
  if (Math.hypot(p.clientX - t.x, p.clientY - t.y) > 10) return;
  e.preventDefault();
  t.el.focus({ preventScroll: true });
  const n = t.el.value.length;
  try { t.el.setSelectionRange(n, n); } catch (_) { /* tipos sin selección */ }
}, { passive: false, capture: true });
document.addEventListener('focusin', (e) => {
  const el = e.target;
  if (!el.matches(EXPR_SEL) || !isTouchNarrow()) return;
  if (!kp) buildKeypad();
  if (el.dataset.abc) return;
  el.inputMode = 'none';
  kpShow(true);
  kpReveal(el);
});
document.addEventListener('focusout', (e) => {
  if (!e.target.matches(EXPR_SEL)) return;
  delete e.target.dataset.abc;
  // al saltar de un campo a otro el teclado no parpadea
  setTimeout(() => { if (!kpTarget()) kpShow(false); }, 60);
});

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
