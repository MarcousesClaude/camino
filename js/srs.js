// Wiederholungs-Logik mit FSRS (Bibliothek ts-fsrs, MIT-Lizenz, lokal in js/vendor).
import { fsrs, createEmptyCard, Rating, generatorParameters } from './vendor/ts-fsrs.mjs';
import { now, today, endOfToday, daysBetween } from './util.js';

// Ziel-Erinnerungsquote 90 %, Abstände in ganzen Tagen (keine Minuten-Schritte)
const scheduler = fsrs(generatorParameters({
  request_retention: 0.9,
  enable_fuzz: true,
  enable_short_term: false,
}));

/** Neue Lernkarte für ein Wort (beim ersten Zeigen der Lernkarte). */
export function newCard(wordId, lessonId) {
  return {
    w: wordId,
    l: lessonId,
    f: serialize(createEmptyCard(now())), // FSRS-Zustand
    fd: null,      // Tag der letzten FSRS-Aktualisierung
    r: 0,          // richtig gesamt
    x: 0,          // falsch gesamt
    deck: false,   // im Fehlerstapel?
    ds: 0,         // richtige Tage in Folge im Fehlerstapel
    dd: null,      // letzter Tag, an dem ds erhöht wurde
  };
}

function serialize(c) {
  return { ...c, due: c.due.toISOString(), last_review: c.last_review ? new Date(c.last_review).toISOString() : null };
}
function deserialize(f) {
  return { ...f, due: new Date(f.due), last_review: f.last_review ? new Date(f.last_review) : undefined };
}

/**
 * Antwort verbuchen. firstTry=false (Wiederholung nach Fehler) zählt nur für die Statistik.
 * Gibt { card, fixed } zurück; fixed=true, wenn das Wort den Fehlerstapel verlassen hat.
 */
export function recordAnswer(card, ok, firstTry = true) {
  const c = { ...card };
  const t = today();
  if (ok) c.r++; else c.x++;
  let fixed = false;

  if (firstTry) {
    // FSRS höchstens einmal pro Tag und Wort
    if (c.fd !== t) {
      const res = scheduler.next(deserialize(c.f), now(), ok ? Rating.Good : Rating.Again);
      c.f = serialize(res.card);
      c.fd = t;
    }
    // Fehlerstapel
    if (!ok) {
      c.deck = true; c.ds = 0; c.dd = t;
    } else if (c.deck && c.dd !== t) {
      c.ds++; c.dd = t;
      if (c.ds >= 3) { c.deck = false; c.ds = 0; fixed = true; }
    }
  }
  return { card: c, fixed };
}

export function isDue(card) {
  return new Date(card.f.due) <= endOfToday();
}

// Erinnerungswahrscheinlichkeit heute (0..1); neue Karten = 0
export function retrievability(card) {
  const f = card.f;
  if (!f.stability || !f.last_review) return 0;
  const elapsed = Math.max(0, daysBetween(f.last_review.slice(0, 10), today()));
  return Math.pow(1 + (19 / 81) * elapsed / f.stability, -0.5);
}

export function overdueDays(card) {
  return daysBetween(card.f.due.slice(0, 10), today());
}
