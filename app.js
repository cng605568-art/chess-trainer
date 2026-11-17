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
  var $ = function (id) { return document.getElementById(id); };

  if (typeof window.Chess !== 'function' || !C) {
    var msg = document.createElement('div');
    msg.className = 'fatal-banner';
    msg.textContent = 'The chess rules library could not be loaded. Check your connection and reload the page.';
    document.body.prepend(msg);
    return;
  }

  /* ======================================================================== */
  /* Configuration                                                            */
  /* ======================================================================== */

  var LEVELS = [
    { name: 'Rookie', blurb: 'Leaves pieces hanging often. Good for your very first games.', skill: 0, depth: 1, movetime: 80, random: 0.35 },
    { name: 'Beginner', blurb: 'Makes sensible moves but misses simple tactics.', skill: 0, depth: 3, movetime: 150, random: 0.12 },
    { name: 'Casual', blurb: 'Plays like a friendly club newcomer.', skill: 4, depth: 5, movetime: 300, random: 0 },
    { name: 'Club player', blurb: 'Notices loose pieces and punishes them.', skill: 9, depth: 8, movetime: 500, random: 0 },
    { name: 'Strong', blurb: 'A solid tournament player. Expect a real fight.', skill: 15, depth: 12, movetime: 800, random: 0 },
    { name: 'Full Stockfish', blurb: 'Full strength. Mostly for watching how the engine plays.', skill: 20, depth: 18, movetime: 1500, random: 0 }
  ];

  var ANALYSIS = { depth: 12, movetime: 900 };
  var PUZZLE_ANALYSIS = { depth: 12, movetime: 900 };
  var MIN_BOT_THINK_MS = 450;
  var SETTINGS_KEY = 'chessTrainer.settings.v1';
  var GAME_KEY = 'chessTrainer.game.v1';
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
      whiteCp: term === 'checkmate' ? (stm === 'w' ? -C.MATE_CP : C.MATE_CP) : 0,
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

  function moveLabel(fenBefore, san) {
    var p = C.parseFen(fenBefore);
    return p.fullmove + (p.turn === 'w' ? '. ' : '… ') + san;
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

  /** p: { t: 'n', c: 'w' } */
  function createPieceEl(p, extraClass) {
    var code = p.c + p.t.toUpperCase();
    var label = C.COLOR_NAMES[p.c] + ' ' + C.NAMES[p.t];
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
      onMove: opts.onMove || function () {}
    };
    this.orientation = 'w';
    this.pieces = new Array(64).fill(null);
    this.pieceCodes = new Array(64).fill('');
    this.selected = null;
    this.targets = [];
    this.marks = { lastMove: null, check: null, danger: [], hint: [] };
    this.arrows = [];
    this.drag = null;
    this.hoverSq = null;
    this.ghost = null;
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

  BoardView.prototype.setFen = function (fen) {
    this.pieces = C.parseFen(fen).board;
    this._drawPieces(false);
    this._paint();
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
      this.squareEls[i].setAttribute('aria-label', C.idxToSq(i) + (p ? ', ' + C.COLOR_NAMES[p.c] + ' ' + C.NAMES[p.t] : ''));
    }
  };

  BoardView.prototype.setMarks = function (patch) {
    for (var k in patch) if (Object.prototype.hasOwnProperty.call(patch, k)) this.marks[k] = patch[k];
    if (!this.marks.danger) this.marks.danger = [];
    if (!this.marks.hint) this.marks.hint = [];
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
        this._commit(d.from, to);
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

  BoardView.prototype._commit = function (from, to) {
    this.selected = null;
    this.targets = [];
    this.hoverSq = null;
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
    this.onStatus({ state: 'loading', flavor: flavor, text: flavor === 'stockfish' ? 'Loading Stockfish…' : 'Starting backup engine…' });
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
      this.onStatus({ state: 'fallback', text: 'Stockfish unavailable. Switching to the backup engine…', reason: reason });
      this._spawn();
      return;
    }
    this.failed = true;
    this.onStatus({ state: 'error', text: 'No engine available', reason: reason });
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
        this.onStatus({ state: 'ready', flavor: msg.flavor, text: msg.flavor === 'lite' ? 'Backup engine ready' : this.name.replace(/\s+64.*$/, '') + ' ready' });
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
        return {
          fen: fen,
          bestMove: r.bestMove,
          pv: r.pv || [],
          whiteCp: C.uciScoreToWhiteCp(r.score, fen),
          depth: r.depth || 0,
          hasScore: !!r.score,
          terminal: null
        };
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
      $('guardEvalBefore').textContent = C.formatEval(info.evalBefore);
      $('guardEvalAfter').textContent = C.formatEval(info.evalAfter);
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
    engineNoticeShown: false
  };

  var engine = new EngineClient(onEngineStatus);
  var board;

  function oppColor() { return C.opposite(S.playerColor); }
  function oppName() { return C.COLOR_NAMES[oppColor()]; }

  function loadSettings() {
    var raw = store.get(SETTINGS_KEY);
    if (!raw) return;
    try {
      var s = JSON.parse(raw);
      if (typeof s.guardOn === 'boolean') S.guardOn = s.guardOn;
      if (typeof s.showEval === 'boolean') S.showEval = s.showEval;
      if (typeof s.levelIndex === 'number' && s.levelIndex >= 0 && s.levelIndex < LEVELS.length) S.levelIndex = s.levelIndex;
      if (s.colorChoice === 'w' || s.colorChoice === 'b' || s.colorChoice === 'random') S.colorChoice = s.colorChoice;
    } catch (e) {
      /* keep defaults */
    }
  }

  function saveSettings() {
    store.set(SETTINGS_KEY, JSON.stringify({
      guardOn: S.guardOn,
      showEval: S.showEval,
      levelIndex: S.levelIndex,
      colorChoice: S.colorChoice
    }));
  }

  function saveGame() {
    if (S.phase === 'over') {
      store.remove(GAME_KEY);
      return;
    }
    var moves = S.game.history({ verbose: true }).map(moveToUci);
    store.set(GAME_KEY, JSON.stringify({ v: 1, moves: moves, playerColor: S.playerColor, gameId: S.gameId, savedAt: Date.now() }));
  }

  function onEngineStatus(s) {
    if (!ui.enginePill) return;
    ui.enginePill.dataset.state = s.state;
    ui.engineText.textContent = s.text;
    if (s.reason) ui.enginePill.title = s.reason;
    if (s.state === 'fallback' && !S.engineNoticeShown) {
      S.engineNoticeShown = true;
      pushNotes([{ tone: 'warn', icon: '!', text: "Stockfish couldn't be downloaded, so a smaller backup engine is running. Coach Guard still works, just with less depth." }], 'Engine');
    }
    if (s.state === 'error') {
      pushNotes([{ tone: 'bad', icon: '✕', text: 'No chess engine could be started, so Coach Guard and move ratings are paused and the bot plays simple moves. Reload the page to try again.' }], 'Engine');
      if (S.phase === 'checking' || S.phase === 'player') refreshStatusForPhase();
    }
    if (s.state === 'ready' && S.phase === 'bot') {
      setStatus(LEVELS[S.levelIndex].name + ' bot is thinking…', 'bot');
    }
  }

  function setStatus(text, kind, sub) {
    ui.statusText.textContent = text;
    ui.statusDot.dataset.kind = kind || 'you';
    if (typeof sub === 'string') ui.statusSub.textContent = sub;
  }

  function refreshStatusForPhase() {
    if (S.phase === 'player') {
      setStatus(ChessAPI.inCheck(S.game) ? "Check! It's your move." : 'Your move.', 'you');
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
  }

  function evalToPct(cp) {
    if (C.isMateScore(cp)) return cp > 0 ? 100 : 0;
    var x = Math.max(-1500, Math.min(1500, cp));
    return 50 + 50 * (2 / (1 + Math.exp(-0.004 * x)) - 1);
  }

  function showEval(a) {
    if (!a || !a.hasScore) return;
    var cp = a.whiteCp;
    ui.evalFill.style.height = evalToPct(cp).toFixed(1) + '%';
    var txt = C.formatEval(cp);
    ui.evalChip.textContent = txt;
    ui.evalBar.setAttribute('aria-label', 'Evaluation ' + txt + ' from White\'s side');
    ui.statusSub.textContent = C.describeEval(C.perspective(cp, S.playerColor), oppName());
  }

  function resetEval() {
    ui.evalFill.style.height = '50%';
    ui.evalChip.textContent = '0.0';
    ui.evalBar.setAttribute('aria-label', 'Evaluation: equal');
  }

  function applyEvalVisibility() {
    document.body.classList.toggle('hide-eval', !S.showEval);
    ui.evalToggle.setAttribute('aria-checked', String(S.showEval));
  }

  function renderMoveList() {
    var hist = S.game.history({ verbose: true });
    var ol = ui.moveList;
    ol.innerHTML = '';
    if (!hist.length) {
      var empty = document.createElement('li');
      empty.className = 'movelist-empty';
      empty.textContent = 'No moves yet.';
      ol.appendChild(empty);
      return;
    }
    for (var i = 0; i < hist.length; i += 2) {
      var li = document.createElement('li');
      li.className = 'move-row';
      var num = document.createElement('span');
      num.className = 'move-num';
      num.textContent = (i / 2 + 1) + '.';
      li.appendChild(num);
      [hist[i], hist[i + 1]].forEach(function (m, k) {
        var span = document.createElement('span');
        span.className = 'move-san';
        if (m) {
          span.textContent = m.san;
          if (m.color === S.playerColor) span.classList.add('is-mine');
          if (i + k === hist.length - 1) span.classList.add('is-current');
        }
        li.appendChild(span);
      });
      ol.appendChild(li);
    }
    ol.scrollTop = ol.scrollHeight;
  }

  function renderStrips() {
    var caps = C.capturedPieces(S.game.fen());
    var topColor = C.opposite(S.orientation);
    var bottomColor = S.orientation;
    var lvl = LEVELS[S.levelIndex];
    function fill(color, nameEl, capsEl, advEl, avatarEl) {
      var isMe = color === S.playerColor;
      nameEl.textContent = isMe ? 'You, playing ' + C.COLOR_NAMES[color] : lvl.name + ' bot, playing ' + C.COLOR_NAMES[color];
      avatarEl.textContent = isMe ? '♔' : '♞';
      avatarEl.classList.toggle('avatar-you', isMe);
      capsEl.innerHTML = '';
      var list = color === 'w' ? caps.byWhite : caps.byBlack;
      list.forEach(function (t) { capsEl.appendChild(createPieceEl({ t: t, c: C.opposite(color) }, 'cap')); });
      var diff = color === 'w' ? caps.diff : -caps.diff;
      advEl.textContent = diff > 0 ? '+' + diff : '';
    }
    fill(topColor, ui.topName, ui.topCaps, ui.topAdv, ui.topAvatar);
    fill(bottomColor, ui.bottomName, ui.bottomCaps, ui.bottomAdv, ui.bottomAvatar);
  }

  function lastMoveMark() {
    var hist = S.game.history({ verbose: true });
    var last = hist[hist.length - 1];
    return last ? { from: last.from, to: last.to } : null;
  }

  function syncBoard() {
    board.setOrientation(S.orientation);
    board.setFen(S.game.fen());
    board.setMarks({ lastMove: lastMoveMark(), check: checkSquare(S.game), danger: [], hint: [] });
    board.setArrows([]);
    ui.evalBar.classList.toggle('flipped', S.orientation === 'b');
  }

  function refreshControls() {
    var hasMine = S.game.history({ verbose: true }).some(function (m) { return m.color === S.playerColor; });
    ui.btnTakeBack.disabled = !hasMine || S.phase === 'warning' || S.phase === 'promoting';
    ui.btnHint.disabled = S.phase !== 'player' || engine.failed;
    ui.btnNewGame.disabled = S.phase === 'warning' || S.phase === 'promoting';
    board.refresh();
  }

  /* ======================================================================== */
  /* Practice: game loop                                                      */
  /* ======================================================================== */

  function newGame() {
    if (S.closeGuard) S.closeGuard();
    cancelEngineWork();
    S.epoch++;
    S.game = new window.Chess();
    S.gameId = makeId();
    S.playerColor = S.colorChoice === 'random' ? (Math.random() < 0.5 ? 'w' : 'b') : S.colorChoice;
    S.orientation = S.playerColor;
    S.lastPlayerEvalP = null;
    S.hintStage = 0;
    S.bankedThisGame = 0;
    S.phase = 'idle';
    board.clearSelection();
    syncBoard();
    resetEval();
    ui.feed.innerHTML = '';
    renderMoveList();
    renderStrips();
    updatePlayAsHelp();
    engine.newGame();
    pushNotes([{
      tone: 'tip',
      icon: '♔',
      text: "New game. You're playing " + C.COLOR_NAMES[S.playerColor] + ' against the ' + LEVELS[S.levelIndex].name + ' bot. ' +
        (S.guardOn ? "Coach Guard is on, so I'll stop you before a big mistake." : 'Coach Guard is off, but blunders still go to your Blunder Bank.')
    }], 'Start');
    saveGame();
    if (S.game.turn() === S.playerColor) playerTurn(null);
    else botTurn();
  }

  function restoreGame() {
    var raw = store.get(GAME_KEY);
    if (!raw) return false;
    var data;
    try { data = JSON.parse(raw); } catch (e) { return false; }
    if (!data || !Array.isArray(data.moves) || !data.moves.length || (data.playerColor !== 'w' && data.playerColor !== 'b')) return false;
    var g = new window.Chess();
    for (var i = 0; i < data.moves.length; i++) {
      if (typeof data.moves[i] !== 'string' || !safeMove(g, uciToMove(data.moves[i]))) return false;
    }
    if (ChessAPI.isGameOver(g)) return false;
    S.game = g;
    S.playerColor = data.playerColor;
    S.orientation = data.playerColor;
    S.gameId = typeof data.gameId === 'string' ? data.gameId : makeId();
    syncBoard();
    renderMoveList();
    renderStrips();
    pushNotes([{ tone: 'tip', icon: '♔', text: 'Welcome back. Your game is restored right where you left it.' }], 'Resumed');
    if (S.game.turn() === S.playerColor) playerTurn(null);
    else botTurn();
    return true;
  }

  function playerTurn(ctx) {
    S.phase = 'player';
    S.hintStage = 0;
    var fen = S.game.fen();
    var epoch = S.epoch;
    setStatus(ChessAPI.inCheck(S.game) ? "Check! It's your move." : 'Your move.', 'you');
    refreshControls();
    // Look at the position while the player thinks: this is the "before"
    // evaluation the Coach Guard compares against.
    analyze(fen).then(function (a) {
      if (epoch !== S.epoch || !a) return;
      if (S.game.fen() === fen) showEval(a);
      if (ctx && ctx.botMove && a.hasScore) {
        var tips = C.describeOpportunity({
          prevEvalP: ctx.prevEvalP,
          evalP: C.perspective(a.whiteCp, S.playerColor),
          playerColor: S.playerColor,
          bestMove: a.bestMove ? describeUci(fen, a.bestMove) : null,
          fen: fen
        });
        if (tips.length) pushNotes(tips, ctx.label);
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
      bestMove: before.bestMove,
      isBlunder: !isBest && !!before.bestMove && drop > C.BLUNDER_CP
    };
  }

  async function onPlayerMove(from, to) {
    if (S.phase !== 'player' || S.game.turn() !== S.playerColor) return;
    var promotion = null;
    if (needsPromotion(S.game, from, to)) {
      S.phase = 'promoting';
      refreshControls();
      promotion = await askPromotion(S.playerColor);
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
    var epoch = S.epoch;
    var fenAfter = S.game.fen();
    S.phase = 'checking';
    S.hintStage = 0;
    board.setFen(fenAfter);
    board.setArrows([]);
    board.setMarks({ lastMove: { from: mv.from, to: mv.to }, check: checkSquare(S.game), hint: [], danger: [] });
    renderMoveList();
    renderStrips();
    refreshControls();
    setStatus(engine.failed ? 'Playing your move…' : 'Coach is checking your move…', 'busy');

    var before = await analyze(fenBefore);
    if (epoch !== S.epoch) return;
    var term = terminalInfo(S.game);
    var after = term ? terminalAnalysis(S.game, term) : await analyze(fenAfter);
    if (epoch !== S.epoch) return;

    var verdict = judge(before, after, mv);
    var saved = false;

    if (verdict && verdict.isBlunder) {
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
      var added = C.BlunderBank.add({
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
      saved = true;
      if (added.isNew) S.bankedThisGame++;

      if (S.guardOn) {
        S.phase = 'warning';
        refreshControls();
        board.setMarks({ danger: explanation.dangerSquares });
        board.setArrows(explanation.threat ? [{ from: explanation.threat.from, to: explanation.threat.to, color: 'red' }] : []);
        setStatus('Coach Guard: take a second look.', 'warn');
        var choice = await showGuard({ message: explanation.message, evalBefore: verdict.pBefore, evalAfter: verdict.pAfter });
        if (epoch !== S.epoch) return;
        board.setMarks({ danger: [] });
        board.setArrows([]);
        if (choice === 'undo') {
          S.game.undo();
          C.BlunderBank.update(added.entry.id, { caught: true });
          syncBoard();
          renderMoveList();
          renderStrips();
          var watch = explanation.threat
            ? ' Before you move, look at what ' + oppName() + ' could do on ' + explanation.threat.to + '.'
            : ' Look for a safer move.';
          pushNotes([{ tone: 'good', icon: '↶', text: 'Good call taking it back.' + watch }], moveLabel(fenBefore, mv.san) + ', taken back');
          playerTurn(null);
          return;
        }
      }
    }
    finalizePlayerMove(mv, fenBefore, fenAfter, verdict, saved, after);
  }

  function finalizePlayerMove(mv, fenBefore, fenAfter, verdict, saved, after) {
    var hist = S.game.history({ verbose: true });
    var prevMove = hist.length >= 2 ? hist[hist.length - 2] : null;
    var term = terminalInfo(S.game);
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
      drawReason: term && term !== 'checkmate' ? term : null,
      verdict: verdict,
      savedToBank: saved
    });
    pushNotes(tips, moveLabel(fenBefore, mv.san));
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
    saveGame();
    botTurn();
  }

  async function botTurn() {
    S.phase = 'bot';
    refreshControls();
    var epoch = S.epoch;
    var fen = S.game.fen();
    var lvl = LEVELS[S.levelIndex];
    setStatus(engine.ready || engine.failed ? lvl.name + ' bot is thinking…' : 'Waiting for the engine to load…', 'bot');
    var t0 = Date.now();
    var uci = null;
    if (lvl.random > 0 && Math.random() < lvl.random) {
      uci = randomMoveUci(S.game);
    } else {
      var r = await engine.search({ fen: fen, skill: lvl.skill, depth: lvl.depth, movetime: lvl.movetime });
      if (epoch !== S.epoch) return;
      uci = r && r.bestMove;
    }
    if (!uci) uci = randomMoveUci(S.game);
    var wait = MIN_BOT_THINK_MS - (Date.now() - t0);
    if (wait > 0) await sleep(wait);
    if (epoch !== S.epoch) return;

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
    var fenAfter = S.game.fen();
    board.setFen(fenAfter);
    board.setMarks({ lastMove: { from: mv.from, to: mv.to }, check: checkSquare(S.game), hint: [], danger: [] });
    board.setArrows([]);
    renderMoveList();
    renderStrips();

    var hist = S.game.history({ verbose: true });
    var prevMove = hist.length >= 2 ? hist[hist.length - 2] : null;
    var term = terminalInfo(S.game);
    var label = moveLabel(fenBefore, mv.san);
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
    }), label);
    if (term) {
      endGame(term);
      return;
    }
    saveGame();
    playerTurn({ botMove: mv, prevEvalP: S.lastPlayerEvalP, label: label });
  }

  function endGame(term) {
    S.phase = 'over';
    store.remove(GAME_KEY);
    var text;
    if (term === 'checkmate') {
      text = S.game.turn() === S.playerColor ? 'Checkmate. ' + oppName() + ' wins.' : 'Checkmate. You win!';
    } else {
      text = 'Draw. ' + ({
        stalemate: 'Stalemate.',
        repetition: 'Threefold repetition.',
        insufficient: 'Not enough material to checkmate.',
        fifty: '50-move rule.'
      }[term] || '');
    }
    setStatus(text, 'over', 'Start a new game, or take back a move to try a different idea.');
    refreshControls();
    var summary = S.bankedThisGame > 0
      ? 'This game added ' + S.bankedThisGame + (S.bankedThisGame === 1 ? ' blunder' : ' blunders') + ' to My Blunder Bank. Solving them is the fastest way to stop repeating them.'
      : 'No new blunders saved this game. Nicely done.';
    pushNotes([{ tone: 'tip', icon: '♔', text: summary }], 'Game over');
  }

  function takeBack() {
    if (S.phase === 'warning' || S.phase === 'promoting') return;
    var hist = S.game.history({ verbose: true });
    if (!hist.some(function (m) { return m.color === S.playerColor; })) return;
    cancelEngineWork();
    S.epoch++;
    while (S.game.history().length) {
      var m = S.game.undo();
      if (!m || m.color === S.playerColor) break;
    }
    S.lastPlayerEvalP = null;
    board.clearSelection();
    syncBoard();
    renderMoveList();
    renderStrips();
    S.phase = 'player';
    saveGame();
    pushNotes([{ tone: 'tip', icon: '↶', text: 'Move taken back. Have another look before you play.' }], 'Take back');
    playerTurn(null);
  }

  async function showHint() {
    if (S.phase !== 'player') return;
    var fen = S.game.fen();
    var epoch = S.epoch;
    ui.btnHint.disabled = true;
    ui.btnHint.textContent = 'Thinking…';
    var a = await analyze(fen);
    ui.btnHint.textContent = 'Show hint';
    if (epoch !== S.epoch || S.game.fen() !== fen || S.phase !== 'player') {
      refreshControls();
      return;
    }
    refreshControls();
    if (!a || !a.bestMove) {
      pushNotes([{ tone: 'tip', icon: '?', text: 'The engine is still warming up. Try the hint again in a moment.' }], 'Hint');
      return;
    }
    var mv = uciToMove(a.bestMove);
    var p = C.parseFen(fen).board[C.sqToIdx(mv.from)];
    var pieceName = p ? C.NAMES[p.t] : 'piece';
    if (S.hintStage === 0) {
      S.hintStage = 1;
      board.setMarks({ hint: [mv.from] });
      pushNotes([{ tone: 'tip', icon: '?', text: 'Hint: look at your ' + pieceName + ' on ' + mv.from + '. Press Show hint again to see the full move.' }], 'Hint');
    } else {
      S.hintStage = 2;
      board.setMarks({ hint: [mv.from] });
      board.setArrows([{ from: mv.from, to: mv.to, color: 'green' }]);
      pushNotes([{ tone: 'tip', icon: '?', text: 'Stockfish suggests ' + sanOf(fen, a.bestMove) + '.' }], 'Hint');
    }
  }

  function flipBoard() {
    S.orientation = C.opposite(S.orientation);
    board.setOrientation(S.orientation);
    ui.evalBar.classList.toggle('flipped', S.orientation === 'b');
    renderStrips();
  }

  function updatePlayAsHelp() {
    var hasMoves = S.game.history().length > 0 && S.phase !== 'over';
    ui.playAsHelp.textContent = hasMoves ? 'Takes effect when you start a new game.' : 'Changing this starts a fresh game.';
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
        if (window.confirm('Remove every saved blunder? This cannot be undone.')) {
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
        ? list.length + (list.length === 1 ? ' puzzle waiting' : ' puzzles waiting') + (stats.cleared ? ', ' + stats.cleared + ' cleared so far.' : '.')
        : (stats.cleared ? 'All clear. You have solved ' + stats.cleared + (stats.cleared === 1 ? ' blunder' : ' blunders') + '.' : '');
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
        san.textContent = 'You played ' + e.playedSan;
        var drop = document.createElement('span');
        drop.className = 'drop-pill';
        drop.textContent = '−' + (Math.abs(e.drop) / 100).toFixed(1);
        drop.title = 'Lost about ' + C.pawnsText(e.drop);
        top.appendChild(san);
        top.appendChild(drop);
        var sub = document.createElement('span');
        sub.className = 'bank-item-sub';
        sub.textContent = 'Move ' + e.moveNumber + ' as ' + C.COLOR_NAMES[e.color] + ', ' + relativeDay(e.createdAt);
        btn.appendChild(top);
        btn.appendChild(sub);
        var tags = document.createElement('span');
        tags.className = 'bank-item-tags';
        if (e.caught) {
          var t1 = document.createElement('span');
          t1.className = 'bank-tag tag-caught';
          t1.textContent = 'Caught by Coach Guard';
          tags.appendChild(t1);
        }
        if (e.timesBlundered > 1) {
          var t2 = document.createElement('span');
          t2.className = 'bank-tag tag-repeat';
          t2.textContent = 'Repeated ' + e.timesBlundered + ' times';
          tags.appendChild(t2);
        }
        if (e.attempts > 0) {
          var t3 = document.createElement('span');
          t3.className = 'bank-tag';
          t3.textContent = e.attempts + (e.attempts === 1 ? ' attempt' : ' attempts');
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
      $('puzzleArea').hidden = true;
      $('puzzleIntro').hidden = false;
      var n = C.BlunderBank.count();
      $('puzzleIntroText').textContent = n
        ? 'Pick a blunder from the list to replay that position and find the move you missed.'
        : 'Your bank is empty. Blunders from your Practice games will show up here.';
      $('btnStartBank').textContent = n ? 'Start with the newest' : 'Go to Practice';
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
      var opp = C.COLOR_NAMES[C.opposite(e.color)];
      $('puzzleTitle').textContent = 'Find a better move for ' + C.COLOR_NAMES[e.color];
      $('puzzleText').textContent = 'In your game you played ' + e.playedSan +
        (e.refutationSan ? ', and ' + opp + ' could answer ' + e.refutationSan + '.' : '.') +
        ' What should you play instead?';
      this.feedback('Your move. Take your time and check what each move allows.', 'neutral');
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
      $('btnPuzzleNext').textContent = this.phase === 'solved' && !hasNext ? 'All clear' : 'Next puzzle';
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
      this.board.setFen(this.game.fen());
      this.board.setMarks({ lastMove: { from: mv.from, to: mv.to }, check: checkSquare(this.game), hint: [] });
      this.board.setArrows([]);
      if (moveToUci(mv) === e.bestMove || ChessAPI.isCheckmate(this.game)) {
        this.solved(mv, moveToUci(mv) !== e.bestMove);
        return;
      }
      this.phase = 'checking';
      this.setButtons();
      this.feedback('Checking ' + mv.san + '…', 'busy');
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
          ? 'Not quite. After ' + mv.san + " you'd be about " + C.pawnsText(lost) + ' worse off than with the best move. Try again.'
          : mv.san + ' is close to the move you played in the game. Look for something stronger.', 'bad');
      } else {
        this.feedback(mv.san + " isn't the move we're looking for. Try again.", 'bad');
      }
      C.BlunderBank.recordAttempt(e.id, false);
      this.entry = C.BlunderBank.get(e.id) || e;
      this.phase = 'retry';
      this.setButtons();
      var self = this;
      this.timer = setTimeout(function () {
        if (epoch !== self.epoch) return;
        self.game.undo();
        self.board.setFen(self.game.fen());
        self.board.setMarks({ lastMove: null, check: checkSquare(self.game) });
        self.phase = 'solving';
        self.setButtons();
      }, 1500);
    },

    solved: function (mv, alternative) {
      clearTimeout(this.timer);
      var e = this.entry;
      this.phase = 'solved';
      C.BlunderBank.recordAttempt(e.id, true);
      this.feedback(alternative
        ? mv.san + ' works too! Stockfish preferred ' + e.bestSan + '. This one is cleared from your bank.'
        : 'Solved! ' + mv.san + ' was the move. This one is cleared from your bank.', 'good');
      this.setButtons();
      this.renderList();
    },

    hint: function () {
      if (!this.entry || this.hintShown) return;
      var best = uciToMove(this.entry.bestMove);
      var p = this.game.get(best.from);
      this.hintShown = true;
      this.board.setMarks({ hint: [best.from] });
      this.feedback('Hint: the move starts with your ' + (p ? C.NAMES[p.type] : 'piece') + ' on ' + best.from + '.', 'neutral');
      this.setButtons();
    },

    reveal: function () {
      if (!this.entry) return;
      clearTimeout(this.timer);
      this.epoch++;
      var e = this.entry;
      this.game = new window.Chess(e.fen);
      var best = uciToMove(e.bestMove);
      this.board.setFen(e.fen);
      this.board.setMarks({ lastMove: null, check: checkSquare(this.game), hint: [best.from] });
      this.board.setArrows([{ from: best.from, to: best.to, color: 'green' }]);
      this.phase = 'revealed';
      C.BlunderBank.recordAttempt(e.id, false);
      this.entry = C.BlunderBank.get(e.id) || e;
      this.feedback("Stockfish's move was " + e.bestSan + '. This puzzle stays in your bank so you can try it again later.', 'neutral');
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

  function relativeDay(ts) {
    var d = new Date(ts);
    var now = new Date();
    var startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    if (ts >= startOfToday) return 'today';
    if (ts >= startOfToday - 86400000) return 'yesterday';
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }

  function updateBankBadge() {
    var n = C.BlunderBank.count();
    ui.bankBadge.textContent = String(n);
    ui.bankBadge.hidden = n === 0;
    ui.bankBadge.setAttribute('aria-label', n + (n === 1 ? ' saved blunder' : ' saved blunders'));
  }

  /* ======================================================================== */
  /* Tabs                                                                     */
  /* ======================================================================== */

  function showTab(name) {
    var isBank = name === 'bank';
    if (isBank && (S.phase === 'warning' || S.phase === 'promoting')) return;
    ui.tabPlay.setAttribute('aria-selected', String(!isBank));
    ui.tabBank.setAttribute('aria-selected', String(isBank));
    ui.tabPlay.tabIndex = isBank ? -1 : 0;
    ui.tabBank.tabIndex = isBank ? 0 : -1;
    ui.viewPlay.hidden = isBank;
    ui.viewBank.hidden = !isBank;
    try {
      history.replaceState(null, '', isBank ? '#bank' : location.pathname + location.search);
    } catch (e) {
      /* file:// or sandboxed */
    }
    if (isBank) Bank.onShow();
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
      levelSelect: $('levelSelect'),
      levelBlurb: $('levelBlurb'),
      playAsHelp: $('playAsHelp'),
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
      viewBank: $('view-bank')
    };

    board = new BoardView($('board'), {
      interactive: function () { return S.phase === 'player'; },
      canMoveFrom: function (sq) {
        if (S.phase !== 'player' || S.game.turn() !== S.playerColor) return false;
        var p = S.game.get(sq);
        return !!p && p.color === S.playerColor;
      },
      legalTargets: function (sq) { return legalTargets(S.game, sq); },
      onMove: function (from, to) { onPlayerMove(from, to); }
    });

    LEVELS.forEach(function (lvl, i) {
      var opt = document.createElement('option');
      opt.value = String(i);
      opt.textContent = lvl.name;
      ui.levelSelect.appendChild(opt);
    });
    ui.levelSelect.value = String(S.levelIndex);
    ui.levelBlurb.textContent = LEVELS[S.levelIndex].blurb;
    ui.levelSelect.addEventListener('change', function () {
      S.levelIndex = parseInt(ui.levelSelect.value, 10) || 0;
      ui.levelBlurb.textContent = LEVELS[S.levelIndex].blurb;
      saveSettings();
      renderStrips();
      pushNotes([{ tone: 'tip', icon: '♞', text: 'Bot level set to ' + LEVELS[S.levelIndex].name + '. It applies from the next bot move.' }], 'Settings');
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
          ? "Coach Guard is on. I'll pause you before any move that loses more than 1.5 pawns."
          : 'Coach Guard is off. You play freely, and blunders still go to My Blunder Bank.'
      }], 'Settings');
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
        var fresh = S.game.history().length === 0 || S.phase === 'over';
        if (fresh && S.phase !== 'warning' && S.phase !== 'promoting') newGame();
        else updatePlayAsHelp();
      });
    });

    ui.btnNewGame.addEventListener('click', newGame);
    ui.btnTakeBack.addEventListener('click', takeBack);
    ui.btnHint.addEventListener('click', showHint);
    ui.btnFlip.addEventListener('click', flipBoard);

    ui.tabPlay.addEventListener('click', function () { showTab('play'); });
    ui.tabBank.addEventListener('click', function () { showTab('bank'); });
    [ui.tabPlay, ui.tabBank].forEach(function (tab) {
      tab.addEventListener('keydown', function (e) {
        if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
          e.preventDefault();
          var goBank = tab === ui.tabPlay;
          showTab(goBank ? 'bank' : 'play');
          (goBank ? ui.tabBank : ui.tabPlay).focus();
        }
      });
    });
    Array.prototype.forEach.call(document.querySelectorAll('[data-goto="play"]'), function (b) {
      b.addEventListener('click', function () { showTab('play'); });
    });

    pieceFallbackListeners.push(function () {
      renderStrips();
    });
  }

  function init() {
    loadSettings();
    bindUI();
    Bank.init();
    updateBankBadge();
    engine.start();
    if (!restoreGame()) newGame();
    if (location.hash === '#bank') showTab('bank');
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
