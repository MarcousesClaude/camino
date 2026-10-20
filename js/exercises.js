// Darstellung der Fragetypen. Jede Funktion zeichnet eine Frage in «root»,
// meldet das Ergebnis über ctx.onCheck(results) (wird sofort gespeichert)
// und ruft ctx.next() auf, wenn die Person «Weiter» tippt.
import { h, clear, shuffle, sample } from './util.js';
import { content } from './content.js';
import { gradeEs, gradeDe, normEs, reasonText } from './grading.js';
import { stripArticle } from './engine.js';

const TYPE_LABEL = {
  de_es: 'Auf Spanisch schreiben', es_de: 'Auf Deutsch schreiben', g: 'Grammatik',
  mc: 'Richtige Antwort wählen', match: 'Paare finden', scramble: 'Wort zusammensetzen',
};

export function render(root, item, ctx) {
  clear(root);
  if (item.t === 'match') return renderMatch(root, item, ctx);
  if (item.t === 'mc') return renderMC(root, item, ctx);
  if (item.t === 'scramble') return renderScramble(root, item, ctx);
  return renderTyping(root, item, ctx);
}

function typeTag(t, rep) {
  return h('p.qtype', {}, rep ? 'Nochmals: ' + (TYPE_LABEL[t] || '') : (TYPE_LABEL[t] || ''));
}

// Lösungs-Infos eines Worts oder einer Grammatikübung
function solutionOf(item) {
  if (item.g) {
    const ex = content.exercises[item.g];
    return { prompt: ex.prompt, hint: ex.hint || null, answer: ex.answer, accept: ex.accept || [], isNoun: /^(el|la|los|las|un|una|unos|unas) /i.test(ex.answer), isSentence: !!ex.sentence, note: ex.explain || null, pattern: null };
  }
  const w = content.words[item.w];
  return { prompt: w.de, hint: w.hintDe, answer: w.es, accept: w.acceptEs || [], isNoun: w.pos === 'noun', isSentence: false, note: w.note || null, pattern: w.pattern || null, word: w };
}

function feedbackBox(ok, lines) {
  return h(`div.feedback.${ok ? 'ok' : 'bad'}`, { role: 'status' },
    h('p.fb-title', {}, ok ? 'Richtig' : 'Nicht ganz'),
    ...lines.filter(Boolean).map(l => (l instanceof Node ? l : h('p', {}, l))));
}

function nextButton(ctx) {
  const b = h('button.btn.primary.wide', { type: 'button', onclick: () => ctx.next() }, 'Weiter');
  setTimeout(() => b.focus(), 30);
  return b;
}

// ---------- Tippen (DE→ES, ES→DE, Grammatik) ----------

function renderTyping(root, item, ctx) {
  const toDe = item.t === 'es_de';
  const sol = solutionOf(item);
  const prompt = toDe ? sol.word.es : sol.prompt;

  const input = h('input.answer', {
    type: 'text', autocomplete: 'off', autocorrect: 'off', autocapitalize: 'off', spellcheck: 'false',
    lang: toDe ? 'de' : 'es', enterkeyhint: 'done', 'aria-label': 'Deine Antwort',
    placeholder: toDe ? 'Deutsch…' : 'Español…',
  });
  const insert = ch => {
    const s = input.selectionStart ?? input.value.length, e = input.selectionEnd ?? input.value.length;
    input.value = input.value.slice(0, s) + ch + input.value.slice(e);
    input.focus(); input.setSelectionRange(s + ch.length, s + ch.length);
  };
  const helpers = toDe ? null : h('div.charbar', {},
    ...['ñ', ...(sol.isSentence ? ['¿', '¡'] : [])].map(ch =>
      h('button.charbtn', { type: 'button', onmousedown: e => e.preventDefault(), onclick: () => insert(ch) }, ch)));

  const checkBtn = h('button.btn.primary.wide', { type: 'button' }, 'Prüfen');
  const fbArea = h('div.fbarea');
  let checked = false;

  const check = () => {
    if (checked) { ctx.next(); return; }
    if (!input.value.trim()) { input.focus(); return; }
    checked = true;
    const res = toDe ? gradeDe(input.value, sol.word.de, sol.word.acceptDe) : gradeEs(input.value, sol.answer, sol.accept, { isNoun: sol.isNoun, isSentence: sol.isSentence });
    input.readOnly = true;
    input.classList.add(res.ok ? 'is-ok' : 'is-bad');
    const lines = [];
    if (res.ok) {
      const shown = toDe ? null : (normEs(input.value) === normEs(sol.answer) && input.value.trim() !== sol.answer ? `Geschrieben: ${sol.answer}` : null);
      lines.push(shown);
      if (toDe) lines.push(`${sol.word.es} = ${sol.word.de}`);
    } else {
      lines.push(h('p', {}, 'Richtig wäre: ', h('strong', { lang: toDe ? 'de' : 'es' }, toDe ? sol.word.de : sol.answer)));
      lines.push(reasonText(res.reason));
    }
    if (sol.pattern) lines.push(`Muster: ${sol.pattern.es} – ${sol.pattern.de}`);
    if (sol.note && (!res.ok || item.g)) lines.push(sol.note);
    fbArea.append(feedbackBox(res.ok, lines));
    checkBtn.replaceWith(nextButton(ctx));
    ctx.onCheck(item.g ? [{ g: item.g, ok: res.ok }] : [{ w: item.w, ok: res.ok }]);
  };
  checkBtn.addEventListener('click', check);
  input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); check(); } });

  root.append(
    typeTag(item.t, item.rep),
    h('div.prompt', {},
      h('p.prompt-text', { lang: toDe ? 'es' : 'de' }, prompt),
      sol.hint && !toDe ? h('p.prompt-hint', {}, sol.hint) : null),
    h('div.answer-zone', {}, input, helpers, fbArea, checkBtn),
  );
  setTimeout(() => input.focus(), 50);
}

// ---------- Multiple Choice ----------

function distractors(word, n, field) {
  const pool = Object.values(content.words).filter(w => w.id !== word.id && w.lessonN <= ctxLesson() && w[field] !== word[field]);
  const same = pool.filter(w => w.pos === word.pos);
  const chosen = sample(same.length >= n ? same : pool, n);
  return chosen.map(w => w[field]);
}
let _lessonForDistractors = 1;
export function setDistractorLesson(n) { _lessonForDistractors = n; }
function ctxLesson() { return _lessonForDistractors; }

function renderMC(root, item, ctx) {
  const w = content.words[item.w];
  const toEs = Math.random() < 0.5;
  const q = toEs ? w.de : w.es;
  const correct = toEs ? w.es : w.de;
  const options = shuffle([correct, ...distractors(w, 3, toEs ? 'es' : 'de')]);
  const fbArea = h('div.fbarea');
  let done = false;
  const list = h('div.options', {}, ...options.map(opt => h('button.option', {
    type: 'button', lang: toEs ? 'es' : 'de',
    onclick: e => {
      if (done) return;
      done = true;
      const ok = opt === correct;
      [...list.children].forEach(b => {
        b.disabled = true;
        if (b.textContent === correct) b.classList.add('is-ok');
      });
      if (!ok) e.currentTarget.classList.add('is-bad');
      fbArea.append(feedbackBox(ok, [ok ? null : h('p', {}, 'Richtig wäre: ', h('strong', {}, correct)), w.note && !ok ? w.note : null]));
      fbArea.append(nextButton(ctx));
      ctx.onCheck([{ w: w.id, ok }]);
    },
  }, opt)));
  root.append(typeTag('mc', item.rep), h('div.prompt', {}, h('p.prompt-text', { lang: toEs ? 'de' : 'es' }, q), w.hintDe && toEs ? h('p.prompt-hint', {}, w.hintDe) : null), list, fbArea);
}

// ---------- Paare finden ----------

function renderMatch(root, item, ctx) {
  const words = item.ws.map(id => content.words[id]);
  const wrong = new Set();
  let matched = 0, sel = null;
  const left = h('div.col'), right = h('div.col');
  const fbArea = h('div.fbarea');

  const mk = (w, side) => h('button.tile', {
    type: 'button', lang: side === 'l' ? 'de' : 'es', 'data-id': w.id, 'data-side': side,
    onclick: e => {
      const b = e.currentTarget;
      if (b.classList.contains('is-ok')) return;
      if (!sel || sel.dataset.side === side) {
        if (sel) sel.classList.remove('is-sel');
        sel = b; b.classList.add('is-sel'); return;
      }
      const leftBtn = side === 'l' ? b : sel;
      if (sel.dataset.id === b.dataset.id) {
        sel.classList.remove('is-sel'); sel.classList.add('is-ok'); b.classList.add('is-ok');
        sel.disabled = true; b.disabled = true; matched++;
        if (matched === words.length) {
          const results = words.map(x => ({ w: x.id, ok: !wrong.has(x.id) }));
          const misses = words.filter(x => wrong.has(x.id));
          fbArea.append(feedbackBox(!misses.length, misses.map(x => `${x.de} = ${x.es}`)));
          fbArea.append(nextButton(ctx));
          ctx.onCheck(results);
        }
      } else {
        wrong.add(leftBtn.dataset.id);
        const a = sel, c = b;
        a.classList.add('is-bad'); c.classList.add('is-bad');
        setTimeout(() => { a.classList.remove('is-bad', 'is-sel'); c.classList.remove('is-bad'); }, 450);
      }
      sel = null;
    },
  }, side === 'l' ? w.de : w.es);

  shuffle(words).forEach(w => left.append(mk(w, 'l')));
  shuffle(words).forEach(w => right.append(mk(w, 'r')));
  root.append(typeTag('match', false), h('p.prompt-hint', {}, 'Tippe ein deutsches Wort und dann das passende spanische.'), h('div.match', {}, left, right), fbArea);
}

// ---------- Buchstabensalat ----------

function renderScramble(root, item, ctx) {
  const w = content.words[item.w];
  const target = stripArticle(w.es);
  const article = w.es.slice(0, w.es.length - target.length).trim();
  const letters = shuffle([...target].map((ch, i) => ({ ch, i })));
  const built = [];
  const out = h('p.built', { lang: 'es' });
  const fbArea = h('div.fbarea');
  const pool = h('div.letters');
  let done = false;

  const refresh = () => { out.textContent = (article ? article + ' ' : '') + built.map(b => b.ch).join(''); };
  const finish = () => {
    done = true;
    const ok = built.map(b => b.ch).join('') === target;
    out.classList.add(ok ? 'is-ok' : 'is-bad');
    fbArea.append(feedbackBox(ok, [ok ? null : h('p', {}, 'Richtig wäre: ', h('strong', {}, w.es))]));
    fbArea.append(nextButton(ctx));
    ctx.onCheck([{ w: w.id, ok }]);
  };
  letters.forEach(l => pool.append(h('button.letter', {
    type: 'button',
    onclick: e => {
      if (done) return;
      e.currentTarget.disabled = true; built.push({ ...l, btn: e.currentTarget }); refresh();
      if (built.length === target.length) finish();
    },
  }, l.ch)));
  const undo = h('button.btn.ghost', { type: 'button', onclick: () => { if (done || !built.length) return; built.pop().btn.disabled = false; refresh(); } }, 'Zurück');
  refresh();
  root.append(typeTag('scramble', item.rep), h('div.prompt', {}, h('p.prompt-text', { lang: 'de' }, w.de)), out, pool, h('div.row', {}, undo), fbArea);
}

// ---------- Speed-Runde (60 Sekunden, Bonus) ----------

export function renderSpeed(root, wordIds, { onAnswer, onEnd, seconds = 60 }) {
  clear(root);
  const timer = h('div.timer', {}, h('div.timer-bar'));
  const scoreEl = h('p.speed-score', {}, '0 richtig');
  const stage = h('div.speed-stage');
  root.append(h('p.qtype', {}, 'Speed-Runde: so viele wie möglich in 60 Sekunden'), timer, scoreEl, stage);
  let score = 0, ended = false;
  const order = shuffle(wordIds);
  let i = 0;
  const bar = timer.firstChild;
  bar.style.transition = `transform ${seconds}s linear`;
  requestAnimationFrame(() => requestAnimationFrame(() => { bar.style.transform = 'scaleX(0)'; }));
  const t = setTimeout(() => { ended = true; onEnd(score); }, seconds * 1000);

  const show = () => {
    if (ended) return;
    if (i >= order.length) i = 0;
    const w = content.words[order[i++]];
    const opts = shuffle([w.de, ...distractors(w, 3, 'de')]);
    clear(stage).append(h('p.prompt-text', { lang: 'es' }, w.es), h('div.options', {}, ...opts.map(o => h('button.option', {
      type: 'button',
      onclick: () => {
        if (ended) return;
        const ok = o === w.de;
        if (ok) { score++; scoreEl.textContent = `${score} richtig`; }
        stage.classList.add(ok ? 'flash-ok' : 'flash-bad');
        onAnswer({ w: w.id, ok });
        setTimeout(() => { stage.classList.remove('flash-ok', 'flash-bad'); show(); }, 220);
      },
    }, o))));
  };
  show();
  return () => { clearTimeout(t); ended = true; };
}

export const ALL_TYPES = ['de_es', 'es_de', 'mc', 'match', 'scramble'];
