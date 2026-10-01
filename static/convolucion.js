// convolucion.js — página /convolucion (MPA). Script clásico cargado con defer
// DESPUÉS de base.js, del que usa $, $$, esc, renderLatex, renderAll, debounce,
// throttle, copyText, bindCopyButton, friendlyError y todo el manejo del tema.

let lastX = [], lastH = [];
let lastRegiones = [], lastCriticos = [];
let lastProcTxt = '';
let lastPlotData = null, lastSolapeData = null;
// La ecuación completa y sus filas deben representar la misma versión. Al
// escribir se regeneran las filas; al editarlas se pasa a modo manual.
const splitState = { x: { source: null, stale: false }, h: { source: null, stale: false } };
const splitRequestVersion = { x: 0, h: 0 };

// número float -> texto corto ('-4', '2.5')
const fmtT = (v) => String(Number(v));

// ---------- tramos ----------
let tramoId = 0;
function tramoRow(container, seg) {
  const id = ++tramoId;
  const cual = container.id === 'xRows' ? 'x' : 'h';
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
  d.querySelector('.del').onclick = () => { usarTramosManuales(cual); d.remove(); };
  container.appendChild(d);
  const update = debounce(() => previewTramo(d), 350);
  d.querySelectorAll('input').forEach(i => i.addEventListener('input', () => {
    usarTramosManuales(cual);
    update();
  }));
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

// ---------- señal completa -> tramos automáticos ----------
// Señal completa con escalón (ej. 3*exp(-2*t)*u(t)) -> tramos automáticos.
// La respuesta se descarta si llegó tarde, para no reemplazar una versión más
// reciente mientras el estudiante sigue escribiendo.
async function descomponerSingle(cual) {
  const inp = cual === 'x' ? $('#xSingle') : $('#hSingle');
  const msg = cual === 'x' ? $('#xSingleMsg') : $('#hSingleMsg');
  const rowsId = cual === 'x' ? 'xRows' : 'hRows';
  const expr = inp.value;
  const version = ++splitRequestVersion[cual];
  if (!expr.trim()) {
    splitState[cual] = { source: null, stale: false };
    msg.textContent = '';
    return;
  }
  splitState[cual] = { source: expr, stale: true };
  msg.textContent = 'Actualizando tramos…';
  try {
    const r = await fetch('/api/descomponer', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ expr, var: 't' }) });
    const j = await r.json();
    if (!j.ok) throw new Error(j.error);
    if (version !== splitRequestVersion[cual] || inp.value !== expr) return;
    $('#' + rowsId).innerHTML = '';
    j.segs.forEach(s => tramoRow($('#' + rowsId), s));
    splitState[cual] = { source: expr, stale: false };
    fitSliderToSegs(j.segs);
    msg.textContent = `${j.n} tramo${j.n === 1 ? '' : 's'} actualizado${j.n === 1 ? '' : 's'} automáticamente.`;
  } catch (e) {
    if (version !== splitRequestVersion[cual] || inp.value !== expr) return;
    splitState[cual] = { source: expr, stale: true };
    msg.textContent = 'La ecuación aún no es válida; corrígela para actualizar los tramos.';
  }
}
const sincronizarSingle = {
  x: debounce(() => descomponerSingle('x'), 350),
  h: debounce(() => descomponerSingle('h'), 350)
};

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
  splitRequestVersion.x += 1; splitRequestVersion.h += 1;
  splitState.x = { source: null, stale: false };
  splitState.h = { source: null, stale: false };
  $('#xRows').innerHTML = ''; $('#hRows').innerHTML = '';
  EJEMPLO.x.forEach(s => tramoRow($('#xRows'), s));
  EJEMPLO.h.forEach(s => tramoRow($('#hRows'), s));
  fitSliderToSegs([...EJEMPLO.x, ...EJEMPLO.h]);  // rango inicial según el ejemplo
}

// ---------- slider ----------
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
  splitRequestVersion.x += 1; splitRequestVersion.h += 1;
  const xState = splitState.x;
  splitState.x = splitState.h;
  splitState.h = xState;
  fitSliderToSegs([...h, ...x]);
  resolver();
}
async function resolver() {
  const btn = $('#resolver');
  $('#errConv').textContent = '';
  $('#loadingConv').hidden = false;
  btn.disabled = true;  // evita doble envío y condiciones de carrera
  try {
    const x = readSegs('xRows'), h = readSegs('hRows');
    if (!x.length || !h.length) throw new Error('Agrega al menos un tramo en x(t) y uno en h(t).');
    const stale = ['x', 'h'].filter(cual => splitState[cual].stale);
    if (stale.length) {
      throw new Error(`La ecuación de ${stale.map(cual => `${cual}(t)`).join(' y ')} se está actualizando o no es válida. Corrígela o espera antes de resolver.`);
    }
    lastX = x; lastH = h;
    const r = await fetch('/api/convolve', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ x, h }) });
    const j = await r.json();
    if (!j.ok) throw new Error(j.error);
    $('#resultado').style.display = 'block';
    renderLatex($('#defConv'), 'y(t)=\\int_{-\\infty}^{\\infty}x(\\tau)\\,h(t-\\tau)\\,d\\tau', true);
    $('#senalesTramos').innerHTML = `<div class="paso math">
      <span class="hint">Señales por tramos</span>
      <span class="m">\\[${j.x_tramos_latex}\\]</span>
      <span class="m">\\[${j.h_tramos_latex}\\]</span>
    </div>`;
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
        (j.criticos_detalle_latex ? `<span class="hint">Cada punto crítico es un borde de x más un borde de h.</span>
          <span class="m">\\[${j.criticos_detalle_latex}\\]</span>` : '') +
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
      const solapes = (rr.solapes_latex || []).map(tex => `<span class="m">\\(${tex}\\)</span>`).join('');
      const bloqueSolape = solapes
        ? `<div class="paso math"><span class="hint">Límites del solape</span>${solapes}</div>`
        : '';
      if (!rr.hay_solape) {
        const lineaCero = rr.cero_latex
          ? `<div class="paso math"><span class="m">\\(${rr.cero_latex}\\)</span></div>`
          : '';
        return `<div class="region cero">${head}<div class="hint">${esc(rr.explicacion)}</div>${lineaCero}
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
          <span class="hint">${esc(g.regla_integrando || '')}</span>
          <span class="m">\\(F(\\tau)=${g.primitiva_latex}\\)</span>
          <span class="m">\\(F(${g.high_latex})=${g.Fsup_latex}\\)</span>
          <span class="m">\\(F(${g.low_latex})=${g.Finf_latex}\\)</span>
          <span class="m">\\(${g.resta_latex}\\)</span>
        </div>`;
      }).join('');
      // BUG-15: región con integral divergente -> «no converge» + causa,
      // en lugar de un valor ∞ disfrazado de respuesta
      const resLine = rr.diverge
        ? `<div class="res-line"><span class="m">\\(y(t)=\\text{no converge}\\)</span></div>
           <div class="hint">${esc(rr.aviso_txt || '')}</div>`
        : `<div class="res-line"><span class="m">\\(y(t)=${rr.resultado_latex}\\)</span></div>`;
      return `<div class="region">${head}${bloqueSolape}${ints}${resLine}</div>`;
    }).join('');
    $('#p5').innerHTML =
      `<div class="paso math"><span class="hint">por tramos</span><span class="m">\\[${j.y_tramos_latex}\\]</span></div>` +
      // la forma compacta con u(t) se omite si alguna integral no converge
      (j.y_escalones_latex ? `<div class="paso math"><span class="hint">forma compacta con u(t)</span><span class="m">\\[${j.y_escalones_latex}\\]</span></div>` : '');
    renderAll($('#resultado'));
    $('#resultado').scrollIntoView({ behavior: 'smooth', block: 'start' });
    updateSolape();
    // Enlace compartible: tras cada resolución exitosa los datos quedan en la URL.
    sincronizarURL();
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

// ---------- enlaces compartibles ----------
// Formato: segmentos de x como x0a/x0b/x0e (a, b, expr del tramo 0), x1a…;
// igual para h (h0a…). Ejemplo:
//   /convolucion?x0a=-4&x0b=4&x0e=2*t&h0a=0&h0b=4&h0e=3
// La codificación SIEMPRE vía URLSearchParams: serializa '+' como %2B y
// .get() lo decodifica de vuelta; nunca codificar/decodificar a mano.
function paramsDesdeSegs() {
  const p = new URLSearchParams();
  readSegs('xRows').forEach((s, i) => {
    p.set(`x${i}a`, s.a);
    p.set(`x${i}b`, s.b);
    p.set(`x${i}e`, s.expr);
  });
  readSegs('hRows').forEach((s, i) => {
    p.set(`h${i}a`, s.a);
    p.set(`h${i}b`, s.b);
    p.set(`h${i}e`, s.expr);
  });
  return p;
}
function segsDesdeParams(search) {
  const q = new URLSearchParams(search);
  const lee = (pref) => {
    const out = [];
    for (let i = 0; ; i++) {
      const expr = q.get(`${pref}${i}e`);
      // un enlace compartido nunca trae expr vacía (readSegs la filtra al
      // serializar); una expr vacía/válida a medias termina el recorrido.
      if (expr == null || !expr.trim()) break;
      out.push({
        a: q.get(`${pref}${i}a`) ?? '0',
        b: q.get(`${pref}${i}b`) ?? 'oo',
        expr
      });
    }
    return out;
  };
  return { x: lee('x'), h: lee('h') };
}
function sincronizarURL() {
  const search = paramsDesdeSegs().toString();
  history.replaceState(null, '', location.pathname + (search ? '?' + search : ''));
}

// ---------- modo manual de tramos ----------
function usarTramosManuales(cual) {
  const inp = cual === 'x' ? $('#xSingle') : $('#hSingle');
  const msg = cual === 'x' ? $('#xSingleMsg') : $('#hSingleMsg');
  if (inp.value.trim()) {
    inp.value = '';
    splitRequestVersion[cual] += 1;
    splitState[cual] = { source: null, stale: false };
    msg.textContent = 'Edición manual de tramos.';
  }
}
function actualizarSingle(cual) {
  const inp = cual === 'x' ? $('#xSingle') : $('#hSingle');
  const msg = cual === 'x' ? $('#xSingleMsg') : $('#hSingleMsg');
  if (!inp.value.trim()) {
    splitRequestVersion[cual] += 1;
    splitState[cual] = { source: null, stale: false };
    msg.textContent = '';
    return;
  }
  splitState[cual].stale = true;
  msg.textContent = 'Actualizando tramos…';
  sincronizarSingle[cual]();
}

// ---------- repintado de gráficas al cambiar el tema ----------
// base.js (applyTheme) llama window.repaintPlots si existe; aquí vive el
// repintado con los últimos datos dibujados.
window.repaintPlots = function () {
  if (!(window.Plotly && lastPlotData)) return;
  plotAll(lastPlotData);
  if (lastSolapeData) renderSolape(lastSolapeData.tau, lastSolapeData.x, lastSolapeData.h, lastSolapeData.prod, lastSolapeData.t0);
  if ($('#plotY').data) { try { Plotly.relayout('plotY', { shapes: yShapes(parseFloat($('#sliderT').value)) }); } catch (e) { /* noop */ } }
};

// ---------- wiring (esta página siempre existe: wiring directo) ----------
$('#addX').onclick = () => { usarTramosManuales('x'); tramoRow($('#xRows'), { a: '0', b: 'oo', expr: '1' }); };
$('#addH').onclick = () => { usarTramosManuales('h'); tramoRow($('#hRows'), { a: '0', b: 'oo', expr: '1' }); };
$('#resetEjemplo').onclick = aplicarEjemplo;
$('#xSingle').addEventListener('input', () => actualizarSingle('x'));
$('#hSingle').addEventListener('input', () => actualizarSingle('h'));
$('#resolver').onclick = resolver;
// Slider en vivo: el número se actualiza al instante y la gráfica sigue al
// dedo con throttle (máx. 1 petición/120 ms); al soltar se hace la final.
const updateSolapeLive = throttle(updateSolape, 120);
$('#sliderT').oninput = (e) => { $('#tVal').textContent = e.target.value; $('#areaVal').textContent = '…'; paintSlider(); updateSolapeLive(); };
$('#sliderT').onchange = updateSolape;
// botones de copiar: procedimiento concreto + enlace compartible
bindCopyButton($('#btnCopiar'), () => lastProcTxt);
if ($('#btnCopiarLink')) {
  bindCopyButton($('#btnCopiarLink'), () => {
    if (lastX.length) sincronizarURL();  // asegura que la URL refleje lo resuelto
    return location.href;
  });
}

// ---------- inicio ----------
// Enlaces compartibles: si la URL trae segmentos (x0e/h0e…), se cargan en las
// filas (modo manual) y se resuelven solos; si no, se muestra el ejemplo.
const compartido = segsDesdeParams(location.search);
if (compartido.x.length && compartido.h.length) {
  $('#presetNota').textContent = 'Solución compartida: cargada desde el enlace.';
  $('#xSingle').value = ''; $('#hSingle').value = '';
  $('#xSingleMsg').textContent = ''; $('#hSingleMsg').textContent = '';
  splitRequestVersion.x += 1; splitRequestVersion.h += 1;
  splitState.x = { source: null, stale: false };  // modo manual: nada que descomponer
  splitState.h = { source: null, stale: false };
  compartido.x.forEach(s => tramoRow($('#xRows'), s));
  compartido.h.forEach(s => tramoRow($('#hRows'), s));
  fitSliderToSegs([...compartido.x, ...compartido.h]);
  resolver();
} else {
  // (en la MPA previewIntegral vive en integrales.js y solo está en su página)
  loadEjemplo().then(() => { if (typeof previewIntegral === 'function') previewIntegral(); });
}
// KaTeX carga diferido: re-render específico de esta página
window.addEventListener('load', () => {
  $$('#xRows .tramo, #hRows .tramo').forEach(previewTramo);
});
