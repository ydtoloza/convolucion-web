# -*- coding: utf-8 -*-
"""
Servidor web - Solucionador paso a paso de convolución continua + integrales.
Metodología en 5 pasos:
  Paso 1: Obtener h(t-tau) móvil (reflejo + corrimiento)
  Paso 2: Obtener x(tau) fija (cambio de variable)
  Paso 3: Identificar intervalos de t y de tau / dónde inicia
  Paso 4: Multiplicar x(tau)*h(t-tau) e integrar sobre tau
  Paso 5: Fin o hay más intervalos? -> respuesta final por tramos
"""
from flask import Flask, request, jsonify, render_template
import sympy as sp
import traceback
import re
import math
import os
import numpy as np  # DESIGN-1/OPT-4: import único a nivel de módulo

app = Flask(__name__)
app.config['MAX_CONTENT_LENGTH'] = 64 * 1024  # DESIGN-3: tope de 64 KB por petición


@app.errorhandler(413)
def _too_large(e):
    # DESIGN-3: JSON (no HTML) cuando el payload excede el tope
    return jsonify({'ok': False,
                    'error': 'Petición demasiado grande (máx 64 KB). Simplifica las expresiones.'}), 413

# BUG-10: compatibilidad NumPy < 2.0 (trapezoid) y >= 2.0 (trapz eliminado)
_trapz = getattr(np, 'trapezoid', getattr(np, 'trapz', None))

t, tau = sp.symbols('t tau', real=True)
a_sym = sp.symbols('a', positive=True, real=True)

FUNCS = {
    't': t, 'tau': tau, 'a': a_sym,
    'E': sp.E, 'e': sp.E, 'pi': sp.pi,
    'exp': sp.exp, 'sin': sp.sin, 'cos': sp.cos, 'tan': sp.tan,
    'log': sp.log, 'sqrt': sp.sqrt, 'Abs': sp.Abs,
    'Heaviside': sp.Heaviside, 'u': sp.Heaviside, 'mu': sp.Heaviside,
}


def normalize_math(s):
    """Normaliza entrada 'humana' a sintaxis SymPy.
    Acepta: 5t, 2(t+1), e^(-3t), e^-3t, e^{-2t}, 3e^{-2t}, 5e-3t, sen(), × ÷ −, √, π, τ, μ.
    """
    if s is None:
        return ''
    s = str(s).strip()
    if s == '':
        return ''
    # unicode común
    s = (s.replace('×', '*').replace('·', '*').replace('÷', '/')
           .replace('−', '-').replace('–', '-').replace('—', '-')
           .replace('π', 'pi').replace('τ', 'tau').replace('Τ', 'tau')
           .replace('μ', 'u').replace('µ', 'u').replace('∞', 'oo'))
    # llaves de LaTeX: e^{-2t} -> e^(-2t) (conservar el ^ para la potencia)
    s = re.sub(r'\^\s*\{\s*([^{}]+?)\s*\}', r'^(\1)', s)
    # raíz cuadrada √(...) o √x
    s = re.sub(r'√\s*\(\s*([^)]+?)\s*\)', r'sqrt(\1)', s)
    s = re.sub(r'√\s*([a-zA-Z0-9_.]+)', r'sqrt(\1)', s)
    # español: sen( -> sin(
    s = re.sub(r'\bsen\s*\(', 'sin(', s, flags=re.IGNORECASE)
    s = re.sub(r'\bseno\s*\(', 'sin(', s, flags=re.IGNORECASE)
    # 5e-3t  -> 5*exp(-3*t)  (notación del taller). Solo si hay t/tau después.
    s = re.sub(r'(\d)\s*[eE]\s*([+-]?\s*\d[\d.]*)\s*(t|tau)\b', r'\1*exp(\2*\3)', s)
    s = re.sub(r'(\d)\s*[eE]\s*\^\s*([+-]?\s*\d[\d.]*)\s*(t|tau)\b', r'\1*exp(\2*\3)', s)
    # 3e^(-2t) -> 3*exp(-2t) (el \b no separa dígito de 'e', por eso va aparte)
    s = re.sub(r'(\d)\s*[eE]\s*\^\s*\(\s*([^)]+?)\s*\)', r'\1*exp(\2)', s)
    # e^(-3t), e^-3t, E^(-2t) -> exp(...) (BUG-11: patrones estrictos, exigen dígitos)
    s = re.sub(r'\b[eE]\s*\^\s*\(\s*([^)]+?)\s*\)', r'exp(\1)', s)
    s = re.sub(r'\b[eE]\s*\^\s*([+-]?[\d.]+\s*\*?\s*(?:t|tau)(?:\s*[+-]\s*[\d.]+)?)', r'exp(\1)', s)
    # u(t), HeavisideHeaviside táctico: u(t) solo -> Heaviside(t)
    s = re.sub(r'\bu\s*\(', 'Heaviside(', s)
    # ln( -> log(
    s = re.sub(r'\bln\s*\(', 'log(', s, flags=re.IGNORECASE)
    return s


def _sympy_parse(s, local):
    """Parsea con multiplicación implícita y ^ como potencia."""
    from sympy.parsing.sympy_parser import (
        parse_expr as sp_parse, standard_transformations,
        implicit_multiplication_application, convert_xor)
    transformations = standard_transformations + (
        implicit_multiplication_application, convert_xor)
    return sp_parse(s, local_dict=local, transformations=transformations)


def parse_bound(s):
    orig = '' if s is None else str(s)
    # Solo la detección de infinito es case-insensitive; el parseo respeta
    # mayúsculas (Abs, Heaviside, sin...) para no romper símbolos/funciones.
    canon = normalize_math(orig).strip()
    low = canon.lower().replace(' ', '')
    if low in ['oo', '+oo', 'inf', '+inf', 'infinito', '+infinito']:
        return sp.oo
    if low in ['-oo', '-inf', '-infinito']:
        return -sp.oo
    local = dict(FUNCS)
    local['t'] = t
    local['tau'] = tau
    try:
        return _sympy_parse(canon, local)
    except Exception:
        try:
            return sp.sympify(canon, locals=local)
        except Exception:
            try:
                return sp.sympify(float(canon))
            except Exception:
                raise ValueError(
                    f"No pude interpretar el límite '{orig}': usa números, oo, -oo o pi.")


def parse_expr(s, var):
    orig = str(s)
    s = normalize_math(orig)
    if s == '' or s == '0':
        return sp.Integer(0)
    local = dict(FUNCS)
    local[str(var)] = var
    try:
        return _sympy_parse(s, local)
    except Exception:
        try:
            return sp.sympify(s, locals=local)
        except Exception as e:
            raise ValueError(f"No pude interpretar '{orig}': {e}. Prueba ej: 5*exp(-3*t), t^2, 2t, e^(-3t), sen(t)")


def _finito(b):
    """True si el borde es un número finito (robusto ante ±oo y simbólicos)."""
    try:
        return abs(float(b.evalf())) != float('inf')
    except Exception:
        return False


def bound_num(b):
    try:
        if b == sp.oo:  # BUG-2: igualdad, no identidad (==, no is)
            return float('inf')
        if b == -sp.oo:
            return float('-inf')
        v = float(b.evalf())
    except (TypeError, ValueError) as e:
        raise ValueError(f"Límite no numérico '{b}': usa números, oo o -oo.") from e
    except Exception:
        try:
            v = float(b)
        except Exception as e:
            raise ValueError(f"Límite no numérico '{b}': usa números, oo o -oo.") from e
    if math.isnan(v):
        # nan simbólico (ej. límite con 't'): error amable en vez de TypeError crudo
        raise ValueError(f"Límite no numérico '{b}': usa números, oo o -oo.")
    return v


def latex(e):
    try:
        return sp.latex(e)
    except Exception:
        return str(e)


def fmt_u_shift(v):
    """Formatea (t - v) evitando 't--10': v=-10 -> 't+10', v=8 -> 't-8'."""
    if v == float('-inf') or v == float('inf'):
        return f"t-{fmt_num(v)}"
    if v == 0:
        return "t"
    return f"t+{fmt_num(-v)}" if v < 0 else f"t-{fmt_num(v)}"


def fmt_num(x):
    if x == float('inf'):
        return r'+\infty'
    if x == float('-inf'):
        return r'-\infty'
    if abs(x - round(x)) < 1e-9:
        return str(int(round(x)))
    return f"{x:.4g}"


def intervalo_t_latex(lo, hi, primero=False, ultimo=False):
    """Devuelve condición tipo 't < 0' o '-4 \\le t < 0' en latex."""
    if lo == float('-inf') and hi == float('inf'):
        return r'-\infty < t < +\infty'
    if lo == float('-inf'):
        return rf't < {fmt_num(hi)}'
    if hi == float('inf'):
        return rf't \ge {fmt_num(lo)}'
    # BUG-1: se eliminó la rama inalcanzable `if primero and lo == -inf`
    return rf'{fmt_num(lo)} \le t \le {fmt_num(hi)}' if ultimo else rf'{fmt_num(lo)} \le t < {fmt_num(hi)}'


def cond_var_latex(var, a, b):
    """Condición de soporte 'a ≤ var ≤ b' con formas naturales en bordes
    infinitos ('t \\ge 0' en vez de '0 \\le t \\le \\infty'), como en el PDF."""
    vn = latex(var)
    if a == -sp.oo and b == sp.oo:
        return rf'{vn} \in \mathbb{{R}}'
    if b == sp.oo:
        return rf'{latex(a)} \le {vn}'
    if a == -sp.oo:
        return rf'{vn} \le {latex(b)}'
    return rf'{latex(a)} \le {vn} \le {latex(b)}'


def tramo_cases_latex(nombre, ex, a, b, var):
    """Bloque cases 'f(var) = {expr, cond; 0, e.o.c.}' con condición natural.
    Si el tramo cubre toda la recta no hay 'e.o.c.': f = expr, var ∈ ℝ."""
    if a == -sp.oo and b == sp.oo:
        return rf"{nombre} = {latex(ex)}, \quad {cond_var_latex(var, a, b)}"
    return (rf"{nombre} = \begin{{cases}} {latex(ex)}, & {cond_var_latex(var, a, b)} \\ "
            rf"0, & \text{{e.o.c.}} \end{{cases}}")


# ------------------------------------------------- texto plano (copiable)
def _txt_expr(e):
    """Expresión sympy -> texto plano con símbolos unicode, lista para pegar
    en Word/WhatsApp. ASCII para operadores (copiable a cualquier lado)."""
    s = str(e)
    s = s.replace('**', '^').replace('tau', 'τ').replace('pi', 'π')
    s = s.replace('exp(', 'e^(').replace('sqrt(', '√(')
    s = s.replace('oo', '∞').replace('*', '·')
    return s


def _txt_num(x):
    if x == float('inf'):
        return '+∞'
    if x == float('-inf'):
        return '-∞'
    if abs(x - round(x)) < 1e-9:
        return str(int(round(x)))
    return f"{x:.4g}"


def _cond_txt(lo, hi, ultimo=False):
    """Condición de t en texto plano ('−4 ≤ t < 0', 't ≥ 8')."""
    if lo == float('-inf') and hi == float('inf'):
        return 'todo t'
    if lo == float('-inf'):
        return f't < {_txt_num(hi)}'
    if hi == float('inf'):
        return f't ≥ {_txt_num(lo)}'
    op = '≤' if ultimo else '<'
    return f'{_txt_num(lo)} ≤ t {op} {_txt_num(hi)}'


def _ineq_txt(a, b, var_txt='t'):
    """Desigualdad de soporte en texto plano ('−4 ≤ t ≤ 4', 't ≥ 0')."""
    if a == -sp.oo and b == sp.oo:
        return f'todo {var_txt}'
    if b == sp.oo:
        return f'{_txt_expr(a)} ≤ {var_txt}'
    if a == -sp.oo:
        return f'{var_txt} ≤ {_txt_expr(b)}'
    return f'{_txt_expr(a)} ≤ {var_txt} ≤ {_txt_expr(b)}'


def _soporte_txt(a, b, var_txt='t'):
    """Soporte en texto plano; un tramo que cubre toda la recta es 'todo var'
    (sin '; 0 en otro caso', que allí no aplica)."""
    if a == -sp.oo and b == sp.oo:
        return f'todo {var_txt}'
    return _ineq_txt(a, b, var_txt)


def _segs_txt(segs, var_txt='t'):
    """Señal por tramos en texto plano: '{expr si cond; 0 en otro caso}'.
    Si un tramo cubre toda la recta, la señal es simplemente esa fórmula."""
    for s in segs:
        if s['a_num'] == float('-inf') and s['b_num'] == float('inf'):
            return _txt_expr(s['expr'])
    parts = [f'{_txt_expr(s["expr"])}  si  {_ineq_txt(s["a"], s["b"], var_txt)}'
             for s in segs]
    parts.append('0 en otro caso')
    return '{ ' + ' ;  '.join(parts) + ' }'


# ---------------------------------------------------------------- ejemplo
# Un solo ejemplo de trabajo: el caso más completo del curso (rampa × pulso,
# Lección 3, ejemplo 2). Es el que más intervalos exige: puntos críticos
# {-4, 0, 4, 8} -> 5 tramos, 3 de ellos con integral.
EJEMPLO = {
    "nombre": "Rampa × pulso",
    "x": [{"a": "-4", "b": "4", "expr": "2*t"}],
    "h": [{"a": "0", "b": "4", "expr": "3"}],
    "nota": ("x(t) = 2t en [−4, 4] y h(t) = 3 en [0, 4]. Es el caso con más "
             "intervalos del taller: puntos críticos en t = −4, 0, 4, 8, "
             "cinco tramos y tres integrales. Ejemplo 2 de la Lección 3."),
}

# Compatibilidad: la ruta /api/presets y las plantillas siguen sirviendo un
# diccionario con la misma estructura de antes, ahora con un único ejemplo.
PRESETS = {"ejemplo": EJEMPLO}


# ------------------------------------------------- motor de convolución
def build_segments(raw, var):
    segs = []
    for s in raw:
        aa = parse_bound(s.get('a', '-oo'))
        bb = parse_bound(s.get('b', 'oo'))
        ex = parse_expr(s.get('expr', '0'), var)
        # normalizar: si a > b intercambiar
        try:
            if aa.is_number and bb.is_number and aa > bb:
                aa, bb = bb, aa
        except Exception:
            pass
        segs.append({'a': aa, 'b': bb, 'expr': ex,
                     'a_num': bound_num(aa), 'b_num': bound_num(bb)})
    return segs


def _num_str(v):
    """Float finito -> texto que parse_bound entiende ('-oo'/'oo'/número)."""
    if v == float('-inf'):
        return '-oo'
    if v == float('inf'):
        return 'oo'
    if abs(v - round(v)) < 1e-9:
        return str(int(round(v)))
    return repr(float(v))


def criterio_fija(x_segs, h_segs):
    """Criterio de clase: se deja FIJA la señal más grande (soporte más
    ancho) y se refleja/desplaza la otra. El resultado no cambia porque
    la convolución conmuta (x∗h = h∗x); solo facilita el análisis a mano
    (menos casos de solape que dibujar). La página siempre fija x(t).
    """
    def ancho(segs):
        total, infinito = 0.0, False
        for s in segs:
            a, b = s['a_num'], s['b_num']
            if math.isfinite(a) and math.isfinite(b):
                total += max(0.0, b - a)
            else:
                infinito = True
        return infinito, total

    x_inf, x_w = ancho(x_segs)
    h_inf, h_w = ancho(h_segs)

    def txt(inf, w):
        return '∞ (cola infinita)' if inf else fmt_num(w)

    if x_inf != h_inf:
        rec = 'x' if x_inf else 'h'
    elif abs(x_w - h_w) < 1e-9:
        rec = 'indiferente'
    else:
        rec = 'x' if x_w > h_w else 'h'

    if rec == 'indiferente':
        msg = (f"Criterio: x(t) y h(t) miden lo mismo (ancho {txt(x_inf, x_w)}); "
               f"da igual cuál se deja fija. Resultado idéntico (x∗h = h∗x).")
    elif rec == 'x':
        msg = (f"Criterio: x(t) es la más grande (ancho {txt(x_inf, x_w)} vs {txt(h_inf, h_w)}) "
               f"y ya está fija; h(t−τ) es la móvil. Resultado idéntico (x∗h = h∗x).")
    else:
        msg = (f"Criterio: h(t) es la más grande (ancho {txt(h_inf, h_w)} vs {txt(x_inf, x_w)}); "
               f"conviene fijarla e intercambiar las señales. El resultado no cambia (x∗h = h∗x).")
    return {'fija_actual': 'x', 'recomendada': rec,
            'x_txt': txt(x_inf, x_w), 'h_txt': txt(h_inf, h_w), 'mensaje': msg}


def split_by_heaviside(expr_str, var_name='t'):
    """Descompone una señal con escalones en tramos.

    Ej: '3*exp(-2*t)*u(t)' -> [{'a':'0','b':'oo','expr':'3*exp(-2*t)'}].
    Método (como en clase): los ceros de cada argumento de u(·) parten la
    recta en regiones; dentro de cada región cada u(·) vale 0 ó 1 fijo, así
    que la señal se reduce a una fórmula sin escalones. Regiones vecinas
    con la misma fórmula se fusionan. Las regiones donde la señal es 0 se
    omiten (el motor las trata como cero de todos modos).
    """
    var = t if var_name == 't' else tau
    f = parse_expr(expr_str, var)
    if f == 0:
        return []
    Hs = list(f.atoms(sp.Heaviside))
    subs_const = {}
    h_args = []
    for H in Hs:
        arg = sp.expand(H.args[0])
        if not arg.has(var):
            try:
                c = float(arg.evalf())
                subs_const[H] = sp.Integer(1 if c > 0 else 0)
            except Exception:
                pass
        else:
            h_args.append((H, arg))
    if subs_const:
        f = f.subs(subs_const)
        if f == 0:
            return []
    if not h_args:
        return [{'a': '-oo', 'b': 'oo', 'expr': str(f)}]
    crit = []
    for _H, arg in h_args:
        try:
            sols = sp.solve(arg, var)
        except Exception:
            sols = []
        for s in sols or []:
            try:
                v = float(s.evalf())
            except Exception:
                continue
            if math.isfinite(v) and not any(abs(v - c) < 1e-9 for c in crit):
                crit.append(v)
    crit.sort()
    bounds = [float('-inf')] + crit + [float('inf')]
    raw = []
    for k in range(len(bounds) - 1):
        lo, hi = bounds[k], bounds[k + 1]
        if lo == float('-inf') and hi == float('inf'):
            mid = 0.0
        elif lo == float('-inf'):
            mid = hi - 1.0
        elif hi == float('inf'):
            mid = lo + 1.0
        else:
            if hi - lo < 1e-9:
                continue
            mid = (lo + hi) / 2.0
        vals = {}
        for H, arg in h_args:
            try:
                c = float(arg.subs(var, mid).evalf())
            except Exception:
                continue
            vals[H] = sp.Integer(1 if c > 0 else 0)
        try:
            exprk = sp.simplify(f.xreplace(vals))
        except Exception:
            continue
        if exprk == 0:
            continue
        raw.append({'a': _num_str(lo), 'b': _num_str(hi), 'expr': str(exprk)})
    # fusionar vecinas con igual fórmula
    segs = []
    for s in raw:
        if segs:
            try:
                if sp.simplify(sp.sympify(segs[-1]['expr']) - sp.sympify(s['expr'])) == 0:
                    segs[-1]['b'] = s['b']
                    continue
            except Exception:
                pass
        segs.append(s)
    return segs


def paso1_h(h_segs):
    """Derivación de h(t-tau) con los 4 subpasos del PDF p.10/p.20."""
    pasos = []
    for j, s in enumerate(h_segs):
        ah, bh, eh = s['a'], s['b'], s['expr']
        eh_tt = sp.simplify(eh.subs(t, t - tau))
        fin_a = _finito(ah)  # BUG-2: igualdad robusta en vez de `is`
        fin_b = _finito(bh)
        T = _txt_expr
        n = j + 1
        if fin_a and fin_b:
            sub1 = rf"{latex(ah)} \le t-\tau \le {latex(bh)}"
            sub2 = rf"{latex(ah - t)} \le -\tau \le {latex(bh - t)} \quad\text{{(restar t)}}"
            sub3 = rf"{latex(t - bh)} \le \tau \le {latex(t - ah)} \quad\text{{(multiplicar por -1: se invierten las desigualdades)}}"
            final = rf"h_{{{n}}}(t-\tau) = \begin{{cases}} {latex(eh_tt)}, & {latex(t-bh)} \le \tau \le {latex(t-ah)} \\ 0, & \text{{e.o.c.}} \end{{cases}}"
            txt = [
                f"h{n}(t) = {T(eh)}   si   {_ineq_txt(ah, bh)} ; 0 en otro caso",
                f"(1) Sustituir t→t−τ:  h{n}(t−τ) = {T(eh_tt)}   con   {_ineq_txt(ah, bh, 't−τ')}",
                f"(2) Restar t:  {T(ah - t)} ≤ −τ ≤ {T(bh - t)}",
                f"(3) Multiplicar por −1 (se invierten):  {T(t - bh)} ≤ τ ≤ {T(t - ah)}",
                f"OK  h{n}(t−τ) = {T(eh_tt)}   si   {T(t - bh)} ≤ τ ≤ {T(t - ah)} ; 0 en otro caso",
            ]
        elif fin_a and not fin_b:  # [ah, oo)
            sub1 = rf"{latex(ah)} \le t-\tau"
            sub2 = rf"{latex(ah - t)} \le -\tau"
            sub3 = rf"\tau \le {latex(t - ah)}"
            final = rf"h_{{{n}}}(t-\tau) = \begin{{cases}} {latex(eh_tt)}, & \tau \le {latex(t-ah)} \\ 0, & \tau > {latex(t-ah)} \end{{cases}}"
            txt = [
                f"h{n}(t) = {T(eh)}   si   {_ineq_txt(ah, bh)} ; 0 en otro caso",
                f"(1) Sustituir t→t−τ:  h{n}(t−τ) = {T(eh_tt)}   con   {_ineq_txt(ah, bh, 't−τ')}",
                f"(2) Restar t:  {T(ah - t)} ≤ −τ",
                f"(3) Multiplicar por −1 (se invierte):  τ ≤ {T(t - ah)}",
                f"OK  h{n}(t−τ) = {T(eh_tt)}   si   τ ≤ {T(t - ah)} ; 0 si τ > {T(t - ah)}",
            ]
        elif not fin_a and fin_b:  # (-oo, bh]
            sub1 = rf"t-\tau \le {latex(bh)}"
            sub2 = rf"-\tau \le {latex(bh - t)}"
            sub3 = rf"\tau \ge {latex(t - bh)}"
            final = rf"h_{{{n}}}(t-\tau) = \begin{{cases}} {latex(eh_tt)}, & \tau \ge {latex(t-bh)} \\ 0, & \tau < {latex(t-bh)} \end{{cases}}"
            txt = [
                f"h{n}(t) = {T(eh)}   si   {_ineq_txt(ah, bh)} ; 0 en otro caso",
                f"(1) Sustituir t→t−τ:  h{n}(t−τ) = {T(eh_tt)}   con   {_ineq_txt(ah, bh, 't−τ')}",
                f"(2) Restar t:  −τ ≤ {T(bh - t)}",
                f"(3) Multiplicar por −1 (se invierte):  τ ≥ {T(t - bh)}",
                f"OK  h{n}(t−τ) = {T(eh_tt)}   si   τ ≥ {T(t - bh)} ; 0 si τ < {T(t - bh)}",
            ]
        else:
            sub1 = r"-\infty < t-\tau < +\infty"
            sub2 = r"-\infty < \tau < +\infty"
            sub3 = r"-\infty < \tau < +\infty"
            final = rf"h_{{{n}}}(t-\tau) = {latex(eh_tt)}\ \forall \tau"
            txt = [
                f"h{n}(t) = {T(eh)}   para todo t",
                f"OK  h{n}(t−τ) = {T(eh_tt)}   para todo τ (el reflejo/desplazamiento no cambia el soporte)",
            ]
        pasos.append({
            'original': tramo_cases_latex(rf"h_{{{n}}}(t)", eh, ah, bh, t),
            'sustituir': rf"h_{{{n}}}(t-\tau) = {latex(eh_tt)}, \quad {sub1}",
            'restar_t': sub2,
            'mult_menos1': sub3,
            'final': final,
            'txt': txt,
        })
    return pasos


def paso2_x(x_segs):
    pasos = []
    for j, s in enumerate(x_segs):
        ax, bx, ex = s['a'], s['b'], s['expr']
        ex_tau = sp.simplify(ex.subs(t, tau))
        n = j + 1
        todo_r = (ax == -sp.oo and bx == sp.oo)
        cola = '' if todo_r else ' ; 0 en otro caso'
        pasos.append({
            'original': tramo_cases_latex(rf"x_{{{n}}}(t)", ex, ax, bx, t),
            'sustituir': rf"x_{{{n}}}(\tau) = {latex(ex_tau)}, \quad {cond_var_latex(tau, ax, bx)}",
            'final': tramo_cases_latex(rf"x_{{{n}}}(\tau)", ex_tau, ax, bx, tau),
            'txt': [
                f"x{n}(t) = {_txt_expr(ex)}   si   {_soporte_txt(ax, bx)}{cola}",
                f"(1) Cambio de variable t→τ:  x{n}(τ) = {_txt_expr(ex_tau)}   con   {_soporte_txt(ax, bx, 'τ')}",
                f"OK  x{n}(τ) = {_txt_expr(ex_tau)}   si   {_soporte_txt(ax, bx, 'τ')}{cola}",
            ],
        })
    return pasos


def critical_points(x_segs, h_segs):
    cand = set()
    for xs in x_segs:
        for hs in h_segs:
            for s1, n1 in [(xs['a'], xs['a_num']), (xs['b'], xs['b_num'])]:
                for s2, n2 in [(hs['a'], hs['a_num']), (hs['b'], hs['b_num'])]:
                    # Solo bordes finitos reales; ignora ±inf y nan simbólico
                    if not math.isfinite(n1) or not math.isfinite(n2):
                        continue
                    try:
                        cand.add(float((s1 + s2).evalf()))
                    except Exception:
                        continue
    return sorted(c for c in cand if math.isfinite(c))


def overlaps_for_t(x_segs, h_segs, tmid):
    """Para un t numérico, devuelve lista de solapes (i,j,low_num,high_num,low_sym,high_sym)."""
    ov = []
    for i, xs in enumerate(x_segs):
        for j, hs in enumerate(h_segs):
            axn, bxn = xs['a_num'], xs['b_num']
            ahn, bhn = hs['a_num'], hs['b_num']
            lo_cand_x = axn
            lo_cand_h = tmid - bhn if math.isfinite(bhn) else float('-inf')
            hi_cand_x = bxn
            hi_cand_h = tmid - ahn if math.isfinite(ahn) else float('inf')
            lo = max(lo_cand_x, lo_cand_h)
            hi = min(hi_cand_x, hi_cand_h)
            if lo < hi - 1e-12:
                # expresiones simbólicas de low/high
                if lo_cand_x >= lo_cand_h - 1e-12:
                    low_sym = xs['a']
                else:
                    low_sym = t - hs['b']
                if hi_cand_x <= hi_cand_h + 1e-12:
                    high_sym = xs['b']
                else:
                    high_sym = t - hs['a']
                ov.append({'i': i, 'j': j, 'low_num': lo, 'high_num': hi,
                           'low_sym': low_sym, 'high_sym': high_sym})
    return ov


def _procedimiento_txt(x_segs, h_segs, p1, p2, crit, regiones):
    """Procedimiento en texto plano (unicode), listo para copiar al cuaderno:
    solo matemática, una línea por paso, sin explicaciones."""
    L = []
    ap = L.append
    ap('y(t) = x(t) ∗ h(t) = ∫ x(τ)·h(t−τ) dτ')
    ap('')
    ap('x(t) = ' + _segs_txt(x_segs))
    ap('h(t) = ' + _segs_txt(h_segs))
    ap('')
    for p in p1:
        ap(p['txt'][-1].replace('OK  ', ''))
    for p in p2:
        ap(p['txt'][-1].replace('OK  ', ''))
    # BUG-15: sin críticos no se inventa t_c = {0}; se dice que hay un único
    # intervalo (los críticos son sumas de bordes finitos; si no hay, la recta
    # de t no se divide).
    if crit:
        ap('t_c = {' + ', '.join(_txt_num(c) for c in crit) + '}')
        ap('y(t) inicia en t = ' + _txt_num(min(crit)))
    else:
        ap('No hay puntos críticos (no hay bordes finitos que sumar): un único intervalo de t')
    ap('')
    hay_divergencia = False
    for r in regiones:
        if not r['hay_solape']:
            if r.get('cero_txt'):
                ap(f"y(t) = {r['cero_txt']} = 0   si   {r['cond_txt']}")
            else:
                ap(f"y(t) = 0   si   {r['cond_txt']}")
            continue
        if r.get('diverge'):
            hay_divergencia = True
            for g in r['integrales']:
                if g.get('cero'):
                    ap(f"y(t) = ∫[{g['low_txt']} → {g['high_txt']}] (0)·({g['h_shift_txt']}) dτ = 0")
                    continue
                ap(f"y(t) = ∫[{g['low_txt']} → {g['high_txt']}] ({g['x_tau_txt']})·({g['h_shift_txt']}) dτ")
                ap(f"     = ∫[{g['low_txt']} → {g['high_txt']}] {g['integrando_txt']} dτ")
                ap(f"     = {g['valor_txt']}   ← NO converge")
            ap(f"⇒ y(t) = no converge   si   {r['cond_txt']}")
            ap('')
            continue
        for g in r['integrales']:
            if g.get('cero'):
                ap(f"y(t) = ∫[{g['low_txt']} → {g['high_txt']}] (0)·({g['h_shift_txt']}) dτ = 0")
                continue
            ap(f"y(t) = ∫[{g['low_txt']} → {g['high_txt']}] ({g['x_tau_txt']})·({g['h_shift_txt']}) dτ")
            ap(f"     = ∫[{g['low_txt']} → {g['high_txt']}] {g['integrando_txt']} dτ")
            ap(f"     F(τ) = {g['primitiva_txt']}")
            ap(f"     = ({g['Fsup_txt']}) − ({g['Finf_txt']}) = {g['valor_txt']}")
        ap(f"⇒ y(t) = {r['resultado_txt']}   si   {r['cond_txt']}")
        ap('')
    if hay_divergencia:
        ap('⚠ La integral de convolución no converge: revisa los tramos (hay una cola infinita donde el integrando no decae a 0).')
    ap('y(t) = { ' + ' ;  '.join(
        f"{r['resultado_txt']}  si  {r['cond_txt']}" for r in regiones) + ' }')
    return '\n'.join(L)


def _num_to_sym(v):
    """Punto crítico float -> sympy bonito para límites (4.0 -> 4, 2.5 -> 5/2)."""
    try:
        return sp.nsimplify(v, rational=True)
    except Exception:
        return sp.Float(v)


# ------------------------------------------------- convergencia (BUG-15)
# El método de la guía (Lección 3) evalúa ∫ x(τ)·h(t−τ) dτ con límites que
# pueden ser infinitos; si la cola no decae, la integral NO converge y no
# debe presentarse un valor (ni ∞) como si fuera la respuesta por tramos.
def _es_divergente(val):
    """True si el valor de la integral salió ±oo / zoo / nan / Acotado
    (AccumBounds de integrales oscilatorias): no converge."""
    if val is None:
        return True
    if isinstance(val, sp.AccumBounds):
        return True
    try:
        if val.has(sp.oo) or val.has(-sp.oo) or val.has(sp.zoo) or val.has(sp.nan):
            return True
        if val.is_number:
            return not bool(val.is_finite)
    except Exception:
        return True
    return False


def _valor_divergente_txt(val):
    """Texto plano del valor de una integral que no converge ('∞', '-∞', ...)."""
    if val == sp.oo:
        return '+∞'
    if val == -sp.oo:
        return '-∞'
    return 'no converge'


def _valor_divergente_latex(val):
    if val == sp.oo:
        return r'+\infty'
    if val == -sp.oo:
        return r'-\infty'
    return r'\text{no converge}'


def _causa_divergencia(low_sym, high_sym, integrando):
    """Explica por qué no converge la integral con esos límites: qué lado
    infinito falla y a qué tiende el integrando en esa cola."""
    lados = []
    if high_sym == sp.oo:
        lados.append(('+∞', sp.S.Infinity))
    if low_sym == -sp.oo:
        lados.append(('−∞', sp.S.NegativeInfinity))
    frases = []
    for lado, dir_lim in lados:
        try:
            lim = sp.limit(integrando, tau, dir_lim)
        except Exception:
            lim = None
        if lim is None or (not lim.is_number and not isinstance(lim, sp.AccumBounds)):
            frases.append(f'el área acumulada hacia τ→{lado} no es finita')
        elif lim == 0:
            frases.append(f'el integrando tiende a 0 hacia τ→{lado} pero el área acumulada no es finita')
        elif isinstance(lim, sp.AccumBounds):
            frases.append(f'el integrando oscila sin definirse cuando τ→{lado}')
        else:
            frases.append(f'el integrando tiende a {_txt_expr(lim)} (≠ 0) cuando τ→{lado}')
    return '; '.join(frases) if frases else 'el intervalo de integración es infinito y el área no es finita'


def _aviso_divergencia(low_sym, high_sym, integrando):
    """Aviso completo (texto plano) para una región cuya integral diverge:
    causa + exigencia del método (Lección 3) + pista sobre los tramos."""
    causa = _causa_divergencia(low_sym, high_sym, integrando)
    return ('La integral de convolución NO converge con estos tramos: ' + causa + '. '
            'El método de la guía exige que x(τ)·h(t−τ) se anule (o decaiga a 0) '
            'en la cola infinita del intervalo de integración. Revisa los límites A/B '
            'de los tramos: una señal como f(t)·u(t) se separa en el tramo '
            '«desde 0 hasta ∞», no «desde −∞» (usa «Separar en tramos»).')


def solve_convolution_from_segs(x_segs, h_segs):
    p1 = paso1_h(h_segs)
    p2 = paso2_x(x_segs)
    crit = critical_points(x_segs, h_segs)
    if len(crit) == 0:
        # caso totalmente infinito (raro): un solo intervalo
        bounds = [float('-inf'), float('inf')]
    else:
        bounds = [float('-inf')] + crit + [float('inf')]
    regiones = []
    for k in range(len(bounds) - 1):
        lo, hi = bounds[k], bounds[k + 1]
        # punto de prueba
        if lo == float('-inf') and hi == float('inf'):
            tmid = 0.0
        elif lo == float('-inf'):
            tmid = hi - 1.0
        elif hi == float('inf'):
            tmid = lo + 1.0
        else:
            tmid = (lo + hi) / 2.0
            if hi - lo < 1e-9:
                continue
        ov = overlaps_for_t(x_segs, h_segs, tmid)
        ultimo = (k == len(bounds) - 2)
        cond = intervalo_t_latex(lo, hi, primero=(k == 0), ultimo=ultimo)
        if not ov:
            # Como en los apuntes (Lección 3, ej. 2, p.23): el tramo sin solape
            # no queda como un simple «y=0», se muestra la integral con la
            # señal en cero — (0)·(h) al inicio (x aún no empieza) y (0)·(h)
            # al final (x ya se apagó).
            cero_latex = cero_txt = ''
            if h_segs:
                h1 = latex(h_segs[0]['expr'].subs(t, t - tau))
                h1_txt = _txt_expr(h_segs[0]['expr'].subs(t, t - tau))
                if k == 0:
                    cero_latex = rf'y(t)=\int_{{-\infty}}^{{t}}\left(0\right)\!\left({h1}\right)d\tau=0'
                    cero_txt = f'∫[−∞ → t] (0)·({h1_txt}) dτ'
                elif k == len(bounds) - 2:
                    cero_latex = rf'y(t)=\int_{{t}}^{{\infty}}\left(0\right)\!\left({h1}\right)d\tau=0'
                    cero_txt = f'∫[t → ∞] (0)·({h1_txt}) dτ'
            regiones.append({
                'k': k, 't_lo': lo, 't_hi': hi, 'cond_latex': cond,
                'cond_txt': _cond_txt(lo, hi, ultimo),
                'hay_solape': False,
                'explicacion': r'En este intervalo \(x(\tau)\) y \(h(t-\tau)\) no se solapan: el producto es \(0\) en todo \(\tau\).',
                'cero_latex': cero_latex, 'cero_txt': cero_txt,
                'integrales': [],
                'resultado': sp.Integer(0),
                'resultado_latex': '0',
                'resultado_txt': '0',
            })
            continue
        integrales = []
        total = sp.Integer(0)
        vistos_cero = set()
        region_diverge = False
        aviso_region = ''
        for o in ov:
            i, j = o['i'], o['j']
            xs, hs = x_segs[i], h_segs[j]
            xe = xs['expr'].subs(t, tau)
            he = hs['expr'].subs(t, t - tau)
            # OPT-1: expand (barato) en vez de simplify (costoso) en intermedios
            integrando = sp.expand(xe * he)
            # Como en los apuntes (Lección 3, p.30-31): cuando la ventana móvil
            # ya se salió por la derecha del último tramo de x, esa parte de la
            # integral entrante vale 0 y se escribe explícita: ∫ (0)·(h) dτ = 0.
            if (i == len(x_segs) - 1 and math.isfinite(hs['a_num'])
                    and math.isfinite(xs['b_num'])
                    and tmid - hs['a_num'] > xs['b_num'] + 1e-9):
                lo_z, hi_z = xs['b'], t - hs['a']
                clave = (str(lo_z), str(hi_z))
                if clave not in vistos_cero:
                    vistos_cero.add(clave)
                    integrales.append({
                        'par': f"x{i+1}*h{j+1}",
                        'cero': True,
                        'low_latex': latex(lo_z), 'high_latex': latex(hi_z),
                        'h_shift_latex': latex(he),
                        'low_txt': _txt_expr(lo_z), 'high_txt': _txt_expr(hi_z),
                        'h_shift_txt': _txt_expr(he),
                    })
            # primitiva (una sola vez por par; se reutiliza en cada parte)
            try:
                F = sp.integrate(integrando, tau)
                if isinstance(F, sp.Integral):
                    F = sp.simplify(F.doit())
            except Exception:
                F = sp.Integral(integrando, tau)
            # Como en la guía: el solape se parte en los puntos críticos
            # interiores (integral saliente = lo que va dejando el borde,
            # integral entrante = la parte nueva). Orden descendente: la
            # entrante (borde derecho) primero, la saliente al final.
            cortes = [c for c in crit
                      if o['low_num'] + 1e-9 < c < o['high_num'] - 1e-9]
            bordes = [o['low_num']] + cortes + [o['high_num']]
            partes = [(bordes[k], bordes[k + 1]) for k in range(len(bordes) - 1)]
            partes.reverse()
            for p, (slo_num, shi_num) in enumerate(partes):
                low_sym = o['low_sym'] if abs(slo_num - o['low_num']) < 1e-9 else _num_to_sym(slo_num)
                high_sym = o['high_sym'] if abs(shi_num - o['high_num']) < 1e-9 else _num_to_sym(shi_num)
                try:
                    val = sp.cancel(F.subs(tau, high_sym) - F.subs(tau, low_sym))
                except Exception:
                    try:
                        val = sp.simplify(sp.integrate(integrando, (tau, low_sym, high_sym)))
                    except Exception:
                        val = sp.nan
                # BUG-15: con límite infinito la integral puede NO converger
                # (cola que no decae a 0): se detecta y se reporta en vez de
                # aceptar ±∞ como si fuera la respuesta.
                diverge_parte = _es_divergente(val)
                if diverge_parte:
                    region_diverge = True
                    aviso_region = _aviso_divergencia(low_sym, high_sym, integrando)
                    valor_latex_g = _valor_divergente_latex(val)
                    valor_txt_g = _valor_divergente_txt(val)
                else:
                    valor_latex_g = latex(sp.simplify(val))
                    valor_txt_g = _txt_expr(val)
                    total = sp.expand(total + val)
                # Procedimiento por intervalo (como en clase): regla, primitiva,
                # evaluar arriba y abajo por separado y restar (TFC).
                try:
                    F_upper = sp.simplify(F.subs(tau, high_sym))
                except Exception:
                    F_upper = F.subs(tau, high_sym)
                try:
                    F_lower = sp.simplify(F.subs(tau, low_sym))
                except Exception:
                    F_lower = F.subs(tau, low_sym)
                integrales.append({
                    'par': f"x{i+1}*h{j+1}",
                    'par_latex': rf"x_{{{i+1}}}(\tau)\cdot h_{{{j+1}}}(t-\tau)",
                    # factores como se plantean en el PDF: (x_i(τ))·(h_j(t−τ))
                    'x_tau_latex': latex(xe), 'h_shift_latex': latex(he),
                    'low_latex': latex(low_sym), 'high_latex': latex(high_sym),
                    'integrando_latex': latex(integrando),
                    'regla_integrando': regla_integrando(integrando, tau),
                    'integrando_txt': _txt_expr(integrando),
                    'primitiva_latex': latex(F) + r' + C',
                    'eval_latex': latex(F) + r'\Big|_{' + latex(low_sym) + r'}^{' + latex(high_sym) + r'} = ' + latex(val),
                    'Fsup_latex': latex(F_upper),
                    'Finf_latex': latex(F_lower),
                    'resta_latex': latex(F_upper) + r' - \left(' + latex(F_lower) + r'\right) = ' + latex(val),
                    'low_str': str(low_sym), 'high_str': str(high_sym),
                    'low_txt': _txt_expr(low_sym), 'high_txt': _txt_expr(high_sym),
                    'x_tau_txt': _txt_expr(xe), 'h_shift_txt': _txt_expr(he),
                    'integrando_str': str(integrando),
                    'primitiva_txt': _txt_expr(F),
                    'Fsup_txt': _txt_expr(F_upper), 'Finf_txt': _txt_expr(F_lower),
                    'valor_txt': valor_txt_g,
                    'valor_latex': valor_latex_g,
                })
        if region_diverge:
            # BUG-15: la región no tiene respuesta numérica. Se marca
            # 'diverge' para que UI/texto digan «no converge» y la gráfica
            # deje un hueco (nan) en vez de dibujar ∞.
            solapes_txt = '; '.join(
                [rf"\(\tau\in[{latex(o['low_sym'])},{latex(o['high_sym'])}]\) (par \(x_{{{o['i']+1}}} \cdot h_{{{o['j']+1}}}\))"
                 for o in ov])
            regiones.append({
                'k': k, 't_lo': lo, 't_hi': hi, 'cond_latex': cond,
                'cond_txt': _cond_txt(lo, hi, ultimo),
                'hay_solape': True,
                'explicacion': (r'Solape en \(\tau\): ' + solapes_txt + '.'),
                'integrales': integrales,
                'diverge': True,
                'aviso_txt': aviso_region,
                'resultado': sp.nan,
                'resultado_latex': r'\text{no converge}',
                'resultado_txt': 'no converge',
            })
            continue
        total = sp.simplify(sp.expand(total))
        solapes_txt = '; '.join(
            [rf"\(\tau\in[{latex(o['low_sym'])},{latex(o['high_sym'])}]\) (par \(x_{{{o['i']+1}}} \cdot h_{{{o['j']+1}}}\))"
             for o in ov])
        regiones.append({
            'k': k, 't_lo': lo, 't_hi': hi, 'cond_latex': cond,
            'cond_txt': _cond_txt(lo, hi, ultimo),
            'hay_solape': True,
            'explicacion': (r'Solape en \(\tau\): ' + solapes_txt + '.'),
            'integrales': integrales,
            'resultado': total,
            'resultado_latex': latex(total),
            'resultado_txt': _txt_expr(total),
        })
    # soporte de y: solo tiene sentido si hay críticos (con regiones que
    # divergen, o sin críticos, no se afirma dónde «inicia» y(t))
    y_ini = min(crit) if crit else None
    # forma con escalones u (se omite si alguna región no converge: escribir
    # (∞)·u(t) o nan·u(t) no es una respuesta)
    esc_parts = []
    for r in regiones:
        if r['hay_solape'] and r['resultado'] != 0 and not r.get('diverge'):
            lo, hi = r['t_lo'], r['t_hi']
            if lo == float('-inf') and hi == float('inf'):
                esc_parts.append(f"({latex(r['resultado'])})")
            elif lo == float('-inf'):
                esc_parts.append(f"({latex(r['resultado'])})\\,[1-u({fmt_u_shift(hi)})]")
            elif hi == float('inf'):
                esc_parts.append(f"({latex(r['resultado'])})\\,[u({fmt_u_shift(lo)})]")
            else:
                esc_parts.append(f"({latex(r['resultado'])})\\,[u({fmt_u_shift(lo)})-u({fmt_u_shift(hi)})]")
    if any(r.get('diverge') for r in regiones):
        y_esc = ''
    elif not esc_parts:
        y_esc = '0'
    else:
        y_esc = ' + '.join(esc_parts)
    tramos = r'\begin{cases} ' + r'\\ '.join(
        [f"{r['resultado_latex']}, & {r['cond_latex']}" for r in regiones]) + r' \end{cases}'
    return {
        'paso1': p1, 'paso2': p2, 'criticos': crit,
        't_inicio': y_ini,
        'regiones': regiones,
        'y_tramos_latex': tramos,
        'y_escalones_latex': y_esc,
        'procedimiento_txt': _procedimiento_txt(x_segs, h_segs, p1, p2, crit, regiones),
        'avisos': [r['aviso_txt'] for r in regiones if r.get('diverge')],
        'x_segs': [{'a': str(s['a']), 'b': str(s['b']), 'expr': str(s['expr'])} for s in x_segs],
        'h_segs': [{'a': str(s['a']), 'b': str(s['b']), 'expr': str(s['expr'])} for s in h_segs],
    }


def _lambdify_cached(seg):
    """OPT-5: compila una vez por segmento y reutiliza (clave por expresión).

    NUEVO-1: la función se compila con la variable simbólica `t`, pero el
    objeto resultante es una función numérica posicional: acepta cualquier
    array (p. ej. `grid` o `t0 - grid` en api_solape). Reutilizarla con
    `arg = t0 - grid` es intencional y correcto, no un alias accidental.
    """
    key = str(seg['expr'])
    fn = _lambdify_cached.cache.get(key)
    if fn is None:
        fn = sp.lambdify(t, seg['expr'], modules=['numpy'])
        if len(_lambdify_cached.cache) > 500:
            _lambdify_cached.cache.clear()
        _lambdify_cached.cache[key] = fn
    return fn


_lambdify_cached.cache = {}


def eval_piecewise(segs, grid):
    vals = np.zeros_like(grid, dtype=float)
    for s in segs:
        try:
            f = _lambdify_cached(s)
        except Exception:
            continue
        m = np.ones_like(grid, dtype=bool)
        if s['a_num'] != float('-inf'):
            m &= (grid >= s['a_num'] - 1e-12)
        if s['b_num'] != float('inf'):
            m &= (grid <= s['b_num'] + 1e-12)
        try:
            vv = f(grid)
            vv = np.asarray(vv, dtype=float)
            if vv.shape == ():
                vv = np.full_like(grid, float(vv))
            vals[m] = np.nan_to_num(vv[m], nan=0.0, posinf=0.0, neginf=0.0)
        except Exception:
            pass
    return vals


def y_function(regiones):
    fns = []
    for r in regiones:
        if r.get('diverge'):
            # BUG-15: la integral no converge ahí -> hueco (nan) en la gráfica,
            # sin nan_to_num (convertiría el hueco en 0)
            fns.append((r['t_lo'], r['t_hi'], None))
            continue
        try:
            f = sp.lambdify(t, r['resultado'], modules=['numpy'])
        except Exception:
            f = lambda tt: 0.0
        fns.append((r['t_lo'], r['t_hi'], f))
    def f(t0):
        t0 = np.asarray(t0, dtype=float)
        out = np.zeros_like(t0, dtype=float)
        covered = np.zeros_like(t0, dtype=bool)
        for lo, hi, fn in fns:
            m = (t0 >= lo - 1e-12) & (t0 < hi - 1e-12)
            if hi == float('inf') and lo != float('-inf'):
                m = (t0 >= lo - 1e-12)
            # incluir borde final del último intervalo
            try:
                if fn is None:
                    out[m] = np.nan
                    covered |= m
                    continue
                v = fn(t0[m])
                v = np.asarray(v, dtype=float)
                if v.shape == ():
                    v = np.full_like(t0[m], float(v))
                out[m] = np.nan_to_num(v, nan=0.0, posinf=0.0, neginf=0.0)
                covered |= m
            except Exception:
                pass
        # DESIGN-5: puntos exactos de borde (t0 == hi finito) que quedaron
        # fuera de ambas máscaras se evalúan con su región cerrada
        missing = ~covered
        if np.any(missing):
            for lo, hi, fn in fns:
                if hi == float('inf'):
                    continue
                edge = missing & (np.abs(t0 - hi) <= 1e-9)
                if np.any(edge):
                    try:
                        v = np.asarray(fn(t0[edge]), dtype=float)
                        if v.shape == ():
                            v = np.full_like(t0[edge], float(v))
                        out[edge] = np.nan_to_num(v, nan=0.0, posinf=0.0, neginf=0.0)
                        missing &= ~edge
                    except Exception:
                        pass
        return out
    return f


# ------------------------------------------------- motor de integrales
def regla_integrando(f, var):
    f = sp.simplify(f)
    txt = []
    if f.is_polynomial(var):
        deg = sp.Poly(f, var).degree()
        txt.append(f"Polinomio de grado {deg}: se aplica linealidad + regla de la potencia \\(\\int \\tau^n d\\tau = \\tau^{{n+1}}/(n+1)\\) término a término.")
    elif f.has(sp.exp):
        txt.append(r"Contiene exponencial: \(\int e^{k\tau}d\tau = e^{k\tau}/k\). Si hay producto polinomio×exponencial se usa integración por partes repetida (o tabular).")
    elif f.has(sp.sin, sp.cos):
        txt.append(r"Contiene seno/coseno: \(\int \sin(k\tau)d\tau=-\cos(k\tau)/k\), \(\int \cos(k\tau)d\tau=\sin(k\tau)/k\).")
    elif f.is_Mul:
        txt.append("Producto de funciones: se expande/simplifica primero; si queda polinomio×exponencial o ×trig se integra por partes.")
    elif f.is_Add:
        txt.append("Suma de términos: linealidad \\(\\int (f+g) = \\int f + \\int g\\).")
    else:
        txt.append("Se busca primitiva directa con reglas básicas (potencia, exponencial, trigonométricas) y sustitución si hace falta.")
    return ' '.join(txt)


# (caché de integrales definida junto a solve_integral: _integral_cache)


def solve_integral(expr_str, a_str=None, b_str=None, var_name='tau'):
    if var_name == 't':
        var = t
    elif var_name in ['tau', 'taux', '\\tau']:
        var = tau
    else:
        var = sp.symbols(var_name, real=True)
    # permitir que el usuario escriba en t o tau indistintamente
    f = parse_expr(expr_str, var)
    # si escribió 't' pero var es tau, sustituir
    if var == tau and f.has(t) and not f.has(tau):
        f = f.subs(t, tau)
    f_simp = sp.simplify(f)
    f_exp = sp.expand(f_simp)
    pasos = []
    pasos.append({'titulo': '1. Integrando original', 'latex': latex(f),
                  'detalle': 'Se transcribe el integrando tal como se plantea en la convolución.'})
    if f_exp != f_simp:
        pasos.append({'titulo': '2. Simplificar / expandir (sin saltarse nada)',
                      'latex': latex(f_exp),
                      'detalle': 'Se expande el producto y se agrupan términos semejantes antes de integrar.'})
    else:
        pasos.append({'titulo': '2. Simplificar (sin saltarse nada)', 'latex': latex(f_simp),
                      'detalle': 'El integrando ya está simplificado; no hay términos que expandir.'})
    pasos.append({'titulo': '3. Regla a usar', 'latex': latex(f_exp),
                  'detalle': regla_integrando(f_exp, var)})
    try:
        F = sp.integrate(f_exp, var)
    except Exception as e:
        raise ValueError(f"No se pudo integrar: {e}")
    pasos.append({'titulo': '4. Primitiva F (integral indefinida)',
                  'latex': r'F(' + latex(var) + r') = ' + latex(F) + r' + C',
                  'detalle': 'Se integra término a término mostrando la antiderivada. Verificación: dF/dτ debe dar el integrando.'})
    # verificación dF/dτ == f (BUG-4/DESIGN-7: sin `dir()`, `ok` sí se reporta)
    ver_str, ok = '?', None
    try:
        ver = sp.simplify(sp.diff(F, var) - f_exp)
        ok = bool(ver == 0)
        ver_str = str(ver)
    except Exception:
        pass
    resp = {'pasos': pasos, 'primitiva_latex': latex(F),
            'verificacion_cero': ver_str, 'verificada': ok,
            'es_definida': False}
    if a_str is not None and b_str is not None and str(a_str).strip() != '' and str(b_str).strip() != '':
        aa = parse_bound(a_str)
        bb = parse_bound(b_str)
        # permitir límites con t (ej. 0 y t): parsear con t (BUG-5: nombres claros)
        try:
            F_upper = sp.simplify(F.subs(var, bb))   # F(b): límite superior
            F_lower = sp.simplify(F.subs(var, aa))   # F(a): límite inferior
        except Exception:
            F_upper, F_lower = F.subs(var, bb), F.subs(var, aa)
        val = sp.simplify(F_upper - F_lower)
        pasos.append({'titulo': '5. Evaluar en el límite superior', 'latex': r'F(' + latex(bb) + r') = ' + latex(F_upper),
                      'detalle': f"Se sustituye \\({latex(var)} = {latex(bb)}\\) en la primitiva."})
        pasos.append({'titulo': '6. Evaluar en el límite inferior', 'latex': r'F(' + latex(aa) + r') = ' + latex(F_lower),
                      'detalle': f"Se sustituye \\({latex(var)} = {latex(aa)}\\) en la primitiva."})
        pasos.append({'titulo': '7. Restar (Teorema Fundamental del Cálculo)',
                      'latex': latex(F_upper) + r' - \left(' + latex(F_lower) + r'\right) = ' + latex(val),
                      'detalle': 'Integral definida = F(superior) − F(inferior). Se simplifica sin omitir operaciones.'})
        # BUG-12: solo incluir valor_num si es finito; inf/-inf serializado a
        # JSON como 'Infinity' es JSON inválido y rompe JSON.parse del navegador
        num = None
        if not val.has(t):
            try:
                if val.is_number and val.is_finite:
                    num = float(val.evalf())
            except Exception:
                num = None
        resp.update({'es_definida': True, 'a_latex': latex(aa), 'b_latex': latex(bb),
                     'Fa_latex': latex(F_upper), 'Fb_latex': latex(F_lower),
                     'valor_latex': latex(val), 'valor_num': num,
                     'pasos': pasos})
    return resp


# BUG-3: caché real para integrales (antes `defPasosCache` muerto)
# NUEVO-2: la clave incluye la versión del contexto de parseo (FUNCS). FUNCS es
# constante del módulo y no cambia en ejecución local single-process; la versión
# protege contra resultados obsoletos si a futuro se amplía FUNCS o se usa en tests.
_FUNCS_VERSION = 1
_integral_cache = {}
_INTEGRAL_CACHE_MAX = 200


def clear_integral_cache():
    """Invalida la caché de integrales (útil en tests o si cambia FUNCS)."""
    _integral_cache.clear()


def solve_integral_cached(expr_str, a_str=None, b_str=None, var_name='tau'):
    key = (str(expr_str), str(a_str or ''), str(b_str or ''), str(var_name), _FUNCS_VERSION)
    if key in _integral_cache:
        return _integral_cache[key]
    sol = solve_integral(expr_str, a_str, b_str, var_name)
    if len(_integral_cache) >= _INTEGRAL_CACHE_MAX:
        _integral_cache.pop(next(iter(_integral_cache)))
    _integral_cache[key] = sol
    return sol


# ---------------------------------------------------------------- rutas
@app.route('/')
def index():
    return render_template('index.html', presets=PRESETS)


@app.route('/api/presets')
def api_presets():
    return jsonify(PRESETS)


@app.route('/api/preview', methods=['POST'])
def api_preview():
    """Vista previa LaTeX de una expresión y sus límites. No calcula nada."""
    try:
        data = request.get_json(force=True)
        expr = data.get('expr', '')
        a = data.get('a', '0')
        b = data.get('b', 'oo')
        var_name = data.get('var', 't')
        var = t if var_name == 't' else tau
        ex = parse_expr(expr, var)
        aa = parse_bound(a)
        bb = parse_bound(b)
        tramo = tramo_cases_latex('f', ex, aa, bb, var)
        return jsonify({'ok': True, 'latex': latex(ex), 'tramo_latex': tramo,
                        'normalizada': str(ex),
                        'sugerencia': '' if str(ex).strip() else 'Escribe una fórmula, ej: 5*exp(-3*t)'})
    except Exception as e:
        return jsonify({'ok': False, 'error': str(e)}), 400


@app.route('/api/descomponer', methods=['POST'])
def api_descomponer():
    """De una señal con escalones (ej. 3*exp(-2*t)*u(t)) saca los tramos.

    Devuelve segmentos {a, b, expr} listos para cargar en el editor y
    resolver la convolución con el flujo normal de 5 pasos.
    """
    try:
        data = request.get_json(force=True)
        expr = data.get('expr', '')
        if not str(expr).strip():
            raise ValueError('Escribe la señal completa, ej: 3*exp(-2*t)*u(t)')
        var_name = data.get('var', 't')
        var = t if var_name == 't' else tau
        segs = split_by_heaviside(expr, var_name)
        if not segs:
            raise ValueError('La señal es cero en todas partes: revisa los escalones.')
        out = []
        for s in segs:
            ex = parse_expr(s['expr'], var)
            aa = parse_bound(s['a'])
            bb = parse_bound(s['b'])
        out.append({
            'a': s['a'], 'b': s['b'], 'expr': s['expr'],
            'latex': latex(ex),
            'tramo_latex': tramo_cases_latex(
                rf"x({latex(var)})", ex, aa, bb, var),
        })
        return jsonify({'ok': True, 'segs': out, 'n': len(out)})
    except Exception as e:
        if not isinstance(e, ValueError):
            traceback.print_exc()
        return jsonify({'ok': False, 'error': str(e)}), 400


@app.route('/api/convolve', methods=['POST'])
def api_convolve():
    try:
        data = request.get_json(force=True)
        x_raw = data.get('x')
        h_raw = data.get('h')
        if isinstance(x_raw, dict) and 'segs' in x_raw:
            x_raw = x_raw['segs']
        if isinstance(h_raw, dict) and 'segs' in h_raw:
            h_raw = h_raw['segs']
        # permitir formato simple: {"x": "exp(-2*t)", "xa":0,"xb":"oo",...}? normalizar
        if isinstance(x_raw, str):
            x_raw = [{'a': data.get('xa', '0'), 'b': data.get('xb', 'oo'), 'expr': x_raw}]
        if isinstance(h_raw, str):
            h_raw = [{'a': data.get('ha', '0'), 'b': data.get('hb', 'oo'), 'expr': h_raw}]
        # OPT-2: construir una sola vez y reutilizar en motor + gráficas
        x_segs = build_segments(x_raw, t)
        h_segs = build_segments(h_raw, t)
        sol = solve_convolution_from_segs(x_segs, h_segs)
        # muestras para gráficas (DESIGN-4: rango desde soportes + críticos)
        crit = sol['criticos']
        finite_bounds = [v for s in x_segs + h_segs for v in (s['a_num'], s['b_num'])
                         if math.isfinite(v)]
        finite_bounds += [c for c in crit if math.isfinite(c)]
        if finite_bounds:
            lo = min(finite_bounds) - 2.0
            hi = max(finite_bounds) + 2.0
            # si hay colas infinitas (exponenciales), ampliar para ver el decaimiento
            if any(abs(r['t_lo']) == float('inf') or abs(r['t_hi']) == float('inf') for r in sol['regiones']):
                hi = max(hi, (max(finite_bounds)) + 4.0)
        else:
            lo, hi = -5.0, 5.0
        # OPT-3/OPT-4: un solo array numpy, un solo alias; a lista solo para JSON
        g = np.linspace(lo, hi, 600)
        xv = eval_piecewise(x_segs, g)
        hv = eval_piecewise(h_segs, g)
        yf = y_function(sol['regiones'])
        yv = yf(g)
        # BUG-15: nan/±oo (regiones que no convergen) -> null para que el JSON
        # sea válido y Plotly dibuje un hueco (ver BUG-12)
        yv = [None if not math.isfinite(v) else v for v in np.asarray(yv, dtype=float).tolist()]
        # convertir regiones (sympy -> str)
        regs = []
        for r in sol['regiones']:
            regs.append({
                't_lo': None if abs(r['t_lo']) == float('inf') else r['t_lo'],
                't_hi': None if abs(r['t_hi']) == float('inf') else r['t_hi'],
                't_lo_str': '-∞' if r['t_lo'] == float('-inf') else (('+∞' if r['t_lo'] == float('inf') else fmt_num(r['t_lo']))),
                't_hi_str': '+∞' if r['t_hi'] == float('inf') else (('-∞' if r['t_hi'] == float('-inf') else fmt_num(r['t_hi']))),
                'cond_latex': r['cond_latex'],
                'cond_txt': r['cond_txt'],
                'hay_solape': r['hay_solape'],
                'explicacion': r['explicacion'],
                'cero_latex': r.get('cero_latex', ''),
                'integrales': r['integrales'],
                'diverge': bool(r.get('diverge', False)),
                'aviso_txt': r.get('aviso_txt', ''),
                'resultado_latex': r['resultado_latex'],
                'resultado_txt': r['resultado_txt'],
            })
        return jsonify({'ok': True, 'paso1': sol['paso1'], 'paso2': sol['paso2'],
                        'criticos': crit, 't_inicio': sol['t_inicio'],
                        'regiones': regs, 'y_tramos_latex': sol['y_tramos_latex'],
                        'y_escalones_latex': sol['y_escalones_latex'],
                        'procedimiento_txt': sol['procedimiento_txt'],
                        'avisos': sol.get('avisos', []),
                        'criterio': criterio_fija(x_segs, h_segs),
                        'grid': g.tolist(), 'x_vals': xv.tolist(), 'h_vals': hv.tolist(), 'y_vals': yv})
    except Exception as e:
        from werkzeug.exceptions import RequestEntityTooLarge
        if isinstance(e, RequestEntityTooLarge):
            raise  # deja que el errorhandler 413 responda JSON
        if not isinstance(e, ValueError):
            traceback.print_exc()  # errores de usuario (ValueError) no ensucian el log
        return jsonify({'ok': False, 'error': str(e)}), 400


@app.route('/api/integral', methods=['POST'])
def api_integral():
    try:
        data = request.get_json(force=True)
        sol = solve_integral_cached(data.get('expr', '0'), data.get('a', ''), data.get('b', ''), data.get('var', 'tau'))
        return jsonify({'ok': True, **sol})
    except Exception as e:
        from werkzeug.exceptions import RequestEntityTooLarge
        if isinstance(e, RequestEntityTooLarge):
            raise  # deja que el errorhandler 413 responda JSON
        if not isinstance(e, ValueError):
            traceback.print_exc()
        return jsonify({'ok': False, 'error': str(e)}), 400


@app.route('/api/solape', methods=['POST'])
def api_solape():
    try:
        data = request.get_json(force=True)
        t0 = float(data.get('t0', 0))
        if not math.isfinite(t0):
            # un t0 nan/inf envenena todo el grid; error amable en su lugar
            raise ValueError('t0 debe ser un número finito.')
        x_raw = data.get('x')
        h_raw = data.get('h')
        x_segs = build_segments(x_raw, t)
        h_segs = build_segments(h_raw, t)
        # rango tau (solo bordes finitos; ignora ±inf y nan)
        xs_a = min([s['a_num'] for s in x_segs if math.isfinite(s['a_num'])], default=t0 - 5)
        xs_b = max([s['b_num'] for s in x_segs if math.isfinite(s['b_num'])], default=t0 + 5)
        # h en tau: [t0-bh, t0-ah]
        hs_lo = min([(t0 - s['b_num']) for s in h_segs if math.isfinite(s['b_num'])], default=t0 - 5)
        hs_hi = max([(t0 - s['a_num']) for s in h_segs if math.isfinite(s['a_num'])], default=t0 + 5)
        lo = min(xs_a, hs_lo) - 1.0
        hi = max(xs_b, hs_hi) + 1.0
        if not np.isfinite(lo):
            lo = t0 - 6
        if not np.isfinite(hi):
            hi = t0 + 6
        grid = np.linspace(lo, hi, 700)
        xv = eval_piecewise(x_segs, grid)
        # h(t0 - tau): evaluar h en (t0 - tau)
        hv = np.zeros_like(grid)
        for s in h_segs:
            try:
                f = _lambdify_cached(s)  # OPT-5: reutiliza compilación
            except Exception:
                continue
            arg = t0 - grid
            m = np.ones_like(grid, dtype=bool)
            if s['a_num'] != float('-inf'):
                m &= (arg >= s['a_num'] - 1e-12)
            if s['b_num'] != float('inf'):
                m &= (arg <= s['b_num'] + 1e-12)
            try:
                vv = np.asarray(f(arg), dtype=float)
                if vv.shape == ():
                    vv = np.full_like(grid, float(vv))
                hv[m] = np.nan_to_num(vv[m], nan=0.0, posinf=0.0, neginf=0.0)
            except Exception:
                pass
        prod = xv * hv
        area = float(_trapz(prod, grid))  # BUG-10: compatible NumPy 1.x y 2.x
        return jsonify({'ok': True, 'tau': grid.tolist(), 'x': xv.tolist(), 'h': hv.tolist(),
                        'prod': prod.tolist(), 'area_trapz': area})
    except Exception as e:
        from werkzeug.exceptions import RequestEntityTooLarge
        if isinstance(e, RequestEntityTooLarge):
            raise  # deja que el errorhandler 413 responda JSON
        if not isinstance(e, ValueError):
            traceback.print_exc()
        return jsonify({'ok': False, 'error': str(e)}), 400


if __name__ == '__main__':
    # DESIGN-2: debug solo con FLASK_DEBUG=1 (el debugger de Werkzeug expone un REPL)
    debug = os.environ.get('FLASK_DEBUG', '0') == '1'
    app.run(host='127.0.0.1', port=5000, debug=debug)
