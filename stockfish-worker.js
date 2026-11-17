/*
 * stockfish-worker.js
 * ---------------------------------------------------------------------------
 * Web Worker that runs the chess engine off the main thread so the board never
 * freezes. It speaks a small JSON protocol with app.js and UCI with Stockfish.
 *
 *   main -> worker   { type: 'init' }
 *                    { type: 'search', id, fen, depth, movetime, skill, multipv }
 *                    { type: 'newGame' }
 *                    { type: 'cancelAll' }
 *
 *   worker -> main   { type: 'status', text }
 *                    { type: 'ready', engine, flavor, source }
 *                    { type: 'result', id, bestMove, ponder, score, depth, pv, lines, nodes, cancelled }
 *                    { type: 'fatal', error }
 *
 * Flavors (chosen with ?engine=... in the worker URL):
 *   stockfish  Stockfish 10 (pure JavaScript build) loaded from a CDN.
 *   lite       A small built-in alpha-beta engine, used automatically by
 *              app.js only if Stockfish cannot be downloaded.
 */

/* global importScripts, Chess, STOCKFISH */

var STOCKFISH_URLS = [
  'https://cdnjs.cloudflare.com/ajax/libs/stockfish.js/10.0.2/stockfish.js',
  'https://cdn.jsdelivr.net/npm/stockfish.js@10.0.2/stockfish.js'
];

var CHESSJS_URLS = [
  'https://cdnjs.cloudflare.com/ajax/libs/chess.js/0.10.3/chess.min.js',
  'https://cdn.jsdelivr.net/npm/chess.js@0.10.3/chess.js'
];

var FLAVOR = (function () {
  try {
    var p = new URLSearchParams(self.location.search);
    return p.get('engine') === 'lite' ? 'lite' : 'stockfish';
  } catch (e) {
    return 'stockfish';
  }
})();

/* ------------------------------------------------------------------------ */
/* Plumbing: keep our own channel to the page separate from the engine's.    */
/* ------------------------------------------------------------------------ */

var nativePostMessage = self.postMessage.bind(self);
var nativeAddEventListener = self.addEventListener.bind(self);

function toMain(msg) {
  nativePostMessage(msg);
}

// Handlers the engine registers for incoming UCI commands.
var engineInputHandlers = [];

// Engine output arrives as strings through postMessage; route it to the
// UCI parser instead of the page. Objects (our own protocol) pass through.
self.postMessage = function (data) {
  if (typeof data === 'string') {
    var lines = data.split('\n');
    for (var i = 0; i < lines.length; i++) handleEngineLine(lines[i]);
    return;
  }
  return nativePostMessage.apply(self, arguments);
};

// Capture any message listener the engine adds, so it only ever sees UCI text.
self.addEventListener = function (type, listener, options) {
  if (type === 'message' && typeof listener === 'function') {
    engineInputHandlers.push(listener);
    return undefined;
  }
  return nativeAddEventListener(type, listener, options);
};

// Capture `onmessage = fn` assignments made by the engine script.
var onmessageTrapInstalled = false;
try {
  var capturedOnMessage = null;
  Object.defineProperty(self, 'onmessage', {
    configurable: true,
    enumerable: true,
    get: function () { return capturedOnMessage; },
    set: function (fn) {
      capturedOnMessage = fn;
      if (typeof fn === 'function' && engineInputHandlers.indexOf(fn) === -1) {
        engineInputHandlers.push(fn);
      }
    }
  });
  onmessageTrapInstalled = true;
} catch (e) {
  onmessageTrapInstalled = false;
}

function engineCommand(cmd) {
  for (var i = 0; i < engineInputHandlers.length; i++) {
    try {
      engineInputHandlers[i].call(self, { data: cmd });
    } catch (err) {
      toMain({ type: 'fatal', error: 'Engine crashed while handling "' + cmd + '": ' + (err && err.message ? err.message : String(err)) });
    }
  }
}

/* ------------------------------------------------------------------------ */
/* Job queue (shared by both flavors).                                       */
/* ------------------------------------------------------------------------ */

var queue = [];
var current = null; // { job, best, lines, watchdog, cancelled }
var engineReady = false;
var engineName = '';
var engineSource = '';

var uciState = 'idle'; // idle -> uci -> isready -> ready
var uciRetryTimer = null;
var uciDeadlineTimer = null;
var currentSkill = null;
var currentMultiPV = 1;

function clampInt(v, lo, hi, fallback) {
  var n = parseInt(v, 10);
  if (isNaN(n)) n = fallback;
  return Math.max(lo, Math.min(hi, n));
}

function enqueue(job) {
  queue.push(job);
  pump();
}

function pump() {
  if (!engineReady || current || queue.length === 0) return;
  var job = queue.shift();
  current = { job: job, best: null, lines: {}, watchdog: null, cancelled: false };
  if (FLAVOR === 'lite') {
    setTimeout(runLiteJob, 0);
  } else {
    runStockfishJob(job);
  }
}

function cancelAll() {
  queue = [];
  if (current && !current.cancelled) {
    current.cancelled = true;
    if (FLAVOR === 'stockfish' && current.job.kind === 'search') engineCommand('stop');
  }
}

nativeAddEventListener('message', function (event) {
  var msg = event.data;
  if (!msg || typeof msg !== 'object') return;
  switch (msg.type) {
    case 'init':
      if (uciState === 'idle' && !engineReady) boot();
      break;
    case 'search':
      enqueue({
        kind: 'search',
        id: msg.id,
        fen: String(msg.fen || ''),
        depth: msg.depth ? clampInt(msg.depth, 1, 40, 12) : 0,
        movetime: msg.movetime ? clampInt(msg.movetime, 20, 60000, 1000) : 0,
        skill: clampInt(msg.skill, 0, 20, 20),
        multipv: clampInt(msg.multipv, 1, 5, 1)
      });
      break;
    case 'newGame':
      enqueue({ kind: 'newgame', id: msg.id || 0 });
      break;
    case 'cancelAll':
      cancelAll();
      break;
    default:
      break;
  }
});

function boot() {
  if (FLAVOR === 'lite') bootLite();
  else bootStockfish();
}

function becomeReady() {
  if (engineReady) return;
  engineReady = true;
  uciState = 'ready';
  clearInterval(uciRetryTimer);
  clearTimeout(uciDeadlineTimer);
  toMain({ type: 'ready', engine: engineName || 'Stockfish', flavor: FLAVOR, source: engineSource });
  pump();
}

/* ------------------------------------------------------------------------ */
/* Stockfish flavor                                                          */
/* ------------------------------------------------------------------------ */

function bootStockfish() {
  toMain({ type: 'status', text: 'Downloading Stockfish…' });
  var loaded = false;
  var lastError = null;
  for (var i = 0; i < STOCKFISH_URLS.length && !loaded; i++) {
    try {
      importScripts(STOCKFISH_URLS[i]);
      loaded = true;
      engineSource = STOCKFISH_URLS[i];
    } catch (err) {
      lastError = err;
    }
  }
  if (!loaded) {
    toMain({ type: 'fatal', error: 'Could not download Stockfish (' + (lastError && lastError.message ? lastError.message : 'network error') + ').' });
    return;
  }

  // If defineProperty was unavailable, pick up a plain onmessage assignment now.
  if (!onmessageTrapInstalled && typeof self.onmessage === 'function') {
    engineInputHandlers.push(self.onmessage);
    self.onmessage = null;
  }

  // Older builds expose a STOCKFISH() factory instead of wiring the worker.
  if (engineInputHandlers.length === 0 && typeof STOCKFISH === 'function') {
    try {
      var sf = STOCKFISH();
      sf.onmessage = function (line) {
        var text = typeof line === 'string' ? line : (line && line.data) || '';
        String(text).split('\n').forEach(handleEngineLine);
      };
      engineInputHandlers.push(function (e) { sf.postMessage(e.data); });
    } catch (err) {
      toMain({ type: 'fatal', error: 'Stockfish failed to start: ' + err.message });
      return;
    }
  }

  toMain({ type: 'status', text: 'Starting Stockfish…' });
  waitForEngineHandler(0);
}

// Some builds finish wiring asynchronously; give them a moment.
function waitForEngineHandler(attempt) {
  if (engineInputHandlers.length > 0) {
    startUciHandshake();
    return;
  }
  if (attempt > 100) {
    toMain({ type: 'fatal', error: 'Stockfish loaded but never opened its UCI interface.' });
    return;
  }
  setTimeout(function () { waitForEngineHandler(attempt + 1); }, 50);
}

function startUciHandshake() {
  uciState = 'uci';
  engineCommand('uci');
  // Re-send "uci" until the engine answers (it may still be initialising).
  uciRetryTimer = setInterval(function () {
    if (uciState === 'uci') engineCommand('uci');
    else if (uciState === 'isready') engineCommand('isready');
  }, 2500);
  uciDeadlineTimer = setTimeout(function () {
    if (!engineReady) {
      clearInterval(uciRetryTimer);
      toMain({ type: 'fatal', error: 'Stockfish did not respond to the UCI handshake.' });
    }
  }, 20000);
}

function runStockfishJob(job) {
  if (job.kind === 'newgame') {
    engineCommand('ucinewgame');
    engineCommand('isready');
    return; // finished when "readyok" arrives
  }
  if (job.skill !== currentSkill) {
    engineCommand('setoption name Skill Level value ' + job.skill);
    currentSkill = job.skill;
  }
  if (job.multipv !== currentMultiPV) {
    engineCommand('setoption name MultiPV value ' + job.multipv);
    currentMultiPV = job.multipv;
  }
  engineCommand('position fen ' + job.fen);
  var go = 'go';
  if (job.depth) go += ' depth ' + job.depth;
  if (job.movetime) go += ' movetime ' + job.movetime;
  if (!job.depth && !job.movetime) go += ' depth 12';
  engineCommand(go);
  var budget = (job.movetime || 4000) + 8000;
  current.watchdog = setTimeout(function () {
    if (current && current.job === job) engineCommand('stop');
  }, budget);
}

function handleEngineLine(raw) {
  var line = String(raw || '').trim();
  if (!line) return;

  if (line.indexOf('id name ') === 0) {
    engineName = line.slice(8).trim();
    return;
  }
  if (line === 'uciok') {
    if (uciState === 'uci') {
      uciState = 'isready';
      engineCommand('isready');
    }
    return;
  }
  if (line === 'readyok') {
    if (uciState === 'isready') {
      becomeReady();
      return;
    }
    if (current && current.job.kind === 'newgame') {
      finishJob({ type: 'result', id: current.job.id, kind: 'newgame', cancelled: current.cancelled });
    }
    return;
  }
  if (!current || current.job.kind !== 'search') return;

  if (line.indexOf('info ') === 0) {
    parseInfo(line);
  } else if (line.indexOf('bestmove') === 0) {
    var parts = line.split(/\s+/);
    var best = parts[1] && parts[1] !== '(none)' && parts[1] !== '0000' ? parts[1] : null;
    var ponder = parts[2] === 'ponder' && parts[3] ? parts[3] : null;
    var main = current.lines[1] || null;
    var lines = Object.keys(current.lines)
      .map(function (k) { return current.lines[k]; })
      .sort(function (a, b) { return a.multipv - b.multipv; });
    finishJob({
      type: 'result',
      id: current.job.id,
      kind: 'search',
      fen: current.job.fen,
      bestMove: best,
      ponder: ponder,
      score: main ? main.score : null,
      depth: main ? main.depth : 0,
      pv: main && main.pv.length ? main.pv : (best ? [best] : []),
      nodes: main ? main.nodes : 0,
      lines: lines,
      cancelled: current.cancelled
    });
  }
}

function parseInfo(line) {
  var t = line.split(/\s+/);
  var info = { depth: 0, multipv: 1, score: null, bound: null, nodes: 0, pv: [] };
  for (var i = 1; i < t.length; i++) {
    switch (t[i]) {
      case 'string':
        return; // free-text info line
      case 'depth':
        info.depth = parseInt(t[++i], 10) || 0;
        break;
      case 'multipv':
        info.multipv = parseInt(t[++i], 10) || 1;
        break;
      case 'nodes':
        info.nodes = parseInt(t[++i], 10) || 0;
        break;
      case 'score': {
        var kind = t[++i];
        var value = parseInt(t[++i], 10);
        if ((kind === 'cp' || kind === 'mate') && !isNaN(value)) info.score = { type: kind, value: value };
        if (t[i + 1] === 'lowerbound' || t[i + 1] === 'upperbound') info.bound = t[++i];
        break;
      }
      case 'pv':
        info.pv = t.slice(i + 1);
        i = t.length;
        break;
      default:
        break;
    }
  }
  if (!info.score) return;
  var prev = current.lines[info.multipv];
  // Prefer exact scores; only accept a bound if we have nothing better yet.
  if (!prev || !info.bound || prev.bound) {
    if (!info.pv.length && prev && prev.pv.length) info.pv = prev.pv;
    current.lines[info.multipv] = info;
  }
}

function finishJob(result) {
  if (current && current.watchdog) clearTimeout(current.watchdog);
  current = null;
  toMain(result);
  pump();
}

/* ------------------------------------------------------------------------ */
/* Lite flavor: compact alpha-beta search on top of chess.js                 */
/* ------------------------------------------------------------------------ */

var Lite = (function () {
  var MATE = 100000;
  var VAL = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 0 };
  // Piece-square tables from White's point of view, a8 first, h1 last.
  var PST = {
    p: [
      0, 0, 0, 0, 0, 0, 0, 0,
      50, 50, 50, 50, 50, 50, 50, 50,
      10, 10, 20, 30, 30, 20, 10, 10,
      5, 5, 10, 25, 25, 10, 5, 5,
      0, 0, 0, 20, 20, 0, 0, 0,
      5, -5, -10, 0, 0, -10, -5, 5,
      5, 10, 10, -20, -20, 10, 10, 5,
      0, 0, 0, 0, 0, 0, 0, 0
    ],
    n: [
      -50, -40, -30, -30, -30, -30, -40, -50,
      -40, -20, 0, 0, 0, 0, -20, -40,
      -30, 0, 10, 15, 15, 10, 0, -30,
      -30, 5, 15, 20, 20, 15, 5, -30,
      -30, 0, 15, 20, 20, 15, 0, -30,
      -30, 5, 10, 15, 15, 10, 5, -30,
      -40, -20, 0, 5, 5, 0, -20, -40,
      -50, -40, -30, -30, -30, -30, -40, -50
    ],
    b: [
      -20, -10, -10, -10, -10, -10, -10, -20,
      -10, 0, 0, 0, 0, 0, 0, -10,
      -10, 0, 5, 10, 10, 5, 0, -10,
      -10, 5, 5, 10, 10, 5, 5, -10,
      -10, 0, 10, 10, 10, 10, 0, -10,
      -10, 10, 10, 10, 10, 10, 10, -10,
      -10, 5, 0, 0, 0, 0, 5, -10,
      -20, -10, -10, -10, -10, -10, -10, -20
    ],
    r: [
      0, 0, 0, 0, 0, 0, 0, 0,
      5, 10, 10, 10, 10, 10, 10, 5,
      -5, 0, 0, 0, 0, 0, 0, -5,
      -5, 0, 0, 0, 0, 0, 0, -5,
      -5, 0, 0, 0, 0, 0, 0, -5,
      -5, 0, 0, 0, 0, 0, 0, -5,
      -5, 0, 0, 0, 0, 0, 0, -5,
      0, 0, 0, 5, 5, 0, 0, 0
    ],
    q: [
      -20, -10, -10, -5, -5, -10, -10, -20,
      -10, 0, 0, 0, 0, 0, 0, -10,
      -10, 0, 5, 5, 5, 5, 0, -10,
      -5, 0, 5, 5, 5, 5, 0, -5,
      0, 0, 5, 5, 5, 5, 0, -5,
      -10, 5, 5, 5, 5, 5, 0, -10,
      -10, 0, 5, 0, 0, 0, 0, -10,
      -20, -10, -10, -5, -5, -10, -10, -20
    ],
    k: [
      -30, -40, -40, -50, -50, -40, -40, -30,
      -30, -40, -40, -50, -50, -40, -40, -30,
      -30, -40, -40, -50, -50, -40, -40, -30,
      -30, -40, -40, -50, -50, -40, -40, -30,
      -20, -30, -30, -40, -40, -30, -30, -20,
      -10, -20, -20, -20, -20, -20, -20, -10,
      20, 20, 0, 0, 0, 0, 20, 20,
      20, 30, 10, 0, 0, 10, 30, 20
    ]
  };
  var ABORT = { aborted: true };
  var game = null;
  var deadline = 0;
  var nodes = 0;

  function inCheck(g) { return g.inCheck ? g.inCheck() : g.in_check(); }

  function evaluate(g) {
    var board = g.board();
    var score = 0;
    for (var r = 0; r < 8; r++) {
      for (var c = 0; c < 8; c++) {
        var p = board[r][c];
        if (!p) continue;
        var idx = p.color === 'w' ? r * 8 + c : (7 - r) * 8 + c;
        var v = VAL[p.type] + PST[p.type][idx];
        score += p.color === 'w' ? v : -v;
      }
    }
    return g.turn() === 'w' ? score : -score;
  }

  function orderMoves(moves) {
    for (var i = 0; i < moves.length; i++) {
      var m = moves[i];
      var s = 0;
      if (m.captured) s += 10 * VAL[m.captured] - VAL[m.piece] + 1000;
      if (m.promotion) s += VAL[m.promotion] + 800;
      if (m.san && m.san.indexOf('+') !== -1) s += 50;
      m._order = s;
    }
    moves.sort(function (a, b) { return b._order - a._order; });
    return moves;
  }

  function tick() {
    nodes++;
    if ((nodes & 63) === 0 && Date.now() > deadline) throw ABORT;
  }

  function quiesce(alpha, beta, qdepth) {
    tick();
    var stand = evaluate(game);
    if (stand >= beta) return beta;
    if (stand > alpha) alpha = stand;
    if (qdepth >= 4) return alpha;
    var moves = game.moves({ verbose: true }).filter(function (m) { return m.captured || m.promotion; });
    orderMoves(moves);
    for (var i = 0; i < moves.length; i++) {
      game.move(moves[i]);
      var s = -quiesce(-beta, -alpha, qdepth + 1);
      game.undo();
      if (s >= beta) return beta;
      if (s > alpha) alpha = s;
    }
    return alpha;
  }

  function negamax(depth, alpha, beta, ply) {
    tick();
    var moves = game.moves({ verbose: true });
    if (moves.length === 0) return inCheck(game) ? -MATE + ply : 0;
    if (depth <= 0) return quiesce(alpha, beta, 0);
    orderMoves(moves);
    var best = -Infinity;
    for (var i = 0; i < moves.length; i++) {
      game.move(moves[i]);
      var s = -negamax(depth - 1, -beta, -alpha, ply + 1);
      game.undo();
      if (s > best) best = s;
      if (s > alpha) alpha = s;
      if (alpha >= beta) break;
    }
    return best;
  }

  function toUci(m) { return m.from + m.to + (m.promotion || ''); }

  function scoreToUci(s) {
    if (Math.abs(s) > MATE - 1000) {
      var plies = MATE - Math.abs(s);
      var moves = Math.max(1, Math.ceil(plies / 2));
      return { type: 'mate', value: s > 0 ? moves : -moves };
    }
    return { type: 'cp', value: Math.round(s) };
  }

  function search(job) {
    game = new Chess(job.fen);
    var rootMoves = game.moves({ verbose: true });
    if (rootMoves.length === 0) {
      return {
        bestMove: null,
        score: inCheck(game) ? { type: 'mate', value: 0 } : { type: 'cp', value: 0 },
        depth: 0,
        pv: []
      };
    }
    orderMoves(rootMoves);
    var maxDepth = Math.max(1, Math.min(job.depth || 3, 4));
    var budget = Math.min(job.movetime || 1500, 4000);
    deadline = Date.now() + budget;
    nodes = 0;
    var bestScores = null;
    var completedDepth = 0;
    // A weaker "skill" widens the root window so near-best moves get exact
    // scores and can be picked at random.
    var margin = job.skill < 20 ? (20 - job.skill) * 14 : 0;
    for (var depth = 1; depth <= maxDepth; depth++) {
      var scores = [];
      var alpha = -Infinity;
      try {
        for (var i = 0; i < rootMoves.length; i++) {
          game.move(rootMoves[i]);
          var s = -negamax(depth - 1, -Infinity, -(alpha - margin), 1);
          game.undo();
          scores.push({ move: rootMoves[i], score: s });
          if (s > alpha) alpha = s;
        }
      } catch (e) {
        if (e !== ABORT) throw e;
        game = new Chess(job.fen);
        break;
      }
      scores.sort(function (a, b) { return b.score - a.score; });
      bestScores = scores;
      completedDepth = depth;
      // Search the best move first next iteration.
      rootMoves = scores.map(function (x) { return x.move; });
      if (Math.abs(scores[0].score) > MATE - 1000) break;
    }
    if (!bestScores) {
      bestScores = rootMoves.map(function (m) { return { move: m, score: 0 }; });
    }
    var pick = bestScores[0];
    if (margin > 0 && bestScores.length > 1) {
      var pool = bestScores.filter(function (x) { return x.score >= pick.score - margin; });
      pick = pool[Math.floor(Math.random() * pool.length)];
    }
    return {
      bestMove: toUci(pick.move),
      score: scoreToUci(bestScores[0].score),
      depth: completedDepth,
      pv: [toUci(bestScores[0].move)],
      nodes: nodes
    };
  }

  return { search: search };
})();

function bootLite() {
  toMain({ type: 'status', text: 'Starting the backup engine…' });
  var loaded = false;
  for (var i = 0; i < CHESSJS_URLS.length && !loaded; i++) {
    try {
      importScripts(CHESSJS_URLS[i]);
      loaded = typeof Chess === 'function';
      if (loaded) engineSource = CHESSJS_URLS[i];
    } catch (e) {
      loaded = false;
    }
  }
  if (!loaded) {
    toMain({ type: 'fatal', error: 'Could not load chess.js for the backup engine.' });
    return;
  }
  engineName = 'Backup engine';
  becomeReady();
}

function runLiteJob() {
  if (!current) return;
  var job = current.job;
  if (job.kind === 'newgame') {
    finishJob({ type: 'result', id: job.id, kind: 'newgame', cancelled: false });
    return;
  }
  if (current.cancelled) {
    finishJob({ type: 'result', id: job.id, kind: 'search', cancelled: true });
    return;
  }
  var r;
  try {
    r = Lite.search(job);
  } catch (err) {
    finishJob({ type: 'result', id: job.id, kind: 'search', fen: job.fen, bestMove: null, score: null, depth: 0, pv: [], lines: [], cancelled: false, error: err.message });
    return;
  }
  finishJob({
    type: 'result',
    id: job.id,
    kind: 'search',
    fen: job.fen,
    bestMove: r.bestMove,
    ponder: null,
    score: r.score,
    depth: r.depth,
    pv: r.pv,
    nodes: r.nodes || 0,
    lines: [],
    cancelled: current.cancelled
  });
}
