// Lern-Engine: baut die Fragen eines Levels, verarbeitet Antworten, verwaltet Gating, XP, Streak und Badges.
import { content, lessonId, lessonNOf, levelType, learnedWordIds, hasPack, lessonCount } from './content.js';
import { newCard, recordAnswer, isDue, retrievability, overdueDays } from './srs.js';
import { today, addDays, daysBetween, weekId, shuffle, uid, now } from './util.js';

export const PASS_QUOTA = 0.8;
export const REVIEW_XP_CAP = 150;

export const XP = {
  first: 10, repeat: 2, vocabPass: 50, grammarPass: 75, testPass: 200,
  review: 3, speed: 5, challengeSender: 30, challengePlayer: 10,
};

export const BADGES = {
  first_level:   { name: 'Erster Schritt', desc: 'Erstes Level bestanden' },
  first_lesson:  { name: 'Erste Etappe', desc: 'Erste Lektion abgeschlossen' },
  perfect:       { name: 'Fehlerfrei', desc: 'Ein Level mit 100 % bestanden' },
  streak_7:      { name: '7 Tage', desc: '7 Tage in Folge gelernt' },
  streak_30:     { name: '30 Tage', desc: '30 Tage in Folge gelernt' },
  streak_100:    { name: '100 Tage', desc: '100 Tage in Folge gelernt' },
  words_100:     { name: '100 Wörter', desc: '100 Wörter gelernt' },
  words_500:     { name: '500 Wörter', desc: '500 Wörter gelernt' },
  words_1000:    { name: '1000 Wörter', desc: '1000 Wörter gelernt' },
  mistake_hunter:{ name: 'Fehlerjäger', desc: '20 Wörter aus dem Fehlerstapel abgebaut' },
  seilschaft:    { name: 'Seilschaft', desc: 'Gemeinsames Wochenziel erreicht' },
  challenger:    { name: 'Herausforderer', desc: 'Erste Challenge gespielt' },
};

// ---------- Benutzer ----------

export function newUser(profile) {
  return {
    id: profile.id, name: profile.name, color: profile.color,
    pos: { lesson: 1, level: 1 },
    lastLevelDay: null, lastResult: null,
    introSeen: {},
    streak: { count: 0, lastDay: null, freezeWeek: null },
    xp: { total: 0, week: 0, weekId: weekId() },
    reviewXp: { day: null, xp: 0 },
    badges: {},
    wordsLearned: 0,
    fixedCount: 0,
    created: now().toISOString(),
  };
}

export function normalizeUser(u) {
  if (u.xp.weekId !== weekId()) { u.xp.week = 0; u.xp.weekId = weekId(); }
  return u;
}

export function addXp(user, n) {
  normalizeUser(user);
  user.xp.total += n; user.xp.week += n;
}

// ---------- Gating ----------

/** Was kann die Person heute tun? */
export function dayStatus(user, session, { ignoreLock = false } = {}) {
  if (session && session.kind === 'level') return { state: 'continue' };
  if (!hasPack(user.pos.lesson)) {
    if (user.pos.lesson > lessonCount()) return { state: 'summit' };
    return { state: 'no_content' };
  }
  if (!ignoreLock && user.lastLevelDay === today()) {
    return { state: user.lastResult === 'pass' ? 'done_pass' : 'done_fail' };
  }
  return { state: 'ready', repeat: user.lastResult === 'fail' };
}

// ---------- Fragen zusammenstellen ----------

function cardOf(cards, w) { return cards[w]; }

// Sortierung «schwierigste zuerst»: meiste Fehler, dann tiefste Erinnerungswahrscheinlichkeit, Rest zufällig
function hardestFirst(ids, cards) {
  return shuffle(ids).sort((a, b) => {
    const ca = cards[a], cb = cards[b];
    const xa = ca ? ca.x : 0, xb = cb ? cb.x : 0;
    if (xb !== xa) return xb - xa;
    const ra = ca ? retrievability(ca) : 0, rb = cb ? retrievability(cb) : 0;
    return ra - rb;
  });
}

// Fällige Wörter aus abgeschlossenen Lektionen (meist überfällig zuerst)
function dueOlder(cards, currentLesson, exclude = new Set()) {
  return Object.values(cards)
    .filter(c => lessonNOf(c.l) < currentLesson && !exclude.has(c.w) && content.words[c.w] && isDue(c))
    .sort((a, b) => overdueDays(b) - overdueDays(a))
    .map(c => c.w);
}

function wordItem(w, extra = {}) { return { k: uid('q'), t: 'de_es', w, rep: false, nq: false, done: false, ...extra }; }
function grammarItem(g) { return { k: uid('q'), t: 'g', g, rep: false, nq: false, done: false }; }

const keyOf = it => it.w || it.g || (it.ws ? it.ws.join(',') : it.k);

// Dasselbe Wort nie zweimal knapp hintereinander (mind. 3 Fragen Abstand)
export function spaceOut(items, gap = 3) {
  const a = items.slice();
  for (let i = 1; i < a.length; i++) {
    const recent = a.slice(Math.max(0, i - gap), i).map(keyOf);
    if (!recent.includes(keyOf(a[i]))) continue;
    for (let j = i + 1; j < a.length; j++) {
      if (!recent.includes(keyOf(a[j]))) { [a[i], a[j]] = [a[j], a[i]]; break; }
    }
  }
  return a;
}

// Fragetyp-Mix je nach Lektion (Spezifikation «Fragetypen»)
function pickType(lessonN) {
  if (lessonN <= 1) return 'de_es';
  const r = Math.random() * 100;
  if (lessonN <= 3) {
    if (r < 50) return 'de_es';
    if (r < 65) return 'es_de';
    if (r < 80) return 'mc';
    if (r < 90) return 'match';
    return 'scramble';
  }
  // ab Lektion 4 (Satzübungen folgen mit Lektion 3; bis dahin als DE→ES)
  if (r < 65) return 'de_es';
  if (r < 75) return 'es_de';
  if (r < 85) return 'mc';
  if (r < 93) return 'match';
  return 'scramble';
}

// Fragetypen zuweisen; «Paare zuordnen» bündelt 5 Wörter zu einer Frage
function assignTypes(items, lessonN) {
  const out = [];
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    if (!it.w) { out.push(it); continue; }
    let t = pickType(lessonN);
    if (t === 'scramble') {
      const w = content.words[it.w];
      if (!w || w.pos === 'phrase' || /\s/.test(stripArticle(w.es))) t = 'de_es';
    }
    if (t === 'match') {
      const group = [it];
      for (let j = i + 1; j < items.length && group.length < 5; j++) {
        if (items[j].w && !group.some(g => g.w === items[j].w)) group.push(items[j]);
        else break;
      }
      if (group.length === 5) {
        out.push({ k: uid('q'), t: 'match', ws: group.map(g => g.w), rep: false, nq: false, done: false });
        i += 4;
        continue;
      }
      t = 'de_es';
    }
    out.push({ ...it, t });
  }
  return out;
}

export function stripArticle(es) {
  return String(es).replace(/^(el|la|los|las)\s+/i, '');
}

function lessonWordsUpTo(pack, maxLevel) {
  return pack.levels.filter(lv => lv.level <= maxLevel).flatMap(lv => lv.words);
}

/** Neues Level-Session-Objekt erstellen. */
export function buildLevelSession(user, cards) {
  const lessonN = user.pos.lesson, level = user.pos.level;
  const pack = content.packs[lessonN];
  const type = levelType(level);
  let items = [];
  let cardWords = [];

  if (type === 'vocab') {
    const fresh = pack.levels.find(lv => lv.level === level).words;
    cardWords = fresh;
    const roundA = shuffle(fresh).map(w => wordItem(w));
    const roundB = shuffle(fresh).map(w => wordItem(w));
    const earlier = lessonWordsUpTo(pack, level - 1);
    const earlierSel = hardestFirst(earlier, cards).slice(0, Math.ceil(earlier.length * 0.5)).map(w => wordItem(w));
    const older = dueOlder(cards, lessonN).map(w => wordItem(w));
    items = [...roundA, ...spaceOut(shuffle([...roundB, ...earlierSel, ...older]))];
  } else if (type === 'grammar') {
    const ex = shuffle(pack.grammar.exercises || []).slice(0, 20).map(e => grammarItem(e.id));
    const lessonSel = hardestFirst(lessonWordsUpTo(pack, 9), cards).slice(0, 20).map(w => wordItem(w));
    const older = dueOlder(cards, lessonN).map(w => wordItem(w));
    items = shuffle([...ex, ...lessonSel, ...older]);
  } else {
    const all = lessonWordsUpTo(pack, 9);
    const testEx = (pack.grammar.testExercises && pack.grammar.testExercises.length ? pack.grammar.testExercises : pack.grammar.exercises) || [];
    const ex = shuffle(testEx).slice(0, 30).map(e => grammarItem(e.id));
    const half = Math.ceil(ex.length / 2);
    // 40 ältere Wörter: zuerst fällige, dann 70 % Fehlerstapel, 30 % zufällig
    const exclude = new Set(all);
    let older = dueOlder(cards, lessonN, exclude).slice(0, 40);
    if (older.length < 40) {
      const pool = Object.values(cards).filter(c => lessonNOf(c.l) < lessonN && content.words[c.w] && !older.includes(c.w));
      const deck = shuffle(pool.filter(c => c.deck)).map(c => c.w);
      const rest = shuffle(pool.filter(c => !c.deck)).map(c => c.w);
      const need = 40 - older.length;
      const fromDeck = deck.slice(0, Math.ceil(need * 0.7));
      const fromRest = rest.slice(0, need - fromDeck.length);
      older = [...older, ...fromDeck, ...fromRest, ...deck.slice(fromDeck.length)].slice(0, 40);
    }
    const r1 = shuffle([...all.map(w => wordItem(w)), ...ex.slice(0, half)]);
    const r2 = shuffle([...all.map(w => wordItem(w)), ...ex.slice(half), ...older.map(w => wordItem(w))]);
    items = [...r1, ...r2];
  }

  items = assignTypes(spaceOut(items), lessonN);

  return {
    id: uid('s'), kind: 'level', lesson: lessonN, level, levelType: type,
    phase: type === 'vocab' ? (level === 1 && !user.introSeen[lessonId(lessonN)] ? 'intro' : 'cards') : 'recap',
    cardWords, items, idx: 0,
    first: 0, firstOk: 0, xp: 0,
    startDay: today(), startedAt: now().toISOString(),
    speedDone: lessonN < 2,
  };
}

/** Freie Wiederholung: Quelle 'deck' | 'due' | 'random', 20 Wörter. */
export function buildReviewSession(user, cards, source) {
  const learned = new Set(learnedWordIds(user.pos));
  const pool = Object.values(cards).filter(c => learned.has(c.w) && content.words[c.w]);
  let ids;
  if (source === 'deck') ids = shuffle(pool.filter(c => c.deck)).map(c => c.w);
  else if (source === 'due') ids = pool.filter(c => isDue(c)).sort((a, b) => overdueDays(b) - overdueDays(a)).map(c => c.w);
  else ids = shuffle(pool).map(c => c.w);
  ids = ids.slice(0, 20);
  if (!ids.length) return null;
  const items = assignTypes(spaceOut(ids.map(w => wordItem(w))), user.pos.lesson);
  return { id: uid('s'), kind: 'review', source, phase: 'quiz', items, idx: 0, first: 0, firstOk: 0, xp: 0, startDay: today(), startedAt: now().toISOString(), speedDone: true };
}

export function buildChallengeSession(user, challenge) {
  const items = assignTypes(spaceOut(shuffle(challenge.words).map(w => wordItem(w))), user.pos.lesson);
  return { id: uid('s'), kind: 'challenge', from: challenge.from, phase: 'quiz', items, idx: 0, first: 0, firstOk: 0, xp: 0, startDay: today(), startedAt: now().toISOString(), speedDone: true };
}

// ---------- Antworten verarbeiten ----------

/**
 * results: [{ w | g, ok }]. Aktualisiert Session, Karten und XP.
 * Gibt die geänderten Karten zurück (zum Speichern) und ob ein Wort den Fehlerstapel verlassen hat.
 */
export function applyAnswer(session, item, results, cards, user) {
  const changed = [];
  let fixedNow = 0;
  for (const r of results) {
    const counts = !item.rep && !item.nq;
    if (counts) { session.first++; if (r.ok) session.firstOk++; }

    if (r.w) {
      const w = content.words[r.w];
      let card = cards[r.w] || newCard(r.w, lessonId(w.lessonN));
      const res = recordAnswer(card, r.ok, !item.rep);
      cards[r.w] = res.card;
      changed.push(res.card);
      if (res.fixed) { user.fixedCount = (user.fixedCount || 0) + 1; fixedNow++; }
    }

    // XP
    let gain = 0;
    if (r.ok) {
      if (session.kind === 'review') gain = item.rep ? 0 : XP.review;
      else if (session.kind === 'challenge') gain = item.rep ? 0 : XP.challengePlayer;
      else if (item.nq) gain = XP.speed;
      else gain = item.rep ? XP.repeat : XP.first;
    }
    if (session.kind === 'review') {
      if (user.reviewXp.day !== today()) user.reviewXp = { day: today(), xp: 0 };
      gain = Math.max(0, Math.min(gain, REVIEW_XP_CAP - user.reviewXp.xp));
      user.reviewXp.xp += gain;
    }
    if (gain) { session.xp += gain; addXp(user, gain); }

    // Falsch → 3–5 Fragen später nochmals (als DE→ES-Tippen bzw. dieselbe Grammatikübung)
    if (!r.ok && !item.nq) {
      const rep = r.w ? wordItem(r.w, { rep: true }) : { ...grammarItem(r.g), rep: true };
      const pos = Math.min(session.items.length, session.idx + 3 + Math.floor(Math.random() * 3));
      session.items.splice(pos, 0, rep);
    }
  }
  item.done = true;
  return { changed, fixedNow };
}

export function quota(session) {
  return session.first ? session.firstOk / session.first : 0;
}

// ---------- Abschluss ----------

/** Streak aktualisieren (bei abgeschlossenem Level oder Wiederholungsrunde). */
export function touchStreak(user) {
  const t = today();
  const s = user.streak;
  if (s.lastDay === t) return;
  if (!s.lastDay) s.count = 1;
  else {
    const gap = daysBetween(s.lastDay, t);
    if (gap === 1) s.count++;
    else if (gap === 2 && s.freezeWeek !== weekId()) { s.count++; s.freezeWeek = weekId(); s.usedFreezeDay = addDays(t, -1); }
    else s.count = 1;
  }
  s.lastDay = t;
}

/** Aktuellen Streak anzeigen (0, wenn abgerissen). */
export function currentStreak(user) {
  const s = user.streak;
  if (!s.lastDay) return 0;
  const gap = daysBetween(s.lastDay, today());
  if (gap <= 1) return s.count;
  if (gap === 2 && s.freezeWeek !== weekId()) return s.count; // Freeze noch verfügbar
  return 0;
}

export function finishLevel(user, session) {
  const q = quota(session);
  const passed = q >= PASS_QUOTA;
  const before = { ...user.pos };
  const events = [];
  user.lastLevelDay = today();
  user.lastResult = passed ? 'pass' : 'fail';

  if (passed) {
    if (session.levelType === 'vocab') { addXp(user, XP.vocabPass); session.xp += XP.vocabPass; user.wordsLearned += session.cardWords.length; }
    if (session.levelType === 'grammar') { addXp(user, XP.grammarPass); session.xp += XP.grammarPass; }
    if (session.levelType === 'test') {
      addXp(user, XP.testPass); session.xp += XP.testPass;
      user.pos = { lesson: session.lesson + 1, level: 1 };
      events.push('lesson');
      const step = content.course.steps.find(s => s.lessons[1] === session.lesson);
      const ms = content.course.milestones.find(m => m.lessons[1] === session.lesson);
      if (session.lesson === lessonCount()) events.push('summit'); else if (ms) events.push('hut'); else if (step) events.push('camp');
    } else {
      user.pos = { lesson: session.lesson, level: session.level + 1 };
    }
    events.unshift('level');
  }
  touchStreak(user);
  const newBadges = checkBadges(user, { perfect: passed && q === 1 });
  return { passed, quota: q, before, after: { ...user.pos }, events, newBadges };
}

export function finishReview(user) {
  touchStreak(user);
  return checkBadges(user, {});
}

export function checkBadges(user, { perfect = false, seilschaft = false, challenger = false } = {}) {
  const got = [];
  const give = id => { if (!user.badges[id]) { user.badges[id] = today(); got.push(id); } };
  if (user.pos.level > 1 || user.pos.lesson > 1) give('first_level');
  if (user.pos.lesson > 1) give('first_lesson');
  if (perfect) give('perfect');
  const st = user.streak.count;
  if (st >= 7) give('streak_7');
  if (st >= 30) give('streak_30');
  if (st >= 100) give('streak_100');
  if (user.wordsLearned >= 100) give('words_100');
  if (user.wordsLearned >= 500) give('words_500');
  if (user.wordsLearned >= 1000) give('words_1000');
  if ((user.fixedCount || 0) >= 20) give('mistake_hunter');
  if (seilschaft) give('seilschaft');
  if (challenger) give('challenger');
  return got;
}

// ---------- Challenge ----------

/** 10 Wörter aus dem eigenen Fehlerstapel, die beide schon gelernt haben. */
export function pickChallengeWords(me, partner, myCards) {
  const both = new Set(learnedWordIds(partner.pos).filter(w => learnedWordIds(me.pos).includes(w)));
  const mine = Object.values(myCards).filter(c => both.has(c.w) && content.words[c.w]);
  const deck = shuffle(mine.filter(c => c.deck)).map(c => c.w);
  const hard = mine.filter(c => !c.deck).sort((a, b) => b.x - a.x || retrievability(a) - retrievability(b)).map(c => c.w);
  return [...deck, ...hard].slice(0, 10);
}

// ---------- Statistik ----------

export function accuracy7(history) {
  const from = addDays(today(), -6);
  const recent = history.filter(h => h.day >= from && h.first);
  const first = recent.reduce((s, h) => s + h.first, 0);
  const ok = recent.reduce((s, h) => s + h.firstOk, 0);
  return first ? ok / first : null;
}
