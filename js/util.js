// Kleine Hilfsfunktionen, die überall gebraucht werden.

let dayOffset = 0; // nur im Demo-Modus ≠ 0 («Datum vorspulen»)
export function setDayOffset(n) { dayOffset = n || 0; }
export function getDayOffset() { return dayOffset; }

// «Jetzt» – im Demo-Modus um ganze Tage verschoben
export function now() {
  const d = new Date();
  if (dayOffset) d.setDate(d.getDate() + dayOffset);
  return d;
}

// Lokales Datum als 'YYYY-MM-DD' (Tageswechsel um Mitternacht, Gerätezeit)
export function dayKey(d = now()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
export function today() { return dayKey(now()); }

export function endOfToday() {
  const d = now();
  d.setHours(23, 59, 59, 999);
  return d;
}

export function addDays(key, n) {
  const [y, m, d] = key.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + n);
  return dayKey(dt);
}

export function daysBetween(a, b) {
  const [y1, m1, d1] = a.split('-').map(Number);
  const [y2, m2, d2] = b.split('-').map(Number);
  return Math.round((new Date(y2, m2 - 1, d2) - new Date(y1, m1 - 1, d1)) / 86400000);
}

// Woche beginnt am Montag 00:00. Kennung = Datum des Montags.
export function weekId(d = now()) {
  const dt = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const wd = (dt.getDay() + 6) % 7; // Mo=0 … So=6
  dt.setDate(dt.getDate() - wd);
  return dayKey(dt);
}

export function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

export function sample(arr, n) { return shuffle(arr).slice(0, n); }

let idCounter = 0;
export function uid(prefix = 'i') {
  idCounter++;
  return `${prefix}${Date.now().toString(36)}${idCounter.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

// DOM-Helfer: h('div.klasse', {attr}, kinder…)
export function h(tag, attrs = {}, ...children) {
  const [name, ...classes] = tag.split('.');
  const el = document.createElement(name || 'div');
  if (classes.length) el.className = classes.join(' ');
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'html') el.innerHTML = v;
    else if (k === 'style' && typeof v === 'object') {
      for (const [sk, sv] of Object.entries(v)) {
        if (sk.startsWith('--')) el.style.setProperty(sk, sv); else el.style[sk] = sv;
      }
    }
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

export function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); return el; }

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function fmtNum(n) { return Number(n || 0).toLocaleString('de-CH'); }

export function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
