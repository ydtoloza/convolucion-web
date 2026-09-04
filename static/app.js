// Editor de ecuaciones con vista previa LaTeX + interfaz renovada
let PRESETS = {};
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

// ---------- tema (oscuro por defecto) ----------
// El atributo data-theme se fija ANTES del CSS con un script inline en <head>;
// aquí solo se alterna, se persiste y se repintan las gráficas.
const THEME_KEY = 'tema';
function currentTheme() {
  return document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
}
function plotTheme() {
  return currentTheme() === 'dark'
    ? { paper: '#101a2e', plot: '#101a2e', font: '#e2e8f0', grid: '#1e293b', zero: '#3b4f6e', marker: '#38bdf8' }
    : { paper: '#ffffff', plot: '#ffffff', font: '#0f172a', grid: '#e2e8f0', zero: '#94a3b8', marker: '#0284c7' };
}
function plotLayout(extra) {
  const t = plotTheme();
  return Object.assign({
    margin: { t: 36, r: 10, l: 44, b: 36 },
    paper_bgcolor: t.paper, plot_bgcolor: t.plot,
    font: { color: t.font },
    xaxis: { gridcolor: t.grid, zerolinecolor: t.zero },
    yaxis: { gridcolor: t.grid, zerolinecolor: t.zero }
  }, extra || {});
}
function applyTheme(t) {
  document.documentElement.setAttribute('data-theme', t);
  try { localStorage.setItem(THEME_KEY, t); } catch (e) { /* modo privado */ }
  const b = $('#btnTema');
  if (b) {
    b.textContent = t === 'light' ? '🌙' : '☀️';
    b.title = t === 'light' ? 'Cambiar a modo oscuro' : 'Cambiar a modo claro';
  }
  // repintar gráficas si hay datos
  if (window.Plotly && lastPlotData) {
    plotAll(lastPlotData);
    if (lastSolapeData) renderSolape(lastSolapeData.tau, lastSolapeData.x, lastSolapeData.h, lastSolapeData.prod, lastSolapeData.t0);
    if (lastPlotData && $('#plotY').data) { try { Plotly.relayout('plotY', { shapes: yShapes(parseFloat($('#sliderT').value)) }); } catch (e) { /* noop */ } }
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
    <div class="tramo-top">
      <label>desde a<input class="a" value="${aVal}" spellcheck="false"></label>
      <label>hasta b<input class="b" value="${bVal}" spellcheck="false"></label>
      <button class="del" title="Quitar tramo">✕</button>
    </div>
    <label class="expr">fórmula f(t) <span class="hint">ej: 5*exp(-3*t) · 2t · e^(-3t) · t^2</span>
      <input class="e expr-in" value="${eVal}" spellcheck="false" autocomplete="off">
    </label>
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
    box.innerHTML = `<span class="ok-tag">✓</span> `;
    const inner = document.createElement('span');  // BUG-8: sin nodo huérfano
    box.appendChild(inner);
    renderLatex(inner, j.tramo_latex, true);
  } catch (e) {
    box.classList.add('bad');
    // BUG-6: el error del backend incluye la expr del usuario -> escapar.
    box.innerHTML = `<span class="hint">⚠ ${esc(String(e.message || e).slice(0, 160))}</span>`;
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
    btn.textContent = ok ? '✓ Copiado' : '⚠ No se pudo copiar';
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
  msg.textContent = 'Descomponiendo…';
  try {
    const r = await fetch('/api/descomponer', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ expr, var: 't' }) });
    const j = await r.json();
    if (!j.ok) throw new Error(j.error);
    $('#' + rowsId).innerHTML = '';
    j.segs.forEach(s => tramoRow($('#' + rowsId), s));
    fitSliderToSegs(j.segs);
    msg.textContent = `✓ ${j.n} tramo${j.n === 1 ? '' : 's'}: revisa abajo y pulsa Resolver.`;
  } catch (e) {
    msg.textContent = '⚠ ' + friendlyError(e.message || e);
  }
}
// BUG-7: con manejo de errores de red y mensaje al usuario
async function loadPresets() {
  try {
    const r = await fetch('/api/presets');
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    PRESETS = await r.json();
  } catch (e) {
    console.error('No se pudieron cargar los presets:', e);
    $('#presetNota').textContent = '⚠ Sin conexión con el servidor: revisa que app.py esté corriendo.';
    return;
  }
  const sel = $('#preset'); sel.innerHTML = '';
  const ul = $('#listaPresets'); if (ul) ul.innerHTML = '';
  Object.entries(PRESETS).forEach(([k, v]) => {
    const o = document.createElement('option'); o.value = k; o.textContent = v.nombre; sel.appendChild(o);
    if (ul) { const li = document.createElement('li'); li.textContent = v.nombre + ' — ' + v.nota; ul.appendChild(li); }
  });
  sel.onchange = () => applyPreset(sel.value);
  applyPreset(Object.keys(PRESETS)[2] || Object.keys(PRESETS)[0]);
}
function applyPreset(k) {
  const p = PRESETS[k]; if (!p) return;
  $('#preset').value = k;  // BUG-13: sincronizar el select con el preset aplicado
  $('#presetNota').textContent = p.nota || '';
  // limpiar también las cajas de "señal completa" para no mezclar entradas viejas
  $('#xSingle').value = ''; $('#hSingle').value = '';
  $('#xSingleMsg').textContent = ''; $('#hSingleMsg').textContent = '';
  $('#xRows').innerHTML = ''; $('#hRows').innerHTML = '';
  p.x.forEach(s => tramoRow($('#xRows'), s));
  p.h.forEach(s => tramoRow($('#hRows'), s));
  fitSliderToSegs([...p.x, ...p.h]);  // DESIGN-6: rango inicial según el preset
}
// DESIGN-6: el slider nace del soporte de las señales, no de un rango fijo
function fitSliderToSegs(segs) {
  const nums = segs.flatMap(s => [parseFloat(s.a), parseFloat(s.b)]).filter(Number.isFinite);
  const s = $('#sliderT');
  if (!nums.length) { s.min = -5; s.max = 5; s.value = 0; }
  else { s.min = Math.min(...nums) - 2; s.max = Math.max(...nums) + 2; s.value = nums[0]; }
  $('#tVal').textContent = s.value;
}
// BUG-9 + UX-8: destino explícito (selector) o por defecto según tipo
const TPL_DEFAULT = { pulso: '#xRows', expon: '#xRows', rampa: '#hRows', escalon: '#hRows' };
const TPL_DATA = {
  pulso: { a: '0', b: '8', expr: '1' },
  rampa: { a: '0', b: '8', expr: 't' },
  expon: { a: '0', b: 'oo', expr: '5*exp(-3*t)' },
  escalon: { a: '0', b: 'oo', expr: '1' },
};
function addTemplate(kind) {
  const sel = $('#tplTarget');
  const where = sel && sel.value !== 'auto' ? (sel.value === 'x' ? '#xRows' : '#hRows')
    : (TPL_DEFAULT[kind] ?? '#xRows');
  if (!TPL_DATA[kind]) return;
  tramoRow($(where), TPL_DATA[kind]);
  $(where).lastElementChild?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
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
  fitSliderToSegs([...h, ...x]);
  resolver();
}
function setStepper(done) {
  const names = ['h(t−τ)', 'x(τ)', 'Regiones', 'Integrar', 'y(t)'];
  $('#stepper').innerHTML = names.map((n, i) =>
    `<span class="st ${i < done ? 'done' : ''}">${i < done ? '✓' : (i + 1)} · ${n}</span>`).join('');
}
// UX-3: errores técnicos de SymPy traducidos a guía para el estudiante
function friendlyError(msg) {
  msg = String(msg || 'Error desconocido');
  if (/interpretar/i.test(msg)) return msg + '\n💡 Revisa la sintaxis: usa * para multiplicar (5*t), exp() para exponenciales y ^ para potencias.';
  if (/dimension|shape|broadcast/i.test(msg)) return msg + '\n💡 Parece un problema numérico en la gráfica; prueba simplificar los tramos.';
  if (/Failed to fetch|NetworkError|HTTP/i.test(msg)) return msg + '\n💡 No hay conexión con el servidor: verifica que app.py esté corriendo en http://127.0.0.1:5000.';
  return msg;
}
async function resolver() {
  const btn = $('#resolver');
  $('#errConv').textContent = '';
  $('#loadingConv').hidden = false;
  btn.disabled = true;  // UX-4: evita doble envío y condiciones de carrera
  setStepper(0);
  try {
    const x = readSegs('xRows'), h = readSegs('hRows');
    if (!x.length || !h.length) throw new Error('Agrega al menos un tramo en x(t) y uno en h(t).');
    lastX = x; lastH = h;
    const r = await fetch('/api/convolve', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ x, h }) });
    const j = await r.json();
    if (!j.ok) throw new Error(j.error);
    $('#resultado').style.display = 'block';
    setStepper(5);
    renderLatex($('#defConv'), 'y(t)=\\int_{-\\infty}^{\\infty}x(\\tau)\\,h(t-\\tau)\\,d\\tau', true);
    lastRegiones = j.regiones || [];
    lastCriticos = j.criticos || [];
    lastProcTxt = j.procedimiento_txt || '';
    // Criterio de la fija: mensaje del servidor + botón de intercambio si aplica
    const cb = $('#criterioFija');
    if (j.criterio && j.criterio.mensaje) {
      const rec = j.criterio.recomendada;
      const cls = rec === 'x' ? 'paso ok' : (rec === 'h' ? 'paso warn' : 'paso');
      cb.innerHTML = `<div class="${cls}">${esc(j.criterio.mensaje)}</div>` +
        (rec === 'h' ? `<button id="btnSwap" class="ghost">⇄ Intercambiar x↔h y resolver</button>` : '');
      const bs = $('#btnSwap');
      if (bs) bs.onclick = intercambiarSenales;
    } else { cb.innerHTML = ''; }
    plotAll(j);
    const c = j.criticos || [];
    const s = $('#sliderT');
    if (c.length) { s.min = Math.min(...c) - 2; s.max = Math.max(...c) + 2; s.value = c[0]; }
    $('#p1').innerHTML = j.paso1.map((s2, i) =>
      `<details class="paso" ${i === 0 ? 'open' : ''}><summary>h<sub>${i + 1}</sub>(t−τ)</summary>
       ① Original: <span class="m">\\(${s2.original}\\)</span><br>
       ② Sustituir t→t−τ: <span class="m">\\(${s2.sustituir}\\)</span><br>
       ③ Restar t: <span class="m">\\(${s2.restar_t}\\)</span><br>
       ④ ×(−1): <span class="m">\\(${s2.mult_menos1}\\)</span><br>
       ✔ Final: <span class="m">\\(${s2.final}\\)</span></details>`).join('');
    $('#p2').innerHTML = j.paso2.map((s2, i) =>
      `<details class="paso" ${i === 0 ? 'open' : ''}><summary>x<sub>${i + 1}</sub>(τ)</summary>
       ① Original: <span class="m">\\(${s2.original}\\)</span><br>
       ② Cambio t→τ: <span class="m">\\(${s2.sustituir}\\)</span><br>
       ✔ Final: <span class="m">\\(${s2.final}\\)</span></details>`).join('');
    // Paso 3 (como la guía): críticos = suma de bordes; dividen la recta; dónde inicia
    $('#p3').innerHTML =
      `<div class="paso">
       <b>Puntos críticos</b> = cada borde de x(τ) + cada borde de h(t−τ):<br>
       <span class="m">\\(t_c \\in \\{${c.length ? c.map(v => Number(v).toFixed(2)).join(',\\;') : '0'}\\}\\)</span><br>
       Los críticos dividen la recta de <b>t</b> en <b>${j.regiones.length} intervalo${j.regiones.length === 1 ? '' : 's'}</b>: se analiza uno por uno.<br>
       <b>y(t) inicia</b> donde aparece el primer solape: <span class="m">\\(t = ${fmtT(j.t_inicio)}\\)</span>
       <div class="mini-chips">${j.regiones.map((rr, k) => `<span class="chip">${k + 1}) <span class="m">\\(${rr.cond_latex}\\)</span></span>`).join('')}</div>
       </div>`;
    // Paso 4 (como la guía): por intervalo -> integral entrante/saliente, TFC y
    // la pregunta del ciclo "¿Fin o hay más intervalos?" tras CADA intervalo.
    $('#p4').innerHTML = j.regiones.map((rr, k) => {
      const head = `<div class="region-head"><span class="rnum">Intervalo ${k + 1} de ${j.regiones.length}</span><span class="m">\\(${rr.cond_latex}\\)</span></div>`;
      const loop = k < j.regiones.length - 1
        ? `<div class="loop-q"><span class="lq">⟳ ¿Fin o hay más intervalos?</span> <b>SÍ</b> — falta <span class="m">\\(${j.regiones[k + 1].cond_latex}\\)</span></div>`
        : `<div class="loop-q"><span class="lq">⟳ ¿Fin o hay más intervalos?</span> <b>NO</b> — todos cubiertos → ir al Paso 5.</div>`;
      if (!rr.hay_solape) {
        return `<div class="region cero">${head}
          Sin solape: <span class="m">\\(x(\\tau)\\,h(t-\\tau) = 0\\)</span> en todo τ<br>
          <span class="m">\\(y(t) = \\int (0)\\,d\\tau = 0\\)</span>
          <div class="res-line"><b>⇒ <span class="m">\\(y(t)=0\\)</span></b> para <span class="m">\\(${rr.cond_latex}\\)</span></div>${loop}</div>`;
      }
      const ints = rr.integrales.map((g, m) => {
        const nI = rr.integrales.length;
        const tag = nI > 1 ? (m === 0 ? 'Integral entrante' : (m === nI - 1 ? 'Integral saliente' : 'Integral intermedia')) : 'Integral';
        const completaTex = `y(t)=\\int_{${g.low_latex}}^{${g.high_latex}}\\left(${g.x_tau_latex}\\right)\\!\\left(${g.h_shift_latex}\\right)d\\tau`;
        return `<details class="paso" ${m === 0 ? 'open' : ''}><summary>${tag} ${rr.integrales.length > 1 ? (m + 1) : ''} · <span class="m">\\(${g.par_latex || ''}\\)</span></summary>
         ① Planteo con límites reales: <span class="m">\\(${completaTex}\\)</span><br>
         ② Expandir el producto (sin saltarse nada): <span class="m">\\(${g.integrando_latex}\\)</span><br>
         ③ Regla: ${esc(g.regla_detalle || '')}<br>
         ④ Primitiva término a término: <span class="m">\\(F(\\tau)=${g.primitiva_latex}\\)</span><br>
         ⑤ Evaluar: arriba <span class="m">\\(F(${g.high_latex})=${g.Fsup_latex || ''}\\)</span> · abajo <span class="m">\\(F(${g.low_latex})=${g.Finf_latex || ''}\\)</span><br>
         ⑥ Restar (TFC): <span class="m">\\(${g.resta_latex || g.eval_latex}\\)</span></details>`;
      }).join('');
      const limites = rr.integrales.map(g => `<span class="m">\\(\\tau \\in [${g.low_latex},\\,${g.high_latex}]\\)</span>`).join(' + ');
      const etiqueta = rr.integrales.length > 1 ? 'Integrales entrante + saliente' : 'Integral entrante';
      return `<div class="region">${head}
        <div class="entrante">${etiqueta} en τ: ${limites}</div>${ints}
        <div class="res-line"><b>⇒ <span class="m">\\(y(t)=${rr.resultado_latex}\\)</span></b> para <span class="m">\\(${rr.cond_latex}\\)</span></div>${loop}</div>`;
    }).join('');
    $('#p5').innerHTML =
      `<div class="paso">Respuesta final por tramos:<br><span class="m">\\[${j.y_tramos_latex}\\]</span></div>` +
      `<div class="paso">Forma compacta con escalón u(t):<br><span class="m">\\[${j.y_escalones_latex}\\]</span></div>`;
    renderAll($('#resultado'));
    $('#resultado').scrollIntoView({ behavior: 'smooth', block: 'start' });
    updateSolape();
  } catch (e) {
    $('#errConv').textContent = '⚠ ' + friendlyError(e.message || e);
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
  if (r.t_lo == null) return `t < ${r.t_hi_str}`;
  if (r.t_hi == null) return `t ≥ ${r.t_lo_str}`;
  return `${r.t_lo_str} ≤ t < ${r.t_hi_str}`;
}
// líneas verticales en la gráfica y(t): críticos (punteadas) + t actual (sólida)
function yShapes(t0) {
  const t = plotTheme();
  const shapes = lastCriticos.map(v => ({
    type: 'line', x0: v, x1: v, y0: 0, y1: 1, yref: 'paper',
    line: { color: t.zero, width: 1, dash: 'dot' }, hoverinfo: 'skip'
  }));
  if (t0 != null && Number.isFinite(t0)) {
    shapes.push({
      type: 'line', x0: t0, x1: t0, y0: 0, y1: 1, yref: 'paper',
      line: { color: t.marker, width: 2 }, hoverinfo: 'skip'
    });
  }
  return shapes;
}
function plotAll(j) {
  lastPlotData = j;
  Plotly.newPlot('plotXH', [
    { x: j.grid, y: j.x_vals, name: 'x(t)', type: 'scatter' },
    { x: j.grid, y: j.h_vals, name: 'h(t)', type: 'scatter' }
  ], plotLayout({ title: 'x(t) y h(t)' }), { responsive: true });
  Plotly.newPlot('plotY', [{ x: j.grid, y: j.y_vals, name: 'y(t)', type: 'scatter', line: { width: 3 } }],
    plotLayout({ title: 'y(t) = x(t) ∗ h(t)', shapes: yShapes(null) }), { responsive: true });
}
function renderSolape(tau, xv, hv, prod, t0) {
  Plotly.newPlot('plotSolape', [
    { x: tau, y: xv, name: 'x(τ)', type: 'scatter' },
    { x: tau, y: hv, name: `h(${t0}−τ)`, type: 'scatter' },
    { x: tau, y: prod, name: 'producto', fill: 'tozeroy', type: 'scatter' }
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
  // marcador de t en la gráfica y(t)
  if ($('#plotY').data) { try { Plotly.relayout('plotY', { shapes: yShapes(t0) }); } catch (e) { /* noop */ } }
  try {
    const r = await fetch('/api/solape', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ x: lastX, h: lastH, t0 }) });
    const j = await r.json(); if (!j.ok) return;
    $('#areaVal').textContent = j.area_trapz.toFixed(4);
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
    box.innerHTML = `<span class="hint">⚠ ${esc(String(e.message || e).slice(0, 140))}</span>`;
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
    const badge = j.verificada === true ? '<div class="paso ok">✓ Primitiva verificada: su derivada coincide con el integrando.</div>'
      : j.verificada === false ? '<div class="paso warn">⚠ No se pudo verificar automáticamente la primitiva: revísala derivando a mano.</div>' : '';
    d.innerHTML = badge + j.pasos.map(p => `<div class="paso"><b>${esc(p.titulo)}</b><br>${p.detalle}<br><span class="m">\\[${p.latex}\\]</span></div>`).join('') +
      (j.es_definida ? `<div class="paso"><b>Resultado:</b> <span class="m">\\[${j.valor_latex}\\]</span>${j.valor_num != null ? ` (≈ ${Number(j.valor_num).toFixed(6)})` : ''}</div>`
        : `<div class="paso"><b>Resultado:</b> <span class="m">\\[${j.primitiva_latex}\\]</span></div>`);
    renderAll(d);
  } catch (e) { $('#errInt').textContent = '⚠ ' + friendlyError(e.message || e); }
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
// (el botón de tema va aparte: no es una pestaña)
$$('.tabs button[data-tab]').forEach(b => b.onclick = () => {
  $$('.tabs button[data-tab]').forEach(x => x.classList.remove('active'));
  $$('.tab').forEach(x => x.classList.remove('active'));
  b.classList.add('active'); document.getElementById('tab-' + b.dataset.tab).classList.add('active');
});
$('#btnTema').onclick = () => applyTheme(currentTheme() === 'light' ? 'dark' : 'light');
applyTheme(currentTheme());  // sincroniza icono/título con el tema ya fijado en <head>
$('#addX').onclick = () => tramoRow($('#xRows'), { a: '0', b: 'oo', expr: '1' });
$('#addH').onclick = () => tramoRow($('#hRows'), { a: '0', b: 'oo', expr: '1' });
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
$('#sliderT').oninput = (e) => { $('#tVal').textContent = e.target.value; $('#areaVal').textContent = '…'; updateSolapeLive(); };
$('#sliderT').onchange = updateSolape;
$('#ejInt1').onclick = () => { $('#intExpr').value = '6*tau'; $('#intA').value = '-4'; $('#intB').value = 't'; previewIntegral(); };
$('#ejInt2').onclick = () => { $('#intExpr').value = 'tau^2*exp(-tau)'; $('#intA').value = ''; $('#intB').value = ''; previewIntegral(); };
$('#ejInt3').onclick = () => { $('#intExpr').value = 'tau*sin(tau)'; $('#intA').value = '0'; $('#intB').value = 'pi'; previewIntegral(); };
document.querySelector('.templates').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-tpl]'); if (!b) return;
  addTemplate(b.dataset.tpl);
});
bindPalette('palette'); bindPalette('palette2');
$('#intExpr').addEventListener('input', debounce(previewIntegral, 350));
$('#intVar').onchange = previewIntegral;
// botones de copiar: solución concreta + procedimiento general (teoría)
bindCopyButton($('#btnCopiar'), () => lastProcTxt);
bindCopyButton($('#btnCopiarProc'), () => PROC_GENERAL_TXT);
loadPresets().then(() => previewIntegral());
renderAll(document.body);
// KaTeX carga diferido: re-renderizar cuando esté listo
window.addEventListener('load', () => {
  renderAll(document.body);
  $$('#xRows .tramo, #hRows .tramo').forEach(previewTramo);
  previewIntegral();
});
