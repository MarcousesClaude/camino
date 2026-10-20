// Hauptprogramm: Start, Profile, Bildschirme und Ablauf eines Levels.
import { h, clear, today, addDays, weekId, setDayOffset, getDayOffset, fmtNum, shuffle } from './util.js';
import { content, loadConfig, loadCourse, loadPack, loadPacksUpTo, lessonMeta, lessonId, levelType, levelLabel, learnedWordIds, hasPack, lessonCount } from './content.js';
import { createStore, LocalStore, onPendingChange, pendingWrites } from './store.js';
import * as E from './engine.js';
import { render as renderExercise, renderSpeed, setDistractorLesson, ALL_TYPES } from './exercises.js';
import { trailSvg, celebrate } from './visuals.js';
import { isDue } from './srs.js';

export const APP_VERSION = '1.0.0';

const S = {
  config: null, store: null, mainStore: null, demo: false,
  profileId: null, user: null, cards: {}, session: null,
  side: null, partner: null, view: 'home', ignoreLock: false, climb: null, installPrompt: null,
};

const app = document.getElementById('app');
const LAST_PROFILE = 'spanischapp:lastProfile';

// ---------- Start ----------

async function boot() {
  try {
    S.config = await loadConfig();
    await loadCourse();
    S.mainStore = await createStore(S.config);
    S.store = S.mainStore;
  } catch (err) {
    showFatal(err);
    return;
  }
  setupBanners();
  const last = localStorage.getItem(LAST_PROFILE);
  if (last && S.config.profiles.some(p => p.id === last)) await openProfile(last);
  else viewProfiles();
}

function showFatal(err) {
  console.error(err);
  clear(app).append(h('main.screen.center', {},
    h('h1', {}, 'Die App konnte nicht starten'),
    h('p', {}, 'Prüfe die Internetverbindung und lade die Seite neu. Bleibt der Fehler, schick diesen Text an Claude:'),
    h('pre.err', {}, String(err && err.message || err)),
    h('button.btn.primary', { type: 'button', onclick: () => location.reload() }, 'Neu laden')));
}

function profiles() {
  return S.demo ? [{ id: 'demo', name: 'Demo', color: '#7A4FB5' }, { id: 'demo2', name: 'Demo-Partner', color: '#2E7D6B' }] : S.config.profiles;
}

async function openProfile(id) {
  const prof = profiles().find(p => p.id === id);
  if (!S.demo) localStorage.setItem(LAST_PROFILE, id);
  S.profileId = id;
  try {
    let user = await S.store.getUser(id);
    if (!user) { user = E.newUser(prof); await S.store.setUser(id, user); }
    user.name = prof.name; user.color = prof.color;
    S.user = E.normalizeUser(user);
    await loadPacksUpTo(Math.min(S.user.pos.lesson, lessonCount()));
    S.cards = await S.store.getCards(id);
    S.session = await S.store.getSession(id);
    const other = profiles().find(p => p.id !== id);
    S.partner = other ? await S.store.getUser(other.id) : null;
    if (S.partner) E.normalizeUser(S.partner);
  } catch (err) { showFatal(err); return; }
  setDistractorLesson(S.user.pos.lesson);
  S.view = 'home';
  renderView();
}

// ---------- Speichern ----------

const cur = () => S.side || S.session; // laufende Runde (Wiederholung/Challenge oder Level)
const saveUser = () => S.store.setUser(S.profileId, S.user);
const saveSession = () => S.store.setSession(S.profileId, S.session);
function saveCards(list) { list.forEach(c => S.store.saveCard(S.profileId, c)); }

function recordDaily(first, firstOk) {
  const t = today();
  S.user.daily = S.user.daily || {};
  const d = S.user.daily[t] || [0, 0];
  S.user.daily[t] = [d[0] + first, d[1] + firstOk];
  const from = addDays(t, -6);
  Object.keys(S.user.daily).forEach(k => { if (k < from) delete S.user.daily[k]; });
}

function accuracyOf(u) {
  if (!u || !u.daily) return null;
  const from = addDays(today(), -6);
  let a = 0, b = 0;
  Object.entries(u.daily).forEach(([k, v]) => { if (k >= from) { a += v[0]; b += v[1]; } });
  return a ? b / a : null;
}

// ---------- Banner (offline, Update, Demo, Testbetrieb) ----------

const banners = h('div.banners', { 'aria-live': 'polite' });
function setupBanners() {
  document.body.prepend(banners);
  const refresh = () => renderBanners();
  window.addEventListener('online', refresh);
  window.addEventListener('offline', refresh);
  onPendingChange(refresh);
  window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); S.installPrompt = e; });
  registerSW();
  renderBanners();
}

let updateReady = null;
function renderBanners() {
  clear(banners);
  if (S.demo) banners.append(h('button.banner.demo', { type: 'button', onclick: () => { S.view = 'demo'; renderView(); } }, `DEMO-Modus${getDayOffset() ? ` (Datum +${getDayOffset()} Tage)` : ''}. Tippen für Demo-Steuerung`));
  if (!navigator.onLine) {
    banners.append(h('div.banner.offline', {}, pendingWrites() > 0
      ? 'Keine Verbindung. Deine Antworten werden gespeichert, sobald du wieder online bist. App nicht schliessen.'
      : 'Keine Verbindung. Neue Level starten erst wieder, wenn du online bist.'));
  }
  if (updateReady) banners.append(h('button.banner.update', { type: 'button', onclick: () => updateReady() }, 'Neue Version verfügbar. Tippen zum Laden.'));
  if (S.mainStore && S.mainStore.mode === 'local' && !S.demo) banners.append(h('div.banner.local', {}, 'Testbetrieb ohne Firebase: Fortschritt nur auf diesem Gerät.'));
}

function registerSW() {
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).then(reg => {
    const offer = worker => {
      updateReady = () => { worker.postMessage('skipWaiting'); };
      renderBanners();
    };
    if (reg.waiting && navigator.serviceWorker.controller) offer(reg.waiting);
    reg.addEventListener('updatefound', () => {
      const w = reg.installing;
      w && w.addEventListener('statechange', () => { if (w.state === 'installed' && navigator.serviceWorker.controller) offer(w); });
    });
    setInterval(() => reg.update().catch(() => {}), 30 * 60 * 1000);
  }).catch(err => console.warn('Service Worker nicht registriert', err));
  let reloaded = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (!reloaded) { reloaded = true; location.reload(); } });
}

// ---------- Grundgerüst ----------

function shell(main, { nav = true } = {}) {
  clear(app);
  app.append(main);
  if (nav) {
    const tab = (id, label, icon) => h(`button.tab${S.view === id ? '.active' : ''}`, { type: 'button', 'aria-current': S.view === id ? 'page' : null, onclick: () => { S.view = id; renderView(); } }, h('span.tab-icon', { 'aria-hidden': 'true', html: icon }), h('span', {}, label));
    app.append(h('nav.tabbar', { 'aria-label': 'Hauptnavigation' },
      tab('home', 'Berg', ICON.mountain), tab('review', 'Wiederholen', ICON.loop), tab('duel', 'Duell', ICON.rope), tab('profile', 'Profil', ICON.person)));
  }
  window.scrollTo(0, 0);
}

const ICON = {
  mountain: '<svg viewBox="0 0 24 24"><path d="M2 20 L9 7 L13 13 L16 9 L22 20 Z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>',
  loop: '<svg viewBox="0 0 24 24"><path d="M4 12a8 8 0 0 1 14-5l2-2v6h-6l2.5-2.5A5.5 5.5 0 0 0 6.5 12M20 12a8 8 0 0 1-14 5l-2 2v-6h6l-2.5 2.5A5.5 5.5 0 0 0 17.5 12" fill="currentColor"/></svg>',
  rope: '<svg viewBox="0 0 24 24"><circle cx="7" cy="7" r="3" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="17" cy="17" r="3" fill="none" stroke="currentColor" stroke-width="2"/><path d="M9 9c3 0 1 6 6 6" fill="none" stroke="currentColor" stroke-width="2"/></svg>',
  person: '<svg viewBox="0 0 24 24"><circle cx="12" cy="8" r="4" fill="none" stroke="currentColor" stroke-width="2"/><path d="M4 21c1-5 15-5 16 0" fill="none" stroke="currentColor" stroke-width="2"/></svg>',
};

function renderView() {
  renderBanners();
  if (!S.user) return viewProfiles();
  ({ home: viewHome, overview: viewOverview, review: viewReview, duel: viewDuel, profile: viewProfile, demo: viewDemo }[S.view] || viewHome)();
}

// ---------- Profilwahl ----------

function viewProfiles() {
  let taps = 0, timer = null;
  const logo = h('button.logo', {
    type: 'button', 'aria-label': 'Spanisch-App',
    onclick: () => {
      taps++; clearTimeout(timer); timer = setTimeout(() => { taps = 0; }, 1500);
      if (taps >= 7) { taps = 0; if (confirm('Demo-Modus starten? Eure echten Profile bleiben unverändert.')) enterDemo(); }
    },
  }, h('span', { html: '<svg viewBox="0 0 64 64" aria-hidden="true"><path d="M4 56 L26 16 L36 32 L44 22 L60 56 Z" fill="#fff"/><rect x="38" y="8" width="16" height="16" fill="#fff"/><rect x="38" y="13" width="16" height="6" fill="#D52B1E"/></svg>' }));
  const tiles = profiles().map(p => h('button.profile-tile', { type: 'button', onclick: () => openProfile(p.id), style: { '--pc': p.color } },
    h('span.profile-avatar', {}, p.name.slice(0, 1).toUpperCase()), h('span.profile-name', {}, p.name)));
  clear(app).append(h('main.screen.profiles', {},
    logo,
    h('h1', {}, '¿Quién eres?'),
    h('p.muted', {}, 'Wer lernt jetzt?'),
    h('div.profile-grid', {}, ...tiles),
    S.demo ? h('button.btn.ghost', { type: 'button', onclick: exitDemo }, 'Demo beenden') : null));
}

// ---------- Berg (Start) ----------

function viewHome() {
  const u = S.user;
  const meta = lessonMeta(Math.min(u.pos.lesson, lessonCount()));
  const st = E.dayStatus(u, S.session, { ignoreLock: S.ignoreLock });
  const partner = S.partner;
  const sameLesson = partner && partner.pos.lesson === u.pos.lesson;
  const level = u.pos.lesson > meta.n ? 11 : u.pos.level - 1; // erreichte Station
  const me = { level: Math.max(0, level), initial: u.name[0].toUpperCase(), color: u.color };
  if (S.climb) { me.fromLevel = S.climb.from; S.climb = null; }
  const trail = trailSvg({ me, partner: sameLesson ? { level: partner.pos.level - 1, initial: partner.name[0].toUpperCase(), color: partner.color } : null, lessonTitle: meta.title });

  let action;
  const startBtn = label => h('button.btn.primary.wide.big', { type: 'button', onclick: startLevel }, label);
  const nextLabel = `${levelLabel(u.pos.level)} starten`;
  switch (st.state) {
    case 'continue': action = [h('p.status', {}, `${levelLabel(S.session.level)} läuft noch.`), h('button.btn.primary.wide.big', { type: 'button', onclick: () => runSession() }, 'Weitermachen')]; break;
    case 'ready': action = [st.repeat ? h('p.status', {}, 'Wiederholung des Levels von gestern.') : null, startBtn(st.repeat ? `${levelLabel(u.pos.level)} wiederholen` : nextLabel)]; break;
    case 'done_pass': action = [h('p.status.good', {}, 'Für heute geschafft. Das nächste Level öffnet morgen.'), h('button.btn.wide', { type: 'button', onclick: () => { S.view = 'review'; renderView(); } }, 'Freiwillig wiederholen')]; break;
    case 'done_fail': action = [h('p.status', {}, 'Heute nicht bestanden. Morgen wiederholst du dieses Level.'), h('button.btn.wide', { type: 'button', onclick: () => { S.view = 'review'; renderView(); } }, 'Fehler üben')]; break;
    case 'no_content': action = [h('p.status', {}, `Lektion ${u.pos.lesson} ist bald verfügbar. Bis dahin hält der Wiederholungsmodus deinen Streak am Leben.`), h('button.btn.wide', { type: 'button', onclick: () => { S.view = 'review'; renderView(); } }, 'Wiederholen')]; break;
    case 'summit': action = [h('p.status.good', {}, 'Gipfel erreicht. ¡Enhorabuena!')]; break;
  }

  const partnerLine = partner && !sameLesson ? h('p.muted.small', {}, `${partner.name} ist in Lektion ${partner.pos.lesson}.`) : null;

  shell(h('main.screen.home', {},
    h('header.home-head', {},
      h('div', {}, h('p.lesson-kicker', {}, `Lektion ${meta.n} von ${lessonCount()}`), h('h1.lesson-title', {}, meta.title)),
      h('button.btn.ghost.small', { type: 'button', onclick: () => { S.view = 'overview'; renderView(); } }, 'Übersicht')),
    h('div.stats-row', {},
      stat('Streak', `${E.currentStreak(u)} ${E.currentStreak(u) === 1 ? 'Tag' : 'Tage'}`),
      stat('Diese Woche', `${fmtNum(u.xp.week)} XP`),
      stat('Wörter', fmtNum(u.wordsLearned))),
    h('div.trail-wrap', {}, trail),
    partnerLine,
    h('div.action', {}, ...action)));
}

function stat(label, value) { return h('div.stat', {}, h('span.stat-value', {}, value), h('span.stat-label', {}, label)); }

// ---------- Übersicht aller Lektionen ----------

function viewOverview() {
  const u = S.user;
  const groups = content.course.milestones.map(ms => {
    const steps = content.course.steps.filter(st => st.lessons[0] >= ms.lessons[0] && st.lessons[1] <= ms.lessons[1]);
    return h('section.ms', {},
      h('h2', {}, ms.title, h('span.muted.small', {}, ` Lektionen ${ms.lessons[0]}–${ms.lessons[1]}`)),
      ...steps.map(st => h('div.step', {},
        h('h3', {}, st.title),
        h('ol.lessons', { start: st.lessons[0] }, ...content.course.lessons.filter(l => l.n >= st.lessons[0] && l.n <= st.lessons[1]).map(l => {
          const state = l.n < u.pos.lesson ? 'done' : l.n === u.pos.lesson ? 'current' : (l.pack ? 'open' : 'soon');
          const tag = { done: 'abgeschlossen', current: `aktuell, ${levelLabel(u.pos.level)}`, open: 'gesperrt', soon: 'bald verfügbar' }[state];
          return h(`li.lesson.${state}`, {}, h('span.l-title', {}, l.title), h('span.l-meta', {}, `${l.cefr}, ${tag}`));
        })))));
  });
  shell(h('main.screen', {},
    h('header.page-head', {}, h('button.btn.ghost.small', { type: 'button', onclick: () => { S.view = 'home'; renderView(); } }, 'Zurück'), h('h1', {}, 'Der ganze Berg')),
    h('p.muted', {}, `${content.course.lessons.length} Lektionen bis zum Gipfel (B2). Basislager nach jeder 5. Lektion, Hütten nach Lektion 15 und 30.`),
    ...groups));
}

// ---------- Level-Ablauf ----------

async function startLevel() {
  if (S.store.mode === 'firebase' && !navigator.onLine) { alert('Keine Verbindung. Bitte zuerst online gehen.'); return; }
  const st = E.dayStatus(S.user, S.session, { ignoreLock: S.ignoreLock });
  if (st.state === 'continue') return runSession();
  if (st.state !== 'ready') return;
  await loadPack(S.user.pos.lesson);
  S.session = E.buildLevelSession(S.user, S.cards);
  saveSession();
  runSession();
}

function sessionShell(content_, { progress = null } = {}) {
  const top = h('header.session-top', {},
    h('button.btn.icon', { type: 'button', 'aria-label': 'Unterbrechen', onclick: () => { S.side = null; S.view = 'home'; renderView(); } }, '×'),
    progress !== null ? h('div.progress', { role: 'progressbar', 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': Math.round(progress * 100) }, h('div.progress-fill', { style: { transform: `scaleX(${progress})` } })) : h('div'),
  );
  shell(h('main.screen.session', {}, top, content_), { nav: false });
}

function runSession() {
  const sess = cur();
  if (!sess) { S.view = 'home'; return renderView(); }
  const pack = sess.lesson ? content.packs[sess.lesson] : null;
  if (sess.phase === 'intro') return phaseCard('Neue Lektion', pack.title, pack.grammar.intro, 'Los geht\'s', () => {
    S.user.introSeen[lessonId(sess.lesson)] = true; saveUser();
    sess.phase = 'cards'; saveSession(); runSession();
  });
  if (sess.phase === 'recap') {
    const isTest = sess.levelType === 'test';
    const text = isTest
      ? `Alle ${sess.items.filter(i => !i.rep).length} Fragen der Lektion: jedes Wort zweimal, dazu Grammatik${sess.lesson > 1 ? ' und Wörter aus früheren Lektionen' : ''}. Rechne mit 25–35 Minuten; du kannst jederzeit unterbrechen und später weitermachen.`
      : pack.grammar.recap;
    return phaseCard(isTest ? 'Lektionstest' : 'Grammatik-Level', pack.title, text, 'Starten', () => { sess.phase = 'quiz'; saveSession(); runSession(); });
  }
  if (sess.phase === 'cards') return phaseFlashcards();
  if (sess.phase === 'quiz') return phaseQuiz();
  if (sess.phase === 'speed') return phaseSpeed();
  finishSession();
}

function phaseCard(kicker, title, text, cta, onGo) {
  const paras = String(text || '').split(/\n\n+/).map(p => h('p', { html: inlineMd(p) }));
  sessionShell(h('div.card-text', {}, h('p.lesson-kicker', {}, kicker), h('h1', {}, title), ...paras, h('button.btn.primary.wide.big', { type: 'button', onclick: onGo }, cta)));
}

// **fett** und Zeilenumbrüche in Erklärungstexten
function inlineMd(s) {
  return String(s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]))
    .replace(/\*\*(.+?)\*\*/g, '<strong lang="es">$1</strong>').replace(/\n/g, '<br>');
}

function phaseFlashcards() {
  const sess = cur();
  const words = sess.cardWords.map(id => content.words[id]);
  let i = 0, flipped = false;
  const showExample = sess.lesson >= 3;
  const stage = h('div.fc-stage');
  const draw = () => {
    const w = words[i];
    const card = h(`button.flashcard${flipped ? '.flipped' : ''}`, { type: 'button', 'aria-label': flipped ? 'Karte umdrehen' : 'Karte umdrehen und Spanisch zeigen', onclick: () => { flipped = !flipped; draw(); } },
      h('span.fc-count', {}, `${i + 1} / ${words.length}`),
      flipped
        ? h('span.fc-face', {}, h('span.fc-es', { lang: 'es' }, w.es), w.pattern ? h('span.fc-sub', {}, w.pattern.es) : null, w.note ? h('span.fc-note', {}, w.note) : null,
            showExample && w.example ? h('span.fc-ex', {}, h('span', { lang: 'es' }, w.example.es), h('br'), w.example.de) : null)
        : h('span.fc-face', {}, h('span.fc-de', { lang: 'de' }, w.de), w.hintDe ? h('span.fc-sub', {}, w.hintDe) : null, h('span.fc-tap', {}, 'Antippen zum Umdrehen')));
    const last = i === words.length - 1;
    clear(stage).append(card, h('div.row.fc-nav', {},
      h('button.btn', { type: 'button', disabled: i === 0, onclick: () => { i--; flipped = false; draw(); } }, 'Zurück'),
      last
        ? h('button.btn.primary', { type: 'button', onclick: () => { sess.phase = 'quiz'; saveSession(); runSession(); } }, 'Abfrage starten')
        : h('button.btn.primary', { type: 'button', onclick: () => { i++; flipped = false; draw(); } }, 'Nächste Karte')));
  };
  // Wischen
  let x0 = null;
  stage.addEventListener('touchstart', e => { x0 = e.touches[0].clientX; }, { passive: true });
  stage.addEventListener('touchend', e => {
    if (x0 === null) return;
    const dx = e.changedTouches[0].clientX - x0; x0 = null;
    if (dx < -50 && i < words.length - 1) { i++; flipped = false; draw(); }
    if (dx > 50 && i > 0) { i--; flipped = false; draw(); }
  });
  sessionShell(h('div', {}, h('p.lesson-kicker', {}, `${levelLabel(sess.level)}: neue Wörter lernen`), stage));
  draw();
}

function phaseQuiz() {
  const sess = cur();
  while (sess.idx < sess.items.length && sess.items[sess.idx].done) sess.idx++;
  if (sess.idx >= sess.items.length) {
    sess.phase = sess.speedDone ? 'done' : 'speed';
    saveSession();
    return runSession();
  }
  const item = sess.items[sess.idx];
  const total = sess.items.length;
  const doneCount = sess.items.filter(i => i.done).length;
  const root = h('div.exercise');
  sessionShell(root, { progress: doneCount / total });
  renderExercise(root, item, {
    onCheck: results => {
      const { changed, fixedNow } = E.applyAnswer(sess, item, results, S.cards, S.user);
      saveCards(changed);
      saveSession();
      saveUser();
    },
    next: () => { sess.idx++; runSession(); },
  });
}

function phaseSpeed() {
  const sess = cur();
  const pool = learnedWordIds(S.user.pos).concat(sess.cardWords || []).filter(w => content.words[w]);
  if (pool.length < 4) { sess.speedDone = true; sess.phase = 'done'; saveSession(); return runSession(); }
  const root = h('div.exercise');
  sessionShell(root);
  renderSpeed(root, pool, {
    onAnswer: r => {
      const item = { nq: true, rep: false };
      const { changed } = E.applyAnswer(sess, item, [r], S.cards, S.user);
      saveCards(changed);
    },
    onEnd: score => { sess.speedDone = true; sess.phase = 'done'; saveSession(); saveUser(); runSession(); },
  });
}

async function finishSession() {
  const sess = cur();
  recordDaily(sess.first, sess.firstOk);
  const pct = Math.round(E.quota(sess) * 100);

  if (sess.kind === 'level') {
    const res = E.finishLevel(S.user, sess);
    S.store.addHistory(S.profileId, { ts: Date.now(), day: today(), kind: 'level', lesson: sess.lesson, level: sess.level, first: sess.first, firstOk: sess.firstOk, passed: res.passed, xp: sess.xp, seconds: Math.round((Date.now() - new Date(sess.startedAt)) / 1000) });
    S.session = null;
    saveUser(); saveSession();
    if (res.passed) {
      if (res.after.lesson > res.before.lesson) await loadPack(res.after.lesson).catch(() => null);
      S.climb = { from: res.before.lesson === res.after.lesson ? res.before.level - 1 : 0 };
    }
    setDistractorLesson(S.user.pos.lesson);
    sessionShell(h('div.result', {},
      h('p.lesson-kicker', {}, levelLabel(sess.level)),
      h('h1', {}, res.passed ? 'Bestanden' : 'Noch nicht bestanden'),
      h('p.big-number', {}, `${pct} %`),
      h('p', {}, `${sess.firstOk} von ${sess.first} Antworten beim ersten Versuch richtig. Nötig sind 80 %.`),
      h('p', {}, `+${fmtNum(sess.xp)} XP`),
      res.passed ? null : h('p.muted', {}, 'Morgen wiederholst du dieses Level. Die schwierigen Wörter sind jetzt in deinem Fehlerstapel.'),
      h('button.btn.primary.wide.big', {
        type: 'button', onclick: async () => {
          if (res.passed) {
            if (res.events.includes('lesson')) await celebrate('lesson', `Lektion ${sess.lesson} geschafft.`);
            if (res.events.includes('summit')) await celebrate('summit', '¡Enhorabuena! Alle 45 Lektionen geschafft.');
            else if (res.events.includes('hut')) await celebrate('hut', 'Ein grosser Meilenstein auf dem Weg zum Gipfel.');
            else if (res.events.includes('camp')) await celebrate('camp', 'Fünf Lektionen am Stück. Weiter geht\'s.');
            if (!res.events.includes('lesson')) await celebrate('level', `+${fmtNum(sess.xp)} XP`);
          }
          for (const b of res.newBadges) await celebrate('badge', E.BADGES[b].name);
          S.view = 'home'; renderView();
        },
      }, 'Weiter')));
    return;
  }

  if (sess.kind === 'review') {
    const badges = E.finishReview(S.user);
    S.side = null; saveUser();
    sessionShell(h('div.result', {}, h('h1', {}, 'Runde fertig'), h('p.big-number', {}, `${pct} %`), h('p', {}, `+${fmtNum(sess.xp)} XP`),
      h('button.btn.primary.wide.big', { type: 'button', onclick: async () => { for (const b of badges) await celebrate('badge', E.BADGES[b].name); S.view = 'review'; renderView(); } }, 'Weiter')));
    return;
  }

  if (sess.kind === 'challenge') {
    const ch = await S.store.getChallenge(sess.from);
    if (ch) { ch.status = 'done'; ch.result = { ok: sess.firstOk, total: sess.first, day: today() }; await S.store.setChallenge(sess.from, ch); }
    E.touchStreak(S.user);
    const badges = E.checkBadges(S.user, { challenger: true });
    S.side = null; saveUser();
    sessionShell(h('div.result', {}, h('h1', {}, 'Challenge gespielt'), h('p.big-number', {}, `${sess.firstOk} / ${sess.first}`), h('p', {}, `+${fmtNum(sess.xp)} XP`),
      h('button.btn.primary.wide.big', { type: 'button', onclick: async () => { for (const b of badges) await celebrate('badge', E.BADGES[b].name); S.view = 'duel'; renderView(); } }, 'Weiter')));
  }
}

// ---------- Wiederholen ----------

function viewReview() {
  const learned = new Set(learnedWordIds(S.user.pos));
  const mine = Object.values(S.cards).filter(c => learned.has(c.w) && content.words[c.w]);
  const deck = mine.filter(c => c.deck).sort((a, b) => b.x - a.x);
  const due = mine.filter(c => isDue(c));
  const start = async source => {
    const sess = E.buildReviewSession(S.user, S.cards, source);
    if (!sess) { alert('Dafür gibt es gerade keine Wörter.'); return; }
    S.side = sess;
    runSession();
  };
  const capLeft = Math.max(0, E.REVIEW_XP_CAP - (S.user.reviewXp.day === today() ? S.user.reviewXp.xp : 0));
  shell(h('main.screen', {},
    h('header.page-head', {}, h('h1', {}, 'Wiederholen')),
    h('p.muted', {}, `Freiwillig, beliebig oft. Gibt 3 XP pro richtige Antwort (heute noch ${capLeft} XP möglich) und schaltet keine Level frei.`),
    h('div.review-buttons', {},
      h('button.btn.wide', { type: 'button', disabled: !deck.length, onclick: () => start('deck') }, `Fehlerstapel (${deck.length})`),
      h('button.btn.wide', { type: 'button', disabled: !due.length, onclick: () => start('due') }, `Fällige Wörter (${due.length})`),
      h('button.btn.wide', { type: 'button', disabled: !mine.length, onclick: () => start('random') }, `Zufällig aus ${mine.length} gelernten Wörtern`)),
    h('h2', {}, 'Dein Fehlerstapel'),
    deck.length
      ? h('ul.decklist', {}, ...deck.map(c => { const w = content.words[c.w]; return h('li', {}, h('span', { lang: 'es' }, w.es), h('span.muted', {}, w.de), h('span.badge-count', { title: 'Fehler gesamt' }, `${c.x}×`)); }))
      : h('p.muted', {}, 'Leer. Ein Wort kommt hierher, wenn du es beim ersten Versuch falsch beantwortest, und geht nach drei richtigen Tagen wieder raus.')));
}

// ---------- Duell ----------

async function viewDuel() {
  const u = S.user, p = S.partner;
  shell(h('main.screen', {}, h('header.page-head', {}, h('h1', {}, 'Duell')), h('p.muted', {}, 'Lädt…')));
  if (!p) { shell(h('main.screen', {}, h('header.page-head', {}, h('h1', {}, 'Duell')), h('p', {}, 'Dein Partner hat die App noch nicht geöffnet.'))); return; }
  // Partnerdaten frisch laden
  try { S.partner = E.normalizeUser(await S.store.getUser(p.id) || p); } catch {}
  const partner = S.partner;
  const goal = S.config.weeklyGoalXp || 3000;
  const sum = (u.xp.weekId === weekId() ? u.xp.week : 0) + (partner.xp.weekId === weekId() ? partner.xp.week : 0);
  let goalBadge = [];
  if (sum >= goal && !u.badges.seilschaft) { goalBadge = E.checkBadges(u, { seilschaft: true }); saveUser(); }

  const row = (label, a, b) => h('tr', {}, h('th', { scope: 'row' }, label), h('td', {}, a), h('td', {}, b));
  const acc = x => (x === null ? '–' : `${Math.round(x * 100)} %`);
  const table = h('table.duel', {},
    h('thead', {}, h('tr', {}, h('th', {}), h('th', { scope: 'col', style: { color: u.color } }, u.name), h('th', { scope: 'col', style: { color: partner.color } }, partner.name))),
    h('tbody', {},
      row('Position', `L${u.pos.lesson}, ${levelLabel(u.pos.level)}`, `L${partner.pos.lesson}, ${levelLabel(partner.pos.level)}`),
      row('Streak', `${E.currentStreak(u)} Tage`, `${E.currentStreak(partner)} Tage`),
      row('XP diese Woche', fmtNum(u.xp.weekId === weekId() ? u.xp.week : 0), fmtNum(partner.xp.weekId === weekId() ? partner.xp.week : 0)),
      row('Treffsicherheit (7 Tage)', acc(accuracyOf(u)), acc(accuracyOf(partner))),
      row('Gelernte Wörter', fmtNum(u.wordsLearned), fmtNum(partner.wordsLearned))));

  // Challenges
  const incoming = await S.store.getChallenge(partner.id);
  let outgoing = await S.store.getChallenge(u.id);
  const chBox = h('div.challenge');
  if (incoming && incoming.to === u.id && incoming.status === 'open') {
    chBox.append(h('p', {}, `${partner.name} fordert dich heraus: ${incoming.words.length} Wörter.`),
      h('button.btn.primary.wide', { type: 'button', onclick: () => { S.side = E.buildChallengeSession(u, { ...incoming, from: partner.id }); runSession(); } }, 'Challenge spielen'));
  }
  if (outgoing && outgoing.status === 'done' && !outgoing.credited) {
    E.addXp(u, E.XP.challengeSender); outgoing.credited = true;
    await S.store.setChallenge(u.id, outgoing); saveUser();
    chBox.append(h('p.status.good', {}, `${partner.name} hat deine Challenge gespielt: ${outgoing.result.ok} von ${outgoing.result.total} richtig. +${E.XP.challengeSender} XP für dich.`));
  }
  if (outgoing && outgoing.status === 'open') chBox.append(h('p.muted', {}, `Deine Challenge wartet auf ${partner.name}.`));
  else {
    const words = E.pickChallengeWords(u, partner, S.cards);
    chBox.append(h('button.btn.wide', {
      type: 'button', disabled: words.length < 5,
      onclick: async () => {
        await S.store.setChallenge(u.id, { from: u.id, to: partner.id, words, status: 'open', created: today() });
        viewDuel();
      },
    }, words.length < 5 ? 'Challenge senden (ab 5 gemeinsamen Wörtern)' : `Challenge senden (${words.length} Wörter aus deinem Fehlerstapel)`));
  }

  shell(h('main.screen', {},
    h('header.page-head', {}, h('h1', {}, 'Duell')),
    table,
    h('h2', {}, 'Gemeinsames Wochenziel'),
    h('div.goal', {}, h('div.goal-fill', { style: { transform: `scaleX(${Math.min(1, sum / goal)})` } })),
    h('p.muted', {}, `${fmtNum(sum)} von ${fmtNum(goal)} XP. Neustart jeden Montag.`),
    h('h2', {}, 'Challenge'),
    chBox));
  for (const b of goalBadge) await celebrate('badge', E.BADGES[b].name);
}

// ---------- Profil ----------

function viewProfile() {
  const u = S.user;
  const badges = Object.entries(E.BADGES).map(([id, b]) => h(`li.badge${u.badges[id] ? '.earned' : ''}`, {}, h('span.badge-name', {}, b.name), h('span.badge-desc', {}, b.desc)));
  const lessonsDone = u.pos.lesson - 1;
  shell(h('main.screen', {},
    h('header.page-head', {}, h('h1', {}, u.name)),
    h('div.stats-row', {}, stat('XP gesamt', fmtNum(u.xp.total)), stat('Lektionen', fmtNum(lessonsDone)), stat('Fehler abgebaut', fmtNum(u.fixedCount || 0))),
    h('h2', {}, 'Abzeichen'),
    h('ul.badges', {}, ...badges),
    S.installPrompt ? h('button.btn.wide', { type: 'button', onclick: async () => { S.installPrompt.prompt(); S.installPrompt = null; renderView(); } }, 'App auf dem Startbildschirm installieren') : null,
    h('button.btn.wide', { type: 'button', onclick: () => { S.user = null; if (!S.demo) localStorage.removeItem(LAST_PROFILE); viewProfiles(); } }, 'Profil wechseln'),
    h('p.muted.small', {}, `Version ${APP_VERSION}${S.store.mode === 'local' ? ', Testbetrieb (lokal)' : ''}`)));
}

// ---------- Demo-Modus ----------

async function enterDemo() {
  S.demo = true;
  S.store = await new LocalStore('demo').init();
  setDayOffset(Number(localStorage.getItem('spanischapp:demo:offset') || 0));
  if (!(await S.store.getUser('demo2'))) {
    const p = E.newUser(profiles()[1]);
    p.pos = { lesson: 1, level: 5 }; p.xp.week = 420; p.xp.total = 420; p.wordsLearned = 40;
    await S.store.setUser('demo2', p);
  }
  await openProfile('demo');
  S.view = 'demo'; renderView();
}

function exitDemo() {
  S.demo = false; S.store = S.mainStore; S.ignoreLock = false; setDayOffset(0);
  S.user = null; S.session = null; S.side = null;
  const last = localStorage.getItem(LAST_PROFILE);
  if (last) openProfile(last); else viewProfiles();
}

function viewDemo() {
  if (!S.demo) { S.view = 'home'; return renderView(); }
  const lessonSel = h('select', { 'aria-label': 'Lektion' }, ...content.course.lessons.filter(l => l.pack).map(l => h('option', { value: l.n, selected: l.n === S.user.pos.lesson }, `Lektion ${l.n}`)));
  const levelSel = h('select', { 'aria-label': 'Level' }, ...Array.from({ length: 11 }, (_, i) => h('option', { value: i + 1, selected: i + 1 === S.user.pos.level }, levelLabel(i + 1))));
  const gallery = ALL_TYPES.map(t => h('button.btn', { type: 'button', onclick: () => demoGallery(t) }, {
    de_es: 'DE→ES tippen', es_de: 'ES→DE tippen', mc: 'Multiple Choice', match: 'Paare', scramble: 'Buchstabensalat',
  }[t]));
  shell(h('main.screen', {},
    h('header.page-head', {}, h('h1', {}, 'Demo-Steuerung')),
    h('p.muted', {}, 'Nur zum Testen. Läuft auf dem Profil «Demo»; eure echten Profile bleiben unverändert.'),
    h('label.switch', {}, h('input', { type: 'checkbox', checked: S.ignoreLock, onchange: e => { S.ignoreLock = e.target.checked; } }), ' Tagessperre ausschalten'),
    h('h2', {}, 'Springen zu'),
    h('div.row', {}, lessonSel, levelSel, h('button.btn.primary', {
      type: 'button', onclick: async () => {
        S.user.pos = { lesson: Number(lessonSel.value), level: Number(levelSel.value) };
        S.user.lastLevelDay = null; S.session = null; await saveSession(); await saveUser();
        await loadPacksUpTo(S.user.pos.lesson);
        S.view = 'home'; renderView();
      },
    }, 'Los')),
    h('h2', {}, 'Datum'),
    h('div.row', {},
      h('button.btn', { type: 'button', onclick: () => { const n = getDayOffset() + 1; setDayOffset(n); localStorage.setItem('spanischapp:demo:offset', n); renderView(); } }, '+1 Tag vorspulen'),
      h('button.btn.ghost', { type: 'button', onclick: () => { setDayOffset(0); localStorage.setItem('spanischapp:demo:offset', 0); renderView(); } }, 'Zurück auf heute')),
    h('p.muted.small', {}, `Simuliertes Datum: ${today()}`),
    h('h2', {}, 'Fragetypen ansehen'),
    h('div.gallery', {}, ...gallery),
    h('h2', {}, 'Animationen'),
    h('div.gallery', {},
      h('button.btn', { type: 'button', onclick: () => celebrate('level', '+120 XP') }, 'Level'),
      h('button.btn', { type: 'button', onclick: () => celebrate('lesson', 'Lektion 1 geschafft.') }, 'Lektion'),
      h('button.btn', { type: 'button', onclick: () => celebrate('camp', 'Basislager 1') }, 'Basislager'),
      h('button.btn', { type: 'button', onclick: () => celebrate('hut', 'Hütte 1') }, 'Hütte'),
      h('button.btn', { type: 'button', onclick: () => { S.climb = { from: 0 }; S.view = 'home'; renderView(); } }, 'Avatar klettert')),
    h('h2', {}, 'Zurücksetzen'),
    h('div.row', {},
      h('button.btn', { type: 'button', onclick: async () => { if (!confirm('Alle Demo-Daten löschen?')) return; S.store.wipe(); setDayOffset(0); await openProfile('demo'); S.view = 'demo'; renderView(); } }, 'Demo-Daten löschen'),
      h('button.btn.ghost', { type: 'button', onclick: exitDemo }, 'Demo beenden'))));
}

async function demoGallery(type) {
  await loadPacksUpTo(Math.max(1, S.user.pos.lesson));
  const ids = shuffle(Object.keys(content.words)).slice(0, 5);
  const item = type === 'match' ? { k: 'demo', t: 'match', ws: ids, rep: false, nq: true, done: false } : { k: 'demo', t: type, w: ids[0], rep: false, nq: true, done: false };
  if (type === 'scramble') { const w = Object.values(content.words).find(x => x.pos === 'noun' && !/\s/.test(x.es.replace(/^(el|la) /, ''))); item.w = w.id; }
  const root = h('div.exercise');
  S.side = { kind: 'gallery' };
  sessionShell(root);
  renderExercise(root, item, { onCheck: () => {}, next: () => { S.side = null; S.view = 'demo'; renderView(); } });
}

boot();
