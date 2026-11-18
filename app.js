/*
 * app.js
 * ---------------------------------------------------------------------------
 * Board rendering, click/drag-to-move, pawn promotion, the Practice game loop
 * with the Coach Guard, the Stockfish client, and the Blunder Bank puzzle
 * trainer. Depends on chess.js (window.Chess) and coach.js (window.Coach).
 */
(function () {
  'use strict';

  var C = window.Coach;
  var T = (C && C.T) || window.T || function (x) { return x; };
  var $ = function (id) { return document.getElementById(id); };

  if (typeof window.Chess !== 'function' || !C) {
    var msg = document.createElement('div');
    msg.className = 'fatal-banner';
    msg.textContent = (window.T || String)('The chess rules library could not be loaded. Check your connection and reload the page.');
    document.body.prepend(msg);
    return;
  }

  /* ======================================================================== */
  /* Configuration                                                            */
  /* ======================================================================== */

  var LEVELS = [
    { name: 'Rookie', glyph: '♟', blurb: 'Makes lots of mistakes and often leaves pieces unprotected. Great for your very first games.', skill: 0, depth: 1, movetime: 80, random: 0.35 },
    { name: 'Beginner', glyph: '♞', blurb: 'Plays sensible moves but misses simple tricks, like attacks on two pieces at once.', skill: 0, depth: 3, movetime: 150, random: 0.12 },
    { name: 'Casual', glyph: '♝', blurb: 'Plays like someone who has been playing for a few months.', skill: 4, depth: 5, movetime: 300, random: 0 },
    { name: 'Club player', glyph: '♜', blurb: 'Takes any piece you leave without protection.', skill: 9, depth: 8, movetime: 500, random: 0 },
    { name: 'Strong', glyph: '♛', blurb: 'Plays like a strong tournament player. Expect a real fight.', skill: 15, depth: 12, movetime: 800, random: 0 },
    { name: 'Full Stockfish', glyph: '♚', blurb: 'The computer at full strength. Almost impossible to beat, but fun to watch.', skill: 20, depth: 18, movetime: 1500, random: 0 }
  ];

  /** Pick the singular or plural template for a count; both use {n}. */
  function plural(n, one, many, params) {
    var p = { n: n };
    if (params) Object.keys(params).forEach(function (k) { p[k] = params[k]; });
    return T(n === 1 ? one : many, p);
  }

  function levelName(i) {
    return T(LEVELS[i] ? LEVELS[i].name : LEVELS[2].name);
  }

  function levelBlurb(i) {
    return T(LEVELS[i] ? LEVELS[i].blurb : '');
  }

  /** "the Casual bot" in the current language. */
  function botName(i) {
    return T('the {level} bot', { level: levelName(i) });
  }

  var ANALYSIS = { depth: 12, movetime: 900 };
  var PUZZLE_ANALYSIS = { depth: 12, movetime: 900 };
  var MIN_BOT_THINK_MS = 450;

  // Clocks. A base of 0 means "no limit": the clocks count up instead of down.
  var TIME_CONTROLS = {
    none: { base: 0, inc: 0, kind: 'none', phrase: 'no time limit' },
    '1': { base: 60000, inc: 0, kind: 'bullet', phrase: '1 minute each' },
    '1+1': { base: 60000, inc: 1000, kind: 'bullet', phrase: '1 minute each plus 1 second a move' },
    '2+1': { base: 2 * 60000, inc: 1000, kind: 'bullet', phrase: '2 minutes each plus 1 second a move' },
    '3': { base: 3 * 60000, inc: 0, kind: 'blitz', phrase: '3 minutes each' },
    '3+2': { base: 3 * 60000, inc: 2000, kind: 'blitz', phrase: '3 minutes each plus 2 seconds a move' },
    '5': { base: 5 * 60000, inc: 0, kind: 'blitz', phrase: '5 minutes each' },
    '10': { base: 10 * 60000, inc: 0, kind: 'rapid', phrase: '10 minutes each' },
    '15+10': { base: 15 * 60000, inc: 10000, kind: 'rapid', phrase: '15 minutes each plus 10 seconds a move' },
    '30': { base: 30 * 60000, inc: 0, kind: 'rapid', phrase: '30 minutes each' }
  };
  var TIME_KINDS = {
    none: { name: 'No limit', help: 'With no limit, the clocks count how long each side thinks.' },
    bullet: { name: 'Bullet', help: 'Bullet is the fastest chess: a minute or two for the whole game. You can make your next move while the bot is still thinking (a premove).', friendHelp: 'Bullet is the fastest chess: a minute or two for the whole game.' },
    blitz: { name: 'Blitz', help: 'Blitz gives you a few minutes for the whole game: fast, but with time to think.' },
    rapid: { name: 'Rapid', help: 'Rapid gives you time to think about every move. The best way to learn.' }
  };

  // Ways to play. Head start removes a bot piece; King of the Hill and
  // Three-check add a second way to win; Play a friend is two people on one device.
  var GAME_MODES = {
    standard: { name: 'Standard', sub: 'Normal chess', help: 'Normal chess against a bot.' },
    odds: { name: 'Head start', sub: 'The bot gives up a piece', help: 'The bot starts without one of its pieces, so you begin ahead. A friendly way to win your first games.' },
    koth: { name: 'King of the Hill', sub: 'King to the centre wins', help: 'Normal chess with one extra way to win: get your king to one of the four centre squares (d4, e4, d5 or e5). Checkmate still wins too.' },
    threecheck: { name: 'Three-check', sub: 'Give 3 checks to win', help: "Normal chess with one extra way to win: put the other king in check three times. Checkmate still wins too." },
    friend: { name: 'Play a friend', sub: 'Two players, one device', help: 'Two people take turns on this device. Turn on Turn the board to see your own pieces at the bottom on your turn.' }
  };
  var ODDS = {
    q: { name: 'Queen', squares: { w: 'd1', b: 'd8' } },
    r: { name: 'Rook', squares: { w: 'a1', b: 'a8' } },
    n: { name: 'Knight', squares: { w: 'b1', b: 'b8' } }
  };
  var HILL = ['d4', 'e4', 'd5', 'e5'];
  var LOW_TIME_MS = 20000;
  var AUTOPLAY_MS = 900;
  var PAWN_AVATAR = '<svg viewBox="0 0 40 40" aria-hidden="true"><path d="M20 6.5a5.6 5.6 0 0 0-3.5 10c-2.2 1.2-3.6 3.1-3.6 5.4 0 .6.5 1.1 1.1 1.1h2c-.4 3.5-1.9 6.2-4.7 8.1-.7.4-1 1.1-1 1.8v1.6h19.4v-1.6c0-.7-.3-1.4-1-1.8-2.8-1.9-4.3-4.6-4.7-8.1h2c.6 0 1.1-.5 1.1-1.1 0-2.3-1.4-4.2-3.6-5.4A5.6 5.6 0 0 0 20 6.5z" fill="currentColor"/></svg>';
  var SETTINGS_KEY = 'chessTrainer.settings.v1';
  var GAME_KEY = 'chessTrainer.game.v1';
  var HISTORY_KEY = 'chessTrainer.history.v1';
  var STATS_KEY = 'chessTrainer.stats.v1';
  var START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
  var SVG_NS = 'http://www.w3.org/2000/svg';
  var FILES = 'abcdefgh';

  var store = {
    get: function (k) {
      try { return window.localStorage.getItem(k); } catch (e) { return null; }
    },
    set: function (k, v) {
      try { window.localStorage.setItem(k, v); } catch (e) { /* storage full or blocked */ }
    },
    remove: function (k) {
      try { window.localStorage.removeItem(k); } catch (e) { /* ignore */ }
    }
  };

  /* ======================================================================== */
  /* chess.js compatibility (works with 0.10.x snake_case and 1.x camelCase)  */
  /* ======================================================================== */

  var ChessAPI = {
    inCheck: function (g) { return g.inCheck ? g.inCheck() : g.in_check(); },
    isCheckmate: function (g) { return g.isCheckmate ? g.isCheckmate() : g.in_checkmate(); },
    isStalemate: function (g) { return g.isStalemate ? g.isStalemate() : g.in_stalemate(); },
    isThreefold: function (g) { return g.isThreefoldRepetition ? g.isThreefoldRepetition() : g.in_threefold_repetition(); },
    isInsufficient: function (g) { return g.isInsufficientMaterial ? g.isInsufficientMaterial() : g.insufficient_material(); },
    isDraw: function (g) { return g.isDraw ? g.isDraw() : g.in_draw(); },
    isGameOver: function (g) { return g.isGameOver ? g.isGameOver() : g.game_over(); }
  };

  function safeMove(game, move) {
    try {
      return game.move(move) || null;
    } catch (e) {
      return null;
    }
  }

  function moveToUci(m) {
    return m.from + m.to + (m.promotion || '');
  }

  function uciToMove(uci) {
    var m = { from: uci.slice(0, 2), to: uci.slice(2, 4) };
    if (uci.length > 4) m.promotion = uci.charAt(4);
    return m;
  }

  /** Verbose details of a UCI move in a position, or null if illegal. */
  function describeUci(fen, uci) {
    if (!uci) return null;
    var g = new window.Chess(fen);
    var m = safeMove(g, uciToMove(uci));
    if (!m) return null;
    return {
      san: m.san,
      from: m.from,
      to: m.to,
      piece: m.piece,
      captured: m.captured || null,
      promotion: m.promotion || null,
      flags: m.flags,
      givesCheck: ChessAPI.inCheck(g),
      isMate: ChessAPI.isCheckmate(g)
    };
  }

  function sanOf(fen, uci) {
    var d = describeUci(fen, uci);
    return d ? d.san : uci;
  }

  function needsPromotion(game, from, to) {
    return game.moves({ square: from, verbose: true }).some(function (m) { return m.to === to && m.promotion; });
  }

  function legalTargets(game, from) {
    var seen = {};
    return game.moves({ square: from, verbose: true })
      .map(function (m) { return m.to; })
      .filter(function (sq) { if (seen[sq]) return false; seen[sq] = true; return true; });
  }

  function checkSquare(game) {
    if (!ChessAPI.inCheck(game)) return null;
    var idx = C.findKing(C.parseFen(game.fen()).board, game.turn());
    return idx >= 0 ? C.idxToSq(idx) : null;
  }

  function terminalInfo(game) {
    if (ChessAPI.isCheckmate(game)) return 'checkmate';
    if (ChessAPI.isStalemate(game)) return 'stalemate';
    if (ChessAPI.isInsufficient(game)) return 'insufficient';
    if (ChessAPI.isThreefold(game)) return 'repetition';
    if (ChessAPI.isDraw(game)) return 'fifty';
    return null;
  }

  function terminalAnalysis(game, term) {
    var stm = game.turn();
    return {
      fen: game.fen(),
      bestMove: null,
      pv: [],
      whiteCp: term === 'checkmate' || term === 'hill' || term === 'threecheck' ? (stm === 'w' ? -C.MATE_CP : C.MATE_CP) : 0,
      depth: 99,
      hasScore: true,
      terminal: term
    };
  }

  function randomMoveUci(game) {
    var moves = game.moves({ verbose: true });
    if (!moves.length) return null;
    // Rookie bots still grab a free queen or rook now and then.
    var juicy = moves.filter(function (m) { return m.captured === 'q' || m.captured === 'r'; });
    var pool = juicy.length && Math.random() < 0.5 ? juicy : moves;
    return moveToUci(pool[Math.floor(Math.random() * pool.length)]);
  }

  /** Feed label in words: "You: knight to f3", "Bot: bishop takes pawn on c4". */
  function moveLabel(mv) {
    if (S.mode === 'friend') return C.moveTitle(mv, false, C.colorName(mv.color));
    return C.moveTitle(mv, mv.color === S.playerColor);
  }

  function sleep(ms) {
    return new Promise(function (r) { setTimeout(r, ms); });
  }

  function makeId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  /* ======================================================================== */
  /* Piece artwork (Cburnett SVGs with a Unicode fallback)                    */
  /* ======================================================================== */

  var PIECE_URLS = (window.PIECE_SET && window.PIECE_SET.urls) || {};
  var useGlyphs = !PIECE_URLS.wK;
  var GLYPH_CHARS = { k: '♚', q: '♛', r: '♜', b: '♝', n: '♞', p: '♟' };
  var boardViews = [];
  var pieceFallbackListeners = [];

  function onPieceImageError() {
    if (useGlyphs) return;
    useGlyphs = true;
    boardViews.forEach(function (b) { b.redrawPieces(); });
    pieceFallbackListeners.forEach(function (fn) { fn(); });
  }

  /** "White rook", in the current language. */
  function pieceLabel(c, t) {
    return T('{color} {piece}', { color: C.colorName(c), piece: C.pieceName(t) });
  }

  /** p: { t: 'n', c: 'w' } */
  function createPieceEl(p, extraClass) {
    var code = p.c + p.t.toUpperCase();
    var label = pieceLabel(p.c, p.t);
    var el;
    if (!useGlyphs && PIECE_URLS[code]) {
      el = document.createElement('img');
      el.src = PIECE_URLS[code];
      el.alt = label;
      el.draggable = false;
      el.decoding = 'async';
      el.addEventListener('error', onPieceImageError, { once: true });
    } else {
      el = document.createElement('span');
      el.textContent = GLYPH_CHARS[p.t];
      el.setAttribute('role', 'img');
      el.setAttribute('aria-label', label);
      el.classList.add('glyph', 'glyph-' + p.c);
    }
    el.classList.add('piece');
    if (extraClass) el.classList.add(extraClass);
    return el;
  }

  /* ======================================================================== */
  /* Sound effects                                                            */
  /* Recorded files in ./sounds/ are used when present. Otherwise sounds are  */
  /* modelled in the browser: a wooden knock for moves, marimba-style notes   */
  /* for alerts, with a touch of room echo and slight variation every time.   */
  /* ======================================================================== */

  var Sound = (function () {
    var AC = window.AudioContext || window.webkitAudioContext;
    var ctx = null;
    var bus = null;
    var out = null;
    var noiseBuf = null;
    var enabled = true;
    var samples = {};
    var samplesTried = false;
    var packListeners = [];
    var SAMPLE_DIR = './sounds/';
    var SAMPLE_FILES = {
      move: 'move',
      capture: 'capture',
      castle: 'castle',
      check: 'check',
      promote: 'promote',
      start: 'game-start',
      win: 'game-win',
      lose: 'game-lose',
      draw: 'game-draw',
      end: 'game-end',
      warning: 'warning',
      notify: 'notify',
      correct: 'puzzle-correct',
      wrong: 'puzzle-wrong'
    };

    function impulse(c) {
      var len = Math.floor(c.sampleRate * 0.32);
      var buf = c.createBuffer(2, len, c.sampleRate);
      for (var ch = 0; ch < 2; ch++) {
        var d = buf.getChannelData(ch);
        var last = 0;
        for (var i = 0; i < len; i++) {
          last = last * 0.6 + (Math.random() * 2 - 1) * 0.4; // soft low-pass: a small warm room
          d[i] = last * Math.pow(1 - i / len, 3);
        }
      }
      return buf;
    }

    function context() {
      if (!enabled || !AC) return null;
      if (!ctx) {
        try {
          ctx = new AC();
        } catch (e) {
          AC = null;
          return null;
        }
        var comp = ctx.createDynamicsCompressor();
        comp.threshold.value = -14;
        comp.ratio.value = 3;
        out = ctx.createGain();
        out.gain.value = 0.75;
        out.connect(comp);
        comp.connect(ctx.destination);
        bus = ctx.createGain();
        bus.connect(out);
        try {
          var verb = ctx.createConvolver();
          verb.buffer = impulse(ctx);
          var wet = ctx.createGain();
          wet.gain.value = 0.14;
          bus.connect(verb);
          verb.connect(wet);
          wet.connect(out);
        } catch (e) {
          /* no reverb on very old browsers */
        }
      }
      if (ctx.state === 'suspended' && ctx.resume) ctx.resume().catch(function () {});
      loadSamples();
      return ctx;
    }

    /* ---- recorded sounds (optional) ---- */

    function decode(ab) {
      return new Promise(function (resolve) {
        try {
          var p = ctx.decodeAudioData(ab, resolve, function () { resolve(null); });
          if (p && typeof p.then === 'function') p.then(resolve, function () { resolve(null); });
        } catch (e) {
          resolve(null);
        }
      });
    }

    function fetchSample(name) {
      return fetch(SAMPLE_DIR + SAMPLE_FILES[name] + '.mp3', { cache: 'force-cache' })
        .then(function (r) { return r.ok ? r.arrayBuffer() : null; })
        .then(function (ab) { return ab && ab.byteLength > 64 ? decode(ab) : null; })
        .catch(function () { return null; });
    }

    function loadSamples() {
      if (samplesTried || !ctx || typeof fetch !== 'function') return;
      samplesTried = true;
      // Try one file first, so a site without a sounds folder makes a single request.
      fetchSample('move').then(function (buf) {
        if (!buf) return;
        samples.move = buf;
        Object.keys(SAMPLE_FILES).forEach(function (name) {
          if (name === 'move') return;
          fetchSample(name).then(function (b) { if (b) samples[name] = b; });
        });
        packListeners.forEach(function (fn) { fn(true); });
      });
    }

    function sampleFor(name) {
      if (samples[name]) return samples[name];
      if ((name === 'win' || name === 'lose' || name === 'draw') && samples.end) return samples.end;
      return null;
    }

    function playSample(c, t, buf, name) {
      var src = c.createBufferSource();
      src.buffer = buf;
      if (name === 'move' || name === 'capture' || name === 'castle') src.playbackRate.value = 0.98 + Math.random() * 0.04;
      var g = c.createGain();
      g.gain.value = 0.9;
      src.connect(g);
      g.connect(out); // recordings already carry their own room sound
      src.start(t);
    }

    /* ---- modelled sounds ---- */

    function noise(c) {
      if (noiseBuf) return noiseBuf;
      var len = Math.floor(c.sampleRate * 0.06);
      noiseBuf = c.createBuffer(1, len, c.sampleRate);
      var d = noiseBuf.getChannelData(0);
      for (var i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      return noiseBuf;
    }

    function envelope(c, t, attack, decay, peak) {
      var g = c.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + attack);
      g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
      g.connect(bus);
      return g;
    }

    function partial(c, t, freq, attack, decay, peak, drift) {
      var osc = c.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, t);
      if (drift) osc.frequency.exponentialRampToValueAtTime(freq * drift, t + attack + decay);
      osc.connect(envelope(c, t, attack, decay, peak));
      osc.start(t);
      osc.stop(t + attack + decay + 0.05);
    }

    // A wooden piece landing on a wooden board: a very short click excites a
    // handful of inharmonic wooden modes plus a low thump from the board.
    var WOOD_MODES = [[1, 0.075, 1], [1.91, 0.05, 0.55], [3.14, 0.032, 0.32], [4.6, 0.02, 0.18], [0.31, 0.11, 0.42]];

    function knock(c, t, o) {
      o = o || {};
      var pitch = (o.pitch || 1) * (0.97 + Math.random() * 0.06);
      var level = (o.gain || 1) * (0.9 + Math.random() * 0.2);
      var src = c.createBufferSource();
      src.buffer = noise(c);
      var hp = c.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = 2200 * pitch;
      src.connect(hp);
      hp.connect(envelope(c, t, 0.0008, 0.012 * (o.clickLen || 1), 0.5 * level * (o.click || 1)));
      src.start(t);
      src.stop(t + 0.06);
      var base = (o.freq || 620) * pitch;
      var decayScale = o.decay || 1;
      WOOD_MODES.forEach(function (m) {
        partial(c, t, base * m[0], 0.0015, m[1] * decayScale, 0.3 * m[2] * level, 0.985);
      });
    }

    // A soft mallet on a wooden bar: fundamental plus the bright marimba overtones.
    function mallet(c, t, freq, o) {
      o = o || {};
      var level = o.gain || 0.2;
      var decay = o.decay || 0.6;
      partial(c, t, freq, 0.004, decay, level);
      partial(c, t, freq * 3.93, 0.003, decay * 0.3, level * 0.28);
      partial(c, t, freq * 9.2, 0.002, decay * 0.1, level * 0.1);
      var src = c.createBufferSource();
      src.buffer = noise(c);
      var bp = c.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = Math.min(8000, freq * 2);
      bp.Q.value = 2;
      src.connect(bp);
      bp.connect(envelope(c, t, 0.001, 0.008, level * 0.35));
      src.start(t);
      src.stop(t + 0.03);
    }

    function notes(c, t, freqs, step, o) {
      freqs.forEach(function (f, i) { mallet(c, t + i * step, f, o); });
    }

    var synth = {
      move: function (c, t, opp) { knock(c, t, { freq: opp ? 570 : 620 }); },
      capture: function (c, t, opp) {
        knock(c, t, { freq: opp ? 1050 : 1150, click: 1.6, decay: 0.55, gain: 0.75 });
        knock(c, t + 0.035, { freq: opp ? 560 : 610, gain: 1.05, decay: 1.1 });
      },
      castle: function (c, t, opp) {
        knock(c, t, { freq: opp ? 570 : 620 });
        knock(c, t + 0.13, { freq: opp ? 520 : 580, gain: 0.85 });
      },
      check: function (c, t) {
        knock(c, t, { freq: 640 });
        mallet(c, t + 0.05, 1046.5, { gain: 0.15, decay: 0.45 });
        mallet(c, t + 0.13, 1318.51, { gain: 0.13, decay: 0.55 });
      },
      promote: function (c, t) {
        knock(c, t, { freq: 640 });
        notes(c, t + 0.06, [783.99, 987.77, 1174.66, 1567.98], 0.07, { gain: 0.13, decay: 0.5 });
      },
      warning: function (c, t) {
        mallet(c, t, 392, { gain: 0.3, decay: 0.5 });
        mallet(c, t + 0.2, 311.13, { gain: 0.3, decay: 0.7 });
      },
      undo: function (c, t) { knock(c, t, { freq: 520, gain: 0.6, decay: 0.8, click: 0.6 }); },
      hint: function (c, t) { notes(c, t, [880, 1318.51], 0.08, { gain: 0.11, decay: 0.45 }); },
      notify: function (c, t) { notes(c, t, [1046.5, 1567.98], 0.07, { gain: 0.1, decay: 0.5 }); },
      correct: function (c, t) { notes(c, t, [659.25, 830.61, 987.77, 1318.51], 0.08, { gain: 0.14, decay: 0.7 }); },
      wrong: function (c, t) {
        mallet(c, t, 233.08, { gain: 0.26, decay: 0.3 });
        mallet(c, t + 0.15, 196, { gain: 0.26, decay: 0.45 });
      },
      start: function (c, t) { notes(c, t, [523.25, 783.99], 0.1, { gain: 0.14, decay: 0.6 }); },
      win: function (c, t) {
        notes(c, t, [523.25, 659.25, 783.99], 0.11, { gain: 0.16, decay: 0.6 });
        [1046.5, 1318.51, 1567.98].forEach(function (f) { mallet(c, t + 0.36, f, { gain: 0.1, decay: 1.2 }); });
      },
      lose: function (c, t) { notes(c, t, [440, 392, 349.23, 293.66], 0.17, { gain: 0.16, decay: 0.8 }); },
      draw: function (c, t) { notes(c, t, [587.33, 523.25], 0.18, { gain: 0.15, decay: 0.8 }); }
    };

    return {
      play: function (name, variant) {
        if (!enabled || !synth[name]) return;
        var c = context();
        if (!c || c.state !== 'running') return;
        try {
          var buf = sampleFor(name);
          if (buf) playSample(c, c.currentTime + 0.005, buf, name);
          else synth[name](c, c.currentTime + 0.01, variant);
        } catch (e) {
          /* sound is a bonus; never let it break the game */
        }
      },
      unlock: function () {
        if (enabled) context();
      },
      setEnabled: function (on) {
        enabled = !!on;
        if (!enabled && ctx && ctx.state === 'running' && ctx.suspend) ctx.suspend().catch(function () {});
      },
      usingRecorded: function () { return !!samples.move; },
      onPack: function (fn) { packListeners.push(fn); }
    };
  })();

  /** Pick the right sound for a move that was just played. */
  function playMoveSound(mv, game, opponent) {
    if (!mv || ChessAPI.isCheckmate(game)) return; // the game-over sound takes over
    var flags = mv.flags || '';
    if (ChessAPI.inCheck(game)) Sound.play('check');
    else if (mv.promotion) Sound.play('promote');
    else if (flags.indexOf('k') !== -1 || flags.indexOf('q') !== -1) Sound.play('castle', opponent);
    else if (mv.captured) Sound.play('capture', opponent);
    else Sound.play('move', opponent);
  }

  /* ======================================================================== */
  /* BoardView                                                                */
  /* ======================================================================== */

  function arrowPoints(p1, p2) {
    var dx = p2.x - p1.x;
    var dy = p2.y - p1.y;
    var len = Math.hypot(dx, dy);
    if (len < 0.01) return '';
    var ux = dx / len;
    var uy = dy / len;
    var nx = -uy;
    var ny = ux;
    var shaft = 1.15;
    var headW = 3.3;
    var headL = 4.4;
    var sx = p1.x + ux * 2.6;
    var sy = p1.y + uy * 2.6;
    var tx = p2.x - ux * 1.4;
    var ty = p2.y - uy * 1.4;
    var bx = tx - ux * headL;
    var by = ty - uy * headL;
    var pts = [
      [sx + nx * shaft, sy + ny * shaft],
      [bx + nx * shaft, by + ny * shaft],
      [bx + nx * headW, by + ny * headW],
      [tx, ty],
      [bx - nx * headW, by - ny * headW],
      [bx - nx * shaft, by - ny * shaft],
      [sx - nx * shaft, sy - ny * shaft]
    ];
    return pts.map(function (p) { return p[0].toFixed(2) + ',' + p[1].toFixed(2); }).join(' ');
  }

  function BoardView(root, opts) {
    this.root = root;
    this.opts = {
      interactive: opts.interactive || function () { return false; },
      canMoveFrom: opts.canMoveFrom || function () { return false; },
      legalTargets: opts.legalTargets || function () { return []; },
      onMove: opts.onMove || function () {},
      onIdleClick: opts.onIdleClick || null
    };
    this.orientation = 'w';
    this.pieces = new Array(64).fill(null);
    this.pieceCodes = new Array(64).fill('');
    this.selected = null;
    this.targets = [];
    this.marks = { lastMove: null, check: null, danger: [], hint: [], stars: [], hill: [], premove: [] };
    this.arrows = [];
    this.drag = null;
    this.hoverSq = null;
    this.ghost = null;
    this.skipAnimTo = null;
    this._build();
    boardViews.push(this);
  }

  BoardView.prototype._build = function () {
    var self = this;
    this.root.classList.add('board');
    this.root.innerHTML = '';
    this.grid = document.createElement('div');
    this.grid.className = 'board-grid';
    this.squareEls = [];
    this.slots = [];
    for (var i = 0; i < 64; i++) {
      var el = document.createElement('div');
      var f = i % 8;
      var r = Math.floor(i / 8);
      el.className = 'sq ' + ((f + r) % 2 === 0 ? 'dark' : 'light');
      el.dataset.sq = C.idxToSq(i);
      var fileLbl = document.createElement('span');
      fileLbl.className = 'coord coord-file';
      var rankLbl = document.createElement('span');
      rankLbl.className = 'coord coord-rank';
      var slot = document.createElement('div');
      slot.className = 'piece-slot';
      el.appendChild(fileLbl);
      el.appendChild(rankLbl);
      el.appendChild(slot);
      this.squareEls.push(el);
      this.slots.push(slot);
    }
    this.svg = document.createElementNS(SVG_NS, 'svg');
    this.svg.setAttribute('class', 'board-arrows');
    this.svg.setAttribute('viewBox', '0 0 100 100');
    this.svg.setAttribute('aria-hidden', 'true');
    this.root.appendChild(this.grid);
    this.root.appendChild(this.svg);
    this._layout();

    this.grid.addEventListener('pointerdown', function (e) { self._onDown(e); });
    this.grid.addEventListener('pointermove', function (e) { self._onMove(e); });
    this.grid.addEventListener('pointerup', function (e) { self._onUp(e); });
    this.grid.addEventListener('pointercancel', function () { self._cancelDrag(); });
    this.grid.addEventListener('lostpointercapture', function () {
      if (self.drag && self.drag.active) self._cancelDrag();
    });
    this.grid.addEventListener('contextmenu', function (e) { e.preventDefault(); });
  };

  BoardView.prototype._layout = function () {
    for (var k = 0; k < 64; k++) {
      var row = Math.floor(k / 8);
      var col = k % 8;
      var rank = this.orientation === 'w' ? 7 - row : row;
      var file = this.orientation === 'w' ? col : 7 - col;
      var idx = rank * 8 + file;
      var el = this.squareEls[idx];
      this.grid.appendChild(el);
      el.children[0].textContent = row === 7 ? FILES.charAt(file) : '';
      el.children[1].textContent = col === 0 ? String(rank + 1) : '';
    }
  };

  BoardView.prototype.setOrientation = function (color) {
    if (color !== 'w' && color !== 'b') return;
    if (this.orientation === color) return;
    this.orientation = color;
    this._layout();
    this._paint();
  };

  /** opts.animate: slide pieces that moved since the last position. */
  BoardView.prototype.setFen = function (fen, opts) {
    var next = C.parseFen(fen).board;
    var pairs = opts && opts.animate && !prefersReducedMotion() ? this._diffMoves(this.pieces, next) : [];
    this.pieces = next;
    this._drawPieces(false);
    this._animate(pairs);
    this._paint();
  };

  /** Match pieces that left a square with pieces that arrived somewhere else. */
  BoardView.prototype._diffMoves = function (prev, next) {
    var arrived = [];
    var left = [];
    for (var i = 0; i < 64; i++) {
      var a = prev[i];
      var b = next[i];
      if ((a ? a.c + a.t : '') === (b ? b.c + b.t : '')) continue;
      if (b) arrived.push(i);
      if (a) left.push(i);
    }
    var pairs = [];
    var used = {};
    arrived.forEach(function (to) {
      var b = next[to];
      var best = -1;
      var bestDist = Infinity;
      left.forEach(function (from) {
        if (used[from] || from === to) return;
        var a = prev[from];
        if (a.c !== b.c) return;
        // Same piece type, or a pawn turning into a piece (or back, on undo).
        if (a.t !== b.t && a.t !== 'p' && b.t !== 'p') return;
        var d = Math.abs((from % 8) - (to % 8)) + Math.abs(Math.floor(from / 8) - Math.floor(to / 8));
        if (a.t !== b.t) d += 20;
        if (d < bestDist) {
          bestDist = d;
          best = from;
        }
      });
      if (best >= 0) {
        used[best] = true;
        pairs.push({ from: best, to: to });
      }
    });
    // Big jumps (new game, restoring a position) just appear.
    return pairs.length <= 4 ? pairs : [];
  };

  BoardView.prototype._displayPos = function (idx) {
    var f = idx % 8;
    var r = Math.floor(idx / 8);
    return { col: this.orientation === 'w' ? f : 7 - f, row: this.orientation === 'w' ? 7 - r : r };
  };

  BoardView.prototype._animate = function (pairs) {
    var self = this;
    var skip = this.skipAnimTo;
    this.skipAnimTo = null;
    pairs.forEach(function (p) {
      if (skip && C.idxToSq(p.to) === skip) return; // dropped by drag: already there
      var slot = self.slots[p.to];
      var el = slot.firstChild;
      if (!el || typeof el.animate !== 'function') return;
      var a = self._displayPos(p.from);
      var b = self._displayPos(p.to);
      var dx = (a.col - b.col) * 100;
      var dy = (a.row - b.row) * 100;
      slot.classList.add('is-moving');
      var anim = el.animate(
        [{ transform: 'translate(' + dx + '%,' + dy + '%)' }, { transform: 'translate(0,0)' }],
        { duration: 190, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' }
      );
      var done = function () { slot.classList.remove('is-moving'); };
      anim.onfinish = done;
      anim.oncancel = done;
    });
  };

  BoardView.prototype.redrawPieces = function () {
    this._drawPieces(true);
  };

  BoardView.prototype._drawPieces = function (force) {
    for (var i = 0; i < 64; i++) {
      var p = this.pieces[i];
      var code = p ? p.c + p.t : '';
      if (!force && code === this.pieceCodes[i]) continue;
      this.pieceCodes[i] = code;
      var slot = this.slots[i];
      slot.innerHTML = '';
      if (p) slot.appendChild(createPieceEl(p));
      this.squareEls[i].setAttribute('aria-label', C.idxToSq(i) + (p ? ', ' + pieceLabel(p.c, p.t) : ''));
    }
  };

  BoardView.prototype.setMarks = function (patch) {
    for (var k in patch) if (Object.prototype.hasOwnProperty.call(patch, k)) this.marks[k] = patch[k];
    if (!this.marks.danger) this.marks.danger = [];
    if (!this.marks.hint) this.marks.hint = [];
    if (!this.marks.stars) this.marks.stars = [];
    if (!this.marks.hill) this.marks.hill = [];
    if (!this.marks.premove) this.marks.premove = [];
    this._paint();
  };

  BoardView.prototype.setArrows = function (arrows) {
    this.arrows = arrows || [];
    this._paint();
  };

  BoardView.prototype.clearSelection = function () {
    this.selected = null;
    this.targets = [];
    this._paint();
  };

  BoardView.prototype.refresh = function () {
    if (this.selected && !this.opts.interactive()) {
      this.selected = null;
      this.targets = [];
    }
    this._paint();
  };

  BoardView.prototype._select = function (sq) {
    this.selected = sq;
    this.targets = sq ? this.opts.legalTargets(sq) : [];
    this._paint();
  };

  BoardView.prototype._paint = function () {
    var m = this.marks;
    var lm = m.lastMove;
    for (var i = 0; i < 64; i++) {
      var sq = C.idxToSq(i);
      var cl = this.squareEls[i].classList;
      cl.toggle('is-last', !!lm && (lm.from === sq || lm.to === sq));
      cl.toggle('is-selected', this.selected === sq);
      cl.toggle('is-target', this.targets.indexOf(sq) !== -1);
      cl.toggle('has-piece', !!this.pieces[i]);
      cl.toggle('is-check', m.check === sq);
      cl.toggle('is-danger', m.danger.indexOf(sq) !== -1);
      cl.toggle('is-hint', m.hint.indexOf(sq) !== -1);
      cl.toggle('is-star', m.stars.indexOf(sq) !== -1);
      cl.toggle('is-hill', m.hill.indexOf(sq) !== -1);
      cl.toggle('is-premove', m.premove.indexOf(sq) !== -1);
      cl.toggle('is-hover', this.hoverSq === sq);
      cl.toggle('is-drag-origin', !!(this.drag && this.drag.active && this.drag.from === sq));
    }
    this.root.classList.toggle('is-interactive', !!this.opts.interactive());
    this._drawArrows();
  };

  BoardView.prototype._center = function (sq) {
    var idx = C.sqToIdx(sq);
    var f = idx % 8;
    var r = Math.floor(idx / 8);
    var col = this.orientation === 'w' ? f : 7 - f;
    var row = this.orientation === 'w' ? 7 - r : r;
    return { x: col * 12.5 + 6.25, y: row * 12.5 + 6.25 };
  };

  BoardView.prototype._drawArrows = function () {
    while (this.svg.firstChild) this.svg.removeChild(this.svg.firstChild);
    for (var i = 0; i < this.arrows.length; i++) {
      var a = this.arrows[i];
      if (!a || !a.from || !a.to || a.from === a.to) continue;
      var poly = document.createElementNS(SVG_NS, 'polygon');
      poly.setAttribute('points', arrowPoints(this._center(a.from), this._center(a.to)));
      poly.setAttribute('class', 'arrow arrow-' + (a.color || 'green'));
      this.svg.appendChild(poly);
    }
  };

  BoardView.prototype._sqAt = function (x, y) {
    var el = document.elementFromPoint(x, y);
    var sqEl = el && el.closest ? el.closest('.sq') : null;
    return sqEl && this.grid.contains(sqEl) ? sqEl.dataset.sq : null;
  };

  BoardView.prototype._onDown = function (e) {
    if (e.button !== undefined && e.button !== 0) return;
    var sqEl = e.target.closest ? e.target.closest('.sq') : null;
    if (!sqEl) return;
    var sq = sqEl.dataset.sq;
    if (!this.opts.interactive()) {
      if (this.selected) this.clearSelection();
      return;
    }
    e.preventDefault();
    if (this.selected && this.selected !== sq && this.targets.indexOf(sq) !== -1) {
      this._commit(this.selected, sq);
      return;
    }
    if (this.opts.canMoveFrom(sq)) {
      var wasSelected = this.selected === sq;
      if (!wasSelected) this._select(sq);
      this.drag = { from: sq, x: e.clientX, y: e.clientY, active: false, id: e.pointerId, wasSelected: wasSelected };
      try { this.grid.setPointerCapture(e.pointerId); } catch (err) { /* older browsers */ }
      return;
    }
    if (this.selected) this.clearSelection();
    else if (this.opts.onIdleClick) this.opts.onIdleClick(sq);
  };

  BoardView.prototype._onMove = function (e) {
    var d = this.drag;
    if (!d || e.pointerId !== d.id) return;
    if (!d.active) {
      if (Math.hypot(e.clientX - d.x, e.clientY - d.y) < 6) return;
      d.active = true;
      this._startGhost(d.from);
    }
    if (this.ghost) {
      this.ghost.style.transform = 'translate(' + (e.clientX - this.ghostSize / 2) + 'px,' + (e.clientY - this.ghostSize / 2) + 'px)';
    }
    var over = this._sqAt(e.clientX, e.clientY);
    if (over !== this.hoverSq) {
      this.hoverSq = over && this.targets.indexOf(over) !== -1 ? over : null;
      this._paint();
    }
  };

  BoardView.prototype._onUp = function (e) {
    var d = this.drag;
    if (!d || e.pointerId !== d.id) return;
    this.drag = null;
    try { this.grid.releasePointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    if (d.active) {
      var to = this._sqAt(e.clientX, e.clientY);
      this._endGhost();
      if (to && to !== d.from && this.targets.indexOf(to) !== -1 && this.opts.interactive()) {
        this._commit(d.from, to, true);
      } else {
        this._paint();
      }
      return;
    }
    if (d.wasSelected) this.clearSelection();
  };

  BoardView.prototype._cancelDrag = function () {
    if (!this.drag) return;
    this.drag = null;
    this._endGhost();
    this._paint();
  };

  BoardView.prototype._startGhost = function (from) {
    var p = this.pieces[C.sqToIdx(from)];
    if (!p) return;
    var rect = this.grid.getBoundingClientRect();
    this.ghostSize = rect.width / 8;
    this.ghost = createPieceEl(p, 'drag-ghost');
    this.ghost.style.width = this.ghostSize + 'px';
    this.ghost.style.height = this.ghostSize + 'px';
    if (this.ghost.classList.contains('glyph')) this.ghost.style.fontSize = (this.ghostSize * 0.8) + 'px';
    document.body.appendChild(this.ghost);
    this.root.classList.add('is-dragging');
    this._paint();
  };

  BoardView.prototype._endGhost = function () {
    if (this.ghost && this.ghost.parentNode) this.ghost.parentNode.removeChild(this.ghost);
    this.ghost = null;
    this.hoverSq = null;
    this.root.classList.remove('is-dragging');
  };

  BoardView.prototype._commit = function (from, to, viaDrag) {
    this.selected = null;
    this.targets = [];
    this.hoverSq = null;
    this.skipAnimTo = viaDrag ? to : null;
    this._paint();
    this.opts.onMove(from, to);
  };

  /* ======================================================================== */
  /* Engine client (talks to stockfish-worker.js)                             */
  /* ======================================================================== */

  function EngineClient(onStatus) {
    this.onStatus = onStatus;
    this.flavors = ['stockfish', 'lite'];
    this.flavorIndex = 0;
    this.worker = null;
    this.ready = false;
    this.failed = false;
    this.name = '';
    this.flavor = '';
    this.pending = new Map();
    this.nextId = 1;
    this.initTimer = null;
  }

  EngineClient.prototype.start = function () {
    this._spawn();
  };

  EngineClient.prototype._spawn = function () {
    var self = this;
    var flavor = this.flavors[this.flavorIndex];
    this.ready = false;
    this.onStatus({ state: 'loading', flavor: flavor, text: flavor === 'stockfish' ? T('Loading Stockfish…') : T('Starting backup engine…') });
    var w;
    try {
      w = new Worker('./stockfish-worker.js?engine=' + flavor);
    } catch (err) {
      this._fail('Web Workers are not available here (' + err.message + ').');
      return;
    }
    this.worker = w;
    w.onmessage = function (e) { self._onMessage(w, e.data); };
    w.onerror = function (e) {
      if (e && e.preventDefault) e.preventDefault();
      if (w === self.worker) self._fail((e && e.message) || 'The engine worker crashed.');
    };
    clearTimeout(this.initTimer);
    this.initTimer = setTimeout(function () {
      if (w === self.worker && !self.ready) self._fail('The engine took too long to start.');
    }, flavor === 'stockfish' ? 30000 : 15000);
    w.postMessage({ type: 'init' });
  };

  EngineClient.prototype._fail = function (reason) {
    clearTimeout(this.initTimer);
    if (this.worker) {
      try { this.worker.terminate(); } catch (e) { /* ignore */ }
    }
    this.worker = null;
    this.ready = false;
    if (this.flavorIndex < this.flavors.length - 1) {
      this.flavorIndex++;
      this.onStatus({ state: 'fallback', text: T('Stockfish unavailable. Switching to the backup engine…'), reason: reason });
      this._spawn();
      return;
    }
    this.failed = true;
    this.onStatus({ state: 'error', text: T('No engine available'), reason: reason });
    this.pending.forEach(function (p) {
      clearTimeout(p.timer);
      p.resolve(null);
    });
    this.pending.clear();
  };

  EngineClient.prototype._onMessage = function (w, msg) {
    var self = this;
    if (w !== this.worker || !msg || typeof msg !== 'object') return;
    switch (msg.type) {
      case 'status':
        if (!this.ready) this.onStatus({ state: 'loading', text: msg.text });
        break;
      case 'ready':
        clearTimeout(this.initTimer);
        this.ready = true;
        this.name = msg.engine || 'Stockfish';
        this.flavor = msg.flavor;
        this.onStatus({ state: 'ready', flavor: msg.flavor, text: msg.flavor === 'lite' ? T('Backup engine ready') : T('{name} ready', { name: this.name.replace(/\s+64.*$/, '') }) });
        // Send anything that queued while loading (or was lost in a restart).
        this.pending.forEach(function (p, id) {
          if (p.sentTo !== w) self._send(id);
        });
        break;
      case 'result': {
        if (msg.kind === 'newgame') break;
        var p = this.pending.get(msg.id);
        if (!p) break;
        this.pending.delete(msg.id);
        clearTimeout(p.timer);
        p.resolve(msg.cancelled ? null : msg);
        break;
      }
      case 'fatal':
        this._fail(msg.error);
        break;
      default:
        break;
    }
  };

  EngineClient.prototype._send = function (id) {
    var self = this;
    var p = this.pending.get(id);
    if (!p || !this.ready || !this.worker) return;
    p.sentTo = this.worker;
    clearTimeout(p.timer);
    p.timer = setTimeout(function () {
      if (self.pending.has(id)) self._fail('The engine stopped responding.');
    }, (p.job.movetime || 3000) + 25000);
    this.worker.postMessage(p.job);
  };

  /** Resolves with the raw result, or null if cancelled / unavailable. */
  EngineClient.prototype.search = function (params) {
    var self = this;
    if (this.failed) return Promise.resolve(null);
    return new Promise(function (resolve) {
      var id = self.nextId++;
      var job = {
        type: 'search',
        id: id,
        fen: params.fen,
        depth: params.depth || 0,
        movetime: params.movetime || 0,
        skill: params.skill === undefined ? 20 : params.skill,
        multipv: params.multipv || 1
      };
      self.pending.set(id, { job: job, resolve: resolve, sentTo: null, timer: null });
      self._send(id);
    });
  };

  EngineClient.prototype.cancelAll = function () {
    this.pending.forEach(function (p) {
      clearTimeout(p.timer);
      p.resolve(null);
    });
    this.pending.clear();
    if (this.worker && this.ready) this.worker.postMessage({ type: 'cancelAll' });
  };

  EngineClient.prototype.newGame = function () {
    if (this.worker && this.ready) this.worker.postMessage({ type: 'newGame' });
  };

  /* ======================================================================== */
  /* Analysis cache                                                           */
  /* ======================================================================== */

  var analysisCache = new Map(); // fen -> { promise, settled }

  function analyze(fen, opts) {
    opts = opts || ANALYSIS;
    var hit = analysisCache.get(fen);
    if (hit) return hit.promise;
    var entry = { promise: null, settled: false };
    entry.promise = engine.search({ fen: fen, depth: opts.depth, movetime: opts.movetime, skill: 20, multipv: 1 })
      .then(function (r) {
        entry.settled = true;
        if (!r) {
          if (analysisCache.get(fen) === entry) analysisCache.delete(fen);
          return null;
        }
        entry.value = {
          fen: fen,
          bestMove: r.bestMove,
          pv: r.pv || [],
          whiteCp: C.uciScoreToWhiteCp(r.score, fen),
          depth: r.depth || 0,
          hasScore: !!r.score,
          terminal: null
        };
        return entry.value;
      })
      .catch(function () {
        entry.settled = true;
        if (analysisCache.get(fen) === entry) analysisCache.delete(fen);
        return null;
      });
    analysisCache.set(fen, entry);
    if (analysisCache.size > 500) analysisCache.delete(analysisCache.keys().next().value);
    return entry.promise;
  }

  /** A finished analysis for this position, without asking the engine for more. */
  function peekAnalysis(fen) {
    var e = analysisCache.get(fen);
    return e && e.settled && e.value ? e.value : null;
  }

  /** Stop the engine and forget analyses that were still running. */
  function cancelEngineWork() {
    engine.cancelAll();
    analysisCache.forEach(function (v, k) {
      if (!v.settled) analysisCache.delete(k);
    });
  }

  /* ======================================================================== */
  /* Modals: focus handling, pawn promotion, Coach Guard                      */
  /* ======================================================================== */

  function focusables(container) {
    return Array.prototype.filter.call(
      container.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'),
      function (el) { return !el.disabled && !el.hidden && el.offsetParent !== null; }
    );
  }

  function trapTab(e, container) {
    if (e.key !== 'Tab') return;
    var items = focusables(container);
    if (!items.length) return;
    var first = items[0];
    var last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    } else if (!container.contains(document.activeElement)) {
      e.preventDefault();
      first.focus();
    }
  }

  function askPromotion(color) {
    return new Promise(function (resolve) {
      var modal = $('promotionModal');
      var card = modal.querySelector('.modal-card');
      var buttons = modal.querySelectorAll('[data-piece]');
      Array.prototype.forEach.call(buttons, function (btn) {
        var holder = btn.querySelector('.promo-piece');
        holder.innerHTML = '';
        holder.appendChild(createPieceEl({ t: btn.dataset.piece, c: color }));
      });
      var prevFocus = document.activeElement;
      modal.hidden = false;
      document.body.classList.add('modal-open');
      function done(value) {
        modal.hidden = true;
        document.body.classList.remove('modal-open');
        modal.removeEventListener('click', onClick);
        document.removeEventListener('keydown', onKey, true);
        S.closePromotion = null;
        if (prevFocus && prevFocus.focus) prevFocus.focus({ preventScroll: true });
        resolve(value);
      }
      function onClick(e) {
        var pick = e.target.closest('[data-piece]');
        if (pick) { done(pick.dataset.piece); return; }
        if (e.target.closest('[data-close]')) done(null);
      }
      function onKey(e) {
        if (e.key === 'Escape') { e.preventDefault(); done(null); return; }
        var k = (e.key || '').toLowerCase();
        if (!e.ctrlKey && !e.metaKey && !e.altKey && 'qrbn'.indexOf(k) !== -1 && k.length === 1) {
          e.preventDefault();
          done(k);
          return;
        }
        trapTab(e, card);
      }
      modal.addEventListener('click', onClick);
      document.addEventListener('keydown', onKey, true);
      S.closePromotion = function () { done(null); };
      setTimeout(function () { if (buttons[0]) buttons[0].focus(); }, 30);
    });
  }

  function showGuard(info) {
    return new Promise(function (resolve) {
      var card = $('blunderModal');
      var backdrop = $('blunderBackdrop');
      var undoBtn = $('guardUndo');
      var playBtn = $('guardPlay');
      $('guardText').textContent = info.message;
      Voice.say(C.joinSentences([$('guardTitle').textContent, info.message]), true);
      $('guardNote').textContent = info.banked === false
        ? T('The red square on the board shows the danger.')
        : T('The red square on the board shows the danger. This position is saved to My Blunder Bank so you can practice it later.');
      $('guardEvalBefore').textContent = C.shortScore(info.evalBefore);
      $('guardEvalAfter').textContent = info.afterText || C.shortScore(info.evalAfter);
      var prevFocus = document.activeElement;
      if (window.matchMedia('(max-width: 1023px)').matches) {
        ui.boardWrap.scrollIntoView({ block: 'start', behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
      }
      backdrop.hidden = false;
      card.hidden = false;
      ui.boardWrap.classList.add('spotlight');
      document.body.classList.add('guard-open');
      void card.offsetWidth; // let the hidden -> visible change settle so the entrance transition runs
      card.classList.add('is-open');
      function done(choice) {
        card.classList.remove('is-open');
        card.hidden = true;
        backdrop.hidden = true;
        ui.boardWrap.classList.remove('spotlight');
        document.body.classList.remove('guard-open');
        undoBtn.removeEventListener('click', onUndo);
        playBtn.removeEventListener('click', onPlay);
        document.removeEventListener('keydown', onKey, true);
        S.closeGuard = null;
        if (prevFocus && prevFocus.focus) prevFocus.focus({ preventScroll: true });
        resolve(choice);
      }
      function onUndo() { done('undo'); }
      function onPlay() { done('play'); }
      function onKey(e) {
        if (e.key === 'Escape') {
          e.preventDefault();
          done('undo');
          return;
        }
        trapTab(e, card);
      }
      undoBtn.addEventListener('click', onUndo);
      playBtn.addEventListener('click', onPlay);
      document.addEventListener('keydown', onKey, true);
      S.closeGuard = function () { done('undo'); };
      setTimeout(function () { undoBtn.focus({ preventScroll: true }); }, 40);
    });
  }

  function prefersReducedMotion() {
    return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  /* ======================================================================== */
  /* Practice: state and UI                                                   */
  /* ======================================================================== */

  var ui = {};
  /* ======================================================================== */
  /* Read aloud: the coach speaks, with the device's own voices              */
  /* ======================================================================== */

  var Voice = {
    on: false,
    supported: typeof window.speechSynthesis !== 'undefined' && typeof window.SpeechSynthesisUtterance === 'function',
    voice: null,
    hasVoice: true,

    locale: function () {
      return (window.I18N && window.I18N.locale) || 'en';
    },

    /** The best voice for the site's language: same region, then same language. */
    pick: function () {
      if (!this.supported) return;
      var voices = [];
      try { voices = window.speechSynthesis.getVoices() || []; } catch (e) { voices = []; }
      var loc = this.locale().toLowerCase();
      var lang = loc.split('-')[0];
      var norm = function (v) { return String(v.lang || '').toLowerCase().replace('_', '-'); };
      var exact = voices.filter(function (v) { return norm(v) === loc; });
      var same = voices.filter(function (v) { return norm(v).split('-')[0] === lang || (lang === 'zh' && norm(v).indexOf('cmn') === 0); });
      var list = exact.length ? exact : same;
      list.sort(function (a, b) { return (b.localService ? 1 : 0) - (a.localService ? 1 : 0); });
      this.voice = list[0] || null;
      this.hasVoice = !voices.length || !!this.voice;
      renderVoiceHelp();
    },

    say: function (text, interrupt) {
      if (!this.on || !this.supported || !text) return;
      try {
        var synth = window.speechSynthesis;
        if (interrupt) synth.cancel();
        var u = new window.SpeechSynthesisUtterance(String(text));
        u.lang = this.locale();
        if (this.voice) u.voice = this.voice;
        u.rate = 0.95;
        synth.speak(u);
      } catch (e) {
        /* speech failed: the text is still on screen */
      }
    },

    stop: function () {
      if (!this.supported) return;
      try { window.speechSynthesis.cancel(); } catch (e) { /* ignore */ }
    }
  };

  function renderVoiceHelp() {
    var help = $('voiceHelp');
    if (!help) return;
    if (!Voice.supported) help.textContent = T("This browser can't read text out loud.");
    else if (!Voice.hasVoice) help.textContent = T("Your device has no voice for this language, so another voice may read it, or it may stay silent. You can add voices in your phone's settings.");
    else help.textContent = T("The coach's notes, warnings and lesson steps are read out loud with your device's voice.");
  }

  function setVoice(on, announce) {
    Voice.on = !!on && Voice.supported;
    S.voiceOn = Voice.on;
    var t = $('voiceToggle');
    if (t) {
      t.setAttribute('aria-checked', String(Voice.on));
      t.disabled = !Voice.supported;
    }
    Array.prototype.forEach.call(document.querySelectorAll('[data-voice-toggle]'), function (b) {
      b.setAttribute('aria-pressed', String(Voice.on));
      b.classList.toggle('is-on', Voice.on);
      b.hidden = !Voice.supported;
    });
    if (!Voice.on) Voice.stop();
    if (announce) {
      saveSettings();
      // Speaking inside the tap also unlocks speech on iPhone.
      if (Voice.on) Voice.say(T("I'll read my notes out loud."), true);
    }
  }

  var S = {
    game: new window.Chess(),
    playerColor: 'w',
    orientation: 'w',
    levelIndex: 2,
    colorChoice: 'w',
    guardOn: true,
    showEval: true,
    phase: 'idle', // idle | player | promoting | checking | warning | bot | over
    epoch: 0,
    gameId: makeId(),
    lastPlayerEvalP: null,
    hintStage: 0,
    bankedThisGame: 0,
    closeGuard: null,
    engineNoticeShown: false,
    engineNotice: null,
    soundOn: true,
    timeChoice: 'none',
    closePromotion: null,
    lastSaveStamp: 0,
    installSnoozedUntil: 0,
    boardTheme: 'green',
    homeLevel: 2,
    boardThemeChosen: false,
    started: false,
    viewPly: null, // null = live position; a number = replaying that ply
    startFen: null, // set when a game starts from a position (try again / play from here)
    mode: 'standard', // the running game's mode (see GAME_MODES)
    modeChoice: 'standard', // the New game choice
    odds: null, // Head start: the piece the bot plays without ('q', 'r' or 'n')
    oddsChoice: 'q',
    autoFlip: true, // Play a friend: turn the board after each move
    checkBase: { w: 0, b: 0 }, // Three-check: checks given before the game's first move
    premove: null, // { from, to } queued while the bot thinks
    variantNote: '',
    voiceOn: false,
    helped: false, // hints, take-backs or Coach Guard saves this game (bot ladder)
    liveEval: null,
    summaryStartPly: 0,
    review: { quality: {}, evals: {}, saves: 0 }
  };

  var engine = new EngineClient(onEngineStatus);
  var board;
  var homeBoard;
  var dailyBoard;

  function oppColor() { return C.opposite(S.playerColor); }
  function isFriend() { return S.mode === 'friend'; }
  function isVariant() { return S.mode === 'koth' || S.mode === 'threecheck'; }
  function modeName(m) { return T((GAME_MODES[m] || GAME_MODES.standard).name); }

  /** The usual start, without one of the bot's pieces (and its castling right, for a rook). */
  function oddsFen(playerColor, piece) {
    var botColor = C.opposite(playerColor);
    var o = ODDS[piece] || ODDS.q;
    var file = o.squares[botColor].charCodeAt(0) - 97;
    var parts = START_FEN.split(' ');
    var rows = parts[0].split('/');
    var r = botColor === 'w' ? 7 : 0;
    var row = rows[r].split('');
    row[file] = '1';
    // merge neighbouring empty squares: "1nbqkbnr" stays, "rn1qkbnr" stays, "r1" + "1" -> "2"
    rows[r] = row.join('').replace(/\d+/g, function (d) { return String(d.split('').reduce(function (a, c) { return a + +c; }, 0)); });
    parts[0] = rows.join('/');
    if (piece === 'r') parts[2] = parts[2].replace(botColor === 'w' ? 'Q' : 'q', '') || '-';
    return parts.join(' ');
  }

  function kingSquare(game, color) {
    var b = C.parseFen(game.fen()).board;
    for (var i = 0; i < 64; i++) if (b[i] && b[i].t === 'k' && b[i].c === color) return C.idxToSq(i);
    return null;
  }

  /** Three-check: checks each side has given in this game. */
  function checksGiven(game) {
    var n = { w: S.checkBase.w || 0, b: S.checkBase.b || 0 };
    game.history({ verbose: true }).forEach(function (m) { if (/[+#]$/.test(m.san)) n[m.color]++; });
    return n;
  }

  /** 'hill' or 'threecheck' when the last move won by the mode's extra rule. */
  function variantTerm(game) {
    if (S.mode === 'koth') {
      var mover = C.opposite(game.turn());
      if (HILL.indexOf(kingSquare(game, mover)) !== -1) return 'hill';
      if (HILL.indexOf(kingSquare(game, game.turn())) !== -1) return 'hill';
    } else if (S.mode === 'threecheck') {
      var n = checksGiven(game);
      if (n.w >= 3 || n.b >= 3) return 'threecheck';
    }
    return null;
  }

  /** How the game ends after the last move, if it does: checkmate first, then the mode's own win, then draws. */
  function gameTerm(game) {
    var t = terminalInfo(game);
    if (t === 'checkmate') return t;
    return variantTerm(game) || t;
  }

  /** Moves for `color` (to move in `game`) that win straight away by the mode's extra rule. */
  function variantWins(game, color, checks) {
    if (game.turn() !== color) return [];
    var moves = game.moves({ verbose: true });
    if (S.mode === 'koth') return moves.filter(function (m) { return m.piece === 'k' && HILL.indexOf(m.to) !== -1; });
    if (S.mode === 'threecheck' && checks[color] >= 2) return moves.filter(function (m) { return /[+#]$/.test(m.san); });
    return [];
  }

  /** The same position with the other side to move (to see what they threaten), or null. */
  function passTurn(game) {
    if (ChessAPI.inCheck(game)) return null;
    var parts = game.fen().split(' ');
    parts[1] = parts[1] === 'w' ? 'b' : 'w';
    parts[3] = '-';
    try {
      var g = new window.Chess(parts.join(' '));
      return g.fen().split(' ')[0] === parts[0] ? g : null;
    } catch (e) {
      return null;
    }
  }

  var PIECE_VALUE = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };

  /**
   * The bot in King of the Hill and Three-check: Stockfish plays normal chess,
   * so take a winning move when there is one, and never allow the player one.
   */
  function variantBotMove(uci, lines) {
    var botColor = oppColor();
    var checks = checksGiven(S.game);
    var wins = variantWins(S.game, botColor, checks);
    if (wins.length) return moveToUci(wins[0]);
    var fen = S.game.fen();
    function safe(u) {
      if (!u) return false;
      var g = new window.Chess(fen);
      var m = safeMove(g, uciToMove(u));
      if (!m) return false;
      if (ChessAPI.isCheckmate(g)) return true;
      var c2 = { w: checks.w, b: checks.b };
      if (/[+#]$/.test(m.san)) c2[botColor]++;
      return variantWins(g, S.playerColor, c2).length === 0;
    }
    if (safe(uci)) return uci;
    var others = (lines || []).map(function (l) { return l && l.pv && l.pv[0]; });
    for (var i = 0; i < others.length; i++) if (safe(others[i])) return others[i];
    var scored = [];
    S.game.moves({ verbose: true }).forEach(function (m) {
      var u = moveToUci(m);
      if (!safe(u)) return;
      var g = new window.Chess(fen);
      safeMove(g, uciToMove(u));
      var attacked = g.moves({ verbose: true }).some(function (r) { return r.to === m.to; });
      scored.push({ u: u, score: (m.captured ? PIECE_VALUE[m.captured] : 0) - (attacked ? PIECE_VALUE[m.piece] : 0) + Math.random() * 0.5 });
    });
    if (!scored.length) return uci;
    scored.sort(function (a, b) { return b.score - a.score; });
    return scored[0].u;
  }

  /* ---------------------------------------------------------------- premoves */

  function premoveOpen() {
    return S.started && !isFriend() && S.phase === 'bot' && S.viewPly === null && S.game.turn() !== S.playerColor;
  }

  /** Where a piece could go if it were your turn now (checked again when the bot has moved). */
  function premoveTargets(sq) {
    var parts = S.game.fen().split(' ');
    parts[1] = S.playerColor;
    parts[3] = '-';
    var g;
    try { g = new window.Chess(parts.join(' ')); } catch (e) { return []; }
    var out = [];
    g.moves({ square: sq, verbose: true }).forEach(function (m) { if (out.indexOf(m.to) === -1) out.push(m.to); });
    return out;
  }

  function setPremove(from, to) {
    S.premove = { from: from, to: to };
    board.setMarks({ premove: [from, to] });
  }

  function clearPremove() {
    if (!S.premove) return;
    S.premove = null;
    if (board) board.setMarks({ premove: [] });
  }

  /** On your turn, play the queued premove if it is still legal. */
  function runPremove() {
    var pm = S.premove;
    if (!pm) return false;
    clearPremove();
    if (legalTargets(S.game, pm.from).indexOf(pm.to) === -1) return false;
    var epoch = S.epoch;
    setTimeout(function () {
      if (epoch === S.epoch && S.phase === 'player' && S.viewPly === null && S.game.turn() === S.playerColor) onPlayerMove(pm.from, pm.to, 'q');
    }, 60);
    return true;
  }

  function oppName() { return C.colorName(oppColor()); }

  function loadSettings() {
    var raw = store.get(SETTINGS_KEY);
    if (!raw) return;
    try {
      var s = JSON.parse(raw);
      if (typeof s.guardOn === 'boolean') S.guardOn = s.guardOn;
      if (typeof s.showEval === 'boolean') S.showEval = s.showEval;
      if (typeof s.levelIndex === 'number' && s.levelIndex >= 0 && s.levelIndex < LEVELS.length) S.levelIndex = s.levelIndex;
      if (s.colorChoice === 'w' || s.colorChoice === 'b' || s.colorChoice === 'random') S.colorChoice = s.colorChoice;
      if (typeof s.soundOn === 'boolean') S.soundOn = s.soundOn;
      if (typeof s.installSnoozedUntil === 'number') S.installSnoozedUntil = s.installSnoozedUntil;
      if (window.I18N && Object.prototype.hasOwnProperty.call(window.I18N.langs, s.lang)) S.lang = s.lang;
      if (typeof s.timeChoice === 'string' && Object.prototype.hasOwnProperty.call(TIME_CONTROLS, s.timeChoice)) S.timeChoice = s.timeChoice;
      if (typeof s.modeChoice === 'string' && Object.prototype.hasOwnProperty.call(GAME_MODES, s.modeChoice)) S.modeChoice = s.modeChoice;
      if (typeof s.oddsChoice === 'string' && Object.prototype.hasOwnProperty.call(ODDS, s.oddsChoice)) S.oddsChoice = s.oddsChoice;
      if (typeof s.autoFlip === 'boolean') S.autoFlip = s.autoFlip;
      if (typeof s.voiceOn === 'boolean') S.voiceOn = s.voiceOn;
      if (s.boardThemeChosen === true && (s.boardTheme === 'grey' || s.boardTheme === 'green' || s.boardTheme === 'brown')) {
        S.boardTheme = s.boardTheme;
        S.boardThemeChosen = true;
      }
    } catch (e) {
      /* keep defaults */
    }
  }

  function saveSettings() {
    store.set(SETTINGS_KEY, JSON.stringify({
      guardOn: S.guardOn,
      showEval: S.showEval,
      levelIndex: S.levelIndex,
      colorChoice: S.colorChoice,
      soundOn: S.soundOn,
      timeChoice: S.timeChoice,
      modeChoice: S.modeChoice,
      oddsChoice: S.oddsChoice,
      autoFlip: S.autoFlip,
      voiceOn: S.voiceOn,
      installSnoozedUntil: S.installSnoozedUntil,
      boardTheme: S.boardTheme,
      boardThemeChosen: S.boardThemeChosen,
      lang: S.lang || undefined
    }));
  }

  function saveGame() {
    if (S.phase === 'over') {
      store.remove(GAME_KEY);
      return;
    }
    if (!S.started) return;
    var moves = S.game.history({ verbose: true }).map(moveToUci);
    var stamp = Date.now();
    if (stamp <= S.lastSaveStamp) stamp = S.lastSaveStamp + 1;
    S.lastSaveStamp = stamp;
    store.set(GAME_KEY, JSON.stringify({
      v: 1,
      moves: moves,
      playerColor: S.playerColor,
      startFen: S.startFen || '',
      mode: S.mode,
      odds: S.odds || '',
      checkBase: S.checkBase,
      helped: S.helped,
      level: S.levelIndex,
      gameId: S.gameId,
      clock: { base: Clock.base, inc: Clock.inc, w: Math.round(Clock.value('w')), b: Math.round(Clock.value('b')) },
      savedAt: stamp
    }));
  }

  /** True when the saved game is still the one this tab wrote last (no other tab has saved since). */
  function ownsSavedGame() {
    var data = readJSON(GAME_KEY, null);
    return !!data && data.gameId === S.gameId && data.savedAt === S.lastSaveStamp;
  }

  /* ======================================================================== */
  /* Clocks                                                                   */
  /* ======================================================================== */

  function clockNow() {
    return window.performance && performance.now ? performance.now() : Date.now();
  }

  function pad2(n) {
    return (n < 10 ? '0' : '') + n;
  }

  /** 7:51, 1:02:03, and tenths of a second under ten seconds on a countdown. */
  function formatClock(ms, countdown) {
    ms = Math.max(0, ms);
    if (countdown && ms < 10000) {
      return '0:' + pad2(Math.floor(ms / 1000)) + '.' + Math.floor((ms % 1000) / 100);
    }
    var total = Math.floor(ms / 1000);
    var h = Math.floor(total / 3600);
    var m = Math.floor((total % 3600) / 60);
    var s = total % 60;
    return h ? h + ':' + pad2(m) + ':' + pad2(s) : m + ':' + pad2(s);
  }

  var Clock = {
    base: 0, // starting time per side in ms; 0 = no limit, count up
    inc: 0, // added after each move, in ms
    ms: { w: 0, b: 0 }, // time left (countdown) or time used (count up), excluding the running stretch
    side: null, // colour whose clock is running
    since: 0,
    timer: null,
    flagged: null,

    reset: function (base, inc) {
      this.stopTimer();
      this.base = base || 0;
      this.inc = inc || 0;
      this.ms = { w: this.base, b: this.base };
      this.side = null;
      this.flagged = null;
      renderClocks();
    },

    countdown: function () {
      return this.base > 0;
    },

    value: function (c) {
      var v = this.ms[c];
      if (this.side === c) {
        var d = clockNow() - this.since;
        v = this.countdown() ? v - d : v + d;
      }
      return Math.max(0, v);
    },

    run: function (c) {
      if (this.flagged || !S.started || S.phase === 'over') return;
      if (this.side === c) return;
      this.pause();
      this.side = c;
      this.since = clockNow();
      var self = this;
      this.timer = setInterval(function () { self.tick(); }, 100);
      renderClocks();
    },

    pause: function () {
      if (this.side) {
        this.ms[this.side] = this.value(this.side);
        this.side = null;
      }
      this.stopTimer();
      renderClocks();
    },

    stopTimer: function () {
      if (this.timer) clearInterval(this.timer);
      this.timer = null;
    },

    addIncrement: function (c) {
      if (this.countdown() && this.inc) this.ms[c] += this.inc;
    },

    tick: function () {
      renderClocks();
      if (this.countdown() && this.side && this.value(this.side) <= 0) onFlag(this.side);
    }
  };

  function renderClocks() {
    if (!ui.topClock) return;
    var topColor = C.opposite(S.orientation);
    [[ui.topClock, ui.topClockTime, topColor], [ui.bottomClock, ui.bottomClockTime, S.orientation]].forEach(function (row) {
      var el = row[0];
      var c = row[2];
      var v = Clock.value(c);
      var countdown = Clock.countdown();
      var text = formatClock(v, countdown);
      if (row[1].textContent !== text) row[1].textContent = text;
      el.classList.toggle('is-running', Clock.side === c);
      el.classList.toggle('is-low', countdown && v < LOW_TIME_MS && Clock.flagged !== c);
      el.classList.toggle('is-flagged', Clock.flagged === c);
      el.classList.toggle('is-countup', !countdown);
    });
  }

  /** True when this side has only a king, or a king and one bishop or knight. */
  function cannotMate(game, color) {
    var minors = 0;
    var board = C.parseFen(game.fen()).board;
    for (var i = 0; i < 64; i++) {
      var p = board[i];
      if (!p || p.c !== color || p.t === 'k') continue;
      if (p.t === 'b' || p.t === 'n') minors++;
      else return false;
    }
    return minors <= 1;
  }

  /** A clock reached zero: the game ends on time. */
  function onFlag(color) {
    if (!S.started || S.phase === 'over') {
      Clock.pause();
      return;
    }
    Clock.ms[color] = 0;
    Clock.flagged = color;
    Clock.pause();
    if (S.closeGuard) S.closeGuard();
    if (S.closePromotion) S.closePromotion();
    cancelEngineWork();
    S.epoch++;
    if (S.viewPly !== null) exitView(false);
    board.clearSelection();
    board.setArrows([]);
    endGame('timeout');
  }

  function readJSON(key, fallback) {
    try {
      var v = JSON.parse(store.get(key));
      return v === null || v === undefined ? fallback : v;
    } catch (e) {
      return fallback;
    }
  }

  function loadHistory() {
    var h = readJSON(HISTORY_KEY, []);
    return Array.isArray(h) ? h.filter(function (x) { return x && typeof x.at === 'number' && typeof x.result === 'string'; }) : [];
  }

  function loadStats() {
    var st = readJSON(STATS_KEY, {}) || {};
    return {
      games: parseInt(st.games, 10) || 0,
      wins: parseInt(st.wins, 10) || 0,
      losses: parseInt(st.losses, 10) || 0,
      draws: parseInt(st.draws, 10) || 0,
      saves: parseInt(st.saves, 10) || 0
    };
  }

  function saveStats(st) {
    store.set(STATS_KEY, JSON.stringify(st));
  }

  function recordGame(term, result) {
    var blunders = Object.keys(S.review.quality).filter(function (k) { return S.review.quality[k].cls === 'blunder'; }).length;
    var list = loadHistory();
    list.unshift({
      at: Date.now(),
      result: result,
      how: term,
      level: S.levelIndex,
      color: S.playerColor,
      moves: Math.ceil(S.game.history().length / 2),
      blunders: isFriend() ? null : blunders,
      saves: S.review.saves,
      mode: S.mode,
      odds: S.odds || undefined,
      time: S.timeChoice
    });
    store.set(HISTORY_KEY, JSON.stringify(list.slice(0, 50)));
    var st = loadStats();
    st.games++;
    if (isFriend()) {
      saveStats(st);
      return;
    }
    if (result === 'win') st.wins++;
    else if (result === 'loss') st.losses++;
    else st.draws++;
    saveStats(st);
  }

  function onEngineStatus(s) {
    if (!ui.enginePill) return;
    ui.enginePill.dataset.state = s.state;
    ui.engineText.textContent = s.text;
    if (s.reason) ui.enginePill.title = s.reason;
    if (s.state === 'fallback' && !S.engineNoticeShown) {
      S.engineNoticeShown = true;
      S.engineNotice = { tone: 'warn', icon: '!', text: T("The full computer coach couldn't load, so a simpler backup engine is running. It still warns you about mistakes, but it may miss a few.") };
      pushNotes([S.engineNotice], 'Engine');
    }
    if (s.state === 'error') {
      S.engineNotice = { tone: 'bad', icon: '✕', text: T("The computer coach couldn't start, so mistake warnings are off and the bot plays simple moves. Reload the page to try again.") };
      pushNotes([S.engineNotice], 'Engine');
      if (S.phase === 'checking' || S.phase === 'player') refreshStatusForPhase();
    }
    if (s.state === 'ready' && S.phase === 'bot') {
      setStatus(T('{level} bot is thinking…', { level: levelName(S.levelIndex) }), 'bot');
    }
  }

  function setStatus(text, kind, sub) {
    ui.statusText.textContent = text;
    ui.statusDot.dataset.kind = kind || 'you';
    if (typeof sub === 'string') ui.statusSub.textContent = sub;
  }

  function refreshStatusForPhase() {
    if (S.phase === 'player') {
      setStatus(ChessAPI.inCheck(S.game) ? T("Check! It's your move.") : T('Your move.'), 'you');
    }
  }

  function pushNotes(tips, label) {
    if (!tips || !tips.length) return;
    var li = document.createElement('li');
    li.className = 'note-group';
    if (label) {
      var h = document.createElement('div');
      h.className = 'note-label';
      h.textContent = label;
      li.appendChild(h);
    }
    tips.forEach(function (t) {
      var row = document.createElement('div');
      row.className = 'note tone-' + (t.tone || 'tip');
      var icon = document.createElement('span');
      icon.className = 'note-icon';
      icon.setAttribute('aria-hidden', 'true');
      icon.textContent = t.icon || '•';
      var p = document.createElement('p');
      p.textContent = t.text;
      row.appendChild(icon);
      row.appendChild(p);
      li.appendChild(row);
    });
    ui.feed.insertBefore(li, ui.feed.firstChild);
    while (ui.feed.children.length > 40) ui.feed.removeChild(ui.feed.lastElementChild);
    if (Voice.on && !ui.viewPlay.hidden) Voice.say(C.joinSentences(tips.map(function (t) { return t.text; })));
  }

  function evalToPct(cp) {
    if (C.isMateScore(cp)) return cp > 0 ? 100 : 0;
    var x = Math.max(-1500, Math.min(1500, cp));
    return 50 + 50 * (2 / (1 + Math.exp(-0.004 * x)) - 1);
  }

  function showEval(a, isView) {
    if (!a || !a.hasScore) return;
    if (!isView) S.liveEval = a;
    var cp = a.whiteCp;
    var mine = C.perspective(cp, S.playerColor);
    ui.evalFill.style.height = evalToPct(cp).toFixed(1) + '%';
    ui.evalChip.textContent = C.scoreChip(mine);
    ui.evalBar.setAttribute('aria-label', C.shortScore(mine));
    ui.statusSub.textContent = C.describeEval(mine);
  }

  function resetEval() {
    ui.evalFill.style.height = '50%';
    ui.evalChip.textContent = T('Even');
    ui.evalBar.setAttribute('aria-label', T('Even'));
  }

  /** The New game pane follows the chosen mode and time. */
  function renderNewGameForm() {
    var mode = S.modeChoice;
    Array.prototype.forEach.call(document.querySelectorAll('input[name="gameMode"]'), function (i) { i.checked = i.value === mode; });
    Array.prototype.forEach.call(document.querySelectorAll('input[name="oddsPiece"]'), function (i) { i.checked = i.value === S.oddsChoice; });
    Array.prototype.forEach.call(document.querySelectorAll('input[name="timeControl"]'), function (i) { i.checked = i.value === S.timeChoice; });
    Array.prototype.forEach.call(document.querySelectorAll('input[name="playAs"]'), function (i) { i.checked = i.value === S.colorChoice; });
    $('modeHelp').textContent = T(GAME_MODES[mode].help);
    $('oddsPick').hidden = mode !== 'odds';
    $('playAsBlock').hidden = mode === 'friend';
    $('botBlock').hidden = mode === 'friend';
    $('friendBlock').hidden = mode !== 'friend';
    $('flipToggle').setAttribute('aria-checked', String(S.autoFlip));
    var kind = (TIME_CONTROLS[S.timeChoice] || TIME_CONTROLS.none).kind;
    var help = mode === 'friend' && TIME_KINDS[kind].friendHelp ? TIME_KINDS[kind].friendHelp : TIME_KINDS[kind].help;
    $('timeHelp').textContent = C.joinSentences([T(help), mode === 'friend' ? '' : T("The coach's checks never use your time.")]);
  }

  function applyEvalVisibility() {
    document.body.classList.toggle('hide-eval', !S.showEval);
    ui.evalToggle.setAttribute('aria-checked', String(S.showEval));
  }

  var QUALITY_MARKS = { blunder: '??', mistake: '?', inaccuracy: '?!' };
  var QUALITY_NAMES = { blunder: 'Big mistake', mistake: 'Mistake', inaccuracy: 'Small slip' };

  function renderMoveList() {
    var hist = S.game.history({ verbose: true });
    var ol = ui.moveList;
    ol.innerHTML = '';
    renderNav();
    if (!hist.length) {
      var empty = document.createElement('li');
      empty.className = 'movelist-empty';
      empty.textContent = T('No moves yet.');
      ol.appendChild(empty);
      return;
    }
    var current = S.viewPly === null ? hist.length : S.viewPly;
    for (var i = 0; i < hist.length; i += 2) {
      var li = document.createElement('li');
      li.className = 'move-row';
      var num = document.createElement('span');
      num.className = 'move-num';
      num.textContent = (i / 2 + 1) + '.';
      li.appendChild(num);
      [hist[i], hist[i + 1]].forEach(function (m, k) {
        if (!m) {
          li.appendChild(document.createElement('span'));
          return;
        }
        var ply = i + k + 1;
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'move-san';
        btn.dataset.ply = String(ply);
        btn.textContent = m.san;
        if (m.color === S.playerColor) btn.classList.add('is-mine');
        var q = S.review.quality[ply];
        var mark = q ? QUALITY_MARKS[q.cls] : null;
        if (mark) {
          btn.dataset.note = mark;
          btn.classList.add('q-' + q.cls);
          btn.title = T('{kind}: {loss}', { kind: T(QUALITY_NAMES[q.cls]), loss: C.lossLike(q.drop) });
        }
        if (ply === current) {
          btn.classList.add('is-current');
          btn.setAttribute('aria-current', 'step');
        }
        btn.setAttribute('aria-label', T('Move {n}, {color} {san}{mark}. Show this position.', { n: Math.ceil(ply / 2), color: C.colorName(m.color), san: m.san, mark: mark ? ', ' + T(QUALITY_NAMES[q.cls]) : '' }));
        li.appendChild(btn);
      });
      ol.appendChild(li);
    }
    var cur = ol.querySelector('.is-current');
    if (S.viewPly !== null && cur) ol.scrollTop = Math.max(0, cur.offsetTop - ol.clientHeight / 2);
    else ol.scrollTop = ol.scrollHeight;
  }

  function renderStrips() {
    var caps = C.capturedPieces(S.game.fen());
    var topColor = C.opposite(S.orientation);
    var bottomColor = S.orientation;
    var lvl = LEVELS[S.levelIndex];
    var checks = S.started && S.mode === 'threecheck' ? checksGiven(S.game) : null;
    function fill(color, nameEl, sideEl, capsEl, advEl, avatarEl, clockEl, checksEl) {
      var isMe = color === S.playerColor;
      if (checksEl) {
        checksEl.hidden = !checks;
        if (checks) {
          var n = Math.min(3, checks[color]);
          checksEl.innerHTML = '<i></i><i></i><i></i>';
          for (var k = 0; k < n; k++) checksEl.children[k].className = 'is-given';
          checksEl.setAttribute('aria-label', T('{n} of 3 checks given', { n: n }));
          checksEl.title = checksEl.getAttribute('aria-label');
        }
      }
      if (S.started && isFriend()) {
        nameEl.textContent = C.colorName(color);
        sideEl.textContent = S.game.turn() === color && S.phase !== 'over' ? T('to move') : '';
        if (!avatarEl.classList.contains('avatar-pawn')) avatarEl.innerHTML = PAWN_AVATAR;
        avatarEl.classList.add('avatar-pawn');
        avatarEl.dataset.color = color;
        delete avatarEl.dataset.level;
      } else if (S.started) {
        nameEl.textContent = isMe ? T('You') : T('{level} bot', { level: levelName(S.levelIndex) });
        sideEl.textContent = '(' + C.colorName(color) + ')';
      } else {
        nameEl.textContent = isMe ? T('You') : T('Opponent');
        sideEl.textContent = '';
      }
      if (S.started && isFriend()) {
        /* both players have a pawn avatar, set above */
      } else if (isMe) {
        if (!avatarEl.classList.contains('avatar-pawn')) avatarEl.innerHTML = PAWN_AVATAR;
        avatarEl.classList.add('avatar-pawn');
        delete avatarEl.dataset.level;
        delete avatarEl.dataset.color;
      } else {
        delete avatarEl.dataset.color;
        avatarEl.classList.remove('avatar-pawn');
        avatarEl.textContent = S.started ? lvl.glyph : '?';
        if (S.started) avatarEl.dataset.level = String(S.levelIndex);
        else delete avatarEl.dataset.level;
      }
      capsEl.innerHTML = '';
      var list = color === 'w' ? caps.byWhite : caps.byBlack;
      list.forEach(function (t) { capsEl.appendChild(createPieceEl({ t: t, c: C.opposite(color) }, 'cap')); });
      var diff = color === 'w' ? caps.diff : -caps.diff;
      advEl.textContent = diff > 0 ? '+' + diff : '';
      clockEl.setAttribute('aria-label', S.started && isFriend()
        ? (Clock.countdown() ? T('{color} clock, time left', { color: C.colorName(color) }) : T('{color} clock, time used', { color: C.colorName(color) }))
        : isMe
          ? (Clock.countdown() ? T('Your clock, time left') : T('Your clock, time used'))
          : (Clock.countdown() ? T("The bot's clock, time left") : T("The bot's clock, time used")));
    }
    fill(topColor, ui.topName, ui.topSide, ui.topCaps, ui.topAdv, ui.topAvatar, ui.topClock, ui.topChecks);
    fill(bottomColor, ui.bottomName, ui.bottomSide, ui.bottomCaps, ui.bottomAdv, ui.bottomAvatar, ui.bottomClock, ui.bottomChecks);
    ui.viewPlay.dataset.mode = S.started ? S.mode : '';
    renderClocks();
  }

  function lastMoveMark() {
    var hist = S.game.history({ verbose: true });
    var last = hist[hist.length - 1];
    return last ? { from: last.from, to: last.to } : null;
  }

  function syncBoard(animate) {
    board.setOrientation(S.orientation);
    board.setFen(S.game.fen(), { animate: !!animate });
    board.setMarks({ lastMove: lastMoveMark(), check: checkSquare(S.game), danger: [], hint: [], hill: S.mode === 'koth' ? HILL : [], premove: S.premove ? [S.premove.from, S.premove.to] : [] });
    board.setArrows([]);
    ui.evalBar.classList.toggle('flipped', S.orientation === 'b');
  }

  function refreshControls() {
    var hasMine = isFriend()
      ? S.game.history().length > 0
      : S.game.history({ verbose: true }).some(function (m) { return m.color === S.playerColor; });
    ui.btnTakeBack.disabled = !hasMine || S.phase === 'warning' || S.phase === 'promoting' || (S.phase === 'over' && !!Clock.flagged);
    ui.btnHint.disabled = S.phase !== 'player' || engine.failed;
    ui.btnNewGame.disabled = S.phase === 'warning' || S.phase === 'promoting';
    board.refresh();
  }

  /* ======================================================================== */
  /* Practice: game loop                                                      */
  /* ======================================================================== */

  function classifyMove(v) {
    if (!v) return null;
    if (v.isBest) return 'best';
    if (v.drop > C.BLUNDER_CP) return 'blunder';
    if (v.drop > C.MISTAKE_CP) return 'mistake';
    if (v.drop > C.INACCURACY_CP) return 'inaccuracy';
    return 'good';
  }

  function resetReview() {
    S.review = { quality: {}, evals: {}, saves: 0 };
  }

  /** Forget ratings and evaluations for plies that were taken back. */
  function truncateReview(len) {
    Object.keys(S.review.quality).forEach(function (k) { if (+k > len) delete S.review.quality[k]; });
    Object.keys(S.review.evals).forEach(function (k) { if (+k > len) delete S.review.evals[k]; });
  }

  /**
   * Start a game. opts (optional):
   *   fen    start from this position instead of the usual start
   *   color  play this colour (default: the New game choice)
   *   retry  { move, drop }: replaying a mistake, so the coach can remind you
   */
  function newGame(opts) {
    opts = opts || {};
    Voice.stop();
    if (S.closeGuard) S.closeGuard();
    if (S.closePromotion) S.closePromotion();
    cancelEngineWork();
    S.epoch++;
    S.viewPly = null;
    renderReviewBar();
    hideSummary();
    var tc = TIME_CONTROLS[S.timeChoice] || TIME_CONTROLS.none;
    Clock.reset(tc.base, tc.inc);
    var mode = opts.mode || S.modeChoice;
    S.mode = GAME_MODES[mode] ? mode : 'standard';
    S.odds = S.mode === 'odds' ? (ODDS[opts.odds] ? opts.odds : S.oddsChoice) : null;
    S.checkBase = opts.checkBase || { w: 0, b: 0 };
    S.premove = null;
    S.variantNote = '';
    S.helped = false;
    S.lastStars = 0;
    if (S.mode === 'friend') S.playerColor = opts.color || 'w';
    else S.playerColor = opts.color || (S.colorChoice === 'random' ? (Math.random() < 0.5 ? 'w' : 'b') : S.colorChoice);
    S.startFen = opts.fen || (S.mode === 'odds' ? oddsFen(S.playerColor, S.odds) : null);
    S.game = S.startFen ? new window.Chess(S.startFen) : new window.Chess();
    S.gameId = makeId();
    if (S.mode === 'friend') S.playerColor = S.game.turn();
    S.orientation = S.mode === 'friend' && !S.autoFlip ? 'w' : S.playerColor;
    S.lastPlayerEvalP = null;
    S.liveEval = null;
    S.hintStage = 0;
    S.bankedThisGame = 0;
    resetReview();
    S.phase = 'idle';
    board.clearSelection();
    syncBoard(false);
    resetEval();
    ui.feed.innerHTML = '';
    S.started = true;
    renderMoveList();
    renderStrips();
    engine.newGame();
    Sound.play('start');
    if (S.engineNotice && S.mode !== 'friend') pushNotes([S.engineNotice], 'Engine');
    if (S.mode === 'friend') {
      pushNotes([{
        tone: 'tip',
        icon: '♔',
        text: C.joinSentences([
          opts.fen ? T('Playing on from this position with a friend.') : T('New game with a friend! White moves first.'),
          S.autoFlip
            ? T('Take turns on this device. The board turns around after each move, so the player to move always has their pieces at the bottom.')
            : T('Take turns on this device. White plays from the bottom of the board, Black from the top.')
        ])
      }], T('Play a friend'));
      saveGame();
      friendTurn();
      return;
    }
    var modeTips = modeIntro();
    if (opts.retry || (S.startFen && S.mode !== 'odds')) {
      var tipText = opts.retry && opts.retry.move
        ? T("Let's try that moment again. Last time you chose to {move}, which was {loss}. Take a second look: what can the bot do after your move?", { move: C.moveAction(opts.retry.move, true), loss: C.lossLike(opts.retry.drop || 0) })
        : T('Playing on from this position. You are {color}, against {bot}.', { color: C.colorName(S.playerColor), bot: botName(S.levelIndex) });
      pushNotes([{ tone: 'tip', icon: '↻', text: tipText }].concat(modeTips), opts.retry ? T('Try again') : T('Play from here'));
      saveGame();
      if (S.game.turn() === S.playerColor) playerTurn(null);
      else botTurn();
      return;
    }
    pushNotes([{
      tone: 'tip',
      icon: '♔',
      text: C.joinSentences([
        S.playerColor === 'w'
          ? T("New game! You're playing the white pieces, so you move first. Your opponent is {bot}.", { bot: botName(S.levelIndex) })
          : T("New game! You're playing the black pieces, so the bot moves first. Your opponent is {bot}.", { bot: botName(S.levelIndex) }),
        S.guardOn ? T("Coach Guard is on, so I'll stop you before a big mistake and explain why.") : T('Coach Guard is off, but your big mistakes are still saved in My Blunder Bank.')
      ])
    }].concat(modeTips, loadStats().games < 3 && S.mode === 'standard' ? [{
      tone: 'tip',
      icon: '?',
      text: T('Each square has a name made of a letter and a number, like e4. The letters run along the bottom edge of the board, the numbers up the side. The coach uses these names to point at squares.')
    }] : []), T('Start'));
    saveGame();
    if (S.game.turn() === S.playerColor) playerTurn(null);
    else botTurn();
  }

  /** The coach's first note about the mode (empty for standard chess). */
  function modeIntro() {
    var text = null;
    if (S.mode === 'odds') {
      text = T('Head start: the bot plays without its {piece}, so you begin ahead. Trade pieces when you can: with fewer pieces on the board, your extra piece counts even more.', { piece: C.pieceName(S.odds) });
    } else if (S.mode === 'koth') {
      text = T('King of the Hill: checkmate wins, and so does getting your king to one of the four centre squares (marked on the board). The bot can win the same way, so keep an eye on its king too.');
    } else if (S.mode === 'threecheck') {
      text = T('Three-check: checkmate wins, and so does putting the other king in check three times. The dots next to each name count the checks. Checks are easier to give than checkmate, so look for them on every move.');
    }
    var tc = TIME_CONTROLS[S.timeChoice] || TIME_CONTROLS.none;
    var tips = text ? [{ tone: 'tip', icon: S.mode === 'koth' ? '⛰' : S.mode === 'threecheck' ? '+' : '♛', text: text }] : [];
    if (tc.kind === 'bullet') {
      tips.push({ tone: 'tip', icon: '⚡', text: T('Bullet: {time}. Tip: while the bot is thinking you can already make your next move (a premove). It plays the moment the bot has moved, if it is still allowed. Tap any empty square to cancel it.', { time: T(tc.phrase) }) });
    }
    return tips;
  }

  /** Play a friend: it's this side's turn on the shared device. */
  function friendTurn() {
    S.phase = 'player';
    S.hintStage = 0;
    S.playerColor = S.game.turn();
    var color = C.colorName(S.playerColor);
    setStatus(ChessAPI.inCheck(S.game) ? T("Check! {color} to move.", { color: color }) : T('{color} to move.', { color: color }), 'you');
    Clock.run(S.playerColor);
    renderStrips();
    refreshControls();
    if (S.autoFlip && S.orientation !== S.playerColor) {
      var epoch = S.epoch;
      setTimeout(function () {
        if (epoch !== S.epoch || S.phase !== 'player' || S.viewPly !== null) return;
        S.orientation = S.playerColor;
        syncBoard(false);
        renderStrips();
      }, 450);
    }
  }

  /** Play a friend: a move was made; no coach, just the move and what it did. */
  function friendMoved(mv) {
    Clock.pause();
    Clock.addIncrement(mv.color);
    board.setFen(S.game.fen(), { animate: true });
    board.setArrows([]);
    board.setMarks({ lastMove: { from: mv.from, to: mv.to }, check: checkSquare(S.game), hint: [], danger: [] });
    playMoveSound(mv, S.game, false);
    renderMoveList();
    var who = C.colorName(mv.color);
    var other = C.colorName(C.opposite(mv.color));
    var term = gameTerm(S.game);
    var text = null;
    if (term === 'checkmate') text = null;
    else if (ChessAPI.inCheck(S.game)) text = T("Check! {color}'s king is under attack and must be saved on the next move.", { color: other });
    else if (mv.flags && (mv.flags.indexOf('k') !== -1 || mv.flags.indexOf('q') !== -1)) text = T('{color} castled: the king is tucked away in the corner.', { color: who });
    else if (mv.promotion) text = T("{color}'s pawn reached the last row and became {apiece}!", { color: who, apiece: C.aPiece(mv.promotion) });
    else if (mv.captured) text = T('{color} took the {piece} on {sq}.', { color: who, piece: C.pieceName(mv.captured), sq: mv.to });
    if (text) pushNotes([{ tone: 'tip', icon: '•', text: text }], moveLabel(mv));
    if (term) {
      renderStrips();
      endGame(term);
      return;
    }
    saveGame();
    friendTurn();
  }

  function restoreGame() {
    var raw = store.get(GAME_KEY);
    if (!raw) return false;
    var data;
    try { data = JSON.parse(raw); } catch (e) { return false; }
    if (!data || !Array.isArray(data.moves) || (data.playerColor !== 'w' && data.playerColor !== 'b')) return false;
    var startFen = typeof data.startFen === 'string' && data.startFen ? data.startFen : null;
    if (!data.moves.length && !startFen) return false;
    var g;
    try {
      g = startFen ? new window.Chess(startFen) : new window.Chess();
    } catch (e) {
      return false;
    }
    if (startFen && g.fen().split(' ')[0] !== startFen.split(' ')[0]) return false;
    for (var i = 0; i < data.moves.length; i++) {
      if (typeof data.moves[i] !== 'string' || !safeMove(g, uciToMove(data.moves[i]))) return false;
    }
    var savedMode = typeof data.mode === 'string' && GAME_MODES[data.mode] ? data.mode : 'standard';
    var cb = data.checkBase && typeof data.checkBase === 'object' ? data.checkBase : null;
    S.mode = savedMode;
    S.odds = savedMode === 'odds' && ODDS[data.odds] ? data.odds : null;
    S.checkBase = cb ? { w: +cb.w || 0, b: +cb.b || 0 } : { w: 0, b: 0 };
    S.premove = null;
    S.variantNote = '';
    S.helped = !!data.helped;
    if (typeof data.level === 'number' && LEVELS[data.level]) S.levelIndex = data.level;
    if (ChessAPI.isGameOver(g) || variantTerm(g)) {
      S.mode = 'standard';
      return false;
    }
    S.game = g;
    S.startFen = startFen;
    S.playerColor = savedMode === 'friend' ? g.turn() : data.playerColor;
    S.orientation = savedMode === 'friend' && !S.autoFlip ? 'w' : S.playerColor;
    S.gameId = typeof data.gameId === 'string' ? data.gameId : makeId();
    S.lastSaveStamp = typeof data.savedAt === 'number' ? data.savedAt : 0;
    S.viewPly = null;
    S.started = true;
    S.lastOutcome = null;
    var ck = data.clock;
    var okNum = function (n) { return typeof n === 'number' && isFinite(n) && n >= 0; };
    if (ck && okNum(ck.base) && okNum(ck.inc) && okNum(ck.w) && okNum(ck.b)) {
      Clock.reset(ck.base, ck.inc);
      // Never restore a countdown at zero: give at least ten seconds back.
      Clock.ms = ck.base > 0 ? { w: Math.max(ck.w, 10000), b: Math.max(ck.b, 10000) } : { w: ck.w, b: ck.b };
    } else {
      Clock.reset(0, 0);
    }
    resetReview();
    syncBoard(false);
    renderMoveList();
    renderStrips();
    showPane('game');
    ui.feed.innerHTML = '';
    if (S.engineNotice) pushNotes([S.engineNotice], 'Engine');
    pushNotes([{ tone: 'tip', icon: '♔', text: T('Welcome back. Your game is restored right where you left it.') }], T('Resumed'));
    if (S.mode === 'friend') friendTurn();
    else if (S.game.turn() === S.playerColor) playerTurn(null);
    else botTurn();
    return true;
  }

  function playerTurn(ctx) {
    S.phase = 'player';
    S.hintStage = 0;
    Clock.run(S.playerColor);
    var fen = S.game.fen();
    var ply = S.game.history().length;
    var epoch = S.epoch;
    setStatus(ChessAPI.inCheck(S.game) ? T("Check! It's your move.") : T('Your move.'), 'you');
    refreshControls();
    if (runPremove()) return;
    if (isVariant()) variantNotes();
    // Look at the position while the player thinks: this is the "before"
    // evaluation the Coach Guard compares against.
    analyze(fen).then(function (a) {
      if (epoch !== S.epoch || !a) return;
      if (a.hasScore) S.review.evals[ply] = a.whiteCp;
      if (S.game.fen() === fen) {
        if (S.viewPly === null) showEval(a);
        else S.liveEval = a;
      }
      if (ctx && ctx.botMove && a.hasScore) {
        var tips = C.describeOpportunity({
          prevEvalP: ctx.prevEvalP,
          evalP: C.perspective(a.whiteCp, S.playerColor),
          playerColor: S.playerColor,
          bestMove: a.bestMove ? describeUci(fen, a.bestMove) : null,
          fen: fen
        });
        if (tips.length) {
          pushNotes(tips, ctx.label);
          Sound.play('notify');
        }
      }
    });
  }

  function judge(before, after, mv) {
    if (!before || !before.hasScore || !after || !after.hasScore) return null;
    var pBefore = C.perspective(before.whiteCp, S.playerColor);
    var pAfter = C.perspective(after.whiteCp, S.playerColor);
    var drop = C.clampCp(pBefore) - C.clampCp(pAfter);
    var isBest = !!before.bestMove && before.bestMove === moveToUci(mv);
    var bestSan = before.bestMove ? (isBest ? mv.san : sanOf(before.fen, before.bestMove)) : null;
    return {
      pBefore: pBefore,
      pAfter: pAfter,
      drop: drop,
      isBest: isBest,
      bestSan: bestSan,
      best: before.bestMove ? describeUci(before.fen, before.bestMove) : null,
      bestMove: before.bestMove,
      isBlunder: !isBest && !!before.bestMove && drop > C.BLUNDER_CP
    };
  }

  /** King of the Hill and Three-check: point out a win, or the bot's threat to win. */
  function variantNotes() {
    var checks = checksGiven(S.game);
    var wins = variantWins(S.game, S.playerColor, checks);
    var key = '';
    var text = null;
    if (wins.length) {
      key = 'win:' + S.game.fen();
      text = S.mode === 'koth'
        ? T('You can win right now: move your king to {sq}!', { sq: wins[0].to })
        : T('You can win right now: give your third check!');
    } else {
      var g = passTurn(S.game);
      var threat = g ? variantWins(g, oppColor(), checks) : [];
      if (threat.length) {
        key = 'threat:' + threat[0].to + ':' + checks[oppColor()];
        text = S.mode === 'koth'
          ? T("Watch out: the bot's king can reach {sq} next move and win. Guard that square, or check the king to push it back.", { sq: threat[0].to })
          : T('Watch out: the bot has given 2 checks. One more check and it wins, so keep your king safe from checks.');
      }
    }
    if (text && key !== S.variantNote) {
      S.variantNote = key;
      pushNotes([{ tone: wins.length ? 'good' : 'warn', icon: S.mode === 'koth' ? '⛰' : '+', text: text }], modeName(S.mode));
      Sound.play('notify');
    }
  }

  async function onPlayerMove(from, to, premovePromotion) {
    if (S.phase !== 'player' || S.viewPly !== null || S.game.turn() !== S.playerColor) return;
    var promotion = null;
    if (premovePromotion && needsPromotion(S.game, from, to)) {
      promotion = premovePromotion;
    } else if (needsPromotion(S.game, from, to)) {
      var promoEpoch = S.epoch;
      S.phase = 'promoting';
      refreshControls();
      promotion = await askPromotion(S.playerColor);
      if (promoEpoch !== S.epoch) return; // the game ended (on time) while the picker was open
      S.phase = 'player';
      refreshControls();
      if (!promotion) return;
    }
    var fenBefore = S.game.fen();
    var mv = safeMove(S.game, promotion ? { from: from, to: to, promotion: promotion } : { from: from, to: to });
    if (!mv) {
      board.refresh();
      return;
    }
    if (isFriend()) {
      friendMoved(mv);
      return;
    }
    // The coach's check below doesn't use anyone's time.
    Clock.pause();
    var epoch = S.epoch;
    var fenAfter = S.game.fen();
    S.phase = 'checking';
    S.hintStage = 0;
    board.setFen(fenAfter, { animate: true });
    board.setArrows([]);
    board.setMarks({ lastMove: { from: mv.from, to: mv.to }, check: checkSquare(S.game), hint: [], danger: [] });
    playMoveSound(mv, S.game, false);
    renderMoveList();
    renderStrips();
    refreshControls();
    setStatus(engine.failed ? T('Playing your move…') : T('Coach is checking your move…'), 'busy');

    var before = await analyze(fenBefore);
    if (epoch !== S.epoch) return;
    var term = gameTerm(S.game);
    var after = term ? terminalAnalysis(S.game, term) : await analyze(fenAfter);
    if (epoch !== S.epoch) return;

    var verdict = judge(before, after, mv);
    var saved = false;

    // King of the Hill / Three-check: does this move let the bot win straight away?
    var vThreat = !term && isVariant() ? variantWins(S.game, oppColor(), checksGiven(S.game))[0] : null;
    if (vThreat && S.guardOn) {
      S.phase = 'warning';
      refreshControls();
      board.setMarks({ danger: [vThreat.to] });
      board.setArrows([{ from: vThreat.from, to: vThreat.to, color: 'red' }]);
      setStatus(T('Coach Guard: take a second look.'), 'warn');
      Sound.play('warning');
      var vMsg = S.mode === 'koth'
        ? T("Careful! After this move the bot's king can walk to {sq}, a centre square, and win the game.", { sq: vThreat.to })
        : T('Careful! After this move the bot can {move}. That would be its third check, and it would win the game.', { move: C.moveAction(describeUci(fenAfter, moveToUci(vThreat)), false) });
      var vChoice = await showGuard({ message: vMsg, evalBefore: verdict ? verdict.pBefore : 0, evalAfter: -C.MATE_CP, afterText: T('Bot wins'), banked: false });
      if (epoch !== S.epoch) return;
      board.setMarks({ danger: [] });
      board.setArrows([]);
      if (vChoice === 'undo') {
        S.game.undo();
        S.helped = true;
        S.review.saves++;
        var vStats = loadStats();
        vStats.saves++;
        saveStats(vStats);
        onProgress('guard-save');
        Sound.play('undo');
        syncBoard(true);
        renderMoveList();
        renderStrips();
        pushNotes([{ tone: 'good', icon: '↶', text: C.joinSentences([T('Good call taking it back.'), T('Look for a safer move.')]) }], T('{move} (taken back)', { move: moveLabel(mv) }));
        playerTurn(null);
        return;
      }
    }

    if (verdict && verdict.isBlunder && !vThreat) {
      var ref = after.bestMove ? describeUci(fenAfter, after.bestMove) : null;
      var pAfterRaw = C.perspective(after.whiteCp, S.playerColor);
      var oppMate = !after.terminal && C.isMateScore(after.whiteCp) && pAfterRaw < 0 ? C.mateDistance(after.whiteCp) : null;
      var explanation = C.explainBlunder({
        move: mv,
        fenBefore: fenBefore,
        fenAfter: fenAfter,
        playerColor: S.playerColor,
        drop: verdict.drop,
        pAfter: verdict.pAfter,
        refutation: ref,
        opponentMateIn: oppMate,
        terminal: after.terminal && after.terminal !== 'checkmate' ? after.terminal : null,
        bestSan: verdict.bestSan
      });
      var added = isVariant() ? { isNew: false, entry: { id: null } } : C.BlunderBank.add({
        fen: fenBefore,
        color: S.playerColor,
        bestMove: verdict.bestMove,
        bestSan: verdict.bestSan,
        playedMove: moveToUci(mv),
        playedSan: mv.san,
        refutationSan: ref ? ref.san : '',
        evalBefore: C.clampCp(verdict.pBefore),
        evalAfter: C.clampCp(verdict.pAfter),
        drop: verdict.drop,
        moveNumber: C.parseFen(fenBefore).fullmove,
        caught: false,
        gameId: S.gameId
      });
      saved = !isVariant();
      if (added.isNew) S.bankedThisGame++;

      if (S.guardOn) {
        S.phase = 'warning';
        refreshControls();
        board.setMarks({ danger: explanation.dangerSquares });
        board.setArrows(explanation.threat ? [{ from: explanation.threat.from, to: explanation.threat.to, color: 'red' }] : []);
        setStatus(T('Coach Guard: take a second look.'), 'warn');
        Sound.play('warning');
        var choice = await showGuard({ message: explanation.message, evalBefore: verdict.pBefore, evalAfter: verdict.pAfter, banked: !isVariant() });
        if (epoch !== S.epoch) return;
        board.setMarks({ danger: [] });
        board.setArrows([]);
        if (choice === 'undo') {
          S.game.undo();
          S.helped = true;
          S.review.saves++;
          var savedStats = loadStats();
          savedStats.saves++;
          saveStats(savedStats);
          if (added.entry.id) C.BlunderBank.update(added.entry.id, { caught: true });
          onProgress('guard-save');
          Sound.play('undo');
          syncBoard(true);
          renderMoveList();
          renderStrips();
          var watch = explanation.threat
            ? T('Before you move again, look at what the bot could do on {sq}.', { sq: explanation.threat.to })
            : T('Look for a safer move.');
          pushNotes([{ tone: 'good', icon: '↶', text: C.joinSentences([T('Good call taking it back.'), watch]) }], T('{move} (taken back)', { move: moveLabel(mv) }));
          playerTurn(null);
          return;
        }
      }
    }
    finalizePlayerMove(mv, fenBefore, fenAfter, verdict, saved, after);
  }

  /** Three-check: say how many checks each side has after a checking move. */
  function checkCountNote(mv) {
    if (S.mode !== 'threecheck' || !/[+]$/.test(mv.san)) return [];
    var n = checksGiven(S.game)[mv.color];
    if (n >= 3) return [];
    var mine = mv.color === S.playerColor;
    var text = mine
      ? (n === 1 ? T('Check 1 of 3! Two more checks win.') : T('Check 2 of 3! One more check wins.'))
      : (n === 1 ? T('The bot has given 1 of 3 checks.') : T('The bot has given 2 of 3 checks. One more and it wins.'));
    return [{ tone: mine ? 'good' : 'warn', icon: '+', text: text }];
  }

  function finalizePlayerMove(mv, fenBefore, fenAfter, verdict, saved, after) {
    var hist = S.game.history({ verbose: true });
    var prevMove = hist.length >= 2 ? hist[hist.length - 2] : null;
    var term = gameTerm(S.game);
    var ply = hist.length;
    var cls = classifyMove(verdict);
    if (cls) S.review.quality[ply] = { cls: cls, san: mv.san, drop: verdict.drop, best: verdict.isBest ? null : verdict.bestMove };
    if (after && after.hasScore) S.review.evals[ply] = after.whiteCp;
    renderMoveList();
    var tips = C.describeMove({
      move: mv,
      fenBefore: fenBefore,
      fenAfter: fenAfter,
      mover: 'player',
      playerColor: S.playerColor,
      history: hist,
      prevMove: prevMove,
      inCheck: ChessAPI.inCheck(S.game),
      isCheckmate: term === 'checkmate',
      drawReason: term && term !== 'checkmate' && term !== 'hill' && term !== 'threecheck' ? term : null,
      verdict: verdict,
      savedToBank: saved
    });
    pushNotes(term === 'hill' || term === 'threecheck' ? [] : tips.concat(checkCountNote(mv)), moveLabel(mv));
    if (after && after.hasScore) {
      showEval(after);
      S.lastPlayerEvalP = C.perspective(after.whiteCp, S.playerColor);
    } else {
      S.lastPlayerEvalP = null;
    }
    if (term) {
      endGame(term);
      return;
    }
    Clock.addIncrement(S.playerColor);
    saveGame();
    botTurn();
  }

  async function botTurn() {
    S.phase = 'bot';
    refreshControls();
    var epoch = S.epoch;
    var fen = S.game.fen();
    var lvl = LEVELS[S.levelIndex];
    var botColor = oppColor();
    Clock.run(botColor);
    setStatus(engine.ready || engine.failed ? T('{level} bot is thinking…', { level: levelName(S.levelIndex) }) : T('Waiting for the computer to load…'), 'bot');
    // Short on time, the bot moves faster, like a person would.
    var botLeft = Clock.countdown() ? Clock.value(botColor) : Infinity;
    var movetime = botLeft < 30000 ? Math.min(lvl.movetime, 150) : botLeft < 90000 ? Math.min(lvl.movetime, 400) : lvl.movetime;
    // In Bullet the bot moves quickly too.
    var fast = Clock.countdown() && Clock.base <= 2 * 60000;
    if (fast) movetime = Math.min(movetime, 250);
    var minThink = botLeft < 15000 ? 0 : fast ? 150 : MIN_BOT_THINK_MS;
    var t0 = Date.now();
    var uci = null;
    var lines = null;
    if (lvl.random > 0 && Math.random() < lvl.random) {
      uci = randomMoveUci(S.game);
    } else {
      var r = await engine.search({ fen: fen, skill: lvl.skill, depth: lvl.depth, movetime: movetime, multipv: isVariant() ? 4 : 1 });
      if (epoch !== S.epoch) return;
      uci = r && r.bestMove;
      lines = r && r.lines;
    }
    if (!uci) uci = randomMoveUci(S.game);
    if (isVariant()) uci = variantBotMove(uci, lines);
    var wait = minThink - (Date.now() - t0);
    if (wait > 0) await sleep(wait);
    if (epoch !== S.epoch) return;

    // If the player was looking back through the game, return to the live board.
    if (S.viewPly !== null) exitView(false);
    var fenBefore = S.game.fen();
    var mv = uci ? safeMove(S.game, uciToMove(uci)) : null;
    if (!mv) {
      var alt = randomMoveUci(S.game);
      mv = alt ? safeMove(S.game, uciToMove(alt)) : null;
    }
    if (!mv) {
      endGame(terminalInfo(S.game) || 'stalemate');
      return;
    }
    Clock.pause();
    Clock.addIncrement(botColor);
    var fenAfter = S.game.fen();
    board.setFen(fenAfter, { animate: true });
    board.setMarks({ lastMove: { from: mv.from, to: mv.to }, check: checkSquare(S.game), hint: [], danger: [] });
    board.setArrows([]);
    playMoveSound(mv, S.game, true);
    renderMoveList();
    renderStrips();

    var hist = S.game.history({ verbose: true });
    var prevMove = hist.length >= 2 ? hist[hist.length - 2] : null;
    var term = gameTerm(S.game);
    var label = moveLabel(mv);
    if (term === 'hill' || term === 'threecheck') {
      endGame(term);
      return;
    }
    pushNotes(C.describeMove({
      move: mv,
      fenBefore: fenBefore,
      fenAfter: fenAfter,
      mover: 'bot',
      playerColor: S.playerColor,
      history: hist,
      prevMove: prevMove,
      inCheck: ChessAPI.inCheck(S.game),
      isCheckmate: term === 'checkmate',
      drawReason: term && term !== 'checkmate' ? term : null,
      verdict: null
    }).concat(checkCountNote(mv)), label);
    if (term) {
      endGame(term);
      return;
    }
    saveGame();
    playerTurn({ botMove: mv, prevEvalP: S.lastPlayerEvalP, label: label });
  }

  /** Result of a finished game from the player's side: win, loss or draw, with the words for it. */
  function friendOutcome(term) {
    var winner = null;
    if (term === 'checkmate') winner = C.opposite(S.game.turn());
    if (term === 'timeout') {
      var loser = Clock.flagged || S.game.turn();
      winner = C.opposite(loser);
      if (cannotMate(S.game, winner)) {
        return {
          result: 'draw',
          status: T("Draw. {color} ran out of time, but the other side can't checkmate with what's left.", { color: C.colorName(loser) }),
          summary: T('Draw: time ran out, with no way left to checkmate.')
        };
      }
      return {
        result: winner === 'w' ? 'white' : 'black',
        status: T('{color} ran out of time. {winner} wins!', { color: C.colorName(loser), winner: C.colorName(winner) }),
        summary: T('{color} won on time!', { color: C.colorName(winner) })
      };
    }
    if (winner) {
      return {
        result: winner === 'w' ? 'white' : 'black',
        status: T('Checkmate. {color} wins!', { color: C.colorName(winner) }),
        summary: T('{color} won by checkmate!', { color: C.colorName(winner) })
      };
    }
    return null;
  }

  function gameOutcome(term) {
    if (isFriend()) {
      var fo = friendOutcome(term);
      if (fo) return fo;
    }
    if (term === 'hill' || term === 'threecheck') {
      var moverWon = C.opposite(S.game.turn()) === S.playerColor;
      if (term === 'hill') {
        return {
          result: moverWon ? 'win' : 'loss',
          status: moverWon ? T('Your king reached the centre. You win!') : T("The bot's king reached the centre. The bot wins."),
          summary: moverWon ? T('You won: your king reached the centre!') : T('The bot won: its king reached the centre.')
        };
      }
      return {
        result: moverWon ? 'win' : 'loss',
        status: moverWon ? T('Third check. You win!') : T('Third check. The bot wins.'),
        summary: moverWon ? T('You won with three checks!') : T('The bot won with three checks.')
      };
    }
    if (term === 'checkmate') {
      var won = S.game.turn() !== S.playerColor;
      return {
        result: won ? 'win' : 'loss',
        status: won ? T('Checkmate. You win!') : T('Checkmate. The bot wins.'),
        summary: won ? T('You won by checkmate!') : T('The bot won by checkmate.')
      };
    }
    if (term === 'timeout') {
      var loser = Clock.flagged || S.playerColor;
      var winner = C.opposite(loser);
      var playerFlagged = loser === S.playerColor;
      if (cannotMate(S.game, winner)) {
        return {
          result: 'draw',
          status: playerFlagged ? T("Draw. Time ran out, but the bot can't checkmate with what's left.") : T("Draw. Time ran out, but you can't checkmate with what's left."),
          summary: playerFlagged ? T('Draw: time ran out, but the bot had no way to checkmate.') : T('Draw: time ran out, but you had no way to checkmate.')
        };
      }
      return {
        result: playerFlagged ? 'loss' : 'win',
        status: playerFlagged ? T('You ran out of time. The bot wins.') : T('The bot ran out of time. You win!'),
        summary: playerFlagged ? T('The bot won on time.') : T('You won on time!')
      };
    }
    var reason = {
      stalemate: ["Draw by stalemate: no legal move, but the king isn't attacked.", 'Draw by stalemate.'],
      repetition: ['Draw: the same position came up three times.', 'Draw: the same position came up three times.'],
      insufficient: ['Draw: not enough pieces left to checkmate.', 'Draw: not enough pieces left to checkmate.'],
      fifty: ['Draw: 50 moves with no capture and no pawn move.', 'Draw by the 50-move rule.']
    }[term] || ['Draw.', 'Draw.'];
    return { result: 'draw', status: T(reason[0]), summary: T(reason[1]) };
  }

  function endGame(term) {
    S.phase = 'over';
    Clock.pause();
    clearPremove();
    showPane('game');
    store.remove(GAME_KEY);
    var outcome = gameOutcome(term);
    outcome.how = term;
    S.lastOutcome = outcome;
    setStatus(outcome.status, 'over', T('Replay the game to see where it turned, or start a new one.'));
    ui.evalChip.textContent = outcome.result === 'win' ? T('You won') : outcome.result === 'loss' ? T('Bot won')
      : outcome.result === 'white' ? T('{color} won', { color: C.colorName('w') })
      : outcome.result === 'black' ? T('{color} won', { color: C.colorName('b') }) : T('Draw');
    refreshControls();
    renderStrips();
    Sound.play(outcome.result === 'loss' ? 'lose' : outcome.result === 'draw' ? 'draw' : 'win');
    recordGame(term, outcome.result);
    var tcKind = (TIME_CONTROLS[S.timeChoice] || TIME_CONTROLS.none).kind;
    onProgress('game', {
      result: isFriend() ? 'friend' : outcome.result,
      how: term,
      level: S.levelIndex,
      mode: S.mode,
      fast: Clock.countdown() && (tcKind === 'bullet' || tcKind === 'blitz'),
      blunders: isFriend() ? null : Object.keys(S.review.quality).filter(function (k) { return S.review.quality[k].cls === 'blunder'; }).length,
      moves: Math.ceil(S.game.history().length / 2)
    });
    var blunderCount = Object.keys(S.review.quality).filter(function (k) { return S.review.quality[k].cls === 'blunder'; }).length;
    var stars = isFriend() ? 0 : ladderStars(outcome.result, blunderCount);
    S.lastStars = stars;
    if (stars && Progress.data) {
      var before = Progress.data.ladder[S.levelIndex] || 0;
      if (stars > before) {
        Progress.data.ladder[S.levelIndex] = stars;
        Progress.save();
        renderLevelCards();
        toast('★', T('{stars} against {bot}', { stars: starText(stars), bot: botName(S.levelIndex) }), stars === 3 ? T('Perfect: a win with no big mistakes and no help.') : stars === 2 ? T('A win with no big mistakes. Win without hints or take-backs for the third star.') : T('A win! Win with no big mistakes for the second star.'));
      }
    }
    if (isFriend()) {
      pushNotes([{ tone: 'tip', icon: '♔', text: T('Good game! Step back through the moves together to see where it turned.') }], T('Game over'));
      showSummary(term);
      return;
    }
    var summary = S.bankedThisGame > 0
      ? (S.bankedThisGame === 1
        ? T('This game added 1 big mistake to My Blunder Bank as a puzzle. Solving it is the best way to stop making the same mistake again.')
        : T('This game added {n} big mistakes to My Blunder Bank as puzzles. Solving them is the best way to stop making the same mistake again.', { n: S.bankedThisGame }))
      : T('No big mistakes this game. Nicely done!');
    pushNotes([{ tone: 'tip', icon: '♔', text: summary }], T('Game over'));
    showSummary(term);
  }

  function takeBack() {
    if (S.phase === 'warning' || S.phase === 'promoting') return;
    if (S.phase === 'over' && Clock.flagged) return; // a game lost on time stays finished
    var hist = S.game.history({ verbose: true });
    if (isFriend()) {
      if (!hist.length) return;
      S.epoch++;
      Clock.pause();
      S.viewPly = null;
      renderReviewBar();
      hideSummary();
      S.game.undo();
      board.clearSelection();
      syncBoard(true);
      Sound.play('undo');
      renderMoveList();
      saveGame();
      pushNotes([{ tone: 'tip', icon: '↶', text: T('Move taken back.') }], T('Take back'));
      friendTurn();
      return;
    }
    if (!hist.some(function (m) { return m.color === S.playerColor; })) return;
    S.helped = true;
    cancelEngineWork();
    S.epoch++;
    Clock.pause();
    clearPremove();
    S.viewPly = null;
    renderReviewBar();
    hideSummary();
    while (S.game.history().length) {
      var m = S.game.undo();
      if (!m || m.color === S.playerColor) break;
    }
    truncateReview(S.game.history().length);
    S.lastPlayerEvalP = null;
    board.clearSelection();
    syncBoard(true);
    Sound.play('undo');
    renderMoveList();
    renderStrips();
    S.phase = 'player';
    saveGame();
    pushNotes([{ tone: 'tip', icon: '↶', text: T('Move taken back. Have another look before you play.') }], T('Take back'));
    playerTurn(null);
  }

  async function showHint() {
    if (S.phase !== 'player') return;
    S.helped = true;
    if (S.viewPly !== null) exitView(false);
    var fen = S.game.fen();
    var epoch = S.epoch;
    ui.btnHint.disabled = true;
    ui.btnHint.textContent = T('Thinking…');
    var a = await analyze(fen);
    ui.btnHint.textContent = T('Show hint');
    if (epoch !== S.epoch || S.game.fen() !== fen || S.phase !== 'player' || S.viewPly !== null) {
      refreshControls();
      return;
    }
    refreshControls();
    if (!a || !a.bestMove) {
      pushNotes([{ tone: 'tip', icon: '?', text: T('The computer coach is still loading. Try the hint again in a moment.') }], T('Hint'));
      return;
    }
    if (isVariant()) {
      var vw = variantWins(S.game, S.playerColor, checksGiven(S.game))[0];
      if (vw) a = { bestMove: moveToUci(vw) };
    }
    var mv = uciToMove(a.bestMove);
    var p = C.parseFen(fen).board[C.sqToIdx(mv.from)];
    var pieceName = p ? C.pieceName(p.t) : T('piece');
    Sound.play('hint');
    if (S.hintStage === 0) {
      S.hintStage = 1;
      board.setMarks({ hint: [mv.from] });
      pushNotes([{ tone: 'tip', icon: '?', text: T('Hint: look at your {piece} on {sq} (the highlighted square). Press Show hint again to see the whole move.', { piece: pieceName, sq: mv.from }) }], T('Hint'));
    } else {
      S.hintStage = 2;
      board.setMarks({ hint: [mv.from] });
      board.setArrows([{ from: mv.from, to: mv.to, color: 'green' }]);
      var bestMv = describeUci(fen, a.bestMove);
      pushNotes([{ tone: 'tip', icon: '?', text: T('The best move here: {move}. Follow the green arrow.', { move: bestMv ? C.moveAction(bestMv, true) : sanOf(fen, a.bestMove) }) }], T('Hint'));
    }
  }

  /* ======================================================================== */
  /* Replay: step back through the game without changing it                  */
  /* ======================================================================== */

  function gameAtPly(ply) {
    var hist = S.game.history({ verbose: true });
    var g = S.startFen ? new window.Chess(S.startFen) : new window.Chess();
    for (var i = 0; i < ply && i < hist.length; i++) {
      var m = hist[i];
      safeMove(g, m.promotion ? { from: m.from, to: m.to, promotion: m.promotion } : { from: m.from, to: m.to });
    }
    return g;
  }

  function canReview() {
    return S.phase !== 'warning' && S.phase !== 'promoting' && S.phase !== 'checking' &&
      !document.body.classList.contains('modal-open') && !document.body.classList.contains('guard-open');
  }

  function enterView(ply) {
    if (!canReview()) return;
    var hist = S.game.history({ verbose: true });
    ply = Math.max(0, Math.min(hist.length, ply));
    if (ply === hist.length) {
      exitView(true);
      return;
    }
    var prev = S.viewPly === null ? hist.length : S.viewPly;
    if (ply === prev) return;
    S.viewPly = ply;
    var g = gameAtPly(ply);
    var m = ply > 0 ? hist[ply - 1] : null;
    board.clearSelection();
    board.setFen(g.fen(), { animate: Math.abs(prev - ply) === 1 });
    board.setMarks({ lastMove: m ? { from: m.from, to: m.to } : null, check: checkSquare(g), danger: [], hint: [] });
    board.setArrows([]);
    if (ply === prev + 1 && m) playMoveSound(m, g, m.color !== S.playerColor);
    else if (ply === prev - 1) Sound.play('move', true);
    var a = peekAnalysis(g.fen());
    if (a) showEval(a, true);
    renderReviewBar();
    renderMoveList();
    refreshControls();
  }

  function exitView(animate) {
    if (S.viewPly === null) return;
    S.viewPly = null;
    syncBoard(!!animate);
    if (S.liveEval) showEval(S.liveEval);
    renderReviewBar();
    renderMoveList();
    refreshControls();
  }

  function renderReviewBar() {
    var viewing = S.viewPly !== null;
    ui.reviewBar.hidden = !viewing;
    if (viewing) ui.btnPlayFrom.disabled = ChessAPI.isGameOver(gameAtPly(S.viewPly));
    ui.boardWrap.classList.toggle('is-reviewing', viewing);
    if (!viewing) stopAutoplay();
    renderNav();
    if (!viewing) return;
    var hist = S.game.history({ verbose: true });
    if (S.viewPly === 0) {
      ui.reviewLabel.textContent = T('Start position');
    } else {
      var m = hist[S.viewPly - 1];
      ui.reviewLabel.textContent = T(m.color === 'w' ? 'Move {n}. {san}' : 'Move {n}… {san}', { n: Math.ceil(S.viewPly / 2), san: m.san });
    }
  }

  /* ======================================================================== */
  /* End-of-game summary                                                      */
  /* ======================================================================== */

  function hideSummary() {
    ui.summaryPanel.hidden = true;
  }

  function showSummary(term) {
    var hist = S.game.history({ verbose: true });
    var counts = { best: 0, good: 0, inaccuracy: 0, mistake: 0, blunder: 0 };
    var rated = 0;
    var firstBlunder = null;
    Object.keys(S.review.quality).forEach(function (k) {
      var ply = +k;
      var q = S.review.quality[k];
      if (ply > hist.length || !Object.prototype.hasOwnProperty.call(counts, q.cls)) return;
      counts[q.cls]++;
      rated++;
      if (q.cls === 'blunder' && (firstBlunder === null || ply < firstBlunder)) firstBlunder = ply;
    });
    ui.summaryResult.textContent = gameOutcome(term).summary;
    ui.summaryPanel.classList.toggle('is-friend', isFriend());
    if (isFriend()) {
      ui.summaryLine.textContent = C.joinSentences([
        plural(Math.ceil(hist.length / 2), 'The game lasted {n} move.', 'The game lasted {n} moves.'),
        T('Step back through the moves together to see where it turned.')
      ]);
      ui.momentsWrap.hidden = true;
      ui.btnSummaryRetry.hidden = true;
      ui.btnSummaryBank.hidden = true;
      S.summaryStartPly = 0;
      ui.btnSummaryReview.textContent = T('Replay the game');
      ui.summaryPanel.hidden = false;
      return;
    }
    renderMoments();
    Array.prototype.forEach.call(ui.summaryPanel.querySelectorAll('[data-q]'), function (el) {
      el.textContent = String(counts[el.dataset.q] || 0);
    });
    var lines = [];
    if (rated) {
      lines.push(rated === 1 ? T('{n} of your 1 move was good or best.', { n: counts.best + counts.good }) : T('{n} of your {total} moves were good or best.', { n: counts.best + counts.good, total: rated }));
    } else {
      lines.push(T("This game has no move ratings, because the computer coach wasn't running or the page was reloaded during the game."));
    }
    if (S.review.saves) lines.push(S.review.saves === 1 ? T('Coach Guard saved you 1 time.') : T('Coach Guard saved you {n} times.', { n: S.review.saves }));
    if (S.lastStars) lines.push(T('Bot ladder: {stars} against {bot}.', { stars: starText(S.lastStars), bot: botName(S.levelIndex) }));
    ui.summaryLine.textContent = C.joinSentences(lines);
    drawEvalGraph(hist.length);
    ui.btnSummaryBank.hidden = S.bankedThisGame === 0;
    ui.btnSummaryBank.textContent = S.bankedThisGame === 1 ? T('Practice this mistake') : T('Practice these {n} mistakes', { n: S.bankedThisGame });
    S.summaryStartPly = firstBlunder ? firstBlunder - 1 : 0;
    ui.btnSummaryReview.textContent = firstBlunder ? T('Replay from your first big mistake') : T('Replay the game');
    ui.summaryPanel.hidden = false;
  }

  /**
   * The turning points of a finished game: your biggest mistakes (from the
   * move ratings) and the bot's slips (big swings in your favour).
   */
  function keyMoments() {
    var hist = S.game.history({ verbose: true });
    var list = [];
    Object.keys(S.review.quality).forEach(function (k) {
      var p = +k;
      var q = S.review.quality[k];
      if (p > hist.length || (q.cls !== 'blunder' && q.cls !== 'mistake')) return;
      list.push({ ply: p, move: hist[p - 1], mine: true, size: q.drop, q: q });
    });
    var ev = S.review.evals;
    for (var p = 1; p <= hist.length; p++) {
      var m = hist[p - 1];
      if (m.color === S.playerColor || typeof ev[p] !== 'number' || typeof ev[p - 1] !== 'number') continue;
      var swing = C.clampCp(C.perspective(ev[p], S.playerColor)) - C.clampCp(C.perspective(ev[p - 1], S.playerColor));
      if (swing >= C.BLUNDER_CP) list.push({ ply: p, move: m, mine: false, size: swing });
    }
    list.sort(function (a, b) { return b.size - a.size; });
    return list.slice(0, 3).sort(function (a, b) { return a.ply - b.ply; });
  }

  function renderMoments() {
    var moments = keyMoments();
    var ol = ui.momentsList;
    ol.innerHTML = '';
    ui.momentsWrap.hidden = moments.length === 0;
    var biggest = null;
    moments.forEach(function (mo) {
      if (mo.mine && (!biggest || mo.size > biggest.size)) biggest = mo;
      var li = document.createElement('li');
      li.className = 'moment ' + (mo.mine ? 'is-mistake' : 'is-chance');
      var mark = document.createElement('span');
      mark.className = 'moment-mark';
      mark.setAttribute('aria-hidden', 'true');
      mark.textContent = mo.mine ? (mo.q.cls === 'blunder' ? '??' : '?') : '!';
      var text = document.createElement('span');
      text.className = 'moment-text';
      var title = document.createElement('span');
      title.className = 'moment-title';
      title.textContent = T('Move {n}. {move}', { n: Math.ceil(mo.ply / 2), move: C.moveTitle(mo.move, mo.mine) });
      var sub = document.createElement('span');
      sub.className = 'moment-sub';
      if (mo.mine) {
        var bestMv = mo.q.best ? describeUci(gameAtPly(mo.ply - 1).fen(), mo.q.best) : null;
        sub.textContent = C.joinSentences([
          mo.q.cls === 'blunder' ? T('Big mistake: that was {loss}.', { loss: C.lossLike(mo.size) }) : T('Mistake: that was {loss}.', { loss: C.lossLike(mo.size) }),
          bestMv ? T('Better was to {move}.', { move: C.moveAction(bestMv, true) }) : ''
        ]);
      } else {
        var reply = S.review.quality[mo.ply + 1];
        sub.textContent = C.joinSentences([
          T('The bot slipped: its move was {loss}.', { loss: C.lossLike(mo.size) }),
          reply ? (reply.cls === 'best' || reply.cls === 'good' ? T('You made the most of it!') : T('Did you spot the chance?')) : ''
        ]);
      }
      text.appendChild(title);
      text.appendChild(sub);
      var actions = document.createElement('span');
      actions.className = 'moment-actions';
      var show = document.createElement('button');
      show.type = 'button';
      show.className = 'btn btn-ghost';
      show.dataset.show = String(mo.mine ? mo.ply - 1 : mo.ply);
      show.textContent = T('Show');
      show.setAttribute('aria-label', T('Show the board at move {n}', { n: Math.ceil(mo.ply / 2) }));
      actions.appendChild(show);
      if (mo.mine) {
        var retry = document.createElement('button');
        retry.type = 'button';
        retry.className = 'btn btn-ghost';
        retry.dataset.retry = String(mo.ply);
        retry.textContent = T('Try again');
        retry.setAttribute('aria-label', T('Play from just before this mistake'));
        actions.appendChild(retry);
      }
      li.appendChild(mark);
      li.appendChild(text);
      li.appendChild(actions);
      ol.appendChild(li);
    });
    S.retryPly = biggest ? biggest.ply : null;
    ui.btnSummaryRetry.hidden = !biggest;
  }

  /**
   * Start a new game from the position after `ply` moves of this game.
   * mistakePly: replaying the player's mistake played on that ply.
   */
  function playFrom(ply, mistakePly) {
    if (S.phase === 'warning' || S.phase === 'promoting') return;
    var hist = S.game.history({ verbose: true });
    ply = Math.max(0, Math.min(hist.length, ply));
    var g = gameAtPly(ply);
    if (ChessAPI.isGameOver(g)) return;
    if (S.phase !== 'over' && hist.length && !window.confirm(T('Start a new game from this position? Your current game will end.'))) return;
    var q = mistakePly ? S.review.quality[mistakePly] : null;
    var retry = mistakePly ? { move: hist[mistakePly - 1], drop: q ? q.drop : 0 } : null;
    var cb = { w: S.checkBase.w || 0, b: S.checkBase.b || 0 };
    if (S.mode === 'threecheck') {
      S.game.history({ verbose: true }).slice(0, ply).forEach(function (m) { if (/[+#]$/.test(m.san)) cb[m.color]++; });
    }
    newGame({ fen: g.fen(), color: isFriend() ? g.turn() : S.playerColor, retry: retry, mode: S.mode, odds: S.odds, checkBase: cb });
    showPane('game');
    if (isMobile()) ui.boardWrap.scrollIntoView({ block: 'start', behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
  }

  /* ======================================================================== */
  /* Sharing a result                                                         */
  /* ======================================================================== */

  function loadImage(url) {
    return new Promise(function (resolve) {
      var img = new Image();
      var done = false;
      var timer = setTimeout(function () { if (!done) { done = true; resolve(null); } }, 2500);
      img.crossOrigin = 'anonymous';
      img.onload = function () { if (!done) { done = true; clearTimeout(timer); resolve(img); } };
      img.onerror = function () { if (!done) { done = true; clearTimeout(timer); resolve(null); } };
      img.src = url;
    });
  }

  /** A square picture of the final board with the result. Resolves to a PNG blob or null. */
  function makeShareImage(fen, orientation, title, sub, lastMove) {
    var W = 1080;
    var canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = W;
    var ctx = canvas.getContext('2d');
    if (!ctx) return Promise.resolve(null);
    var styles = getComputedStyle(document.body);
    var light = styles.getPropertyValue('--sq-light').trim() || '#ebecd0';
    var dark = styles.getPropertyValue('--sq-dark').trim() || '#739552';
    var urls = (window.PIECE_SET && window.PIECE_SET.urls) || {};
    var keys = Object.keys(urls);

    function draw(images) {
      ctx.fillStyle = '#262626';
      ctx.fillRect(0, 0, W, W);
      ctx.textAlign = 'center';
      ctx.fillStyle = '#f2f2f2';
      ctx.font = '800 62px Montserrat, system-ui, sans-serif';
      ctx.fillText(title, W / 2, 104);
      ctx.fillStyle = '#bdbdbd';
      ctx.font = '700 32px "Atkinson Hyperlegible", system-ui, sans-serif';
      ctx.fillText(sub, W / 2, 156);
      var size = 760;
      var x0 = (W - size) / 2;
      var y0 = 196;
      var sq = size / 8;
      var board = C.parseFen(fen).board;
      for (var row = 0; row < 8; row++) {
        for (var col = 0; col < 8; col++) {
          var rank = orientation === 'w' ? 7 - row : row;
          var file = orientation === 'w' ? col : 7 - col;
          var x = x0 + col * sq;
          var y = y0 + row * sq;
          ctx.fillStyle = (rank + file) % 2 === 0 ? dark : light;
          ctx.fillRect(x, y, sq, sq);
          var name = FILES.charAt(file) + (rank + 1);
          if (lastMove && (lastMove.from === name || lastMove.to === name)) {
            ctx.fillStyle = 'rgba(255, 255, 51, 0.5)';
            ctx.fillRect(x, y, sq, sq);
          }
          var p = board[rank * 8 + file];
          if (!p) continue;
          var key = p.c + p.t.toUpperCase();
          var img = images[key];
          if (img) {
            ctx.drawImage(img, x, y, sq, sq);
          } else {
            ctx.font = Math.round(sq * 0.82) + 'px "Segoe UI Symbol", "Noto Sans Symbols 2", "DejaVu Sans", serif';
            ctx.lineWidth = 3;
            ctx.strokeStyle = p.c === 'w' ? '#1a1a1a' : '#000';
            ctx.fillStyle = p.c === 'w' ? '#fbfbfb' : '#1c1c1c';
            var glyph = C.GLYPHS[p.t];
            ctx.strokeText(glyph, x + sq / 2, y + sq * 0.8);
            ctx.fillText(glyph, x + sq / 2, y + sq * 0.8);
          }
        }
      }
      ctx.fillStyle = '#f2f2f2';
      ctx.font = '800 40px Montserrat, system-ui, sans-serif';
      ctx.fillText('♞ Second Look', W / 2, 1022);
      ctx.fillStyle = '#9a9a9a';
      ctx.font = '700 26px "Atkinson Hyperlegible", system-ui, sans-serif';
      ctx.fillText(T('Learn chess free at {site}', { site: location.host }), W / 2, 1060);
    }

    function toBlob() {
      return new Promise(function (resolve) {
        try {
          canvas.toBlob(function (b) { resolve(b); }, 'image/png');
        } catch (e) {
          resolve(undefined); // canvas tainted by the piece pictures
        }
      });
    }

    return Promise.all(keys.map(function (k) { return loadImage(urls[k]); })).then(function (imgs) {
      var images = {};
      keys.forEach(function (k, i) { if (imgs[i]) images[k] = imgs[i]; });
      draw(images);
      return toBlob().then(function (blob) {
        if (blob !== undefined) return blob;
        draw({});
        return toBlob().then(function (b) { return b || null; });
      });
    });
  }

  function downloadBlob(blob, name) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
  }

  function copyText(text) {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(text).catch(function () {});
    } catch (e) {
      /* no clipboard */
    }
    return Promise.resolve();
  }

  function shareResult() {
    var o = S.lastOutcome;
    if (S.phase !== 'over' || !o) return;
    var bot = botName(S.levelIndex);
    var moves = Math.ceil(S.game.history().length / 2);
    var title = isFriend() ? T('A game of chess with a friend')
      : o.result === 'win' ? T('I beat {bot}!', { bot: bot }) : o.result === 'draw' ? T('A draw with {bot}', { bot: bot }) : T('I played {bot}', { bot: bot });
    if (!isFriend() && S.mode !== 'standard') title = T('{title} ({mode})', { title: title, mode: modeName(S.mode) });
    var sub = C.joinSentences([o.summary, moves === 1 ? T('1 move.') : T('{n} moves.', { n: moves })]);
    var text = C.joinSentences([title, T('Learn chess free on Second Look, with a coach that stops your blunders.')]);
    var url = location.origin + '/';
    var hist = S.game.history({ verbose: true });
    var last = hist[hist.length - 1];
    ui.btnShare.disabled = true;
    makeShareImage(S.game.fen(), S.orientation, title, sub, last ? { from: last.from, to: last.to } : null)
      .then(function (blob) {
        var file = null;
        try {
          file = blob ? new File([blob], 'second-look-result.png', { type: 'image/png' }) : null;
        } catch (e) {
          file = null;
        }
        if (file && navigator.canShare && navigator.share && navigator.canShare({ files: [file] })) {
          return navigator.share({ files: [file], title: 'Second Look', text: text + ' ' + url });
        }
        if (navigator.share) return navigator.share({ title: 'Second Look', text: text, url: url });
        if (blob) downloadBlob(blob, 'second-look-result.png');
        return copyText(text + ' ' + url).then(function () {
          toast('♞', blob ? T('Picture saved') : T('Link copied'), blob ? T('The link is copied too, so you can paste it to a friend.') : T('Paste it to a friend.'));
        });
      })
      .catch(function () { /* sharing cancelled */ })
      .then(function () { ui.btnShare.disabled = false; });
  }

  function drawEvalGraph(len) {
    var W = 300;
    var H = 96;
    var mid = H / 2;
    var pts = [];
    for (var p = 0; p <= len; p++) {
      var cp = S.review.evals[p];
      if (typeof cp !== 'number') continue;
      var v = C.perspective(cp, S.playerColor);
      if (C.isMateScore(v)) v = v > 0 ? 1500 : -1500;
      v = Math.max(-1500, Math.min(1500, v));
      pts.push({ p: p, x: len ? (p / len) * W : 0, y: mid - (mid - 6) * (2 / (1 + Math.exp(-0.004 * v)) - 1) });
    }
    var svg = '<defs><clipPath id="egTop"><rect x="0" y="0" width="' + W + '" height="' + mid + '"/></clipPath>' +
      '<clipPath id="egBottom"><rect x="0" y="' + mid + '" width="' + W + '" height="' + mid + '"/></clipPath></defs>' +
      '<line class="eg-mid" x1="0" y1="' + mid + '" x2="' + W + '" y2="' + mid + '"/>';
    if (pts.length < 2) {
      svg += '<text class="eg-empty" x="' + (W / 2) + '" y="' + (mid - 8) + '" text-anchor="middle">' + T('Not enough moves for a graph yet') + '</text>';
      ui.evalGraph.innerHTML = svg;
      return;
    }
    var line = pts.map(function (pt, i) { return (i ? 'L' : 'M') + pt.x.toFixed(1) + ',' + pt.y.toFixed(1); }).join(' ');
    var first = pts[0];
    var last = pts[pts.length - 1];
    var area = line + ' L' + last.x.toFixed(1) + ',' + mid + ' L' + first.x.toFixed(1) + ',' + mid + ' Z';
    svg += '<path class="eg-area-up" clip-path="url(#egTop)" d="' + area + '"/>' +
      '<path class="eg-area-down" clip-path="url(#egBottom)" d="' + area + '"/>' +
      '<path class="eg-line" d="' + line + '"/>';
    pts.forEach(function (pt) {
      var q = S.review.quality[pt.p];
      if (q && (q.cls === 'blunder' || q.cls === 'mistake')) {
        svg += '<circle class="eg-dot eg-dot-' + q.cls + '" cx="' + pt.x.toFixed(1) + '" cy="' + pt.y.toFixed(1) + '" r="3.8"></circle>';
      }
    });
    ui.evalGraph.innerHTML = svg;
  }

  function flipBoard() {
    S.orientation = C.opposite(S.orientation);
    board.setOrientation(S.orientation);
    ui.evalBar.classList.toggle('flipped', S.orientation === 'b');
    renderStrips();
  }

  /* ======================================================================== */
  /* Step buttons under the panel: first, back, play through, forward, last   */
  /* ======================================================================== */

  var autoplayTimer = null;

  function stopAutoplay() {
    if (autoplayTimer) clearInterval(autoplayTimer);
    autoplayTimer = null;
    if (!ui.btnAutoplay) return;
    ui.btnAutoplay.classList.remove('is-playing');
    ui.btnAutoplay.setAttribute('aria-pressed', 'false');
    ui.btnAutoplay.setAttribute('aria-label', T('Play through the moves'));
  }

  function toggleAutoplay() {
    if (autoplayTimer) {
      stopAutoplay();
      renderNav();
      return;
    }
    if (!S.game.history().length || !canReview()) return;
    // From the live position, play the whole game from the start.
    if (S.viewPly === null) enterView(0);
    if (S.viewPly === null) return;
    autoplayTimer = setInterval(function () {
      if (S.viewPly === null || !canReview()) {
        stopAutoplay();
        renderNav();
        return;
      }
      enterView(S.viewPly + 1);
      if (S.viewPly === null) stopAutoplay();
      renderNav();
    }, AUTOPLAY_MS);
    ui.btnAutoplay.classList.add('is-playing');
    ui.btnAutoplay.setAttribute('aria-pressed', 'true');
    ui.btnAutoplay.setAttribute('aria-label', T('Pause'));
    renderNav();
  }

  function renderNav() {
    if (!ui.btnFirst) return;
    var len = S.game.history().length;
    var cur = S.viewPly === null ? len : S.viewPly;
    ui.btnFirst.disabled = cur === 0;
    ui.btnPrev.disabled = cur === 0;
    ui.btnNext.disabled = S.viewPly === null;
    ui.btnLast.disabled = S.viewPly === null;
    ui.btnAutoplay.disabled = !autoplayTimer && len === 0;
  }

  function stepTo(ply) {
    stopAutoplay();
    enterView(ply);
    renderNav();
  }

  /** Start screen: empty-handed board, bot cards open in the panel. */
  function showHome() {
    S.started = false;
    S.phase = 'idle';
    S.startFen = null;
    S.game = new window.Chess();
    S.playerColor = S.colorChoice === 'b' ? 'b' : 'w';
    S.orientation = S.playerColor;
    S.viewPly = null;
    var tc = TIME_CONTROLS[S.timeChoice] || TIME_CONTROLS.none;
    Clock.reset(tc.base, tc.inc);
    resetReview();
    syncBoard(false);
    resetEval();
    renderMoveList();
    renderStrips();
    renderReviewBar();
    setStatus(T('Choose a bot to start.'), 'you', T('Pick a level under New game. Coach Guard watches every move you make.'));
    refreshControls();
    showPane('new');
  }

  function showPane(name) {
    ['game', 'new', 'settings'].forEach(function (p) {
      var on = p === name;
      var tab = $('ptab-' + p);
      tab.setAttribute('aria-selected', String(on));
      tab.tabIndex = on ? 0 : -1;
      $('pane-' + p).hidden = !on;
    });
  }

  function renderLevelCards() {
    var wrap = ui.levelCards;
    wrap.innerHTML = '';
    LEVELS.forEach(function (lvl, i) {
      var card = document.createElement('button');
      card.type = 'button';
      card.className = 'menu-card';
      card.dataset.level = String(i);
      card.setAttribute('aria-label', C.joinSentences([T('Play {bot}.', { bot: botName(i) }), levelBlurb(i)]));
      var icon = document.createElement('span');
      icon.className = 'menu-icon';
      icon.setAttribute('aria-hidden', 'true');
      icon.textContent = lvl.glyph;
      var text = document.createElement('span');
      text.className = 'menu-text';
      var title = document.createElement('span');
      title.className = 'menu-title';
      title.textContent = levelName(i);
      if (i === S.levelIndex) {
        var tag = document.createElement('span');
        tag.className = 'menu-tag';
        tag.textContent = T('Last used');
        title.appendChild(tag);
      }
      var sub = document.createElement('span');
      sub.className = 'menu-sub';
      sub.textContent = levelBlurb(i);
      if (Progress.data) {
        var stars = document.createElement('span');
        var n = Progress.data.ladder[i] || 0;
        stars.className = 'menu-stars' + (n ? ' has-stars' : '');
        stars.textContent = starText(n);
        stars.setAttribute('aria-label', T('{n} of 3 stars', { n: n }));
        title.appendChild(stars);
      }
      text.appendChild(title);
      text.appendChild(sub);
      card.appendChild(icon);
      card.appendChild(text);
      wrap.appendChild(card);
    });
  }

  function applyBoardTheme() {
    document.body.dataset.board = S.boardTheme;
    Array.prototype.forEach.call(document.querySelectorAll('input[name="boardTheme"]'), function (input) {
      input.checked = input.value === S.boardTheme;
    });
  }

  /* ======================================================================== */
  /* My Blunder Bank: puzzle trainer                                          */
  /* ======================================================================== */

  var Bank = {
    board: null,
    entry: null,
    game: null,
    phase: 'idle', // idle | solving | checking | retry | solved | revealed
    hintShown: false,
    epoch: 0,
    timer: null,
    lastIndex: 0,

    init: function () {
      var self = this;
      this.board = new BoardView($('puzzleBoard'), {
        interactive: function () { return self.phase === 'solving'; },
        canMoveFrom: function (sq) {
          if (!self.game || self.phase !== 'solving') return false;
          var p = self.game.get(sq);
          return !!p && p.color === self.game.turn();
        },
        legalTargets: function (sq) { return self.game ? legalTargets(self.game, sq) : []; },
        onMove: function (from, to) { self.onMove(from, to); }
      });
      $('btnPuzzleHint').addEventListener('click', function () { self.hint(); });
      $('btnPuzzleSolution').addEventListener('click', function () { self.reveal(); });
      $('btnPuzzleRetry').addEventListener('click', function () { if (self.entry) self.open(self.entry.id); });
      $('btnPuzzleNext').addEventListener('click', function () { self.next(); });
      $('btnPuzzleRemove').addEventListener('click', function () { self.removeCurrent(); });
      $('btnStartBank').addEventListener('click', function () {
        var list = C.BlunderBank.list();
        if (list.length) self.open(list[0].id);
        else showTab('play');
      });
      $('btnClearBank').addEventListener('click', function () {
        if (!C.BlunderBank.count()) return;
        if (window.confirm(T('Remove every saved blunder? This cannot be undone.'))) {
          C.BlunderBank.clear();
          self.entry = null;
          self.showIntro();
        }
      });
      $('bankList').addEventListener('click', function (e) {
        var item = e.target.closest('[data-id]');
        if (item) self.open(item.dataset.id);
      });
      window.addEventListener('blunderbank:change', function () {
        updateBankBadge();
        if (!ui.viewBank.hidden) self.renderList();
      });
      window.addEventListener('storage', function (e) {
        if (e.key === C.BlunderBank.key) {
          updateBankBadge();
          if (!ui.viewBank.hidden) self.renderList();
        }
      });
    },

    onShow: function () {
      this.renderList();
      if (this.entry && C.BlunderBank.get(this.entry.id)) return;
      if (this.phase === 'solved' && this.entry) return; // keep the success message visible
      this.showIntro();
    },

    renderList: function () {
      var list = C.BlunderBank.list();
      var ul = $('bankList');
      var stats = C.BlunderBank.stats();
      ul.innerHTML = '';
      $('bankEmpty').hidden = list.length > 0;
      $('btnClearBank').hidden = list.length === 0;
      $('bankStats').textContent = list.length
        ? (stats.cleared
          ? plural(list.length, '{n} puzzle waiting, {cleared} cleared so far.', '{n} puzzles waiting, {cleared} cleared so far.', { cleared: stats.cleared })
          : plural(list.length, '{n} puzzle waiting.', '{n} puzzles waiting.'))
        : (stats.cleared ? plural(stats.cleared, 'All clear. You have solved {n} puzzle.', 'All clear. You have solved {n} puzzles.') : '');
      var self = this;
      list.forEach(function (e) {
        var li = document.createElement('li');
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'bank-item';
        btn.dataset.id = e.id;
        if (self.entry && self.entry.id === e.id) {
          btn.classList.add('is-active');
          btn.setAttribute('aria-current', 'true');
        }
        var top = document.createElement('span');
        top.className = 'bank-item-top';
        var san = document.createElement('span');
        san.className = 'bank-item-san';
        var played = describeUci(e.fen, e.playedMove);
        san.textContent = played ? C.moveTitle(played, true) : T('You played {san}', { san: e.playedSan });
        var drop = document.createElement('span');
        drop.className = 'drop-pill';
        drop.textContent = C.lossGlyphs(e.drop);
        drop.title = C.capitalize(C.lossLike(e.drop));
        drop.setAttribute('aria-label', C.capitalize(C.lossLike(e.drop)));
        top.appendChild(san);
        top.appendChild(drop);
        var sub = document.createElement('span');
        sub.className = 'bank-item-sub';
        sub.textContent = T('Move {n} as {color}, {when}', { n: e.moveNumber, color: C.colorName(e.color), when: relativeDay(e.createdAt) });
        btn.appendChild(top);
        btn.appendChild(sub);
        var tags = document.createElement('span');
        tags.className = 'bank-item-tags';
        if (e.caught) {
          var t1 = document.createElement('span');
          t1.className = 'bank-tag tag-caught';
          t1.textContent = T('Caught by Coach Guard');
          tags.appendChild(t1);
        }
        if (e.timesBlundered > 1) {
          var t2 = document.createElement('span');
          t2.className = 'bank-tag tag-repeat';
          t2.textContent = T('Made this mistake {n} times', { n: e.timesBlundered });
          tags.appendChild(t2);
        }
        if (e.attempts > 0) {
          var t3 = document.createElement('span');
          t3.className = 'bank-tag';
          t3.textContent = plural(e.attempts, '{n} attempt', '{n} attempts');
          tags.appendChild(t3);
        }
        if (tags.children.length) btn.appendChild(tags);
        li.appendChild(btn);
        ul.appendChild(li);
      });
    },

    showIntro: function () {
      clearTimeout(this.timer);
      this.epoch++;
      this.phase = 'idle';
      this.board.setFen('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');
      this.board.setMarks({ lastMove: null, check: null, danger: [], hint: [] });
      this.board.setArrows([]);
      $('puzzleArea').hidden = true;
      $('puzzleIntro').hidden = false;
      var n = C.BlunderBank.count();
      $('puzzleIntroText').textContent = n
        ? T("Pick a mistake from the list. You'll see the board just before it happened, so you can look for a better move.")
        : T('Nothing here yet. When you make a big mistake in a game, it shows up here as a puzzle.');
      $('btnStartBank').textContent = n ? T('Start with the newest') : T('Play a game');
      this.renderList();
    },

    open: function (id) {
      var e = C.BlunderBank.get(id);
      if (!e) {
        this.showIntro();
        return;
      }
      clearTimeout(this.timer);
      this.epoch++;
      this.entry = e;
      this.game = new window.Chess(e.fen);
      if (this.game.turn() !== e.color) {
        // Corrupt entry: the side to move must be the player who blundered.
        C.BlunderBank.remove(e.id);
        this.showIntro();
        return;
      }
      var list = C.BlunderBank.list();
      this.lastIndex = Math.max(0, list.findIndex(function (x) { return x.id === id; }));
      this.phase = 'solving';
      this.hintShown = false;
      this.board.clearSelection();
      this.board.setOrientation(e.color);
      this.board.setFen(e.fen);
      this.board.setMarks({ lastMove: null, check: checkSquare(this.game), danger: [], hint: [] });
      this.board.setArrows([]);
      $('puzzleIntro').hidden = true;
      $('puzzleArea').hidden = false;
      $('puzzleTitle').textContent = T('Find a better move (you are {color})', { color: C.colorName(e.color) });
      var playedMv = describeUci(e.fen, e.playedMove);
      var replyMv = null;
      if (playedMv && e.refutationSan) {
        var afterGame = new window.Chess(e.fen);
        safeMove(afterGame, uciToMove(e.playedMove));
        replyMv = safeMove(afterGame, e.refutationSan);
      }
      $('puzzleText').textContent = playedMv
        ? C.joinSentences([
          T('In your game you chose to {move}.', { move: C.moveAction(playedMv, true) }),
          replyMv ? T('Then the bot could {move}.', { move: C.moveAction(replyMv, false) }) : '',
          T('What should you play instead?')
        ])
        : C.joinSentences([T('In your game you played {san}.', { san: e.playedSan }), T('What should you play instead?')]);
      this.feedback(T('Your turn. Before you move, ask yourself: what can the bot do after this?'), 'neutral');
      this.setButtons();
      this.renderList();
    },

    setButtons: function () {
      var solving = this.phase === 'solving' || this.phase === 'checking' || this.phase === 'retry';
      $('btnPuzzleHint').disabled = !solving || this.hintShown;
      $('btnPuzzleSolution').disabled = !solving;
      $('btnPuzzleRetry').hidden = this.phase !== 'revealed';
      $('btnPuzzleRemove').disabled = !this.entry || this.phase === 'solved';
      var hasNext = C.BlunderBank.count() > (this.phase === 'solved' ? 0 : 1);
      $('btnPuzzleNext').disabled = !hasNext;
      $('btnPuzzleNext').textContent = this.phase === 'solved' && !hasNext ? T('All clear') : T('Next puzzle');
      this.board.refresh();
    },

    feedback: function (text, tone) {
      var el = $('puzzleFeedback');
      el.textContent = text;
      el.dataset.tone = tone || 'neutral';
    },

    onMove: async function (from, to) {
      if (this.phase !== 'solving' || !this.game) return;
      var e = this.entry;
      var promotion = null;
      if (needsPromotion(this.game, from, to)) {
        this.phase = 'promoting';
        promotion = await askPromotion(e.color);
        this.phase = 'solving';
        if (!promotion) {
          this.board.refresh();
          return;
        }
      }
      var mv = safeMove(this.game, promotion ? { from: from, to: to, promotion: promotion } : { from: from, to: to });
      if (!mv) {
        this.board.refresh();
        return;
      }
      var epoch = this.epoch;
      this.board.setFen(this.game.fen(), { animate: true });
      this.board.setMarks({ lastMove: { from: mv.from, to: mv.to }, check: checkSquare(this.game), hint: [] });
      this.board.setArrows([]);
      playMoveSound(mv, this.game, false);
      if (moveToUci(mv) === e.bestMove || ChessAPI.isCheckmate(this.game)) {
        this.solved(mv, moveToUci(mv) !== e.bestMove);
        return;
      }
      this.phase = 'checking';
      this.setButtons();
      this.feedback(T('Checking your move…'), 'busy');
      var a = await analyze(this.game.fen(), PUZZLE_ANALYSIS);
      if (epoch !== this.epoch) return;
      var before = C.clampCp(e.evalBefore);
      if (a && a.hasScore) {
        var p = C.clampCp(C.perspective(a.whiteCp, e.color));
        if (p >= before - 60 && p > C.clampCp(e.evalAfter) + 100) {
          this.solved(mv, true);
          return;
        }
        var lost = before - p;
        this.feedback(lost >= 50
          ? T('Not quite. Compared with the best move, that is {loss}. Try again.', { loss: C.lossLike(lost) })
          : T("That's about as good as the move you played in the game. Look for something stronger."), 'bad');
      } else {
        this.feedback(T("That's not the move we're looking for. Try again."), 'bad');
      }
      Sound.play('wrong');
      C.BlunderBank.recordAttempt(e.id, false);
      this.entry = C.BlunderBank.get(e.id) || e;
      this.phase = 'retry';
      this.setButtons();
      var self = this;
      this.timer = setTimeout(function () {
        if (epoch !== self.epoch) return;
        self.game.undo();
        self.board.setFen(self.game.fen(), { animate: true });
        self.board.setMarks({ lastMove: null, check: checkSquare(self.game) });
        self.phase = 'solving';
        self.setButtons();
      }, 1500);
    },

    solved: function (mv, alternative) {
      clearTimeout(this.timer);
      var e = this.entry;
      this.phase = 'solved';
      Sound.play('correct');
      C.BlunderBank.recordAttempt(e.id, true);
      onProgress('bank');
      this.feedback(alternative
        ? T('That works too! The computer liked one other move even more: to {move}. This puzzle is cleared from your bank.', { move: bestWords(e) })
        : T("Solved! That's the move. This puzzle is cleared from your bank."), 'good');
      this.setButtons();
      this.renderList();
    },

    hint: function () {
      if (!this.entry || this.hintShown) return;
      var best = uciToMove(this.entry.bestMove);
      var p = this.game.get(best.from);
      this.hintShown = true;
      Sound.play('hint');
      this.board.setMarks({ hint: [best.from] });
      this.feedback(T('Hint: move your {piece} on {sq} (the highlighted square).', { piece: p ? C.pieceName(p.type) : T('piece'), sq: best.from }), 'neutral');
      this.setButtons();
    },

    reveal: function () {
      if (!this.entry) return;
      clearTimeout(this.timer);
      this.epoch++;
      var e = this.entry;
      this.game = new window.Chess(e.fen);
      var best = uciToMove(e.bestMove);
      this.board.setFen(e.fen, { animate: true });
      this.board.setMarks({ lastMove: null, check: checkSquare(this.game), hint: [best.from] });
      Sound.play('hint');
      this.board.setArrows([{ from: best.from, to: best.to, color: 'green' }]);
      this.phase = 'revealed';
      C.BlunderBank.recordAttempt(e.id, false);
      this.entry = C.BlunderBank.get(e.id) || e;
      this.feedback(T('The best move was to {move}. Follow the green arrow. This puzzle stays in your bank so you can try it again later.', { move: bestWords(e) }), 'neutral');
      this.setButtons();
    },

    next: function () {
      var list = C.BlunderBank.list();
      if (!list.length) {
        this.entry = null;
        this.showIntro();
        return;
      }
      var cur = this.entry ? this.entry.id : null;
      var idx = list.findIndex(function (x) { return x.id === cur; });
      var target = idx === -1 ? list[Math.min(this.lastIndex, list.length - 1)] : list[(idx + 1) % list.length];
      this.open(target.id);
    },

    removeCurrent: function () {
      if (!this.entry) return;
      C.BlunderBank.remove(this.entry.id);
      this.next();
    }
  };

  /* ======================================================================== */
  /* Daily loop: XP and levels, day streak, today's goal, badges              */
  /* ======================================================================== */

  var PROGRESS_KEY = 'chessTrainer.progress.v1';
  var LEVEL_TITLES = ['Pawn', 'Pawn', 'Knight', 'Knight', 'Bishop', 'Bishop', 'Rook', 'Rook', 'Queen', 'Queen', 'King'];
  var LEVEL_GLYPHS = ['♙', '♙', '♘', '♘', '♗', '♗', '♖', '♖', '♕', '♕', '♔'];

  /** XP needed to reach level n: 0, 100, 250, 450, 700, 1000, ... */
  function xpForLevel(n) {
    return n <= 1 ? 0 : 25 * n * (n + 1) - 50;
  }

  function levelFor(xp) {
    var n = 1;
    while (xpForLevel(n + 1) <= xp) n++;
    return n;
  }

  function levelTitle(n) {
    return T(LEVEL_TITLES[Math.min(n, LEVEL_TITLES.length) - 1]);
  }

  var GOALS = [
    { id: 'games', label: 'Finish a game', need: 1, go: 'play', button: 'Play' },
    { id: 'puzzles', label: 'Solve 3 puzzles', need: 3, go: 'puzzles', button: 'Puzzles' },
    { id: 'lessons', label: 'Do a lesson step', need: 1, go: 'learn', button: 'Learn' }
  ];

  var BADGES = [
    { id: 'first-game', icon: '♙', name: 'First game', desc: 'Finish your first game against a bot.' },
    { id: 'first-win', icon: '♔', name: 'First win', desc: 'Beat a bot for the first time.' },
    { id: 'checkmate', icon: '#', name: 'Checkmate!', desc: 'Win a game by checkmate.' },
    { id: 'clean-game', icon: '✓', name: 'Clean game', desc: 'Play a game of 10+ moves with no big mistakes.' },
    { id: 'beat-casual', icon: '♝', name: 'Beat Casual', desc: 'Beat the Casual bot (or a stronger one).' },
    { id: 'beat-club', icon: '♜', name: 'Beat Club player', desc: 'Beat the Club player bot (or a stronger one).' },
    { id: 'saved', icon: '↶', name: 'Second look', desc: 'Take back a move when Coach Guard warns you.' },
    { id: 'fixed', icon: '??', name: 'Lesson learned', desc: 'Solve a puzzle from My Blunder Bank.' },
    { id: 'pieces', icon: '♞', name: 'Know the pieces', desc: 'Finish every lesson in How the pieces move.' },
    { id: 'graduate', icon: '★', name: 'Graduate', desc: 'Finish every lesson in Learn.' },
    { id: 'puzzles-10', icon: '10', name: '10 puzzles', desc: 'Solve 10 puzzles.' },
    { id: 'puzzles-50', icon: '50', name: '50 puzzles', desc: 'Solve 50 puzzles.' },
    { id: 'rating-1000', icon: '♛', name: 'Puzzle 1000', desc: 'Reach a puzzle rating of 1000.' },
    { id: 'goal', icon: '◎', name: 'Goal reached', desc: "Complete today's goal." },
    { id: 'streak-3', icon: '3', name: '3-day streak', desc: 'Practise 3 days in a row.' },
    { id: 'streak-7', icon: '7', name: '7-day streak', desc: 'Practise 7 days in a row.' },
    { id: 'fast', icon: '⚡', name: 'Fast hands', desc: 'Win a Bullet or Blitz game against a bot.' },
    { id: 'hill', icon: '⛰', name: 'King of the Hill', desc: 'Win by walking your king to the centre.' },
    { id: 'sprint-10', icon: '⏱', name: 'Sprinter', desc: 'Solve 10 puzzles in one Puzzle Sprint.' },
    { id: 'survival-15', icon: '♥', name: 'Survivor', desc: 'Solve 15 puzzles in one Puzzle Survival.' }
  ];

  function dayKeyOffset(offset) {
    var d = new Date();
    d.setDate(d.getDate() + offset);
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }

  function hashString(s) {
    var h = 2166136261;
    for (var i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  var Progress = {
    data: null,

    load: function () {
      var d = readJSON(PROGRESS_KEY, {}) || {};
      this.data = {
        xp: Math.max(0, parseInt(d.xp, 10) || 0),
        days: d.days && typeof d.days === 'object' ? d.days : {},
        streak: d.streak && typeof d.streak === 'object' ? { count: parseInt(d.streak.count, 10) || 0, best: parseInt(d.streak.best, 10) || 0, last: String(d.streak.last || '') } : { count: 0, best: 0, last: '' },
        badges: d.badges && typeof d.badges === 'object' ? d.badges : {},
        daily: d.daily && typeof d.daily === 'object' ? d.daily : {},
        ladder: LEVELS.map(function (l, i) { return Array.isArray(d.ladder) ? Math.max(0, Math.min(3, parseInt(d.ladder[i], 10) || 0)) : 0; })
      };
    },

    save: function () {
      var keys = Object.keys(this.data.days).sort();
      while (keys.length > 60) delete this.data.days[keys.shift()];
      store.set(PROGRESS_KEY, JSON.stringify(this.data));
    },

    today: function () {
      var k = todayKey();
      var d = this.data.days[k];
      if (!d || typeof d !== 'object') {
        d = { games: 0, puzzles: 0, lessons: 0, goal: false };
        this.data.days[k] = d;
      }
      return d;
    },

    /** Current streak: still alive if the last practice day was today or yesterday. */
    streakNow: function () {
      var s = this.data.streak;
      return s.last === todayKey() || s.last === dayKeyOffset(-1) ? s.count : 0;
    },

    touchStreak: function () {
      var s = this.data.streak;
      var today = todayKey();
      if (s.last === today) return;
      s.count = s.last === dayKeyOffset(-1) ? s.count + 1 : 1;
      s.last = today;
      s.best = Math.max(s.best, s.count);
      if (s.count >= 3) this.award('streak-3');
      if (s.count >= 7) this.award('streak-7');
    },

    addXp: function (n) {
      if (!n) return;
      var before = levelFor(this.data.xp);
      this.data.xp += n;
      var after = levelFor(this.data.xp);
      if (after > before) {
        Sound.play('win');
        toast(LEVEL_GLYPHS[Math.min(after, LEVEL_GLYPHS.length) - 1], T('Level {n}!', { n: after }), T("You're now a {title}. Keep going!", { title: levelTitle(after) }));
      }
    },

    award: function (id) {
      if (this.data.badges[id]) return;
      var b = BADGES.filter(function (x) { return x.id === id; })[0];
      if (!b) return;
      this.data.badges[id] = Date.now();
      Sound.play('notify');
      toast(b.icon, T('Badge earned: {name}', { name: T(b.name) }), T(b.desc));
    },

    checkGoal: function () {
      var d = this.today();
      if (d.goal) return;
      var met = GOALS.every(function (g) { return (d[g.id] || 0) >= g.need; });
      if (!met) return;
      d.goal = true;
      this.addXp(50);
      this.award('goal');
      Sound.play('correct');
      toast('◎', T("Today's goal complete!"), T('+50 XP. Come back tomorrow to keep your streak going.'));
    },

    event: function (type, info) {
      info = info || {};
      var d = this.today();
      var counted = false;
      if (type === 'game' && info.result === 'friend') {
        d.games++;
        counted = true;
        this.addXp(20);
      } else if (type === 'game') {
        d.games++;
        counted = true;
        var win = info.result === 'win';
        if (win && info.fast) this.award('fast');
        if (win && info.how === 'hill') this.award('hill');
        this.addXp(20 + (win ? 20 : info.result === 'draw' ? 10 : 0) + (info.blunders === 0 && info.moves >= 10 ? 15 : 0));
        this.award('first-game');
        if (win) this.award('first-win');
        if (win && info.how === 'checkmate') this.award('checkmate');
        if (win && info.level >= 2 && info.mode !== 'odds') this.award('beat-casual');
        if (win && info.level >= 3 && info.mode !== 'odds') this.award('beat-club');
        if (info.blunders === 0 && info.moves >= 10) this.award('clean-game');
      } else if (type === 'puzzle') {
        if (info.solved) {
          d.puzzles++;
          counted = true;
          this.addXp(info.rush ? 4 : info.hinted ? 5 : 10);
          if (info.daily && this.data.daily.solved !== todayKey()) {
            this.data.daily.solved = todayKey();
            this.addXp(15);
          }
          if (info.total >= 10) this.award('puzzles-10');
          if (info.total >= 50) this.award('puzzles-50');
          if (info.rating >= 1000) this.award('rating-1000');
        }
      } else if (type === 'bank') {
        d.puzzles++;
        counted = true;
        this.addXp(15);
        this.award('fixed');
      } else if (type === 'lesson-step' || type === 'lesson') {
        d.lessons++;
        counted = true;
        this.addXp(type === 'lesson' ? (info.first ? 25 : 5) : 5);
        if (type === 'lesson') {
          var done = Learn.progress.done;
          var pieces = (window.LESSONS || []).filter(function (u) { return u.id === 'pieces'; })[0];
          if (pieces && pieces.lessons.every(function (l) { return done[l.id]; })) this.award('pieces');
          if (allLessons().every(function (l) { return done[l.id]; })) this.award('graduate');
        }
      } else if (type === 'guard-save') {
        this.award('saved');
      } else if (type === 'rush') {
        if (info.kind === 'sprint' && info.score >= 10) this.award('sprint-10');
        if (info.kind === 'survival' && info.score >= 15) this.award('survival-15');
      }
      if (counted) this.touchStreak();
      this.checkGoal();
      this.save();
      if (!ui.viewHome.hidden) renderHome();
    }
  };

  /* ---------------------------------------------------------------- bot ladder */

  /** Stars for a finished game: win; and no big mistakes; and no help. 0 if it doesn't count. */
  function ladderStars(result, blunders) {
    if (result !== 'win' || S.mode !== 'standard' || S.startFen) return 0;
    if (blunders > 0) return 1;
    return S.helped ? 2 : 3;
  }

  function starText(n) {
    var out = '';
    for (var i = 0; i < 3; i++) out += i < n ? '★' : '☆';
    return out;
  }

  /** The next rung to aim for: the first bot not beaten yet, else the first without 3 stars. */
  function ladderNext() {
    var l = Progress.data.ladder;
    for (var i = 0; i < l.length; i++) if (!l[i]) return { level: i, goal: 'win' };
    for (var j = 0; j < l.length; j++) if (l[j] < 3) return { level: j, goal: 'three' };
    return null;
  }

  function renderLadder() {
    var wrap = $('ladderRungs');
    if (!wrap || !Progress.data) return;
    var l = Progress.data.ladder;
    var next = ladderNext();
    wrap.innerHTML = '';
    LEVELS.forEach(function (lvl, i) {
      var li = document.createElement('li');
      li.className = 'rung' + (l[i] ? ' is-beaten' : '') + (l[i] === 3 ? ' is-perfect' : '') + (next && next.level === i ? ' is-next' : '');
      li.setAttribute('aria-label', T('{bot}: {n} of 3 stars', { bot: levelName(i), n: l[i] }));
      var g = document.createElement('span');
      g.className = 'rung-glyph';
      g.dataset.level = String(i);
      g.setAttribute('aria-hidden', 'true');
      g.textContent = lvl.glyph;
      var name = document.createElement('span');
      name.className = 'rung-name';
      name.textContent = levelName(i);
      var st = document.createElement('span');
      st.className = 'rung-stars';
      st.setAttribute('aria-hidden', 'true');
      st.textContent = starText(l[i]);
      li.appendChild(g);
      li.appendChild(name);
      li.appendChild(st);
      wrap.appendChild(li);
    });
    var total = l.reduce(function (a, b) { return a + b; }, 0);
    $('ladderTotal').textContent = T('{have} of {need}', { have: total, need: l.length * 3 }) + ' ★';
    var btn = $('btnLadderGo');
    if (next) {
      $('ladderNext').textContent = next.goal === 'win'
        ? T('Next: beat {bot}.', { bot: botName(next.level) })
        : T('Next: get 3 stars against {bot}.', { bot: botName(next.level) });
      btn.hidden = false;
      btn.dataset.level = String(next.level);
    } else {
      $('ladderNext').textContent = T('You have every star. You beat the whole ladder!');
      btn.hidden = true;
    }
  }

  function onProgress(type, info) {
    if (Progress.data) Progress.event(type, info);
  }

  function toast(icon, title, sub) {
    var stack = $('toasts');
    if (!stack) return;
    var el = document.createElement('div');
    el.className = 'toast';
    var i = document.createElement('span');
    i.className = 'toast-icon';
    i.setAttribute('aria-hidden', 'true');
    i.textContent = icon;
    var text = document.createElement('span');
    text.className = 'toast-text';
    var t = document.createElement('span');
    t.className = 'toast-title';
    t.textContent = title;
    text.appendChild(t);
    if (sub) {
      var s = document.createElement('span');
      s.className = 'toast-sub';
      s.textContent = sub;
      text.appendChild(s);
    }
    el.appendChild(i);
    el.appendChild(text);
    stack.appendChild(el);
    while (stack.children.length > 3) stack.removeChild(stack.firstChild);
    setTimeout(function () {
      el.classList.add('is-leaving');
      setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 300);
    }, 3800);
  }

  /** Today's puzzle: the same easy puzzle for everyone on a given day. */
  function dailyPuzzle(data) {
    var easy = data.filter(function (p) { return p.rating <= 1000; });
    if (!easy.length) return null;
    return easy[hashString('second-look:' + todayKey()) % easy.length];
  }

  function renderProgressHome() {
    var d = Progress.data;
    var lvl = levelFor(d.xp);
    var from = xpForLevel(lvl);
    var to = xpForLevel(lvl + 1);
    var pct = Math.round(((d.xp - from) / (to - from)) * 100);
    ui.levelName.textContent = T('Level {n}: {title}', { n: lvl, title: levelTitle(lvl) });
    ui.levelGlyph.textContent = LEVEL_GLYPHS[Math.min(lvl, LEVEL_GLYPHS.length) - 1];
    ui.xpFill.style.width = pct + '%';
    ui.xpBar.setAttribute('aria-valuenow', String(pct));
    ui.homeSub.textContent = T('{have} of {need} XP to level {n}', { have: d.xp - from, need: to - from, n: lvl + 1 });

    var streak = Progress.streakNow();
    ui.streakNum.textContent = String(streak);
    ui.dayStreak.classList.toggle('is-alive', streak > 0);
    ui.dayStreak.classList.toggle('is-today', d.streak.last === todayKey());
    ui.dayStreak.title = streak
      ? (d.streak.last === todayKey()
        ? plural(streak, '{n} day in a row. You practised today.', '{n} days in a row. You practised today.')
        : plural(streak, '{n} day in a row. Practise today to keep it going!', '{n} days in a row. Practise today to keep it going!'))
      : T('Practise today to start a streak');

    var today = d.days[todayKey()] || { games: 0, puzzles: 0, lessons: 0, goal: false };
    ui.goalList.innerHTML = '';
    GOALS.forEach(function (g) {
      var have = Math.min(today[g.id] || 0, g.need);
      var li = document.createElement('li');
      li.className = 'goal' + (have >= g.need ? ' is-done' : '');
      var check = document.createElement('span');
      check.className = 'goal-check';
      check.setAttribute('aria-hidden', 'true');
      check.textContent = '✓';
      var text = document.createElement('span');
      text.className = 'goal-text';
      var label = document.createElement('span');
      label.className = 'goal-label';
      label.textContent = T(g.label);
      var count = document.createElement('span');
      count.className = 'goal-count';
      count.textContent = have >= g.need ? T('Done') : T('{have} of {need}', { have: have, need: g.need });
      text.appendChild(label);
      text.appendChild(count);
      li.appendChild(check);
      li.appendChild(text);
      if (have < g.need) {
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'btn btn-ghost';
        btn.dataset.goal = g.go;
        btn.textContent = T(g.button);
        li.appendChild(btn);
      }
      ui.goalList.appendChild(li);
    });
    ui.todayCard.classList.toggle('is-complete', !!today.goal);
    ui.todayReward.textContent = today.goal ? T('Done! +50 XP') : '+50 XP';

    var next = Learn.nextLesson();
    if (next) {
      ui.nextLessonIcon.textContent = next.icon;
      ui.nextLessonTitle.textContent = Learn.doneCount() ? T('Continue learning') : T('Learn chess from zero');
      ui.nextLessonText.textContent = T('Next lesson: {title}', { title: T(next.title) });
      ui.btnNextLesson.textContent = Learn.progress.step[next.id] ? T('Continue') : T('Start');
    } else {
      ui.nextLessonIcon.textContent = '★';
      ui.nextLessonTitle.textContent = T('All lessons done!');
      ui.nextLessonText.textContent = T('Practise any lesson again, or play the bots.');
      ui.btnNextLesson.textContent = T('Lessons');
    }

    ui.badgeGrid.innerHTML = '';
    var earned = 0;
    BADGES.forEach(function (b) {
      var has = !!d.badges[b.id];
      if (has) earned++;
      var li = document.createElement('li');
      li.className = 'badge' + (has ? ' is-earned' : '');
      var bName = T(b.name);
      var bDesc = T(b.desc);
      li.title = has ? T('{name}: {desc} (earned {when})', { name: bName, desc: bDesc, when: relativeDay(d.badges[b.id]) }) : T('{name}: {desc}', { name: bName, desc: bDesc });
      li.setAttribute('aria-label', C.joinSentences([T('{name}.', { name: bName }), bDesc, has ? T('Earned.') : T('Not earned yet.')]));
      var icon = document.createElement('span');
      icon.className = 'badge-icon';
      icon.setAttribute('aria-hidden', 'true');
      icon.textContent = b.icon;
      var name = document.createElement('span');
      name.className = 'badge-name';
      name.textContent = bName;
      li.appendChild(icon);
      li.appendChild(name);
      ui.badgeGrid.appendChild(li);
    });
    ui.badgeCount.textContent = T('{have} of {need}', { have: earned, need: BADGES.length });

    Puzzles.load().then(function (data) {
      if (!data) {
        ui.dailyText.textContent = T('Connect to the internet to load puzzles.');
        return;
      }
      var p = dailyPuzzle(data);
      if (!p) return;
      var g = new window.Chess(p.fen);
      safeMove(g, uciToMove(p.moves[0]));
      dailyBoard.setOrientation(g.turn());
      dailyBoard.setFen(g.fen());
      var solved = Progress.data.daily.solved === todayKey();
      ui.dailyCard.classList.toggle('is-solved', solved);
      ui.dailyText.textContent = solved
        ? T('Solved! A new puzzle arrives tomorrow.')
        : C.joinSentences([
          T('You play {color}.', { color: C.colorName(g.turn()) }),
          p.tags.indexOf('mate1') !== -1 ? T('Find checkmate in 1.') : p.tags.indexOf('mate2') !== -1 ? T('Find checkmate in 2.') : T('Find the best move.')
        ]) + ' +25 XP';
      ui.btnDaily.textContent = solved ? T('Solve again') : T('Solve it');
    });
  }

  /* ======================================================================== */
  /* Learn: lessons for complete beginners (content in lessons.js)            */
  /* ======================================================================== */

  var LEARN_KEY = 'chessTrainer.learn.v1';

  function allLessons() {
    var out = [];
    (window.LESSONS || []).forEach(function (unit) {
      unit.lessons.forEach(function (l) {
        l.unitId = unit.id;
        out.push(l);
      });
    });
    return out;
  }

  /** FEN for a lesson board given as { square: letter }. */
  function fenFromPieces(map) {
    var rows = [];
    for (var r = 7; r >= 0; r--) {
      var row = '';
      var empty = 0;
      for (var f = 0; f < 8; f++) {
        var p = map[FILES.charAt(f) + (r + 1)];
        if (p) {
          if (empty) row += empty;
          empty = 0;
          row += p;
        } else {
          empty++;
        }
      }
      if (empty) row += empty;
      rows.push(row);
    }
    return rows.join('/') + ' w - - 0 1';
  }

  /** Where a lone lesson piece can go: normal piece moves, no turns and no checks. */
  function lessonTargets(map, from) {
    var p = map[from];
    if (!p) return [];
    var white = p === p.toUpperCase();
    var t = p.toLowerCase();
    var idx = C.sqToIdx(from);
    var f = idx % 8;
    var r = Math.floor(idx / 8);
    if (t === 'p') {
      var out = [];
      var dir = white ? 1 : -1;
      var one = r + dir;
      if (one < 0 || one > 7) return out;
      var s1 = FILES.charAt(f) + (one + 1);
      if (!map[s1]) {
        out.push(s1);
        var s2 = FILES.charAt(f) + (one + dir + 1);
        if (r === (white ? 1 : 6) && !map[s2]) out.push(s2);
      }
      [-1, 1].forEach(function (df) {
        var nf = f + df;
        if (nf < 0 || nf > 7) return;
        var sq = FILES.charAt(nf) + (one + 1);
        var q = map[sq];
        if (q && (q === q.toUpperCase()) !== white) out.push(sq);
      });
      return out;
    }
    var board = C.parseFen(fenFromPieces(map)).board;
    return C.attacksFrom(board, idx).map(C.idxToSq).filter(function (sq) {
      var q = map[sq];
      return !q || (q === q.toUpperCase()) !== white;
    });
  }

  var GOAL_HELP = {
    mate: "That's not checkmate: the king can still get out of check. Try again.",
    check: "That move doesn't attack the king. Try again.",
    'king-move': 'This time, move your king to a square where nothing attacks it.',
    block: 'This time, block the check: put a piece between the attacker and your king.',
    capture: 'This time, take the piece that is giving check.',
    castle: 'To castle, drag your king two squares toward one of your rooks.',
    promote: 'Push the pawn to the last row and choose a queen.'
  };

  var Learn = {
    board: null,
    lesson: null,
    stepIndex: 0,
    step: null,
    map: null,
    hero: null,
    stars: [],
    moves: 0,
    game: null,
    color: 'w',
    phase: 'list', // list | doing | thinking | wrong | step-done | lesson-done
    epoch: 0,
    timer: null,
    progress: null,

    loadProgress: function () {
      var p = readJSON(LEARN_KEY, {}) || {};
      this.progress = {
        done: p.done && typeof p.done === 'object' ? p.done : {},
        step: p.step && typeof p.step === 'object' ? p.step : {}
      };
    },

    saveProgress: function () {
      store.set(LEARN_KEY, JSON.stringify(this.progress));
    },

    doneCount: function () {
      var done = this.progress.done;
      return allLessons().filter(function (l) { return done[l.id]; }).length;
    },

    nextLesson: function () {
      var done = this.progress.done;
      var list = allLessons();
      for (var i = 0; i < list.length; i++) if (!done[list[i].id]) return list[i];
      return null;
    },

    init: function () {
      var self = this;
      this.loadProgress();
      this.board = new BoardView($('lnBoard'), {
        interactive: function () { return self.phase === 'doing'; },
        canMoveFrom: function (sq) {
          if (self.phase !== 'doing') return false;
          if (self.map) return sq === self.hero;
          if (!self.game || self.game.turn() !== self.color) return false;
          var p = self.game.get(sq);
          return !!p && p.color === self.color;
        },
        legalTargets: function (sq) {
          if (self.map) return lessonTargets(self.map, sq);
          return self.game ? legalTargets(self.game, sq) : [];
        },
        onMove: function (from, to) { self.onMove(from, to); }
      });
      $('lnUnits').addEventListener('click', function (e) {
        var card = e.target.closest('[data-lesson]');
        if (card) self.openLesson(card.dataset.lesson);
      });
      $('btnLnBack').addEventListener('click', function () { self.showList(); });
      $('btnLnRestart').addEventListener('click', function () { if (self.lesson) self.startStep(self.stepIndex); });
      $('btnLnHint').addEventListener('click', function () { self.hint(); });
      $('btnLnNext').addEventListener('click', function () { self.advance(); });
      this.renderList();
      this.idleBoard();
    },

    onShow: function () {
      this.renderCount();
      if (!this.lesson) this.renderList();
    },

    renderCount: function () {
      $('lnDoneCount').textContent = this.doneCount() + '/' + allLessons().length;
    },

    idleBoard: function () {
      this.board.setOrientation('w');
      this.board.setFen(START_FEN);
      this.board.setMarks({ lastMove: null, check: null, danger: [], hint: [], stars: [] });
      this.board.setArrows([]);
    },

    renderList: function () {
      var self = this;
      var wrap = $('lnUnits');
      var next = this.nextLesson();
      wrap.innerHTML = '';
      (window.LESSONS || []).forEach(function (unit) {
        var sec = document.createElement('section');
        sec.className = 'ln-unit';
        var h = document.createElement('h2');
        h.className = 'ln-unit-title';
        var title = document.createElement('span');
        title.textContent = T(unit.title);
        var count = document.createElement('span');
        count.className = 'ln-unit-count';
        var doneHere = unit.lessons.filter(function (l) { return self.progress.done[l.id]; }).length;
        count.textContent = T('{have} of {need}', { have: doneHere, need: unit.lessons.length });
        h.appendChild(title);
        h.appendChild(count);
        sec.appendChild(h);
        var ul = document.createElement('ul');
        ul.className = 'ln-cards';
        unit.lessons.forEach(function (l) {
          var li = document.createElement('li');
          var btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'ln-card';
          btn.dataset.lesson = l.id;
          var done = !!self.progress.done[l.id];
          if (done) btn.classList.add('is-done');
          if (next && next.id === l.id) btn.classList.add('is-next');
          var icon = document.createElement('span');
          icon.className = 'ln-card-icon';
          icon.setAttribute('aria-hidden', 'true');
          icon.textContent = l.icon;
          var text = document.createElement('span');
          text.className = 'ln-card-text';
          var t = document.createElement('span');
          t.className = 'ln-card-title';
          t.textContent = T(l.title);
          var sub = document.createElement('span');
          sub.className = 'ln-card-sub';
          sub.textContent = plural(l.steps.length, '{n} step', '{n} steps');
          text.appendChild(t);
          text.appendChild(sub);
          var state = document.createElement('span');
          state.className = 'ln-card-state';
          var partial = self.progress.step[l.id] || 0;
          state.textContent = done ? T('Done') + ' ✓' : next && next.id === l.id ? (partial ? T('Continue') : T('Start')) : partial ? partial + '/' + l.steps.length : '';
          btn.setAttribute('aria-label', C.joinSentences([
            T('{name}.', { name: T(l.title) }),
            done ? T('Done.') : partial ? T('{have} of {need} steps done.', { have: partial, need: l.steps.length }) : T('Not started.')
          ]));
          btn.appendChild(icon);
          btn.appendChild(text);
          btn.appendChild(state);
          li.appendChild(btn);
          ul.appendChild(li);
        });
        sec.appendChild(ul);
        wrap.appendChild(sec);
      });
      this.renderCount();
    },

    showList: function () {
      clearTimeout(this.timer);
      this.epoch++;
      this.lesson = null;
      this.phase = 'list';
      this.map = null;
      this.game = null;
      $('lnLesson').hidden = true;
      $('lnList').hidden = false;
      $('lnTitle').textContent = T('Learn chess');
      $('lnStepLabel').textContent = T('Pick a lesson to start');
      $('lnIcon').textContent = '♞';
      this.renderList();
      this.idleBoard();
      if (isMobile()) $('lnList').scrollIntoView({ block: 'start' });
    },

    openLesson: function (id) {
      var lesson = allLessons().filter(function (l) { return l.id === id; })[0];
      if (!lesson) return;
      this.lesson = lesson;
      $('lnList').hidden = true;
      $('lnLesson').hidden = false;
      $('lnLessonTitle').textContent = T(lesson.title);
      $('lnIntro').textContent = T(lesson.intro);
      $('lnTitle').textContent = T(lesson.title);
      $('lnIcon').textContent = lesson.icon;
      var resume = this.progress.done[id] ? 0 : Math.min(this.progress.step[id] || 0, lesson.steps.length - 1);
      this.startStep(resume);
      if (isMobile()) window.scrollTo(0, 0);
    },

    status: function (task, feedback, tone, kind) {
      // Lesson texts are written in English in lessons.js; translate them here.
      var taskText = T(task);
      var changed = $('lnTask').textContent !== taskText;
      if (changed || feedback) Voice.say(changed && !feedback ? taskText : (feedback || ''), true);
      $('lnTask').textContent = taskText;
      $('lnFeedback').textContent = feedback || '';
      $('lnDot').dataset.kind = kind || 'you';
      $('lnTask').closest('.status-card').dataset.tone = tone || '';
    },

    renderDots: function () {
      var ol = $('lnDots');
      ol.innerHTML = '';
      for (var i = 0; i < this.lesson.steps.length; i++) {
        var li = document.createElement('li');
        if (i < this.stepIndex || (i === this.stepIndex && (this.phase === 'step-done' || this.phase === 'lesson-done'))) li.className = 'is-done';
        else if (i === this.stepIndex) li.className = 'is-current';
        ol.appendChild(li);
      }
      $('lnStepLabel').textContent = T('Step {n} of {total}', { n: this.stepIndex + 1, total: this.lesson.steps.length });
    },

    setButtons: function () {
      var done = this.phase === 'step-done' || this.phase === 'lesson-done';
      var lastStep = this.stepIndex >= this.lesson.steps.length - 1;
      $('btnLnNext').disabled = !done;
      $('btnLnNext').textContent = this.phase === 'lesson-done' ? (this.nextLesson() ? T('Next lesson') : T('All lessons')) : lastStep ? T('Finish') : T('Next');
      $('btnLnHint').disabled = this.phase !== 'doing';
      this.board.refresh();
    },

    startStep: function (i) {
      clearTimeout(this.timer);
      this.epoch++;
      this.stepIndex = i;
      this.step = this.lesson.steps[i];
      this.moves = 0;
      var st = this.step;
      this.board.clearSelection();
      this.board.setArrows([]);
      if (st.type === 'stars' || st.type === 'capture') {
        this.game = null;
        this.map = {};
        for (var k in st.pieces) if (Object.prototype.hasOwnProperty.call(st.pieces, k)) this.map[k] = st.pieces[k];
        this.hero = st.hero;
        this.stars = (st.stars || []).slice();
        this.color = 'w';
        this.board.setOrientation('w');
        this.board.setFen(fenFromPieces(this.map));
        this.board.setMarks({ lastMove: null, check: null, danger: [], hint: [], stars: this.stars });
      } else {
        this.map = null;
        this.game = new window.Chess(st.fen);
        this.color = this.game.turn();
        this.board.setOrientation(this.color);
        this.board.setFen(st.fen);
        this.board.setMarks({ lastMove: null, check: checkSquare(this.game), danger: [], hint: [], stars: [] });
      }
      this.phase = 'doing';
      this.status(st.text, st.type === 'play' && st.tip ? T('Tip: {tip}', { tip: T(st.tip) }) : '', '', 'you');
      this.renderDots();
      this.setButtons();
    },

    onMove: async function (from, to) {
      if (this.phase !== 'doing') return;
      if (this.map) this.miniMove(from, to);
      else await this.realMove(from, to);
    },

    miniMove: function (from, to) {
      if (lessonTargets(this.map, from).indexOf(to) === -1) {
        this.board.refresh();
        return;
      }
      var piece = this.map[from];
      var took = !!this.map[to];
      delete this.map[from];
      var promoted = piece === 'P' && to.charAt(1) === '8';
      this.map[to] = promoted ? 'Q' : piece;
      this.hero = to;
      this.moves++;
      var hadStar = this.stars.indexOf(to) !== -1;
      this.stars = this.stars.filter(function (s) { return s !== to; });
      this.board.setFen(fenFromPieces(this.map), { animate: true });
      this.board.setMarks({ lastMove: { from: from, to: to }, stars: this.stars });
      Sound.play(promoted ? 'promote' : took ? 'capture' : 'move', true);
      var st = this.step;
      var left = st.type === 'stars'
        ? this.stars.length
        : Object.keys(this.map).filter(function (k) { return this.map[k] === this.map[k].toLowerCase(); }, this).length;
      if (left === 0) {
        this.stepDone(C.joinSentences([
          st.type === 'stars'
            ? plural(this.moves, 'All stars collected in {n} move.', 'All stars collected in {n} moves.')
            : plural(this.moves, 'All pieces taken in {n} move.', 'All pieces taken in {n} moves.'),
          st.par ? (this.moves <= st.par ? T('That is the fewest moves possible!') : plural(st.par, 'It can be done in {n} move.', 'It can be done in {n} moves.')) : '',
          promoted ? T('Your pawn became a queen on the last row.') : ''
        ]));
        return;
      }
      if (promoted) this.status(st.text, T('Your pawn reached the last row and became a queen!'), '', 'you');
      else if (hadStar || took) this.status(st.text, st.type === 'stars' ? plural(left, '{n} star to go.', '{n} stars to go.') : plural(left, '{n} piece to go.', '{n} pieces to go.'), '', 'you');
    },

    goalMet: function (mv) {
      var st = this.step;
      var g = this.game;
      switch (st.goal) {
        case 'mate': return ChessAPI.isCheckmate(g);
        case 'check': return ChessAPI.inCheck(g);
        case 'king-move': return mv.piece === 'k';
        case 'block': return mv.piece !== 'k' && !mv.captured;
        case 'capture': return !!mv.captured && (!st.target || mv.to === st.target);
        case 'castle': return /[kq]/.test(mv.flags || '');
        case 'promote': return mv.promotion === 'q';
        case 'moves': return (st.moves || []).indexOf(moveToUci(mv)) !== -1;
        default: return false;
      }
    },

    realMove: async function (from, to) {
      var self = this;
      var epoch = this.epoch;
      var st = this.step;
      var promotion = null;
      if (needsPromotion(this.game, from, to)) {
        this.phase = 'promoting';
        promotion = await askPromotion(this.color);
        if (epoch !== this.epoch) return;
        this.phase = 'doing';
        if (!promotion) {
          this.board.refresh();
          return;
        }
      }
      var mv = safeMove(this.game, promotion ? { from: from, to: to, promotion: promotion } : { from: from, to: to });
      if (!mv) {
        this.board.refresh();
        return;
      }
      this.moves++;
      this.board.setFen(this.game.fen(), { animate: true });
      this.board.setMarks({ lastMove: { from: mv.from, to: mv.to }, check: checkSquare(this.game), hint: [] });
      this.board.setArrows([]);
      playMoveSound(mv, this.game, false);

      if (st.type === 'play') {
        this.playReply(mv);
        return;
      }
      if (this.goalMet(mv)) {
        this.stepDone(T(st.done || 'Well done!'));
        return;
      }
      var msg;
      if (st.goal === 'mate' && ChessAPI.isStalemate(this.game)) {
        msg = T("Stalemate! The bot's king is not in check, but it has no legal move, so the game would be a draw. Try a different move.");
      } else if (st.goal === 'promote' && mv.promotion) {
        msg = T('That works, but a queen is the strongest piece. Try again and choose the queen.');
      } else {
        msg = T(st.wrong || GOAL_HELP[st.goal] || 'Not quite. Try again.');
      }
      this.phase = 'wrong';
      Sound.play('wrong');
      this.status(st.text, msg, 'bad', 'warn');
      this.setButtons();
      this.timer = setTimeout(function () {
        if (epoch !== self.epoch) return;
        self.game.undo();
        self.board.setFen(self.game.fen(), { animate: true });
        self.board.setMarks({ lastMove: null, check: checkSquare(self.game), hint: [] });
        self.phase = 'doing';
        self.setButtons();
      }, 1400);
    },

    /** Play-out steps: the bot defends with the engine until the game ends. */
    playReply: async function () {
      var self = this;
      var epoch = this.epoch;
      var st = this.step;
      var g = this.game;
      if (ChessAPI.isCheckmate(g)) {
        this.stepDone(T(st.done || 'Checkmate!'));
        return;
      }
      if (this.playFailed()) return;
      this.phase = 'thinking';
      this.setButtons();
      this.status(st.text, T('The bot is thinking…'), '', 'bot');
      var fen = g.fen();
      var t0 = Date.now();
      var uci = null;
      if (!engine.failed) {
        var r = await engine.search({ fen: fen, skill: 20, depth: 10, movetime: 350 });
        if (epoch !== this.epoch) return;
        uci = r && r.bestMove;
      }
      if (!uci) uci = randomMoveUci(g);
      var wait = 400 - (Date.now() - t0);
      if (wait > 0) await sleep(wait);
      if (epoch !== this.epoch) return;
      var mv = uci ? safeMove(g, uciToMove(uci)) : null;
      if (!mv) {
        var alt = randomMoveUci(g);
        mv = alt ? safeMove(g, uciToMove(alt)) : null;
      }
      if (!mv) {
        if (!this.playFailed()) {
          this.phase = 'doing';
          this.setButtons();
        }
        return;
      }
      this.board.setFen(g.fen(), { animate: true });
      this.board.setMarks({ lastMove: { from: mv.from, to: mv.to }, check: checkSquare(g), hint: [] });
      playMoveSound(mv, g, true);
      if (this.playFailed()) return;
      this.phase = 'doing';
      this.status(st.text, mv.captured ? T('The bot took your {piece}.', { piece: C.pieceName(mv.captured) }) : (st.tip ? T('Tip: {tip}', { tip: T(st.tip) }) : ''), '', 'you');
      this.setButtons();
    },

    playFailed: function () {
      var g = this.game;
      var reason = null;
      if (ChessAPI.isStalemate(g)) reason = T("Stalemate! The bot's king had no legal move but was not in check, so it's a draw. Keep your queen or rook a little further away and try again.");
      else if (ChessAPI.isInsufficient && ChessAPI.isInsufficient(g)) reason = T('The bot took your piece, so nobody can checkmate any more. Try again, and keep your piece away from the king.');
      else if (this.moves >= 50) reason = T('That took 50 moves, so the game would be a draw. Try again: shrink the box faster.');
      if (!reason) return false;
      this.phase = 'wrong';
      Sound.play('wrong');
      this.status(this.step.text, C.joinSentences([reason, T('Press Start over.')]), 'bad', 'warn');
      this.setButtons();
      return true;
    },

    stepDone: function (text) {
      this.phase = this.stepIndex >= this.lesson.steps.length - 1 ? 'lesson-done' : 'step-done';
      Sound.play('correct');
      var id = this.lesson.id;
      this.progress.step[id] = Math.max(this.progress.step[id] || 0, this.stepIndex + 1);
      if (this.phase === 'lesson-done') {
        var first = !this.progress.done[id];
        this.progress.done[id] = Date.now();
        this.saveProgress();
        this.status(T('Lesson complete!'), text, 'good', 'over');
        onProgress('lesson', { id: id, first: first });
      } else {
        this.saveProgress();
        this.status(T('Well done!'), text, 'good', 'over');
        onProgress('lesson-step', { id: id });
      }
      this.renderDots();
      this.renderCount();
      this.setButtons();
    },

    advance: function () {
      if (this.phase === 'step-done') {
        this.startStep(this.stepIndex + 1);
      } else if (this.phase === 'lesson-done') {
        var next = this.nextLesson();
        if (next) this.openLesson(next.id);
        else this.showList();
      }
    },

    hint: function () {
      if (this.phase !== 'doing') return;
      var self = this;
      var st = this.step;
      Sound.play('hint');
      if (this.map) {
        var reach = lessonTargets(this.map, this.hero);
        var goals = st.type === 'stars'
          ? this.stars
          : Object.keys(this.map).filter(function (k) { return self.map[k] === self.map[k].toLowerCase(); });
        var direct = reach.filter(function (sq) { return goals.indexOf(sq) !== -1; })[0];
        if (direct) {
          this.board.setArrows([{ from: this.hero, to: direct, color: 'green' }]);
          this.status(st.text, T('Follow the green arrow.'), '', 'you');
        } else {
          this.board.setMarks({ hint: [this.hero] });
          this.status(st.text, T('No target can be reached in one move from here. Move somewhere that lines up with one first.'), '', 'you');
        }
        return;
      }
      if (st.type === 'play') {
        analyze(this.game.fen()).then(function (a) {
          if (!a || !a.bestMove || self.phase !== 'doing') return;
          var m = uciToMove(a.bestMove);
          self.board.setArrows([{ from: m.from, to: m.to, color: 'green' }]);
          self.status(st.text, T('A good move: follow the green arrow.'), '', 'you');
        });
        return;
      }
      var sol = null;
      if (st.goal === 'moves') {
        sol = uciToMove(st.moves[0]);
      } else {
        var legal = this.game.moves({ verbose: true });
        for (var i = 0; i < legal.length && !sol; i++) {
          var m = legal[i];
          if (st.goal === 'promote' && m.promotion && m.promotion !== 'q') continue;
          var tryGame = new window.Chess(this.game.fen());
          var tmv = safeMove(tryGame, { from: m.from, to: m.to, promotion: m.promotion });
          var saved = this.game;
          this.game = tryGame;
          if (tmv && this.goalMet(tmv)) sol = m;
          this.game = saved;
        }
      }
      if (sol) {
        this.board.setArrows([{ from: sol.from, to: sol.to, color: 'green' }]);
        this.status(st.text, T('Follow the green arrow.'), '', 'you');
      }
    }
  };

  /* ======================================================================== */
  /* Puzzles: beginner puzzles from the Lichess puzzle database (CC0)         */
  /* ======================================================================== */

  var PUZZLE_KEY = 'chessTrainer.puzzles.v1';
  var PUZZLE_THEMES = [
    { id: 'mixed', name: 'Mixed', title: 'Puzzle', help: 'A mix of everything. Look at every check, every capture and every attack.' },
    { id: 'mate1', name: 'Checkmate in 1', title: 'Checkmate in 1', help: 'Find the one move that traps the king. Try every check!' },
    { id: 'mate2', name: 'Checkmate in 2', title: 'Checkmate in 2', help: "Two moves to checkmate. Your first move forces the bot's answer, then you finish the job." },
    { id: 'free', name: 'Free pieces', title: 'Win a free piece', help: "One of the bot's pieces has no protection, or it's trapped. Find the move that wins it." },
    { id: 'fork', name: 'Forks', title: 'Fork', help: 'A fork is one move that attacks two things at once. The bot can only save one of them.' },
    { id: 'pin', name: 'Pins', title: 'Pin', help: "Attack two of the bot's pieces that stand in a line. Whatever the front one does, the bot loses something." },
    { id: 'backrank', name: 'Back-row mates', title: 'Back-row mate', help: 'The king is stuck behind its own pawns on the back row. A rook or queen can checkmate it there.' },
    { id: 'promote', name: 'Pawn to queen', title: 'Pawn to queen', help: 'Push a pawn all the way to the last row so it turns into a queen.' }
  ];

  function puzzleTheme(id) {
    for (var i = 0; i < PUZZLE_THEMES.length; i++) if (PUZZLE_THEMES[i].id === id) return PUZZLE_THEMES[i];
    return PUZZLE_THEMES[0];
  }

  function todayKey() {
    var d = new Date();
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }

  var Puzzles = {
    data: null,
    loading: null,
    board: null,
    game: null,
    cur: null,
    idx: 0,
    color: 'w',
    phase: 'idle', // idle | loading | intro | solving | wrong | solved | revealed | error
    failed: false,
    hinted: false,
    daily: false,
    mode: 'rated', // rated | sprint | survival
    rush: null, // the Sprint or Survival run in progress
    pendingDaily: false,
    epoch: 0,
    timer: null,
    stats: null,

    loadStats: function () {
      var st = readJSON(PUZZLE_KEY, {}) || {};
      this.stats = {
        rating: typeof st.rating === 'number' && isFinite(st.rating) ? st.rating : 600,
        played: parseInt(st.played, 10) || 0,
        solved: parseInt(st.solved, 10) || 0,
        streak: parseInt(st.streak, 10) || 0,
        best: parseInt(st.best, 10) || 0,
        seen: Array.isArray(st.seen) ? st.seen.filter(function (x) { return typeof x === 'string'; }).slice(-800) : [],
        day: typeof st.day === 'string' ? st.day : '',
        today: parseInt(st.today, 10) || 0,
        theme: typeof st.theme === 'string' ? st.theme : 'mixed',
        rushBest: {
          sprint: st.rushBest && parseInt(st.rushBest.sprint, 10) || 0,
          survival: st.rushBest && parseInt(st.rushBest.survival, 10) || 0
        }
      };
      if (this.stats.day !== todayKey()) {
        this.stats.day = todayKey();
        this.stats.today = 0;
      }
    },

    saveStats: function () {
      store.set(PUZZLE_KEY, JSON.stringify(this.stats));
    },

    init: function () {
      var self = this;
      this.loadStats();
      this.board = new BoardView($('pzBoard'), {
        interactive: function () { return self.phase === 'solving'; },
        canMoveFrom: function (sq) {
          if (!self.game || self.phase !== 'solving' || self.game.turn() !== self.color) return false;
          var p = self.game.get(sq);
          return !!p && p.color === self.color;
        },
        legalTargets: function (sq) { return self.game ? legalTargets(self.game, sq) : []; },
        onMove: function (from, to) { self.onMove(from, to); }
      });
      var chips = $('pzThemes');
      PUZZLE_THEMES.forEach(function (t) {
        var chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'chip';
        chip.setAttribute('role', 'radio');
        chip.dataset.theme = t.id;
        chip.textContent = T(t.name);
        chips.appendChild(chip);
      });
      chips.addEventListener('click', function (e) {
        var chip = e.target.closest('[data-theme]');
        if (!chip) return;
        self.stats.theme = chip.dataset.theme;
        self.saveStats();
        self.renderThemes();
        if (self.data) self.next();
      });
      $('btnPzHint').addEventListener('click', function () { self.hint(); });
      $('btnPzSolution').addEventListener('click', function () { self.reveal(); });
      $('btnPzNext').addEventListener('click', function () { self.next(); });
      $('btnPzRetry').addEventListener('click', function () { if (self.cur) self.open(self.cur, true); });
      Array.prototype.forEach.call(document.querySelectorAll('input[name="pzMode"]'), function (input) {
        input.addEventListener('change', function () { if (input.checked) self.setMode(input.value); });
      });
      $('btnRushStart').addEventListener('click', function () { self.startRush(); });
      this.renderThemes();
      this.renderStats();
    },

    renderThemes: function () {
      var theme = this.stats.theme;
      Array.prototype.forEach.call($('pzThemes').querySelectorAll('[data-theme]'), function (chip) {
        chip.setAttribute('aria-checked', String(chip.dataset.theme === theme));
      });
      $('pzThemeHelp').textContent = T(puzzleTheme(theme).help);
    },

    renderStats: function () {
      if (this.stats.day !== todayKey()) {
        this.stats.day = todayKey();
        this.stats.today = 0;
      }
      if (this.mode === 'rated') {
        $('pzRatingLabel').textContent = T('Rating');
        $('pzRating').textContent = String(Math.round(this.stats.rating));
      }
      $('pzSolvedToday').textContent = String(this.stats.today);
      $('pzStreak').textContent = String(this.stats.streak);
      $('pzSolvedTotal').textContent = String(this.stats.solved);
    },

    status: function (text, kind, feedback, tone) {
      $('pzStatus').textContent = text;
      $('pzDot').dataset.kind = kind || 'you';
      $('pzFeedback').textContent = feedback || '';
      $('pzStatus').closest('.status-card').dataset.tone = tone || '';
    },

    setButtons: function () {
      var active = this.phase === 'solving' || this.phase === 'wrong' || this.phase === 'intro';
      $('btnRushStart').disabled = !!(this.rush && this.rush.running);
      $('btnPzHint').disabled = this.phase !== 'solving' || this.hinted;
      $('btnPzSolution').disabled = !active;
      $('btnPzNext').disabled = !this.data;
      $('btnPzRetry').hidden = this.phase !== 'revealed';
      this.board.refresh();
    },

    load: function () {
      var self = this;
      if (this.data) return Promise.resolve(this.data);
      if (this.loading) return this.loading;
      this.phase = 'loading';
      this.status(T('Loading puzzles…'), 'busy');
      this.loading = fetch('./puzzles.json')
        .then(function (r) {
          if (!r.ok) throw new Error('HTTP ' + r.status);
          return r.json();
        })
        .then(function (json) {
          self.data = (json && Array.isArray(json.p) ? json.p : [])
            .filter(function (row) { return Array.isArray(row) && row.length >= 5; })
            .map(function (row) {
              return { id: String(row[0]), fen: String(row[1]), moves: String(row[2]).split(' '), rating: +row[3] || 1000, tags: String(row[4]).split(',') };
            });
          return self.data;
        })
        .catch(function () {
          self.loading = null;
          self.phase = 'error';
          self.status(T("Couldn't load the puzzles."), 'warn', T('Check your internet connection, then press Next puzzle to try again.'));
          self.setButtons();
          $('btnPzNext').disabled = false;
          return null;
        });
      return this.loading;
    },

    onShow: function () {
      var self = this;
      this.renderStats();
      if (this.pendingDaily) return;
      if (this.mode !== 'rated') {
        if (!this.rush) this.showRushIntro(null);
        return;
      }
      if (this.cur && this.phase !== 'error') return;
      this.load().then(function (d) { if (d && !self.cur) self.next(); });
    },

    /** A puzzle near the player's rating, in the chosen theme, not seen recently. */
    pick: function () {
      var theme = this.stats.theme;
      var seen = {};
      this.stats.seen.forEach(function (id) { seen[id] = true; });
      var pool = this.data.filter(function (p) { return theme === 'mixed' || p.tags.indexOf(theme) !== -1; });
      var fresh = pool.filter(function (p) { return !seen[p.id]; });
      if (!fresh.length) {
        // Everything in this theme has been seen: start the theme over.
        var ids = {};
        pool.forEach(function (p) { ids[p.id] = true; });
        this.stats.seen = this.stats.seen.filter(function (id) { return !ids[id]; });
        fresh = pool;
      }
      var r = this.stats.rating;
      fresh.sort(function (a, b) { return Math.abs(a.rating - r) - Math.abs(b.rating - r); });
      var near = fresh.filter(function (p) { return Math.abs(p.rating - r) <= 125; });
      var choices = near.length >= 5 ? near : fresh.slice(0, 12);
      return choices[Math.floor(Math.random() * choices.length)] || null;
    },

    /** Open today's puzzle (the same one for everyone today). */
    openDaily: function () {
      var self = this;
      if (this.mode !== 'rated') this.setMode('rated', true);
      this.pendingDaily = true;
      showTab('puzzles');
      this.load().then(function (d) {
        self.pendingDaily = false;
        var p = d && dailyPuzzle(d);
        if (p) self.open(p, false, true);
        else if (d && !self.cur) self.next();
      });
    },

    next: function () {
      var self = this;
      this.load().then(function (d) {
        if (!d || !d.length) return;
        var p = self.pick();
        if (p) self.open(p, false);
      });
    },

    open: function (p, retry, daily) {
      var self = this;
      clearTimeout(this.timer);
      this.epoch++;
      var epoch = this.epoch;
      this.cur = p;
      this.idx = 0;
      if (!retry) {
        this.failed = false;
        this.hinted = false;
        this.daily = !!daily;
      }
      this.game = new window.Chess(p.fen);
      this.color = C.opposite(this.game.turn());
      this.phase = 'intro';
      var mainTag = p.tags.indexOf('mate1') !== -1 ? 'mate1' : p.tags.indexOf('mate2') !== -1 ? 'mate2' : p.tags[0];
      var theme = this.stats.theme === 'mixed' ? puzzleTheme(mainTag) : puzzleTheme(this.stats.theme);
      $('pzTitle').textContent = this.rush ? T(this.rush.kind === 'sprint' ? 'Puzzle Sprint' : 'Puzzle Survival') : this.daily ? T('Puzzle of the day') : T(theme.title);
      $('pzSide').textContent = T('(you are {color})', { color: C.colorName(this.color) });
      $('pzTask').textContent = p.tags.indexOf('mate1') !== -1 ? T('Find checkmate in 1 move')
        : p.tags.indexOf('mate2') !== -1 ? T('Find checkmate in 2 moves')
        : T('Find the best move');
      $('pzRating').parentElement.classList.remove('is-up', 'is-down');
      this.board.clearSelection();
      this.board.setOrientation(this.color);
      this.board.setFen(p.fen);
      this.board.setMarks({ lastMove: null, check: checkSquare(this.game), danger: [], hint: [] });
      this.board.setArrows([]);
      this.status(T("Watch the bot's move…"), 'bot');
      this.setButtons();
      this.timer = setTimeout(function () {
        if (epoch !== self.epoch) return;
        self.playAuto(p.moves[0]);
        self.idx = 1;
        self.phase = 'solving';
        self.status(T('Your turn. {task}.', { task: $('pzTask').textContent }), 'you', retry ? T('Try again from the start.') : '');
        self.setButtons();
      }, 650);
    },

    playAuto: function (uci) {
      var mv = safeMove(this.game, uciToMove(uci));
      if (!mv) return null;
      this.board.setFen(this.game.fen(), { animate: true });
      this.board.setMarks({ lastMove: { from: mv.from, to: mv.to }, check: checkSquare(this.game), hint: [], danger: [] });
      this.board.setArrows([]);
      playMoveSound(mv, this.game, mv.color !== this.color);
      return mv;
    },

    onMove: async function (from, to) {
      if (this.phase !== 'solving' || !this.game) return;
      var self = this;
      var epoch = this.epoch;
      var expected = this.cur.moves[this.idx];
      var promotion = null;
      if (needsPromotion(this.game, from, to)) {
        this.phase = 'promoting';
        promotion = await askPromotion(this.color);
        if (epoch !== this.epoch) return;
        this.phase = 'solving';
        if (!promotion) {
          this.board.refresh();
          return;
        }
      }
      var mv = safeMove(this.game, promotion ? { from: from, to: to, promotion: promotion } : { from: from, to: to });
      if (!mv) {
        this.board.refresh();
        return;
      }
      this.board.setFen(this.game.fen(), { animate: true });
      this.board.setMarks({ lastMove: { from: mv.from, to: mv.to }, check: checkSquare(this.game), hint: [], danger: [] });
      this.board.setArrows([]);
      playMoveSound(mv, this.game, false);
      var last = this.idx >= this.cur.moves.length - 1;
      var right = moveToUci(mv) === expected || (last && ChessAPI.isCheckmate(this.game));
      if (!right) {
        this.wrong(mv);
        return;
      }
      if (last) {
        this.solved(mv);
        return;
      }
      this.phase = 'intro';
      this.setButtons();
      this.status(T('Good move! Keep going.'), 'bot', T('Watch the bot answer…'), 'good');
      this.timer = setTimeout(function () {
        if (epoch !== self.epoch) return;
        self.playAuto(self.cur.moves[self.idx + 1]);
        self.idx += 2;
        self.phase = 'solving';
        self.status(T('Your turn again. Now finish it!'), 'you', '', 'good');
        self.setButtons();
      }, 550);
    },

    wrong: function (mv) {
      if (this.rush) {
        this.rushWrong(mv);
        return;
      }
      var self = this;
      var epoch = this.epoch;
      this.phase = 'wrong';
      Sound.play('wrong');
      var first = !this.failed;
      if (first) this.rate(0);
      var tag = this.cur.tags;
      var tipText = tag.indexOf('mate1') !== -1 || tag.indexOf('mate2') !== -1 || tag.indexOf('backrank') !== -1
        ? T("That doesn't trap the king. Which checks do you have?")
        : tag.indexOf('fork') !== -1 ? T("Look for a move that attacks two of the bot's pieces at once.")
        : tag.indexOf('free') !== -1 ? T('Look for a bot piece that nothing protects.')
        : T('Look at every check, every capture and every attack.');
      this.status(T('Not that one.'), 'warn', C.joinSentences([tipText, T('Try again, or press Show solution.')]), 'bad');
      this.setButtons();
      this.timer = setTimeout(function () {
        if (epoch !== self.epoch) return;
        self.game.undo();
        self.board.setFen(self.game.fen(), { animate: true });
        var hist = self.game.history({ verbose: true });
        var lastMv = hist[hist.length - 1];
        self.board.setMarks({ lastMove: lastMv ? { from: lastMv.from, to: lastMv.to } : null, check: checkSquare(self.game), hint: [], danger: [] });
        self.phase = 'solving';
        self.setButtons();
      }, 1000);
      this.renderStats();
    },

    explain: function (mv) {
      var t = this.cur.tags;
      if (ChessAPI.isCheckmate(this.game)) return T("Checkmate! The bot's king is under attack and has no safe square.");
      if (t.indexOf('fork') !== -1) {
        var first = this.game.history({ verbose: true }).filter(function (m) { return m.color === mv.color; })[0] || mv;
        return T('Your {piece} attacked two pieces at once, so the bot could not save both.', { piece: C.pieceName(first.piece) });
      }
      if (t.indexOf('free') !== -1) return T('That piece had no protection, so you won it for free.');
      if (t.indexOf('pin') !== -1) return T("The bot's pieces were lined up, so it could not save both.");
      if (t.indexOf('promote') !== -1) return T('Your pawn made it to the last row and became a queen.');
      return T('That was the best move.');
    },

    solved: function (mv) {
      if (this.rush) {
        this.rushSolved(mv);
        return;
      }
      this.phase = 'solved';
      Sound.play('correct');
      var delta = 0;
      if (!this.failed) {
        delta = this.rate(this.hinted ? 0.5 : 1);
        this.stats.solved++;
        this.stats.today++;
        this.stats.streak++;
        this.stats.best = Math.max(this.stats.best, this.stats.streak);
        this.saveStats();
      }
      var change = delta > 0 ? T('Your rating went up by {n}.', { n: delta }) : '';
      this.status(this.failed ? T('Solved on another try.') : T('Solved!'), 'over', C.joinSentences([this.explain(mv), change]), 'good');
      this.setButtons();
      this.renderStats();
      onProgress('puzzle', { solved: !this.failed, hinted: this.hinted, daily: this.daily, total: this.stats.solved, rating: this.stats.rating });
    },

    hint: function () {
      if (this.phase !== 'solving' || this.hinted) return;
      var u = this.cur.moves[this.idx];
      var p = this.game.get(u.slice(0, 2));
      this.hinted = true;
      Sound.play('hint');
      this.board.setMarks({ hint: [u.slice(0, 2)] });
      this.status(T('Hint'), 'you', T('Move your {piece} on {sq} (the highlighted square).', { piece: p ? C.pieceName(p.type) : T('piece'), sq: u.slice(0, 2) }));
      this.setButtons();
    },

    reveal: function () {
      var self = this;
      if (!this.cur || (this.phase !== 'solving' && this.phase !== 'wrong' && this.phase !== 'intro')) return;
      clearTimeout(this.timer);
      this.epoch++;
      var epoch = this.epoch;
      if (!this.failed) this.rate(0);
      this.phase = 'revealed';
      // Replay the puzzle from the start, then step through the answer.
      this.game = new window.Chess(this.cur.fen);
      var words = [];
      var steps = this.cur.moves.slice();
      this.board.setFen(this.cur.fen);
      this.setButtons();
      this.status(T('Here is the answer.'), 'bot', '');
      var i = 0;
      function step() {
        if (epoch !== self.epoch || i >= steps.length) {
          if (epoch === self.epoch) {
            self.status(T('Here is the answer.'), 'over', words.length ? T('You could {moves}.', { moves: words.join(T(', then ')) }) : '');
            self.board.setArrows([]);
          }
          return;
        }
        var u = steps[i];
        var before = self.game.fen();
        var mv = self.playAuto(u);
        if (mv && i % 2 === 1) {
          words.push(C.moveAction(describeUci(before, u), true));
          self.board.setArrows([{ from: mv.from, to: mv.to, color: 'green' }]);
        }
        i++;
        self.timer = setTimeout(step, 900);
      }
      step();
      this.renderStats();
    },

    /* ---------------------------------------------- Puzzle Sprint and Survival */

    /** Rated puzzles, a 3-minute Sprint, or Survival (three mistakes and you're out). */
    setMode: function (mode, quiet) {
      if (mode !== 'sprint' && mode !== 'survival') mode = 'rated';
      if (this.rush && this.rush.running) this.endRush('quit');
      this.rush = null;
      this.mode = mode;
      $('view-puzzles').dataset.pzmode = mode;
      Array.prototype.forEach.call(document.querySelectorAll('input[name="pzMode"]'), function (input) { input.checked = input.value === mode; });
      if (mode === 'rated') {
        $('rushIntro').hidden = true;
        $('rushBoard').hidden = true;
        this.renderStats();
        if (!quiet) {
          this.cur = null;
          this.next();
        }
      } else {
        this.showRushIntro(null);
      }
    },

    showRushIntro: function (result) {
      clearTimeout(this.timer);
      this.epoch++;
      this.phase = 'idle';
      this.cur = null;
      this.game = null;
      var sprint = this.mode === 'sprint';
      var name = T(sprint ? 'Puzzle Sprint' : 'Puzzle Survival');
      var best = this.stats.rushBest[this.mode] || 0;
      if (!result) {
        this.board.clearSelection();
        this.board.setOrientation('w');
        this.board.setFen(START_FEN);
        this.board.setMarks({ lastMove: null, check: null, danger: [], hint: [] });
        this.board.setArrows([]);
      }
      $('rushIntro').hidden = false;
      $('rushBoard').hidden = !result;
      $('rushTitle').textContent = result ? (result.reason === 'time' ? T("Time's up!") : result.reason === 'strikes' ? T('Three mistakes: the run is over.') : T('You solved every puzzle!')) : name;
      $('rushText').textContent = result
        ? C.joinSentences([plural(result.score, 'You solved {n} puzzle.', 'You solved {n} puzzles.'), result.newBest && result.score > 0 ? T('That is a new best!') : ''])
        : sprint
          ? T('Solve as many puzzles as you can in 3 minutes. They start easy and get harder. Three wrong moves end the run.')
          : T('Solve puzzles until you make three mistakes. There is no clock, so take your time. They start easy and get harder.');
      $('rushBest').textContent = best ? T('Your best: {n}', { n: best }) : '';
      $('btnRushStart').textContent = result ? T('Play again') : T('Start');
      $('pzTitle').textContent = name;
      $('pzSide').textContent = '';
      $('pzTask').textContent = sprint ? T('3 minutes, 3 lives') : T('3 lives, no clock');
      $('pzRatingLabel').textContent = T('Best');
      $('pzRating').textContent = String(best);
      this.status(result ? T('Run over.') : T('Press Start when you are ready.'), result ? 'over' : 'you', '');
      this.setButtons();
    },

    startRush: function () {
      var self = this;
      this.load().then(function (data) {
        if (!data || !data.length || self.mode === 'rated') return;
        var sprint = self.mode === 'sprint';
        if (self.rush && self.rush.tick) clearInterval(self.rush.tick);
        self.rush = { kind: self.mode, score: 0, strikes: 0, used: {}, running: true, endsAt: sprint ? Date.now() + 180000 : 0, tick: null };
        $('rushIntro').hidden = true;
        $('rushBoard').hidden = false;
        $('pzRatingLabel').textContent = T('Solved');
        if (sprint) self.rush.tick = setInterval(function () { self.rushTick(); }, 200);
        self.renderRush();
        Sound.play('start');
        self.rushNext();
      });
    },

    /** Puzzles get harder as the score goes up. */
    rushPick: function () {
      var r = this.rush;
      var target = 350 + r.score * 45;
      var pool = this.data.filter(function (p) { return !r.used[p.id]; });
      pool.sort(function (a, b) { return Math.abs(a.rating - target) - Math.abs(b.rating - target); });
      var choices = pool.slice(0, 8);
      return choices[Math.floor(Math.random() * choices.length)] || null;
    },

    rushNext: function () {
      if (!this.rush || !this.rush.running) return;
      var p = this.rushPick();
      if (!p) {
        this.endRush('done');
        return;
      }
      this.rush.used[p.id] = true;
      this.open(p, false);
    },

    rushTick: function () {
      var r = this.rush;
      if (!r || !r.running) return;
      var left = r.endsAt - Date.now();
      $('rushTime').textContent = formatClock(left, true);
      $('rushTimeWrap').classList.toggle('is-low', left < 20000);
      if (left <= 0) this.endRush('time');
    },

    renderRush: function () {
      var r = this.rush;
      if (!r) return;
      $('rushScore').textContent = String(r.score);
      $('pzRating').textContent = String(r.score);
      $('rushTimeWrap').hidden = r.kind !== 'sprint';
      if (r.kind === 'sprint') $('rushTime').textContent = formatClock(Math.max(0, r.endsAt - Date.now()), true);
      var lives = $('rushLives');
      Array.prototype.forEach.call(lives.children, function (el, i) { el.classList.toggle('is-lost', i < r.strikes); });
      lives.setAttribute('aria-label', T('{n} of 3 mistakes', { n: r.strikes }));
    },

    rushSolved: function () {
      var self = this;
      var epoch = this.epoch;
      this.phase = 'solved';
      this.rush.score++;
      Sound.play('correct');
      this.status(T('Solved!'), 'over', '', 'good');
      this.renderRush();
      this.setButtons();
      onProgress('puzzle', { solved: true, rush: true, total: this.stats.solved, rating: this.stats.rating });
      this.timer = setTimeout(function () {
        if (epoch === self.epoch) self.rushNext();
      }, 450);
    },

    rushWrong: function () {
      var self = this;
      var epoch = this.epoch;
      this.phase = 'wrong';
      this.rush.strikes++;
      Sound.play('wrong');
      var u = this.cur.moves[this.idx];
      if (u) this.board.setArrows([{ from: u.slice(0, 2), to: u.slice(2, 4), color: 'green' }]);
      this.status(T('Not that one.'), 'warn', T('The green arrow shows the right move.'), 'bad');
      this.renderRush();
      this.setButtons();
      var over = this.rush.strikes >= 3;
      this.timer = setTimeout(function () {
        if (epoch !== self.epoch) return;
        if (over) self.endRush('strikes');
        else self.rushNext();
      }, 1100);
    },

    endRush: function (reason) {
      var r = this.rush;
      if (!r || !r.running) return;
      r.running = false;
      clearInterval(r.tick);
      clearTimeout(this.timer);
      this.epoch++;
      if (reason === 'quit') return;
      var prev = this.stats.rushBest[r.kind] || 0;
      var newBest = r.score > prev;
      if (newBest) {
        this.stats.rushBest[r.kind] = r.score;
        this.saveStats();
      }
      onProgress('rush', { kind: r.kind, score: r.score });
      Sound.play(newBest && r.score > 0 ? 'win' : 'draw');
      this.board.setArrows([]);
      this.showRushIntro({ reason: reason, score: r.score, newBest: newBest });
      this.rush = null;
    },

    /** Elo-style update; returns the change in points. */
    rate: function (score) {
      var st = this.stats;
      var pr = this.cur ? this.cur.rating : st.rating;
      var expected = 1 / (1 + Math.pow(10, (pr - st.rating) / 400));
      var k = st.played < 20 ? 40 : 24;
      var delta = Math.round(k * (score - expected));
      st.rating = Math.max(400, Math.min(2500, st.rating + delta));
      st.played++;
      if (score === 0) {
        st.streak = 0;
        this.failed = true;
      }
      if (this.cur && st.seen.indexOf(this.cur.id) === -1) st.seen.push(this.cur.id);
      if (st.seen.length > 800) st.seen = st.seen.slice(-800);
      this.saveStats();
      var badge = $('pzRating').parentElement;
      badge.classList.toggle('is-up', delta > 0);
      badge.classList.toggle('is-down', delta < 0);
      this.renderStats();
      return delta;
    }
  };

  /** The best move of a saved puzzle, in words. */
  function bestWords(e) {
    var mv = describeUci(e.fen, e.bestMove);
    return mv ? C.moveAction(mv, true) : T('play {san}', { san: e.bestSan });
  }

  /** The date locale for the chosen language (undefined = the browser's own). */
  function uiLocale() {
    return window.I18N && window.I18N.lang !== 'en' ? window.I18N.locale : undefined;
  }

  function relativeDay(ts) {
    var d = new Date(ts);
    var now = new Date();
    var startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    if (ts >= startOfToday) return T('today');
    if (ts >= startOfToday - 86400000) return T('yesterday');
    return d.toLocaleDateString(uiLocale(), { month: 'short', day: 'numeric' });
  }

  function updateBankBadge() {
    var n = C.BlunderBank.count();
    ui.bankBadge.textContent = String(n);
    ui.bankBadge.hidden = n === 0;
    ui.bankBadge.setAttribute('aria-label', plural(n, '{n} saved blunder', '{n} saved blunders'));
    ui.bankBadgeMobile.textContent = n > 99 ? '99+' : String(n);
    ui.bankBadgeMobile.hidden = n === 0;
    ui.btnBankQuick.setAttribute('aria-label', plural(n, 'My Blunder Bank, {n} puzzle waiting', 'My Blunder Bank, {n} puzzles waiting'));
    renderHome();
  }

  /* ======================================================================== */
  /* Tabs                                                                     */
  /* ======================================================================== */

  function isMobile() {
    return window.matchMedia && window.matchMedia('(max-width: 1023px)').matches;
  }

  var VIEW_NAMES = ['home', 'learn', 'play', 'puzzles', 'bank'];

  function showTab(name) {
    if (S.phase === 'warning' || S.phase === 'promoting') return;
    if (document.body.classList.contains('modal-open')) return;
    if (VIEW_NAMES.indexOf(name) === -1) name = 'play';
    var target = $('view-' + name);
    var wasHidden = target.hidden;
    VIEW_NAMES.forEach(function (n) {
      var v = $('view-' + n);
      if (v) v.hidden = n !== name;
      var tab = $('tab-' + n);
      if (!tab) return;
      if (n === name) tab.setAttribute('aria-current', 'page');
      else tab.removeAttribute('aria-current');
    });
    closeDrawer();
    try {
      history.replaceState(null, '', name === 'play' ? location.pathname + location.search : '#' + name);
    } catch (e) {
      /* file:// or sandboxed */
    }
    if (name === 'bank') Bank.onShow();
    if (name === 'puzzles') Puzzles.onShow();
    if (name === 'learn') Learn.onShow();
    if (name === 'home') renderHome();
    if (wasHidden && isMobile()) window.scrollTo(0, 0);
  }

  function openDrawer() {
    document.body.classList.add('drawer-open');
    ui.btnMenu.setAttribute('aria-expanded', 'true');
    ui.drawerBackdrop.hidden = false;
    var current = ui.sidebar.querySelector('[aria-current="page"]') || ui.tabHome;
    setTimeout(function () { current.focus({ preventScroll: true }); }, 60);
  }

  function closeDrawer() {
    if (!document.body.classList.contains('drawer-open')) return;
    document.body.classList.remove('drawer-open');
    ui.btnMenu.setAttribute('aria-expanded', 'false');
    ui.drawerBackdrop.hidden = true;
  }

  function goToPlay(pane) {
    showTab('play');
    showPane(pane || (S.started ? 'game' : 'new'));
  }

  function renderLevelChips() {
    var first = Math.max(0, Math.min(LEVELS.length - 3, S.homeLevel - 1));
    ui.levelChips.innerHTML = '';
    for (var i = first; i < first + 3; i++) {
      var chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'chip';
      chip.setAttribute('role', 'radio');
      chip.setAttribute('aria-checked', String(i === S.homeLevel));
      chip.dataset.level = String(i);
      chip.textContent = levelName(i);
      chip.title = levelBlurb(i);
      ui.levelChips.appendChild(chip);
    }
  }

  function renderHome() {
    if (ui.viewHome.hidden) return;
    var games = loadHistory();
    var stats = loadStats();
    var bank = C.BlunderBank.list();
    var bankStats = C.BlunderBank.stats();

    var clean = 0;
    for (var i = 0, list = games.filter(function (g) { return g.mode !== 'friend'; }); i < list.length && list[i].blunders === 0; i++) clean++;
    ui.statClean.textContent = String(clean);
    renderProgressHome();
    renderLadder();

    renderLevelChips();
    var colour = S.colorChoice === 'random' ? T('a random colour') : C.colorName(S.colorChoice === 'b' ? 'b' : 'w');
    var tcPhrase = T((TIME_CONTROLS[S.timeChoice] || TIME_CONTROLS.none).phrase);
    var friendNext = S.modeChoice === 'friend';
    ui.levelChips.hidden = friendNext;
    $('playCardTitle').textContent = friendNext ? T('Play a friend') : T('Play vs bot');
    ui.homeNote.textContent = C.joinSentences([
      S.modeChoice !== 'standard' ? T('Mode: {mode}.', { mode: modeName(S.modeChoice) }) : '',
      friendNext ? T('Two players on this device, {time}.', { time: tcPhrase }) : T('You play {color}, {time}.', { color: colour, time: tcPhrase }),
      friendNext ? '' : S.guardOn ? T('Coach Guard is on.') : T('Coach Guard is off.')
    ]);
    ui.btnHomeContinue.hidden = !(S.started && S.phase !== 'over' && S.game.history().length > 0);

    ui.homePuzzleCount.textContent = String(bank.length);
    if (bank.length) {
      homeBoard.setOrientation(bank[0].color);
      homeBoard.setFen(bank[0].fen);
      ui.homePuzzleText.textContent = bank.length === 1
        ? T('Find the move you missed in one of your games.')
        : T('Find the moves you missed. Newest first.');
      ui.btnHomePuzzle.textContent = T('Solve puzzle');
    } else {
      homeBoard.setOrientation('w');
      homeBoard.setFen(START_FEN);
      ui.homePuzzleText.textContent = bankStats.cleared
        ? T('All clear. Blunders from new games will show up here.')
        : T('No puzzles yet. Blunders from your games become puzzles here.');
      ui.btnHomePuzzle.textContent = T('Play a game');
    }

    ui.historyList.innerHTML = '';
    ui.historyEmpty.hidden = games.length > 0;
    games.slice(0, 5).forEach(function (g) {
      var li = document.createElement('li');
      li.className = 'history-item';
      var badge = document.createElement('span');
      badge.className = 'result-badge result-' + g.result;
      var friendGame = g.mode === 'friend';
      badge.textContent = g.result === 'win' ? T('W') : g.result === 'loss' ? T('L') : g.result === 'white' ? '1–0' : g.result === 'black' ? '0–1' : '½';
      badge.setAttribute('aria-label', g.result === 'win' ? T('Win') : g.result === 'loss' ? T('Loss')
        : g.result === 'white' ? T('{color} won', { color: C.colorName('w') })
        : g.result === 'black' ? T('{color} won', { color: C.colorName('b') }) : T('Draw'));
      if (friendGame) badge.className = 'result-badge result-friend';
      var text = document.createElement('span');
      text.className = 'history-text';
      var title = document.createElement('span');
      title.className = 'history-title';
      var vsText = friendGame ? T('Game with a friend') : T('vs {level} bot', { level: levelName(LEVELS[g.level] ? g.level : 2) });
      var extra = [];
      if (g.mode && g.mode !== 'standard' && g.mode !== 'friend' && GAME_MODES[g.mode]) extra.push(modeName(g.mode));
      var gtc = TIME_CONTROLS[g.time];
      if (gtc && gtc.kind !== 'none') extra.push(T(TIME_KINDS[gtc.kind].name));
      title.textContent = extra.length ? T('{title} ({mode})', { title: vsText, mode: extra.join(', ') }) : vsText;
      var sub = document.createElement('span');
      sub.className = 'history-sub';
      var how = T({ checkmate: 'Checkmate', timeout: 'On time', stalemate: 'Stalemate', repetition: 'Repetition', insufficient: 'Not enough pieces', fifty: '50-move rule', hill: 'King to the centre', threecheck: 'Three checks' }[g.how] || 'Finished');
      sub.textContent = friendGame
        ? plural(g.moves, '{how}, {n} move, {when}', '{how}, {n} moves, {when}', { how: how, when: relativeDay(g.at) })
        : plural(g.moves, '{how}, {n} move as {color}, {when}', '{how}, {n} moves as {color}, {when}', { how: how, color: C.colorName(g.color === 'b' ? 'b' : 'w'), when: relativeDay(g.at) });
      text.appendChild(title);
      text.appendChild(sub);
      var tag = document.createElement('span');
      tag.className = 'history-tag ' + (g.blunders ? 'has-blunders' : 'is-clean');
      tag.textContent = friendGame ? '' : g.blunders ? plural(g.blunders, '{n} blunder', '{n} blunders') : T('Clean');
      tag.hidden = friendGame;
      li.appendChild(badge);
      li.appendChild(text);
      li.appendChild(tag);
      ui.historyList.appendChild(li);
    });

    ui.statGames.textContent = String(stats.games);
    ui.statWins.textContent = String(stats.wins);
    ui.statSaves.textContent = String(stats.saves);
    ui.statSolved.textContent = String(bankStats.cleared);
    ui.statWaiting.textContent = String(bank.length);
  }

  /* ======================================================================== */
  /* Move progress to another device (backup file or transfer code)          */
  /* ======================================================================== */

  var BACKUP_PREFIX = 'chessTrainer.';

  /** An error whose message is written for the player (already translated). */
  function friendlyError(text) {
    var e = new Error(T(text));
    e.friendly = true;
    return e;
  }

  function collectBackup() {
    var data = {};
    try {
      for (var i = 0; i < window.localStorage.length; i++) {
        var k = window.localStorage.key(i);
        if (k && k.indexOf(BACKUP_PREFIX) === 0) data[k] = window.localStorage.getItem(k);
      }
    } catch (e) {
      /* storage blocked: nothing to back up */
    }
    return { app: 'second-look', v: 1, exportedAt: Date.now(), data: data };
  }

  function checkBackup(obj) {
    if (!obj || obj.app !== 'second-look' || !obj.data || typeof obj.data !== 'object') {
      throw friendlyError("This isn't a Second Look backup.");
    }
    var keys = Object.keys(obj.data).filter(function (k) { return k.indexOf(BACKUP_PREFIX) === 0 && typeof obj.data[k] === 'string'; });
    if (!keys.length) throw friendlyError('This backup is empty.');
    return keys;
  }

  /** Replace this browser's progress with the backup, then reload. */
  function applyBackup(obj) {
    var keys = checkBackup(obj);
    var when = typeof obj.exportedAt === 'number' ? new Date(obj.exportedAt).toLocaleString(uiLocale()) : T('an earlier date');
    if (!window.confirm(T('Replace the progress on this device with the backup from {when}? Your current games, puzzles and badges here will be replaced.', { when: when }))) return false;
    try {
      var old = [];
      for (var i = 0; i < window.localStorage.length; i++) {
        var k = window.localStorage.key(i);
        if (k && k.indexOf(BACKUP_PREFIX) === 0) old.push(k);
      }
      old.forEach(function (key) { window.localStorage.removeItem(key); });
      keys.forEach(function (key) { window.localStorage.setItem(key, obj.data[key]); });
    } catch (e) {
      throw friendlyError("This browser won't let the site save data. Check that private browsing is off.");
    }
    S.restoring = true;
    toast('✓', T('Progress loaded'), T('Reloading…'));
    setTimeout(function () { location.reload(); }, 700);
    return true;
  }

  function bytesToBase64(bytes) {
    var bin = '';
    for (var i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  }

  function base64ToBytes(b64) {
    var bin = atob(b64);
    var out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  function streamBytes(bytes, stream) {
    var piped = new Blob([bytes]).stream().pipeThrough(stream);
    return new Response(piped).arrayBuffer().then(function (buf) { return new Uint8Array(buf); });
  }

  /** Transfer code: "SL1:" + gzip + base64, or "SL0:" + base64 where gzip isn't available. */
  function encodeTransfer(obj) {
    var bytes = new TextEncoder().encode(JSON.stringify(obj));
    if (typeof CompressionStream === 'function') {
      return streamBytes(bytes, new CompressionStream('gzip')).then(function (gz) { return 'SL1:' + bytesToBase64(gz); });
    }
    return Promise.resolve('SL0:' + bytesToBase64(bytes));
  }

  function decodeTransfer(text) {
    var code = String(text || '').replace(/\s+/g, '');
    var head = code.slice(0, 4);
    var body = code.slice(4);
    var bytes;
    try {
      bytes = base64ToBytes(body);
    } catch (e) {
      return Promise.reject(friendlyError("That code isn't complete. Copy it again and paste the whole thing."));
    }
    var json;
    if (head === 'SL1:') {
      if (typeof DecompressionStream !== 'function') return Promise.reject(friendlyError('This browser is too old to read the code. Use a backup file instead.'));
      json = streamBytes(bytes, new DecompressionStream('gzip')).then(function (raw) { return new TextDecoder().decode(raw); });
    } else if (head === 'SL0:') {
      json = Promise.resolve(new TextDecoder().decode(bytes));
    } else {
      return Promise.reject(friendlyError("That doesn't look like a transfer code. It should start with SL."));
    }
    return json.then(function (t) { return JSON.parse(t); }).catch(function (e) {
      throw e && e.friendly ? e : friendlyError("That code isn't complete. Copy it again and paste the whole thing.");
    });
  }

  function backupFileName() {
    return 'second-look-backup-' + todayKey() + '.json';
  }

  var CodeModal = {
    mode: 'paste', // paste | show

    open: function (mode, code) {
      this.mode = mode;
      var modal = $('codeModal');
      var input = $('codeInput');
      $('codeError').textContent = '';
      if (mode === 'show') {
        $('codeTitle').textContent = T('Your transfer code');
        $('codeText').textContent = T('Copy this whole code, then on your other device open Settings, press Paste transfer code and paste it there.');
        input.value = code;
        input.readOnly = true;
        $('btnCodeGo').textContent = T('Copy code');
      } else {
        $('codeTitle').textContent = T('Paste your transfer code');
        $('codeText').textContent = T('On your other device, open Settings and press Copy transfer code. Then paste it here.');
        input.value = '';
        input.readOnly = false;
        $('btnCodeGo').textContent = T('Load progress');
      }
      modal.hidden = false;
      document.body.classList.add('modal-open');
      setTimeout(function () {
        input.focus();
        if (mode === 'show') input.select();
      }, 30);
    },

    close: function () {
      $('codeModal').hidden = true;
      document.body.classList.remove('modal-open');
    },

    go: function () {
      var self = this;
      var input = $('codeInput');
      if (this.mode === 'show') {
        input.select();
        copyText(input.value).then(function () {
          toast('✓', T('Code copied'), T('Paste it on your other device in Settings.'));
        });
        return;
      }
      $('codeError').textContent = '';
      decodeTransfer(input.value)
        .then(function (obj) {
          if (applyBackup(obj)) self.close();
        })
        .catch(function (e) {
          $('codeError').textContent = e && e.friendly ? e.message : T("That code didn't work.");
        });
    }
  };

  function setupBackup() {
    $('btnBackupSave').addEventListener('click', function () {
      var blob = new Blob([JSON.stringify(collectBackup())], { type: 'application/json' });
      downloadBlob(blob, backupFileName());
      toast('✓', T('Backup saved'), T('Open Settings on your other device and press Load backup file.'));
    });
    $('btnBackupLoad').addEventListener('click', function () { $('backupFile').click(); });
    $('backupFile').addEventListener('change', function () {
      var file = this.files && this.files[0];
      this.value = '';
      if (!file) return;
      file.text().then(function (t) {
        return applyBackup(JSON.parse(t));
      }).catch(function (e) {
        toast('!', T("Couldn't load that file"), e && e.friendly ? e.message : T("This isn't a Second Look backup."));
      });
    });
    $('btnCodeCopy').addEventListener('click', function () {
      encodeTransfer(collectBackup()).then(function (code) {
        CodeModal.open('show', code);
      });
    });
    $('btnCodePaste').addEventListener('click', function () { CodeModal.open('paste'); });
    $('btnCodeGo').addEventListener('click', function () { CodeModal.go(); });
    $('codeModal').addEventListener('click', function (e) {
      if (e.target.closest('[data-close]')) CodeModal.close();
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && !$('codeModal').hidden) CodeModal.close();
    });
  }

  /* ======================================================================== */
  /* Install as an app (PWA)                                                  */
  /* ======================================================================== */

  var installPrompt = null;

  function isStandalone() {
    return (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || window.navigator.standalone === true;
  }

  function isIOS() {
    var ua = navigator.userAgent || '';
    return /iphone|ipad|ipod/i.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  }

  function renderInstallCard() {
    if (!ui.installCard) return;
    var snoozed = Date.now() < S.installSnoozedUntil;
    if (isStandalone() || snoozed) {
      ui.installCard.hidden = true;
      return;
    }
    if (installPrompt) {
      ui.installText.textContent = T('Add Second Look to your home screen. It opens full screen and the bot works without internet.');
      ui.btnInstall.hidden = false;
      ui.installCard.hidden = false;
    } else if (isIOS()) {
      ui.installText.textContent = T('On iPhone or iPad: tap the Share button at the bottom of Safari, then choose "Add to Home Screen".');
      ui.btnInstall.hidden = true;
      ui.installCard.hidden = false;
    } else {
      ui.installCard.hidden = true;
    }
  }

  function setupInstall() {
    window.addEventListener('beforeinstallprompt', function (e) {
      e.preventDefault();
      installPrompt = e;
      renderInstallCard();
    });
    window.addEventListener('appinstalled', function () {
      installPrompt = null;
      renderInstallCard();
    });
    ui.btnInstall.addEventListener('click', function () {
      if (!installPrompt) return;
      var p = installPrompt;
      installPrompt = null;
      p.prompt();
      Promise.resolve(p.userChoice).then(renderInstallCard, renderInstallCard);
    });
    ui.btnInstallLater.addEventListener('click', function () {
      S.installSnoozedUntil = Date.now() + 14 * 86400000;
      saveSettings();
      renderInstallCard();
    });
    renderInstallCard();

    var secure = location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1';
    if ('serviceWorker' in navigator && secure) {
      var register = function () {
        navigator.serviceWorker.register('./sw.js').catch(function () { /* the site works without it */ });
      };
      if (document.readyState === 'complete') register();
      else window.addEventListener('load', register);
    }
  }

  /* ======================================================================== */
  /* Wiring                                                                   */
  /* ======================================================================== */

  function bindUI() {
    ui = {
      enginePill: $('enginePill'),
      engineText: $('engineText'),
      statusText: $('statusText'),
      statusSub: $('statusSub'),
      statusDot: $('statusDot'),
      evalChip: $('evalChip'),
      evalBar: $('evalBar'),
      evalFill: $('evalFill'),
      boardWrap: $('boardWrap'),
      feed: $('feed'),
      moveList: $('moveList'),
      btnNewGame: $('btnNewGame'),
      btnTakeBack: $('btnTakeBack'),
      btnHint: $('btnHint'),
      btnFlip: $('btnFlip'),
      guardToggle: $('guardToggle'),
      evalToggle: $('evalToggle'),
      levelCards: $('levelCards'),
      topSide: $('topSide'),
      bottomSide: $('bottomSide'),
      topChecks: $('topChecks'),
      bottomChecks: $('bottomChecks'),
      topName: $('topName'),
      topCaps: $('topCaps'),
      topAdv: $('topAdv'),
      topAvatar: $('topAvatar'),
      bottomName: $('bottomName'),
      bottomCaps: $('bottomCaps'),
      bottomAdv: $('bottomAdv'),
      bottomAvatar: $('bottomAvatar'),
      bankBadge: $('bankBadge'),
      tabPlay: $('tab-play'),
      tabBank: $('tab-bank'),
      viewPlay: $('view-play'),
      viewBank: $('view-bank'),
      viewHome: $('view-home'),
      tabHome: $('tab-home'),
      sidebar: $('sidebar'),
      btnMenu: $('btnMenu'),
      drawerBackdrop: $('drawerBackdrop'),
      btnBankQuick: $('btnBankQuick'),
      bankBadgeMobile: $('bankBadgeMobile'),
      btnSoundQuick: $('btnSoundQuick'),
      soundHelp: $('soundHelp'),
      streakNum: $('streakNum'),
      homeSub: $('homeSub'),
      levelChips: $('levelChips'),
      homeNote: $('homeNote'),
      btnHomeStart: $('btnHomeStart'),
      btnHomeContinue: $('btnHomeContinue'),
      homePuzzleCount: $('homePuzzleCount'),
      homePuzzleText: $('homePuzzleText'),
      btnHomePuzzle: $('btnHomePuzzle'),
      historyList: $('historyList'),
      historyEmpty: $('historyEmpty'),
      btnHistoryPlay: $('btnHistoryPlay'),
      statGames: $('statGames'),
      statWins: $('statWins'),
      statSaves: $('statSaves'),
      statSolved: $('statSolved'),
      statWaiting: $('statWaiting'),
      soundToggle: $('soundToggle'),
      reviewBar: $('reviewBar'),
      reviewLabel: $('reviewLabel'),
      btnFirst: $('btnFirst'),
      btnPrev: $('btnPrev'),
      btnAutoplay: $('btnAutoplay'),
      btnNext: $('btnNext'),
      btnLast: $('btnLast'),
      btnLive: $('btnLive'),
      topClock: $('topClock'),
      topClockTime: $('topClockTime'),
      bottomClock: $('bottomClock'),
      bottomClockTime: $('bottomClockTime'),
      summaryPanel: $('summaryPanel'),
      summaryResult: $('summaryResult'),
      summaryLine: $('summaryLine'),
      evalGraph: $('evalGraph'),
      btnSummaryBank: $('btnSummaryBank'),
      btnSummaryReview: $('btnSummaryReview'),
      installCard: $('installCard'),
      btnPlayFrom: $('btnPlayFrom'),
      btnShare: $('btnShare'),
      btnSummaryRetry: $('btnSummaryRetry'),
      momentsWrap: $('momentsWrap'),
      momentsList: $('momentsList'),
      levelName: $('levelName'),
      levelGlyph: $('levelGlyph'),
      xpFill: $('xpFill'),
      xpBar: $('xpBar'),
      dayStreak: $('dayStreak'),
      goalList: $('goalList'),
      todayCard: document.querySelector('.today-card'),
      todayReward: $('todayReward'),
      nextLessonIcon: $('nextLessonIcon'),
      nextLessonTitle: $('nextLessonTitle'),
      nextLessonText: $('nextLessonText'),
      btnNextLesson: $('btnNextLesson'),
      badgeGrid: $('badgeGrid'),
      badgeCount: $('badgeCount'),
      dailyCard: document.querySelector('.daily-card'),
      dailyText: $('dailyText'),
      btnDaily: $('btnDaily'),
      statClean: $('statClean'),
      installText: $('installText'),
      btnInstall: $('btnInstall'),
      btnInstallLater: $('btnInstallLater')
    };

    board = new BoardView($('board'), {
      interactive: function () { return (S.phase === 'player' && S.viewPly === null) || premoveOpen(); },
      canMoveFrom: function (sq) {
        var p = S.game.get(sq);
        if (premoveOpen()) return !!p && p.color === S.playerColor;
        if (S.phase !== 'player' || S.viewPly !== null || S.game.turn() !== S.playerColor) return false;
        return !!p && p.color === S.playerColor;
      },
      legalTargets: function (sq) { return premoveOpen() ? premoveTargets(sq) : legalTargets(S.game, sq); },
      onMove: function (from, to) {
        if (premoveOpen()) setPremove(from, to);
        else onPlayerMove(from, to);
      },
      onIdleClick: function () { clearPremove(); }
    });
    $('board').addEventListener('contextmenu', function (e) {
      if (!S.premove) return;
      e.preventDefault();
      clearPremove();
    });
    homeBoard = new BoardView($('homeBoard'), {});
    dailyBoard = new BoardView($('dailyBoard'), {});

    renderLevelCards();
    ui.levelCards.addEventListener('click', function (e) {
      var card = e.target.closest('[data-level]');
      if (!card || S.phase === 'warning' || S.phase === 'promoting') return;
      S.levelIndex = parseInt(card.dataset.level, 10) || 0;
      saveSettings();
      renderLevelCards();
      newGame();
      showPane('game');
    });

    // Right-panel tabs
    ['game', 'new', 'settings'].forEach(function (p, i, all) {
      var tab = $('ptab-' + p);
      tab.addEventListener('click', function () { showPane(p); });
      tab.addEventListener('keydown', function (e) {
        if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
        e.preventDefault();
        var next = all[(i + (e.key === 'ArrowRight' ? 1 : all.length - 1)) % all.length];
        showPane(next);
        $('ptab-' + next).focus();
      });
    });

    applyBoardTheme();
    Array.prototype.forEach.call(document.querySelectorAll('input[name="boardTheme"]'), function (input) {
      input.addEventListener('change', function () {
        if (!input.checked) return;
        S.boardTheme = input.value;
        S.boardThemeChosen = true;
        applyBoardTheme();
        saveSettings();
      });
    });

    ui.guardToggle.setAttribute('aria-checked', String(S.guardOn));
    ui.guardToggle.addEventListener('click', function () {
      S.guardOn = !S.guardOn;
      ui.guardToggle.setAttribute('aria-checked', String(S.guardOn));
      saveSettings();
      pushNotes([{
        tone: 'tip',
        icon: S.guardOn ? '✓' : '•',
        text: S.guardOn
          ? T("Coach Guard is on. I'll stop you before a big mistake and explain what's wrong.")
          : T('Coach Guard is off. You play freely, and your big mistakes are still saved in My Blunder Bank.')
      }], T('Settings'));
    });

    applyEvalVisibility();
    ui.evalToggle.addEventListener('click', function () {
      S.showEval = !S.showEval;
      applyEvalVisibility();
      saveSettings();
    });

    Array.prototype.forEach.call(document.querySelectorAll('input[name="playAs"]'), function (input) {
      input.checked = input.value === S.colorChoice;
      input.addEventListener('change', function () {
        if (!input.checked) return;
        S.colorChoice = input.value;
        saveSettings();
        if (!S.started) showHome();
      });
    });

    Array.prototype.forEach.call(document.querySelectorAll('input[name="timeControl"]'), function (input) {
      input.checked = input.value === S.timeChoice;
      input.addEventListener('change', function () {
        if (!input.checked) return;
        S.timeChoice = input.value;
        saveSettings();
        renderNewGameForm();
        if (!S.started) showHome();
      });
    });

    Array.prototype.forEach.call(document.querySelectorAll('input[name="gameMode"]'), function (input) {
      input.addEventListener('change', function () {
        if (!input.checked) return;
        S.modeChoice = input.value;
        saveSettings();
        renderNewGameForm();
        if (!S.started) showHome();
      });
    });
    Array.prototype.forEach.call(document.querySelectorAll('input[name="oddsPiece"]'), function (input) {
      input.addEventListener('change', function () {
        if (!input.checked) return;
        S.oddsChoice = input.value;
        saveSettings();
      });
    });
    $('flipToggle').addEventListener('click', function () {
      S.autoFlip = !S.autoFlip;
      saveSettings();
      renderNewGameForm();
      if (S.started && isFriend() && S.phase === 'player') {
        S.orientation = S.autoFlip ? S.playerColor : 'w';
        syncBoard(false);
        renderStrips();
      }
    });
    $('btnFriendStart').addEventListener('click', function () {
      if (S.phase === 'warning' || S.phase === 'promoting') return;
      if (S.started && S.phase !== 'over' && S.game.history().length && !window.confirm(T('Start a new game? Your current game will end.'))) return;
      newGame({ mode: 'friend' });
      showPane('game');
    });
    renderNewGameForm();

    // Home: ways to play
    Array.prototype.forEach.call(document.querySelectorAll('[data-way]'), function (btn) {
      btn.addEventListener('click', function () {
        var way = btn.dataset.way;
        if (way === 'sprint' || way === 'survival') {
          showTab('puzzles');
          Puzzles.setMode(way);
          return;
        }
        if (way === 'bullet' || way === 'blitz' || way === 'rapid') {
          S.timeChoice = { bullet: '1', blitz: '3+2', rapid: '10' }[way];
          if (S.modeChoice === 'friend') S.modeChoice = 'standard';
        } else {
          S.modeChoice = way;
        }
        saveSettings();
        renderNewGameForm();
        goToPlay('new');
        var pane = $('pane-new');
        if (pane && pane.scrollTo) pane.scrollTo(0, 0);
      });
    });

    ui.btnNewGame.addEventListener('click', function () { showPane('new'); });
    ui.btnTakeBack.addEventListener('click', takeBack);
    ui.btnHint.addEventListener('click', showHint);
    ui.btnFlip.addEventListener('click', flipBoard);

    // Sounds: browsers only allow audio after a click or key press.
    function applySound(on, announce) {
      S.soundOn = on;
      Sound.setEnabled(on);
      ui.soundToggle.setAttribute('aria-checked', String(on));
      ui.btnSoundQuick.setAttribute('aria-pressed', String(on));
      ui.btnSoundQuick.setAttribute('aria-label', on ? T('Sounds on') : T('Sounds off'));
      ui.btnSoundQuick.classList.toggle('is-off', !on);
      if (!announce) return;
      saveSettings();
      if (on) {
        Sound.unlock();
        setTimeout(function () { Sound.play('move'); }, 80);
      }
    }
    applySound(S.soundOn, false);
    setVoice(S.voiceOn, false);
    if (Voice.supported) {
      Voice.pick();
      try { window.speechSynthesis.addEventListener('voiceschanged', function () { Voice.pick(); }); } catch (e) { /* older browsers */ }
    } else {
      renderVoiceHelp();
    }
    $('voiceToggle').addEventListener('click', function () { setVoice(!Voice.on, true); });
    Array.prototype.forEach.call(document.querySelectorAll('[data-voice-toggle]'), function (b) {
      b.addEventListener('click', function () { setVoice(!Voice.on, true); });
    });
    ui.soundToggle.addEventListener('click', function () { applySound(!S.soundOn, true); });
    ui.btnSoundQuick.addEventListener('click', function () { applySound(!S.soundOn, true); });
    Sound.onPack(function (recorded) {
      if (recorded) ui.soundHelp.textContent = T('Playing the recorded sounds from your sounds folder.');
    });
    document.addEventListener('pointerdown', Sound.unlock, true);
    document.addEventListener('keydown', Sound.unlock, true);

    // Replay: move list, arrow buttons and keyboard.
    ui.moveList.addEventListener('click', function (e) {
      var b = e.target.closest('[data-ply]');
      if (b) stepTo(parseInt(b.dataset.ply, 10));
    });
    ui.btnFirst.addEventListener('click', function () { stepTo(0); });
    ui.btnPrev.addEventListener('click', function () {
      stepTo((S.viewPly === null ? S.game.history().length : S.viewPly) - 1);
    });
    ui.btnAutoplay.addEventListener('click', toggleAutoplay);
    ui.btnNext.addEventListener('click', function () {
      if (S.viewPly !== null) stepTo(S.viewPly + 1);
    });
    ui.btnLast.addEventListener('click', function () {
      stopAutoplay();
      exitView(true);
    });
    ui.btnLive.addEventListener('click', function () {
      stopAutoplay();
      exitView(true);
    });
    document.addEventListener('keydown', function (e) {
      if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || ui.viewPlay.hidden) return;
      var t = e.target || {};
      var tag = t.tagName || '';
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
      if (t.getAttribute && t.getAttribute('role') === 'tab') return;
      var cur = S.viewPly === null ? S.game.history().length : S.viewPly;
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        stepTo(cur - 1);
      } else if (e.key === 'ArrowRight' && S.viewPly !== null) {
        e.preventDefault();
        stepTo(cur + 1);
      } else if (e.key === 'Home') {
        e.preventDefault();
        stepTo(0);
      } else if (e.key === 'End' && S.viewPly !== null) {
        e.preventDefault();
        stopAutoplay();
        exitView(true);
      }
    });

    // Keep the clocks if the tab is closed or the phone switches apps mid-game.
    function saveIfSteady() {
      if (S.restoring) return;
      if (S.started && (S.phase === 'player' || S.phase === 'bot') && ownsSavedGame()) saveGame();
    }
    window.addEventListener('pagehide', saveIfSteady);
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'hidden') saveIfSteady();
    });

    // End-of-game summary.
    ui.btnSummaryBank.addEventListener('click', function () { showTab('bank'); });
    ui.btnSummaryRetry.addEventListener('click', function () {
      if (S.retryPly) playFrom(S.retryPly - 1, S.retryPly);
    });
    ui.momentsList.addEventListener('click', function (e) {
      var show = e.target.closest('[data-show]');
      if (show) {
        stepTo(parseInt(show.dataset.show, 10));
        if (isMobile()) ui.boardWrap.scrollIntoView({ block: 'start', behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
        return;
      }
      var retry = e.target.closest('[data-retry]');
      if (retry) {
        var p = parseInt(retry.dataset.retry, 10);
        playFrom(p - 1, p);
      }
    });
    ui.btnShare.addEventListener('click', shareResult);
    ui.btnPlayFrom.addEventListener('click', function () {
      if (S.viewPly !== null) playFrom(S.viewPly, null);
    });
    ui.btnSummaryReview.addEventListener('click', function () {
      stepTo(S.summaryStartPly);
      if (window.matchMedia('(max-width: 1023px)').matches) {
        ui.boardWrap.scrollIntoView({ block: 'start', behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
      }
    });
    ui.evalGraph.addEventListener('click', function (e) {
      var len = S.game.history().length;
      if (!len) return;
      var rect = ui.evalGraph.getBoundingClientRect();
      stepTo(Math.round(((e.clientX - rect.left) / rect.width) * len));
    });

    ui.tabHome.addEventListener('click', function () { showTab('home'); });
    ui.tabPlay.addEventListener('click', function () { showTab('play'); });
    ui.tabBank.addEventListener('click', function () { showTab('bank'); });
    $('tab-puzzles').addEventListener('click', function () { showTab('puzzles'); });
    $('tab-learn').addEventListener('click', function () { showTab('learn'); });
    $('navSettings').addEventListener('click', function () { goToPlay('settings'); });

    ui.btnMenu.addEventListener('click', function () {
      if (document.body.classList.contains('drawer-open')) closeDrawer();
      else openDrawer();
    });
    ui.drawerBackdrop.addEventListener('click', closeDrawer);
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && document.body.classList.contains('drawer-open')) {
        closeDrawer();
        ui.btnMenu.focus();
      }
    });
    ui.btnBankQuick.addEventListener('click', function () { showTab('bank'); });

    ui.levelChips.addEventListener('click', function (e) {
      var chip = e.target.closest('[data-level]');
      if (!chip) return;
      S.homeLevel = parseInt(chip.dataset.level, 10) || 0;
      renderLevelChips();
    });
    ui.btnHomeStart.addEventListener('click', function () {
      if (S.phase === 'warning' || S.phase === 'promoting') return;
      if (S.modeChoice === 'friend') {
        newGame({ mode: 'friend' });
        goToPlay('game');
        return;
      }
      S.levelIndex = S.homeLevel;
      saveSettings();
      renderLevelCards();
      newGame();
      goToPlay('game');
    });
    ui.btnHomeContinue.addEventListener('click', function () { goToPlay('game'); });
    $('btnLadderGo').addEventListener('click', function () {
      if (S.phase === 'warning' || S.phase === 'promoting') return;
      if (S.started && S.phase !== 'over' && S.game.history().length && !window.confirm(T('Start a new game? Your current game will end.'))) return;
      S.levelIndex = parseInt($('btnLadderGo').dataset.level, 10) || 0;
      S.homeLevel = S.levelIndex;
      saveSettings();
      renderLevelCards();
      newGame({ mode: 'standard' });
      goToPlay('game');
    });
    Array.prototype.forEach.call(ui.viewHome.querySelectorAll('[data-go]'), function (btn) {
      btn.addEventListener('click', function () {
        var go = btn.dataset.go;
        if (go === 'bank' || go === 'puzzles' || go === 'learn') showTab(go);
        else if (go === 'settings') goToPlay('settings');
        else goToPlay('new');
      });
    });
    ui.btnHomePuzzle.addEventListener('click', function () {
      var list = C.BlunderBank.list();
      if (list.length) {
        showTab('bank');
        Bank.open(list[0].id);
      } else {
        goToPlay();
      }
    });
    ui.btnHistoryPlay.addEventListener('click', function () { goToPlay(); });
    ui.goalList.addEventListener('click', function (e) {
      var b = e.target.closest('[data-goal]');
      if (!b) return;
      if (b.dataset.goal === 'play') goToPlay();
      else showTab(b.dataset.goal);
    });
    ui.btnNextLesson.addEventListener('click', function () {
      var next = Learn.nextLesson();
      showTab('learn');
      if (next) Learn.openLesson(next.id);
    });
    ui.btnDaily.addEventListener('click', function () { Puzzles.openDaily(); });
    Array.prototype.forEach.call(document.querySelectorAll('[data-goto="play"]'), function (b) {
      b.addEventListener('click', function () { showTab('play'); });
    });

    pieceFallbackListeners.push(function () {
      renderStrips();
    });
  }

  /** Language: the page's own text is translated once, then a change reloads the page. */
  function setupLanguage() {
    var I = window.I18N;
    if (!I) return;
    I.translateDom(document.body);
    if (I.lang !== 'en') document.title = T(document.title);
    function choose(lang) {
      if (lang === I.lang) return;
      S.lang = lang;
      I.choose(lang);
      saveSettings();
      location.reload(); // the game in progress is saved on pagehide
    }
    Array.prototype.forEach.call(document.querySelectorAll('input[name="lang"]'), function (input) {
      input.checked = input.value === I.lang;
      input.addEventListener('change', function () { if (input.checked) choose(input.value); });
    });
    var sel = $('langSelect');
    if (sel) {
      sel.value = I.lang;
      sel.addEventListener('change', function () { choose(sel.value); });
    }
  }

  function init() {
    loadSettings();
    setupLanguage();
    Progress.load();
    bindUI();
    Bank.init();
    Puzzles.init();
    Learn.init();
    setupInstall();
    setupBackup();
    updateBankBadge();
    engine.start();
    S.homeLevel = S.levelIndex;
    if (!restoreGame()) showHome();
    var hash = location.hash;
    if (hash === '#bank' || hash === '#puzzles' || hash === '#learn') showTab(hash.slice(1));
    else if (hash === '#home' || (hash !== '#play' && isMobile())) showTab('home');
    else showTab('play');
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
