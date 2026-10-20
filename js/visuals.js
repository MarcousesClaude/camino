// Eigene SVG-Grafiken: Bergpfad einer Lektion, Avatare, Feier-Animationen.
import { h } from './util.js';

const NS = 'http://www.w3.org/2000/svg';
function s(tag, attrs = {}, ...children) {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v !== undefined && v !== null) el.setAttribute(k, v);
  children.flat().forEach(c => c && el.append(c instanceof Node ? c : document.createTextNode(String(c))));
  return el;
}

// 12 Stationen: 0 = Lektionsstart, 1–9 Vokabeln, 10 Grammatik, 11 Lektionstest
export function stationPoints() {
  const pts = [];
  const top = 70, bottom = 560, n = 12;
  for (let i = 0; i < n; i++) {
    const y = bottom - (i * (bottom - top)) / (n - 1);
    const x = 180 + Math.sin(i * 1.15) * 105;
    pts.push({ x: Math.round(x), y: Math.round(y) });
  }
  return pts;
}

function pathD(pts) {
  let d = `M ${pts[0].x} ${pts[0].y}`;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    const my = (a.y + b.y) / 2;
    d += ` C ${a.x} ${my}, ${b.x} ${my}, ${b.x} ${b.y}`;
  }
  return d;
}

export function avatarSvg(initial, color, size = 34) {
  const r = size / 2;
  return s('g', { class: 'avatar' },
    s('circle', { r, fill: color, stroke: '#fff', 'stroke-width': 3 }),
    s('text', { 'text-anchor': 'middle', dy: '0.36em', 'font-size': r * 1.05, 'font-weight': 700, fill: '#fff' }, initial));
}

/**
 * Bergpfad zeichnen.
 * me: { level, initial, color, fromLevel? }  partner: { level, initial, color } | null (nur wenn gleiche Lektion)
 */
export function trailSvg({ me, partner, lessonTitle }) {
  const pts = stationPoints();
  const svg = s('svg', { viewBox: '0 0 360 620', class: 'trail', role: 'img', 'aria-label': `Bergpfad: ${lessonTitle}` });

  // Hintergrund: Gipfel mit Schneekappe, vordere Hügel
  svg.append(
    s('path', { d: 'M -10 400 L 120 150 L 175 210 L 250 60 L 380 330 L 380 640 L -10 640 Z', fill: 'var(--rock-soft)' }),
    s('path', { d: 'M 250 60 L 222 116 L 238 110 L 250 124 L 262 108 L 280 122 Z', fill: '#fff' }),
    s('path', { d: 'M -10 520 Q 90 440 200 500 T 380 470 L 380 640 L -10 640 Z', fill: 'var(--meadow-soft)' }),
  );

  const d = pathD(pts);
  svg.append(s('path', { d, fill: 'none', stroke: 'var(--path)', 'stroke-width': 10, 'stroke-linecap': 'round' }));
  svg.append(s('path', { d, fill: 'none', stroke: '#fff', 'stroke-width': 2, 'stroke-dasharray': '2 10', 'stroke-linecap': 'round' }));

  pts.forEach((p, i) => {
    const done = i < me.level;
    const current = i === me.level;
    const g = s('g', { transform: `translate(${p.x} ${p.y})` });
    if (i === 0) {
      g.append(s('rect', { x: -14, y: -9, width: 28, height: 18, rx: 2, fill: 'var(--sign)' }));
      g.append(s('text', { 'text-anchor': 'middle', dy: '0.35em', 'font-size': 9, 'font-weight': 700, fill: 'var(--ink)' }, 'Start'));
    } else if (i === 11) {
      // Weiss-rot-weisse Bergweg-Markierung als Lektionsziel
      g.append(s('rect', { x: -15, y: -15, width: 30, height: 30, rx: 3, fill: '#fff', stroke: 'var(--ink)', 'stroke-width': 1.5 }));
      g.append(s('rect', { x: -15, y: -5, width: 30, height: 10, fill: 'var(--blaze)' }));
    } else if (i === 10) {
      g.append(s('rect', { x: -11, y: -11, width: 22, height: 22, transform: 'rotate(45)', fill: done ? 'var(--ok)' : '#fff', stroke: current ? 'var(--blaze)' : 'var(--ink)', 'stroke-width': current ? 3 : 1.5 }));
      g.append(s('text', { 'text-anchor': 'middle', dy: '0.35em', 'font-size': 10, 'font-weight': 700, fill: done ? '#fff' : 'var(--ink)' }, 'G'));
    } else {
      g.append(s('circle', { r: 12, fill: done ? 'var(--ok)' : '#fff', stroke: current ? 'var(--blaze)' : 'var(--ink)', 'stroke-width': current ? 3 : 1.5 }));
      g.append(s('text', { 'text-anchor': 'middle', dy: '0.35em', 'font-size': 11, 'font-weight': 700, fill: done ? '#fff' : 'var(--ink)' }, i));
    }
    svg.append(g);
  });

  const place = (who, offset) => {
    const lv = Math.min(who.level, 11);
    const p = pts[lv];
    const g = s('g', { class: 'climber', style: `transform: translate(${p.x + offset}px, ${p.y - 30}px)` }, avatarSvg(who.initial, who.color));
    if (who.fromLevel !== undefined && who.fromLevel !== who.level) {
      const f = pts[Math.min(who.fromLevel, 11)];
      g.setAttribute('style', `transform: translate(${f.x + offset}px, ${f.y - 30}px)`);
      requestAnimationFrame(() => requestAnimationFrame(() => {
        g.style.transform = `translate(${p.x + offset}px, ${p.y - 30}px)`;
      }));
    }
    return g;
  };
  if (partner) svg.append(place(partner, 22));
  svg.append(place(me, partner && partner.level === me.level ? -22 : 0));
  return svg;
}

// ---------- Feier-Animationen ----------

function flagSvg() {
  return s('svg', { viewBox: '0 0 120 120', class: 'celebrate-icon' },
    s('path', { d: 'M 10 110 L 60 30 L 110 110 Z', fill: 'var(--rock)' }),
    s('path', { d: 'M 60 30 L 48 50 L 60 46 L 72 50 Z', fill: '#fff' }),
    s('line', { x1: 60, y1: 30, x2: 60, y2: 4, stroke: 'var(--ink)', 'stroke-width': 3 }),
    s('path', { d: 'M 60 5 L 90 12 L 60 20 Z', fill: 'var(--blaze)', class: 'flag-wave' }));
}
function tentSvg() {
  return s('svg', { viewBox: '0 0 120 120', class: 'celebrate-icon' },
    s('path', { d: 'M 10 100 L 60 25 L 110 100 Z', fill: 'var(--sign)' }),
    s('path', { d: 'M 60 25 L 45 100 L 75 100 Z', fill: 'var(--ink)' }),
    s('line', { x1: 0, y1: 100, x2: 120, y2: 100, stroke: 'var(--ink)', 'stroke-width': 3 }));
}
function hutSvg() {
  return s('svg', { viewBox: '0 0 120 120', class: 'celebrate-icon' },
    s('rect', { x: 25, y: 55, width: 70, height: 45, fill: 'var(--wood)' }),
    s('path', { d: 'M 15 60 L 60 22 L 105 60 Z', fill: 'var(--blaze)' }),
    s('rect', { x: 52, y: 72, width: 16, height: 28, fill: 'var(--ink)' }),
    s('rect', { x: 32, y: 66, width: 12, height: 12, fill: '#fff' }));
}
function stepSvg() {
  return s('svg', { viewBox: '0 0 120 120', class: 'celebrate-icon' },
    s('circle', { cx: 60, cy: 60, r: 44, fill: 'var(--ok)' }),
    s('path', { d: 'M 38 62 L 54 78 L 84 44', fill: 'none', stroke: '#fff', 'stroke-width': 10, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }));
}

const KINDS = {
  level: { icon: stepSvg, title: 'Level geschafft' },
  lesson: { icon: flagSvg, title: 'Lektion abgeschlossen' },
  camp: { icon: tentSvg, title: 'Basislager erreicht' },
  hut: { icon: hutSvg, title: 'Hütte erreicht' },
  badge: { icon: stepSvg, title: 'Neues Abzeichen' },
  summit: { icon: flagSvg, title: 'Gipfel erreicht' },
};

export function celebrate(kind, subtitle = '') {
  return new Promise(resolve => {
    const k = KINDS[kind] || KINDS.level;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const confetti = h('div.confetti', { 'aria-hidden': 'true' });
    if (!reduce) {
      const colors = ['var(--blaze)', 'var(--sign)', 'var(--ok)', 'var(--sky)', '#fff'];
      for (let i = 0; i < 40; i++) {
        confetti.append(h('i', { style: { left: `${Math.random() * 100}%`, background: colors[i % colors.length], animationDelay: `${Math.random() * 0.6}s`, animationDuration: `${1.6 + Math.random()}s` } }));
      }
    }
    const close = () => { ov.remove(); resolve(); };
    const ov = h('div.overlay', { role: 'dialog', 'aria-label': k.title, onclick: close },
      confetti,
      h('div.overlay-card', {}, k.icon(), h('h2', {}, k.title), subtitle ? h('p', {}, subtitle) : null, h('button.btn.primary.wide', { type: 'button' }, 'Weiter')));
    document.body.append(ov);
  });
}
