// integrales.js — página /integrales (MPA). Script clásico cargado con defer
// DESPUÉS de base.js, del que usa $, esc, renderLatex, renderAll, debounce,
// bindCopyButton y friendlyError.

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
    // Enlace compartible: tras cada resolución exitosa los datos quedan en la URL.
    sincronizarURLInt();
  } catch (e) { $('#errInt').textContent = friendlyError(e.message || e); }
}

// ---------- enlaces compartibles ----------
// Params: expr, var, a, b (los valores tal cual de #intExpr, #intVar, #intA,
// #intB, vacíos incluidos). Codificación SIEMPRE vía URLSearchParams: serializa
// '+' como %2B y .get() lo devuelve como '+'; nunca codificar a mano.
function paramsDesdeIntegral() {
  const p = new URLSearchParams();
  p.set('expr', $('#intExpr').value);
  p.set('var', $('#intVar').value);
  p.set('a', $('#intA').value);
  p.set('b', $('#intB').value);
  return p;
}
function sincronizarURLInt() {
  const search = paramsDesdeIntegral().toString();
  history.replaceState(null, '', location.pathname + (search ? '?' + search : ''));
}

// ---------- wiring (esta página siempre existe: wiring directo) ----------
$('#resolverInt').onclick = resolverInt;
$('#intExpr').addEventListener('input', debounce(previewIntegral, 350));
$('#intVar').onchange = previewIntegral;
// copiar el enlace de la integral resuelta (mismo feedback que bindCopyButton)
if ($('#btnCopiarLink')) {
  bindCopyButton($('#btnCopiarLink'), () => { sincronizarURLInt(); return location.href; });
}

// ---------- inicio ----------
// Con ?expr=… en el URL se cargan los 4 campos (con los defaults actuales para
// los params ausentes: a='-4', b='t', var='tau') y se resuelve sola (enlace
// compartible); sin param expr, solo la vista previa del integrando por defecto.
const paramsInt = new URLSearchParams(location.search);
const exprCompartida = paramsInt.get('expr');
if (exprCompartida && exprCompartida.trim()) {
  $('#intExpr').value = exprCompartida;
  const v = paramsInt.get('var');
  $('#intVar').value = (v === 't' || v === 'tau') ? v : 'tau';
  $('#intA').value = paramsInt.has('a') ? paramsInt.get('a') : '-4';
  $('#intB').value = paramsInt.has('b') ? paramsInt.get('b') : 't';
  resolverInt();
}
previewIntegral();
// KaTeX carga diferido: re-render específico de esta página
window.addEventListener('load', () => previewIntegral());
