// Editor de ecuaciones con vista previa LaTeX + interfaz renovada
let lastX = [], lastH = [];
let lastRegiones = [], lastCriticos = [];
let lastProcTxt = '';
let lastPlotData = null, lastSolapeData = null;
let focusedExpr = null;
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

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
// aquí solo se alterna, se persiste y se repintan las gráficas.
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
  // repintar gráficas si hay datos
  if (window.Plotly && lastPlotData) {
    plotAll(lastPlotData);
    if (lastSolapeData) renderSolape(lastSolapeData.tau, lastSolapeData.x, lastSolapeData.h, lastSolapeData.prod, lastSolapeData.t0);
    if ($('#plotY').data) { try { Plotly.relayout('plotY', { shapes: yShapes(parseFloat($('#sliderT').value)) }); } catch (e) { /* noop */ } }
  }
}

// número float -> texto corto ('-4', '2.5')
const fmtT = (v) => String(Number(v));

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

// ---------- tramos ----------
let tramoId = 0;
function tramoRow(container, seg) {
  const id = ++tramoId;
  const d = document.createElement('div');
  d.className = 'tramo'; d.dataset.id = id;
  // BUG-6: los valores van entre comillas de atributo -> escapar siempre
  // (una expr con " rompería el HTML e inyectaría marcado).
  const aVal = esc(seg?.a ?? '0');
  const bVal = esc(seg?.b ?? 'oo');
  const eVal = esc(seg?.expr ?? '1');
  d.innerHTML = `
    <div class="tramo-grid">
      <label>Desde a<input class="a" value="${aVal}" spellcheck="false" aria-label="Inicio del tramo"></label>
      <label>Hasta b<input class="b" value="${bVal}" spellcheck="false" aria-label="Fin del tramo"></label>
      <label class="expr">Fórmula f(t)<input class="e expr-in" value="${eVal}" spellcheck="false" autocomplete="off" aria-label="Fórmula del tramo"></label>
      <button class="del" type="button" title="Quitar tramo" aria-label="Quitar tramo"><svg class="icon" aria-hidden="true"><use href="#i-trash"/></svg></button>
    </div>
    <div class="preview"><span class="hint">vista previa…</span></div>`;
  d.querySelector('.del').onclick = () => d.remove();
  container.appendChild(d);
  const update = debounce(() => previewTramo(d), 350);
  d.querySelectorAll('input').forEach(i => i.addEventListener('input', update));
  previewTramo(d);
}
function readSegs(id) {
  return $$('#' + id + ' .tramo').map(r => ({
    a: r.querySelector('.a').value, b: r.querySelector('.b').value, expr: r.querySelector('.e').value
  })).filter(s => s.expr.trim() !== '');
}
async function previewTramo(row) {
  const box = row.querySelector('.preview');
  const body = {
    expr: row.querySelector('.e').value,
    a: row.querySelector('.a').value, b: row.querySelector('.b').value,
    var: 't'
  };
  if (!body.expr.trim()) { box.innerHTML = '<span class="hint">Escribe la fórmula…</span>'; return; }
  try {
    const r = await fetch('/api/preview', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const j = await r.json();
    if (!j.ok) throw new Error(j.error);
    box.classList.remove('bad');
    box.innerHTML = `<span class="ok-tag"><svg class="icon" aria-hidden="true"><use href="#i-check"/></svg></span> `;
    const inner = document.createElement('span');  // BUG-8: sin nodo huérfano
    box.appendChild(inner);
    renderLatex(inner, j.tramo_latex, true);
  } catch (e) {
    box.classList.add('bad');
    // BUG-6: el error del backend incluye la expr del usuario -> escapar.
    box.innerHTML = `<span class="hint">${esc(String(e.message || e).slice(0, 160))}</span>`;
  }
}
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
    const prev = btn.textContent;
    const ok = await copyText(getText());
    btn.textContent = ok ? 'Copiado' : 'No se pudo copiar';
    btn.classList.toggle('copy-ok', ok);
    setTimeout(() => { btn.textContent = prev; btn.classList.remove('copy-ok'); }, 1600);
  });
}

// ---------- presets + plantillas ----------
// Señal completa con escalón (ej. 3*exp(-2*t)*u(t)) -> tramos automáticos.
// El servidor parte la recta en los ceros de cada u(·) y devuelve la fórmula
// de cada región; aquí solo se cargan como filas para el flujo normal.
async function descomponerSingle(cual) {
  const inp = cual === 'x' ? $('#xSingle') : $('#hSingle');
  const msg = cual === 'x' ? $('#xSingleMsg') : $('#hSingleMsg');
  const rowsId = cual === 'x' ? 'xRows' : 'hRows';
  const expr = inp.value;
  if (!expr.trim()) { msg.textContent = 'Escribe primero la señal, ej: 3*exp(-2*t)*u(t)'; return; }
  msg.textContent = 'Separando en tramos…';
  try {
    const r = await fetch('/api/descomponer', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ expr, var: 't' }) });
    const j = await r.json();
    if (!j.ok) throw new Error(j.error);
    $('#' + rowsId).innerHTML = '';
    j.segs.forEach(s => tramoRow($('#' + rowsId), s));
    fitSliderToSegs(j.segs);
    msg.textContent = `${j.n} tramo${j.n === 1 ? '' : 's'} separado${j.n === 1 ? '' : 's'}: revísalos abajo y pulsa Resolver.`;
  } catch (e) {
    msg.textContent = friendlyError(e.message || e);
  }
}
// ---------- ejemplo de trabajo (único) ----------
// El servidor expone un solo ejemplo (el caso más completo del curso); se
// carga al abrir la página y se puede restablecer con el botón de la tarjeta.
let EJEMPLO = null;
async function loadEjemplo() {
  try {
    const r = await fetch('/api/presets');
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const data = await r.json();
    EJEMPLO = Object.values(data)[0] || null;
  } catch (e) {
    console.error('No se pudo cargar el ejemplo:', e);
    $('#presetNota').textContent = 'Sin conexión con el servidor: revisa que app.py esté corriendo.';
    return;
  }
  aplicarEjemplo();
}
function aplicarEjemplo() {
  if (!EJEMPLO) return;
  $('#presetNota').textContent = `Ejemplo cargado: ${EJEMPLO.nombre}. ${EJEMPLO.nota || ''}`;
  // limpiar también las cajas de "señal completa" para no mezclar entradas viejas
  $('#xSingle').value = ''; $('#hSingle').value = '';
  $('#xSingleMsg').textContent = ''; $('#hSingleMsg').textContent = '';
  $('#xRows').innerHTML = ''; $('#hRows').innerHTML = '';
  EJEMPLO.x.forEach(s => tramoRow($('#xRows'), s));
  EJEMPLO.h.forEach(s => tramoRow($('#hRows'), s));
  fitSliderToSegs([...EJEMPLO.x, ...EJEMPLO.h]);  // rango inicial según el ejemplo
}
// relleno de progreso del slider (el track usa la variable CSS --fill)
function paintSlider() {
  const s = $('#sliderT');
  const min = parseFloat(s.min), max = parseFloat(s.max), v = parseFloat(s.value);
  if (Number.isFinite(min) && Number.isFinite(max) && max > min) {
    s.style.setProperty('--fill', (100 * (v - min) / (max - min)).toFixed(2) + '%');
  }
}
// DESIGN-6: el slider nace del soporte de las señales, no de un rango fijo
function fitSliderToSegs(segs) {
  const nums = segs.flatMap(s => [parseFloat(s.a), parseFloat(s.b)]).filter(Number.isFinite);
  const s = $('#sliderT');
  if (!nums.length) { s.min = -5; s.max = 5; s.value = 0; }
  else { s.min = Math.min(...nums) - 2; s.max = Math.max(...nums) + 2; s.value = nums[0]; }
  $('#tVal').textContent = s.value;
  paintSlider();
}
// (las plantillas de señal se retiraron: el ejemplo único cubre ese papel)

// ---------- convolución ----------
// Criterio: fija la más grande. Intercambia x↔h (filas + cajas de señal
// completa) y resuelve de nuevo. El resultado no cambia (x∗h = h∗x).
function intercambiarSenales() {
  const x = readSegs('xRows'), h = readSegs('hRows');
  $('#xRows').innerHTML = ''; $('#hRows').innerHTML = '';
  h.forEach(s => tramoRow($('#xRows'), s));
  x.forEach(s => tramoRow($('#hRows'), s));
  const xs = $('#xSingle').value;
  $('#xSingle').value = $('#hSingle').value;
  $('#hSingle').value = xs;
  fitSliderToSegs([...h, ...x]);
  resolver();
}
// UX-3: errores técnicos de SymPy traducidos a guía para el estudiante
function friendlyError(msg) {
  msg = String(msg || 'Error desconocido');
  if (/interpretar/i.test(msg)) return msg + '\nRevisa la sintaxis: usa * para multiplicar (5*t), exp() para exponenciales y ^ para potencias.';
  if (/dimension|shape|broadcast/i.test(msg)) return msg + '\nParece un problema numérico en la gráfica; prueba simplificar los tramos.';
  if (/Failed to fetch|NetworkError|HTTP/i.test(msg)) return msg + '\nNo hay conexión con el servidor: verifica que app.py esté corriendo en http://127.0.0.1:5000.';
  return msg;
}
async function resolver() {
  const btn = $('#resolver');
  $('#errConv').textContent = '';
  $('#loadingConv').hidden = false;
  btn.disabled = true;  // evita doble envío y condiciones de carrera
  try {
    const x = readSegs('xRows'), h = readSegs('hRows');
    if (!x.length || !h.length) throw new Error('Agrega al menos un tramo en x(t) y uno en h(t).');
    lastX = x; lastH = h;
    const r = await fetch('/api/convolve', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ x, h }) });
    const j = await r.json();
    if (!j.ok) throw new Error(j.error);
    $('#resultado').style.display = 'block';
    renderLatex($('#defConv'), 'y(t)=\\int_{-\\infty}^{\\infty}x(\\tau)\\,h(t-\\tau)\\,d\\tau', true);
    lastRegiones = j.regiones || [];
    lastCriticos = j.criticos || [];
    lastProcTxt = j.procedimiento_txt || '';
    // Criterio de la fija: mensaje del servidor + botón de intercambio si aplica
    const cb = $('#criterioFija');
    if (j.criterio && j.criterio.mensaje) {
      const rec = j.criterio.recomendada;
      const cls = rec === 'h' ? 'paso warn' : 'paso';
      cb.innerHTML = `<div class="${cls}">${esc(j.criterio.mensaje)}</div>` +
        (rec === 'h' ? `<button id="btnSwap" class="ghost"><svg class="icon" aria-hidden="true"><use href="#i-swap"/></svg>Intercambiar x ↔ h y resolver</button>` : '');
      const bs = $('#btnSwap');
      if (bs) bs.onclick = intercambiarSenales;
    } else { cb.innerHTML = ''; }
    plotAll(j);
    const c = j.criticos || [];
    const s = $('#sliderT');
    if (c.length) { s.min = Math.min(...c) - 2; s.max = Math.max(...c) + 2; s.value = c[0]; }
    paintSlider();
    // Salida pensada para copiar al cuaderno: solo matemática, sin texto guía.
    $('#p1').innerHTML = j.paso1.map(s2 =>
      `<div class="paso math">
        <span class="m">\\(${s2.original}\\)</span>
        <span class="m flecha" aria-hidden="true">⟹</span>
        <span class="m">\\(${s2.final}\\)</span>
      </div>`).join('');
    $('#p2').innerHTML = j.paso2.map(s2 =>
      `<div class="paso math">
        <span class="m">\\(${s2.original}\\)</span>
        <span class="m flecha" aria-hidden="true">⟹</span>
        <span class="m">\\(${s2.final}\\)</span>
      </div>`).join('');
    // Paso 3: puntos críticos reales; si no hay (sin bordes finitos que
    // sumar) la recta de t no se divide — no se inventa t_c = {0}.
    $('#p3').innerHTML = c.length
      ? `<div class="paso math">
          <span class="m">\\(t_c \\in \\{${c.map(v => Number(v).toFixed(2)).join(',\\;')}\\}\\)</span>` +
        (j.t_inicio != null ? `<span class="m">\\(t_{\\text{inicio}} = ${fmtT(j.t_inicio)}\\)</span>` : '') +
        `</div>`
      : `<div class="paso math">
          <span class="hint">sin puntos críticos (no hay bordes finitos que sumar): un único intervalo de t</span>
        </div>`;
    // BUG-15: avisos de convergencia — si una integral no converge se dice
    // aquí y por qué, en vez de presentar ∞ como respuesta por tramos.
    $('#avisosConv').innerHTML = (j.avisos || []).map(a =>
      `<div class="paso warn"><svg class="icon" aria-hidden="true"><use href="#i-alert"/></svg>${esc(a)}</div>`).join('');
    // Paso 4: por intervalo, la cadena matemática completa (planteo →
    // integrando expandido → primitiva → evaluación), sin texto.
    $('#p4').innerHTML = j.regiones.map((rr) => {
      const head = `<div class="region-head"><span class="m">\\(${rr.cond_latex}\\)</span></div>`;
      if (!rr.hay_solape) {
        const lineaCero = rr.cero_latex
          ? `<div class="paso math"><span class="m">\\(${rr.cero_latex}\\)</span></div>`
          : '';
        return `<div class="region cero">${head}${lineaCero}
          <div class="res-line"><span class="m">\\(y(t)=0\\)</span></div></div>`;
      }
      const ints = rr.integrales.map((g) => {
        // tramo donde la señal ya vale 0 (como en los apuntes): ∫ (0)·(h) = 0
        if (g.cero) {
          return `<div class="paso math">
            <span class="m">\\(y(t)=\\int_{${g.low_latex}}^{${g.high_latex}}\\left(0\\right)\\!\\left(${g.h_shift_latex}\\right)d\\tau=0\\)</span>
          </div>`;
        }
        const completaTex = `y(t)=\\int_{${g.low_latex}}^{${g.high_latex}}\\left(${g.x_tau_latex}\\right)\\!\\left(${g.h_shift_latex}\\right)d\\tau`;
        const expandidaTex = `\\int_{${g.low_latex}}^{${g.high_latex}} ${g.integrando_latex}\\,d\\tau`;
        return `<div class="paso math">
          <span class="m">\\(${completaTex}\\)</span>
          <span class="m">\\(= ${expandidaTex}\\)</span>
          <span class="m">\\(F(\\tau)=${g.primitiva_latex}\\)</span>
          <span class="m">\\(${g.eval_latex}\\)</span>
        </div>`;
      }).join('');
      // BUG-15: región con integral divergente -> «no converge» + causa,
      // en lugar de un valor ∞ disfrazado de respuesta
      const resLine = rr.diverge
        ? `<div class="res-line"><span class="m">\\(y(t)=\\text{no converge}\\)</span></div>
           <div class="hint">${esc(rr.aviso_txt || '')}</div>`
        : `<div class="res-line"><span class="m">\\(y(t)=${rr.resultado_latex}\\)</span></div>`;
      return `<div class="region">${head}${ints}${resLine}</div>`;
    }).join('');
    $('#p5').innerHTML =
      `<div class="paso math"><span class="hint">por tramos</span><span class="m">\\[${j.y_tramos_latex}\\]</span></div>` +
      // la forma compacta con u(t) se omite si alguna integral no converge
      (j.y_escalones_latex ? `<div class="paso math"><span class="hint">forma compacta con u(t)</span><span class="m">\\[${j.y_escalones_latex}\\]</span></div>` : '');
    renderAll($('#resultado'));
    $('#resultado').scrollIntoView({ behavior: 'smooth', block: 'start' });
    updateSolape();
  } catch (e) {
    $('#errConv').textContent = friendlyError(e.message || e);
  } finally {
    $('#loadingConv').hidden = true;
    $('#resolver').disabled = false;
  }
}
// índice de la región a la que pertenece un t dado (null = infinito)
function regionDeT(t0) {
  for (let k = 0; k < lastRegiones.length; k++) {
    const r = lastRegiones[k];
    const lo = r.t_lo == null ? -Infinity : r.t_lo;
    const hi = r.t_hi == null ? Infinity : r.t_hi;
    const esUltima = k === lastRegiones.length - 1;
    if (t0 >= lo - 1e-9 && (esUltima ? t0 <= hi + 1e-9 : t0 < hi - 1e-9)) return k;
  }
  return -1;
}
function condPlain(r) {
  if (r.t_lo == null && r.t_hi == null) return 'todo t';
  if (r.t_lo == null) return `t < ${r.t_hi_str}`;
  if (r.t_hi == null) return `t ≥ ${r.t_lo_str}`;
  return `${r.t_lo_str} ≤ t < ${r.t_hi_str}`;
}
// líneas verticales en la gráfica y(t): críticos (punteadas) + t actual (sólida)
function yShapes(t0) {
  const shapes = lastCriticos.map(v => ({
    type: 'line', x0: v, x1: v, y0: 0, y1: 1, yref: 'paper',
    line: { color: plotColors().crit, width: 1, dash: 'dot' }, hoverinfo: 'skip'
  }));
  if (t0 != null && Number.isFinite(t0)) {
    shapes.push({
      type: 'line', x0: t0, x1: t0, y0: 0, y1: 1, yref: 'paper',
      line: { color: plotColors().marker, width: 1.5 }, hoverinfo: 'skip'
    });
  }
  return shapes;
}
// texto-guía dentro de una gráfica vacía; se retira al dibujar encima
function quitarHint(id) {
  const h = document.querySelector('#' + id + ' .plot-hint');
  if (h) h.remove();
}
function plotAll(j) {
  lastPlotData = j;
  quitarHint('plotXH'); quitarHint('plotY');
  Plotly.newPlot('plotXH', [
    { x: j.grid, y: j.x_vals, name: 'x(t)', type: 'scatter', line: { color: plotColors().x, width: 2 } },
    { x: j.grid, y: j.h_vals, name: 'h(t)', type: 'scatter', line: { color: plotColors().h, width: 2 } }
  ], plotLayout({ title: 'x(t) y h(t)' }), { responsive: true });
  Plotly.newPlot('plotY', [{ x: j.grid, y: j.y_vals, name: 'y(t)', type: 'scatter', line: { color: plotColors().y, width: 2.5 } }],
    plotLayout({ title: 'y(t) = x(t) ∗ h(t)', shapes: yShapes(null) }), { responsive: true });
}
function renderSolape(tau, xv, hv, prod, t0) {
  quitarHint('plotSolape');
  Plotly.newPlot('plotSolape', [
    { x: tau, y: xv, name: 'x(τ)', type: 'scatter', line: { color: plotColors().x, width: 2 } },
    { x: tau, y: hv, name: `h(${t0}−τ)`, type: 'scatter', line: { color: plotColors().h, width: 2 } },
    { x: tau, y: prod, name: 'producto', type: 'scatter', fill: 'tozeroy',
      fillcolor: plotColors().prodFill, line: { color: plotColors().h, width: 1.5 } }
  ], plotLayout({ title: `Solape en τ · t = ${t0}` }), { responsive: true });
}
async function updateSolape() {
  if (!lastX.length) return;
  const t0 = parseFloat($('#sliderT').value);
  $('#tVal').textContent = t0;
  $('#areaVal').textContent = '…';  // UX-1: feedback mientras calcula
  // indicador de en qué intervalo está el t del slider
  const k = regionDeT(t0);
  $('#regionRead').textContent = k >= 0
    ? `Intervalo ${k + 1} de ${lastRegiones.length} · ${condPlain(lastRegiones[k])}` : '';
  // BUG-15: si la integral de este intervalo no converge, el área no es finita
  // (el recorte numérico de la ventana daría un valor engañoso)
  const divergeAqui = k >= 0 && lastRegiones[k].diverge;
  if (divergeAqui) $('#areaVal').textContent = 'no converge';
  // marcador de t en la gráfica y(t)
  if ($('#plotY').data) { try { Plotly.relayout('plotY', { shapes: yShapes(t0) }); } catch (e) { /* noop */ } }
  try {
    const r = await fetch('/api/solape', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ x: lastX, h: lastH, t0 }) });
    const j = await r.json(); if (!j.ok) return;
    if (!divergeAqui) $('#areaVal').textContent = j.area_trapz.toFixed(4);
    lastSolapeData = { tau: j.tau, x: j.x, h: j.h, prod: j.prod, t0 };
    renderSolape(j.tau, j.x, j.h, j.prod, t0);
  } catch (e) { /* silencioso */ }
}

// ---------- integrales ----------
// La vista previa solo valida el integrando: los límites no aparecen en ella,
// así que un límite a medio escribir no dispara errores mientras se teclea.
async function previewIntegral() {
  const box = $('#intPreview');
  const expr = $('#intExpr').value;
  if (!expr.trim()) { box.innerHTML = '<span class="hint">Escribe el integrando…</span>'; return; }
  try {
    const r = await fetch('/api/preview', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ expr, var: $('#intVar').value === 't' ? 't' : 'tau' }) });
    const j = await r.json();
    if (!j.ok) throw new Error(j.error);
    box.classList.remove('bad');
    const inner = document.createElement('span');
    box.innerHTML = ''; box.appendChild(inner);
    const v = $('#intVar').value === 't' ? 't' : '\\tau';
    renderLatex(inner, `\\int ${j.latex}\\,d${v}`, true);
  } catch (e) {
    box.classList.add('bad');
    // BUG-6: igual que previewTramo, escapar el mensaje (lleva input del usuario).
    box.innerHTML = `<span class="hint">${esc(String(e.message || e).slice(0, 140))}</span>`;
  }
}
async function resolverInt() {
  $('#errInt').textContent = '';
  try {
    const body = { expr: $('#intExpr').value, var: $('#intVar').value, a: $('#intA').value, b: $('#intB').value };
    const r = await fetch('/api/integral', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const j = await r.json();
    if (!j.ok) throw new Error(j.error);
    const d = $('#intRes');
    // DESIGN-7: mostrar si la primitiva quedó verificada (dF/dτ == f)
    const badge = j.verificada === true ? '<div class="paso ok">Primitiva verificada: su derivada coincide con el integrando.</div>'
      : j.verificada === false ? '<div class="paso warn">No se pudo verificar automáticamente la primitiva: revísala derivando a mano.</div>' : '';
    d.innerHTML = badge + j.pasos.map(p => `<div class="paso"><b>${esc(p.titulo)}</b><br>${p.detalle}<br><span class="m">\\[${p.latex}\\]</span></div>`).join('') +
      (j.es_definida ? `<div class="paso"><b>Resultado:</b> <span class="m">\\[${j.valor_latex}\\]</span>${j.valor_num != null ? ` (≈ ${Number(j.valor_num).toFixed(6)})` : ''}</div>`
        : `<div class="paso"><b>Resultado:</b> <span class="m">\\[${j.primitiva_latex}\\]</span></div>`);
    renderAll(d);
  } catch (e) { $('#errInt').textContent = friendlyError(e.message || e); }
}

// ---------- procedimiento general (texto copiable, pestaña Teoría) ----------
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

// ---------- wiring ----------
$$('.tabs button[data-tab]').forEach(b => b.onclick = () => {
  $$('.tabs button[data-tab]').forEach(x => x.classList.remove('active'));
  $$('.tab').forEach(x => x.classList.remove('active'));
  b.classList.add('active'); document.getElementById('tab-' + b.dataset.tab).classList.add('active');
});
// (el botón de tema va aparte: no es una pestaña)
$('#btnTema').onclick = () => applyTheme(currentTheme() === 'dark' ? 'light' : 'dark');
syncThemeButton();  // sincroniza icono/título con el tema fijado en <head>
$('#addX').onclick = () => tramoRow($('#xRows'), { a: '0', b: 'oo', expr: '1' });
$('#addH').onclick = () => tramoRow($('#hRows'), { a: '0', b: 'oo', expr: '1' });
$('#resetEjemplo').onclick = aplicarEjemplo;
$('#xToTramos').onclick = () => descomponerSingle('x');
$('#hToTramos').onclick = () => descomponerSingle('h');
$('#xSingle').addEventListener('keydown', (e) => { if (e.key === 'Enter') descomponerSingle('x'); });
$('#hSingle').addEventListener('keydown', (e) => { if (e.key === 'Enter') descomponerSingle('h'); });
// Al seguir escribiendo se borra el mensaje anterior (evita confundir un
// error viejo, ej. un 'e^()' a medio escribir, con el contenido actual).
$('#xSingle').addEventListener('input', () => { $('#xSingleMsg').textContent = ''; });
$('#hSingle').addEventListener('input', () => { $('#hSingleMsg').textContent = ''; });
$('#resolver').onclick = resolver;
$('#resolverInt').onclick = resolverInt;
// Slider en vivo: el número se actualiza al instante y la gráfica sigue al
// dedo con throttle (máx. 1 petición/120 ms); al soltar se hace la final.
const updateSolapeLive = throttle(updateSolape, 120);
$('#sliderT').oninput = (e) => { $('#tVal').textContent = e.target.value; $('#areaVal').textContent = '…'; paintSlider(); updateSolapeLive(); };
$('#sliderT').onchange = updateSolape;
bindPalette('palette'); bindPalette('palette2');
$('#intExpr').addEventListener('input', debounce(previewIntegral, 350));
$('#intVar').onchange = previewIntegral;
// botones de copiar: solución concreta + procedimiento general (teoría)
bindCopyButton($('#btnCopiar'), () => lastProcTxt);
bindCopyButton($('#btnCopiarProc'), () => PROC_GENERAL_TXT);
loadEjemplo().then(() => previewIntegral());
renderAll(document.body);
// KaTeX carga diferido: re-renderizar cuando esté listo
window.addEventListener('load', () => {
  renderAll(document.body);
  $$('#xRows .tramo, #hRows .tramo').forEach(previewTramo);
  previewIntegral();
});
