// Checks the translations in lang.js against the English text in the code.
// Usage: node tools/check-lang.js
// Lists English strings with no Malay or Chinese yet, and rows whose {placeholders}
// don't match the English. Exits with 1 if anything is wrong.
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const lit = (q) => vm.runInNewContext(q); // our own source: safe to evaluate a string literal
const STR = String.raw`('(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*")`;

const out = {};
const add = (group, s) => {
  if (typeof s !== 'string' || !/[A-Za-z]/.test(s)) return;
  (out[group] = out[group] || new Set()).add(s);
};

function literalCalls(src, group) {
  // T('...'), plural(n, '...', '...'), friendlyError('...')
  let re = new RegExp(String.raw`\bT\(\s*` + STR, 'g');
  let m;
  while ((m = re.exec(src))) add(group, lit(m[1]));
  re = new RegExp(String.raw`\bplural\([^,]+,\s*` + STR + String.raw`\s*,\s*` + STR, 'g');
  while ((m = re.exec(src))) { add(group, lit(m[1])); add(group, lit(m[2])); }
  re = new RegExp(String.raw`\bfriendlyError\(\s*` + STR, 'g');
  while ((m = re.exec(src))) add(group, lit(m[1]));
  // T(x || 'fallback') and T(cond ? 'a' : 'b') style fallbacks inside T(...)
  re = new RegExp(String.raw`\bT\([^;\n]*?\|\|\s*` + STR + String.raw`\s*\)`, 'g');
  while ((m = re.exec(src))) add(group, lit(m[1]));
  // T(cond ? 'a' : 'b', ...)
  re = new RegExp(String.raw`\bT\((?:[^;\n?'"()]|` + STR + String.raw`)*?\?\s*` + STR + String.raw`\s*:\s*` + STR, 'g');
  while ((m = re.exec(src))) { add(group, lit(m[m.length - 2])); add(group, lit(m[m.length - 1])); }
}

/** The source text of `var NAME = ...;` (balanced brackets). */
function block(src, name) {
  const i = src.indexOf('var ' + name + ' =');
  if (i < 0) throw new Error('missing table ' + name);
  let j = src.indexOf('=', i) + 1;
  while (/\s/.test(src[j])) j++;
  const open = src[j];
  const close = open === '[' ? ']' : '}';
  let depth = 0;
  for (let k = j; k < src.length; k++) {
    const c = src[k];
    if (c === "'" || c === '"') { // skip strings
      const m = new RegExp(STR, 'y');
      m.lastIndex = k;
      const r = m.exec(src);
      k += r[0].length - 1;
      continue;
    }
    if (c === open) depth++;
    else if (c === close && --depth === 0) return src.slice(j, k + 1);
  }
  throw new Error('unbalanced ' + name);
}

function tableProps(src, name, props, group) {
  const b = block(src, name);
  const re = new RegExp(String.raw`\b(` + props.join('|') + String.raw`):\s*` + STR, 'g');
  let m;
  while ((m = re.exec(b))) add(group, lit(m[2]));
}

function tableValues(src, name, group) {
  const b = block(src, name);
  // values: strings after ':' or inside arrays (not keys)
  const re = new RegExp(String.raw`(?:[:\[,]\s*)` + STR + String.raw`(?!\s*:)`, 'g');
  let m;
  while ((m = re.exec(b))) add(group, lit(m[1]));
}

const app = read('app.js');
const coach = read('coach.js');
literalCalls(app, 'app');
literalCalls(coach, 'coach');

['NAMES', 'COLOR_NAMES', 'A_NAMES', 'LOSS_WORDS', 'EXTRA_WORDS'].forEach((n) => tableValues(coach, n, 'coach-tables'));
tableProps(app, 'LEVELS', ['name', 'blurb'], 'app-tables');
tableProps(app, 'TIME_CONTROLS', ['phrase'], 'app-tables');
tableProps(app, 'TIME_KINDS', ['name', 'help', 'friendHelp'], 'app-tables');
tableProps(app, 'GAME_MODES', ['name', 'sub', 'help'], 'app-tables');
tableProps(app, 'ODDS', ['name'], 'app-tables');
tableProps(app, 'GOALS', ['label', 'button'], 'app-tables');
tableProps(app, 'BADGES', ['name', 'desc'], 'app-tables');
tableProps(app, 'PUZZLE_THEMES', ['name', 'title', 'help'], 'app-tables');
['QUALITY_NAMES', 'GOAL_HELP', 'LEVEL_TITLES'].forEach((n) => tableValues(app, n, 'app-tables'));
// draw reasons and the history "how" map are inline objects
{
  let m = app.match(/stalemate: \["[\s\S]*?fifty: \[[^\]]*\]/);
  if (!m) throw new Error('draw reasons not found');
  const re = new RegExp(STR, 'g');
  let r;
  while ((r = re.exec(m[0]))) add('app-tables', lit(r[1]));
  m = app.match(/var how = T\(\{[^}]*\}/);
  if (!m) throw new Error('history map not found');
  const re2 = new RegExp(String.raw`:\s*` + STR, 'g');
  while ((r = re2.exec(m[0]))) add('app-tables', lit(r[1]));
}

// Lessons
{
  const sandbox = { window: {} };
  vm.runInNewContext(read('lessons.js'), sandbox);
  (sandbox.window.LESSONS || []).forEach((u) => {
    add('lessons', u.title);
    u.lessons.forEach((l) => {
      add('lessons', l.title);
      add('lessons', l.intro);
      l.steps.forEach((s) => {
        ['text', 'tip', 'done', 'wrong'].forEach((k) => s[k] && add('lessons', s[k]));
        if (s.type === 'line') s.moves.forEach((m) => { if (m.say) add('lessons', m.say); if (m.why) add('lessons', m.why); });
      });
    });
  });
}

// index.html and about.html: whole text nodes and a few attributes, normalised like I18N.translateDom
for (const page of ['index.html', 'about.html']) {
  const group = page === 'index.html' ? 'html' : 'about';
  const html = read(page).replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<!--[\s\S]*?-->/g, '');
  const body = html.slice(html.search(/<body[\s>]/i));
  const decode = (s) => s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ').replace(/&middot;/g, '·').replace(/&times;/g, '×').replace(/&rarr;/g, '→').replace(/&hellip;/g, '…');
  body.replace(/>([^<]+)</g, (m, t) => {
    const s = decode(t).replace(/\s+/g, ' ').trim();
    if (s) add(group, s);
    return m;
  });
  body.replace(/\s(aria-label|title|alt|placeholder)="([^"]*)"/g, (m, a, v) => {
    add(group, decode(v));
    return m;
  });
  const t = html.match(/<title>([^<]*)<\/title>/);
  if (t) add(group, decode(t[1]).trim());
}

// Compare with lang.js
const rows = [];
vm.runInNewContext(read('lang.js'), { I18N: { addRows: (r) => rows.push(...r) } });
const have = new Map(rows.map((r) => [r[0], r]));
const SKIP = new Set(['English', 'Bahasa Melayu', '中文']);
const ph = (s) => (s.match(/\{\w+\}/g) || []).sort().join(' ');
let bad = 0;
Object.keys(out).forEach((g) => out[g].forEach((en) => {
  if (SKIP.has(en)) return;
  const r = have.get(en);
  if (!r || !r[1] || !r[2]) { bad++; console.log('missing (' + g + '): ' + en); return; }
  [1, 2].forEach((i) => {
    if (ph(r[i]) !== ph(en)) { bad++; console.log('placeholders differ: ' + en + ' -> ' + r[i]); }
  });
}));
console.log(bad ? bad + ' problem(s)' : 'lang.js covers all ' + have.size + ' strings');
process.exit(bad ? 1 : 0);
