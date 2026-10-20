// Lädt Konfiguration, Kursstruktur und Content-Packs (JSON-Dateien auf GitHub Pages).

export const content = {
  config: null,
  course: null,
  packs: {},      // Lektionsnummer → Pack
  words: {},      // Wort-ID → { ...wort, lessonN, level }
  exercises: {},  // Übungs-ID → Übung
};

async function getJson(url) {
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`${url} konnte nicht geladen werden (${res.status})`);
  return res.json();
}

export async function loadConfig() {
  content.config = await getJson('config.json');
  return content.config;
}

export async function loadCourse() {
  content.course = await getJson('content/course.json');
  return content.course;
}

export function lessonMeta(n) { return content.course.lessons.find(l => l.n === n); }
export function lessonCount() { return content.course.lessons.length; }
export function hasPack(n) { const m = lessonMeta(n); return !!(m && m.pack); }

export async function loadPack(n) {
  if (content.packs[n]) return content.packs[n];
  const meta = lessonMeta(n);
  if (!meta || !meta.pack) return null;
  const pack = await getJson(`content/${meta.pack}?v=${meta.version || 1}`);
  content.packs[n] = pack;
  pack.levels.forEach(lv => lv.words.forEach(id => {
    const w = pack.words.find(x => x.id === id);
    if (w) content.words[id] = { ...w, lessonN: n, level: lv.level };
  }));
  const g = pack.grammar || {};
  [...(g.exercises || []), ...(g.testExercises || [])].forEach(ex => { content.exercises[ex.id] = ex; });
  return pack;
}

// Alle Packs bis und mit Lektion n laden (für Wiederholungen älterer Lektionen)
export async function loadPacksUpTo(n) {
  for (let i = 1; i <= n; i++) if (hasPack(i)) await loadPack(i);
}

export function lessonNOf(lessonId) { return parseInt(String(lessonId).replace(/\D/g, ''), 10); }
export function lessonId(n) { return `L${String(n).padStart(2, '0')}`; }

// Gelernte Wörter ergeben sich aus der Position (alle lernen in derselben Reihenfolge):
// alle Wörter früherer Lektionen + Wörter der bestandenen Vokabel-Level der aktuellen Lektion.
export function learnedWordIds(pos) {
  const ids = [];
  for (const [nStr, pack] of Object.entries(content.packs)) {
    const n = Number(nStr);
    if (n < pos.lesson) pack.levels.forEach(lv => ids.push(...lv.words));
    else if (n === pos.lesson) pack.levels.filter(lv => lv.level < pos.level && lv.level <= 9).forEach(lv => ids.push(...lv.words));
  }
  return ids;
}

export function levelType(level) {
  if (level <= 9) return 'vocab';
  if (level === 10) return 'grammar';
  return 'test';
}

export function levelLabel(level) {
  const t = levelType(level);
  if (t === 'vocab') return `Level ${level}`;
  if (t === 'grammar') return 'Grammatik-Level';
  return 'Lektionstest';
}

// Lage im Kurs: Schritt (Basislager), Meilenstein (Hütte)
export function stepOf(n) { return content.course.steps.find(s => n >= s.lessons[0] && n <= s.lessons[1]); }
export function milestoneOf(n) { return content.course.milestones.find(m => n >= m.lessons[0] && n <= m.lessons[1]); }
