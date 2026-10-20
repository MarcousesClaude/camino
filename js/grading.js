// Bewertung von Antworten.
// Regeln (Spezifikation): Gross/Klein, Leerzeichen, Akzente und Schlusspunkt egal.
// Pflicht: ñ, Artikel bei Nomen, ¿ ¡ in Sätzen. Keine Tippfehler-Toleranz.

const ARTICLES_ES = ['el', 'la', 'los', 'las', 'un', 'una', 'unos', 'unas'];
const ARTICLES_DE = ['der', 'die', 'das', 'den', 'dem', 'des', 'ein', 'eine', 'einen', 'einem', 'einer'];

// Spanisch normalisieren: ñ bleibt, alle anderen Akzente fallen weg
export function normEs(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/ñ/g, '\u0001')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/\u0001/g, 'ñ')
    .replace(/[.,;:]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Deutsch normalisieren: ä=ae usw., Artikel vorne optional, Klammern im Soll ignorieren
export function normDe(s, stripArticle = true) {
  let t = String(s || '').toLowerCase()
    .replace(/\(.*?\)/g, ' ')
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
    .replace(/[.,;:!?]+/g, ' ')
    .replace(/\s+/g, ' ').trim();
  if (stripArticle) {
    const parts = t.split(' ');
    if (parts.length > 1 && ARTICLES_DE.includes(parts[0])) t = parts.slice(1).join(' ');
  }
  return t;
}

function splitArticle(normed) {
  const parts = normed.split(' ');
  if (parts.length > 1 && ARTICLES_ES.includes(parts[0])) return { art: parts[0], rest: parts.slice(1).join(' ') };
  return { art: null, rest: normed };
}

/**
 * Spanische Antwort prüfen.
 * expected: Soll-Antwort (z. B. "el día"), accept: weitere gültige Antworten
 * isNoun: Artikel ist Pflicht
 * Rückgabe: { ok, reason, correct }  reason: 'ok' | 'article_missing' | 'article_wrong' | 'wrong' | 'punct'
 */
export function gradeEs(input, expected, accept = [], { isNoun = false, isSentence = false } = {}) {
  const valid = [expected, ...(accept || [])];
  const inNorm = normEs(input);
  for (const v of valid) {
    const vNorm = normEs(v);
    if (inNorm === vNorm) return { ok: true, reason: 'ok', correct: expected };
    // Satzzeichen ¿ ¡ sind Pflicht: gleiche Wörter, aber Zeichen fehlen
    if (isSentence && inNorm.replace(/[¿¡?!]/g, '').trim() === vNorm.replace(/[¿¡?!]/g, '').trim()) {
      return { ok: false, reason: 'punct', correct: expected };
    }
  }
  if (isNoun) {
    const e = splitArticle(normEs(expected));
    const i = splitArticle(inNorm);
    if (e.art && !i.art && i.rest === e.rest) return { ok: false, reason: 'article_missing', correct: expected };
    if (e.art && i.art && i.art !== e.art && i.rest === e.rest) return { ok: false, reason: 'article_wrong', correct: expected };
  }
  return { ok: false, reason: 'wrong', correct: expected };
}

/** Deutsche Antwort prüfen (Artikel optional, alle hinterlegten Übersetzungen gelten). */
export function gradeDe(input, expected, accept = []) {
  const inNorm = normDe(input);
  if (!inNorm) return { ok: false, reason: 'wrong', correct: expected };
  // "der Junge (das Kind)" → gültig: "Junge"; Varianten mit "/" werden aufgeteilt
  const variants = [];
  for (const v of [expected, ...(accept || [])]) {
    for (const part of String(v).split('/')) variants.push(part);
  }
  for (const v of variants) {
    if (normDe(v) === inNorm) return { ok: true, reason: 'ok', correct: expected };
  }
  return { ok: false, reason: 'wrong', correct: expected };
}

export function reasonText(reason, word) {
  switch (reason) {
    case 'article_missing': return 'Der Artikel fehlt. Nomen immer mit el/la lernen.';
    case 'article_wrong': return 'Falscher Artikel.';
    case 'punct': return 'Fast: Im Spanischen beginnt eine Frage mit ¿ und ein Ausruf mit ¡.';
    default: return '';
  }
}
