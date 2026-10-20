// Speicher-Schicht. Zwei Varianten mit derselben Schnittstelle:
// - FirebaseStore: echter Betrieb, Fortschritt in Firestore (eine Quelle für alle Geräte)
// - LocalStore: lokaler Testbetrieb (ohne Firebase-Konfiguration) und Demo-Modus

const FIREBASE_VERSION = '12.19.0';

let pending = 0;
const listeners = new Set();
export function onPendingChange(fn) { listeners.add(fn); }
function track(promise) {
  pending++; listeners.forEach(f => f(pending));
  return promise
    .catch(err => { console.error('Speichern fehlgeschlagen', err); })
    .finally(() => { pending--; listeners.forEach(f => f(pending)); });
}
export function pendingWrites() { return pending; }

const clone = o => (o === undefined ? undefined : JSON.parse(JSON.stringify(o)));

export class LocalStore {
  constructor(ns = 'local') { this.ns = ns; this.mode = 'local'; }
  key(...p) { return `spanischapp:${this.ns}:${p.join(':')}`; }
  read(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } }
  write(k, v) {
    try {
      if (v === null || v === undefined) localStorage.removeItem(k);
      else localStorage.setItem(k, JSON.stringify(v));
    } catch (e) { console.error(e); }
  }
  async init() { return this; }
  async getUser(uid) { return this.read(this.key('user', uid)); }
  async setUser(uid, data) { this.write(this.key('user', uid), clone(data)); }
  async getCards(uid) { return this.read(this.key('cards', uid)) || {}; }
  async saveCard(uid, card) {
    const all = this.read(this.key('cards', uid)) || {};
    all[card.w] = clone(card);
    this.write(this.key('cards', uid), all);
  }
  async getSession(uid) { return this.read(this.key('session', uid)); }
  async setSession(uid, s) { this.write(this.key('session', uid), s ? clone(s) : null); }
  async addHistory(uid, entry) {
    const list = this.read(this.key('history', uid)) || [];
    list.push(clone(entry));
    this.write(this.key('history', uid), list.slice(-500));
  }
  async getHistory(uid) { return this.read(this.key('history', uid)) || []; }
  async getChallenge(fromUid) { return this.read(this.key('challenge', fromUid)); }
  async setChallenge(fromUid, data) { this.write(this.key('challenge', fromUid), data ? clone(data) : null); }
  wipe() {
    const prefix = `spanischapp:${this.ns}:`;
    Object.keys(localStorage).filter(k => k.startsWith(prefix)).forEach(k => localStorage.removeItem(k));
  }
}

export class FirebaseStore {
  constructor(firebaseConfig) { this.cfg = firebaseConfig; this.mode = 'firebase'; }

  async init() {
    const base = `https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}`;
    const [appMod, authMod, fsMod] = await Promise.all([
      import(`${base}/firebase-app.js`),
      import(`${base}/firebase-auth.js`),
      import(`${base}/firebase-firestore.js`),
    ]);
    this.fs = fsMod;
    const app = appMod.initializeApp(this.cfg);
    const auth = authMod.getAuth(app);
    await authMod.signInAnonymously(auth); // nur damit Fremde ohne Anmeldung nicht schreiben können
    this.db = fsMod.getFirestore(app);
    return this;
  }

  d(...path) { return this.fs.doc(this.db, ...path); }

  async getUser(uid) {
    const s = await this.fs.getDoc(this.d('users', uid));
    return s.exists() ? s.data() : null;
  }
  async setUser(uid, data) { return track(this.fs.setDoc(this.d('users', uid), clone(data))); }

  // Karten sind pro Lektion in einem Dokument gebündelt (spart Lesevorgänge: max. 45 statt 4'050)
  async getCards(uid) {
    const snap = await this.fs.getDocs(this.fs.collection(this.db, 'users', uid, 'cards'));
    const all = {};
    snap.forEach(docSnap => Object.assign(all, docSnap.data().cards || {}));
    return all;
  }
  async saveCard(uid, card) {
    return track(this.fs.setDoc(this.d('users', uid, 'cards', card.l), { cards: { [card.w]: clone(card) } }, { merge: true }));
  }

  async getSession(uid) {
    const s = await this.fs.getDoc(this.d('users', uid, 'meta', 'session'));
    return s.exists() ? (s.data().s || null) : null;
  }
  async setSession(uid, sess) {
    return track(this.fs.setDoc(this.d('users', uid, 'meta', 'session'), { s: sess ? clone(sess) : null }));
  }

  async addHistory(uid, entry) {
    return track(this.fs.addDoc(this.fs.collection(this.db, 'users', uid, 'history'), clone(entry)));
  }
  async getHistory(uid) {
    const q = this.fs.query(this.fs.collection(this.db, 'users', uid, 'history'), this.fs.orderBy('ts', 'desc'), this.fs.limit(60));
    const snap = await this.fs.getDocs(q);
    const list = [];
    snap.forEach(d => list.push(d.data()));
    return list.reverse();
  }

  async getChallenge(fromUid) {
    const s = await this.fs.getDoc(this.d('challenges', fromUid));
    return s.exists() ? (s.data().c || null) : null;
  }
  async setChallenge(fromUid, data) {
    return track(this.fs.setDoc(this.d('challenges', fromUid), { c: data ? clone(data) : null }));
  }
}

export async function createStore(config) {
  const fc = config.firebase || {};
  const configured = fc.apiKey && !String(fc.apiKey).startsWith('HIER');
  if (!configured) return new LocalStore('local').init();
  return new FirebaseStore(fc).init();
}
