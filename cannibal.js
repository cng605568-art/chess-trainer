/*
 * cannibal.js: the Cannibal King game mode, and a small bot that plays it.
 *
 * Rules: normal chess, plus both kings may eat their own pieces. The king
 * moves onto one of its own pieces (any piece it could reach as a move),
 * the piece is gone, and the king keeps that piece's way of moving:
 *   knight -> the king can also jump like a knight
 *   bishop -> slide diagonally        rook -> slide in straight lines
 *   queen  -> both of those           pawn -> nothing new (just a snack)
 * Skills add up and last for the rest of the game. A king with skills also
 * attacks along them, so it can give check from a distance. Kings still may
 * never move into check, and castling works as usual until the king moves.
 *
 * chess.js and Stockfish don't know these rules, so this file has its own
 * move generator with the parts of the chess.js API the app uses (move, undo,
 * moves, history, fen, turn, get, board and the game-over checks).
 * fen() is a normal FEN for drawing the board; fenFull() adds the kings'
 * skills as a 7th field ("NR/-" = White's king jumps and slides straight).
 * Eating is written king-onto-own-piece in UCI (e1d1) and like a capture in
 * SAN (Kxd1).
 */
(function (root) {
  'use strict';

  var FILES = 'abcdefgh';
  var START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
  var KNIGHT = [[1, 2], [2, 1], [2, -1], [1, -2], [-1, -2], [-2, -1], [-2, 1], [-1, 2]];
  var DIAG = [[1, 1], [1, -1], [-1, 1], [-1, -1]];
  var STRAIGHT = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  var KING = DIAG.concat(STRAIGHT);
  var VALUE = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 0 };
  // What a skill is worth to the bot: a little more than the piece, so it is
  // happy to eat a knight, bishop or rook when nothing else is going on.
  var SKILL_VALUE = { n: 340, b: 350, r: 520 };

  function sqName(i) { return FILES.charAt(i & 7) + ((i >> 3) + 1); }
  function sqIndex(s) { return (+s.charAt(1) - 1) * 8 + FILES.indexOf(s.charAt(0)); }
  function colorOf(p) { return p === p.toUpperCase() ? 'w' : 'b'; }
  function typeOf(p) { return p.toLowerCase(); }
  function opp(c) { return c === 'w' ? 'b' : 'w'; }
  function onBoard(f, r) { return f >= 0 && f < 8 && r >= 0 && r < 8; }

  function noSkills() { return { w: { n: false, b: false, r: false }, b: { n: false, b: false, r: false } }; }

  function parseSkills(field) {
    var s = noSkills();
    var parts = String(field || '-/-').split('/');
    ['w', 'b'].forEach(function (c, i) {
      var t = (parts[i] || '-').toLowerCase();
      s[c].n = t.indexOf('n') !== -1;
      s[c].b = t.indexOf('b') !== -1 || t.indexOf('q') !== -1;
      s[c].r = t.indexOf('r') !== -1 || t.indexOf('q') !== -1;
    });
    return s;
  }

  function skillsText(sk, upper) {
    var t = (sk.n ? 'n' : '') + (sk.b ? 'b' : '') + (sk.r ? 'r' : '');
    return t ? (upper ? t.toUpperCase() : t) : '-';
  }

  /* ---------------------------------------------------------------------- */
  /* The game                                                               */
  /* ---------------------------------------------------------------------- */

  function CannibalGame(fen) {
    this.load(fen || START);
  }

  var P = CannibalGame.prototype;

  P.load = function (fen) {
    var parts = String(fen).trim().split(/\s+/);
    var b = new Array(64);
    for (var i = 0; i < 64; i++) b[i] = null;
    var rows = (parts[0] || '').split('/');
    for (var r = 0; r < 8; r++) {
      var f = 0;
      var row = rows[r] || '';
      for (var j = 0; j < row.length; j++) {
        var ch = row.charAt(j);
        if (/\d/.test(ch)) f += +ch;
        else { if (f < 8) b[(7 - r) * 8 + f] = ch; f++; }
      }
    }
    this.b = b;
    this.t = parts[1] === 'b' ? 'b' : 'w';
    var c = parts[2] || '-';
    this.castle = { K: c.indexOf('K') !== -1, Q: c.indexOf('Q') !== -1, k: c.indexOf('k') !== -1, q: c.indexOf('q') !== -1 };
    this.ep = parts[3] && parts[3] !== '-' ? sqIndex(parts[3]) : -1;
    this.half = parseInt(parts[4], 10) || 0;
    this.full = parseInt(parts[5], 10) || 1;
    this.sk = parseSkills(parts[6]);
    this.kings = { w: b.indexOf('K'), b: b.indexOf('k') };
    this.stack = [];
    this.keys = [this._key()];
    this.isCannibal = true;
    return true;
  };

  P._snap = function () {
    return {
      b: this.b.slice(), t: this.t, ep: this.ep, half: this.half, full: this.full,
      castle: { K: this.castle.K, Q: this.castle.Q, k: this.castle.k, q: this.castle.q },
      sk: { w: { n: this.sk.w.n, b: this.sk.w.b, r: this.sk.w.r }, b: { n: this.sk.b.n, b: this.sk.b.b, r: this.sk.b.r } },
      kings: { w: this.kings.w, b: this.kings.b }
    };
  };

  P._restore = function (s) {
    this.b = s.b; this.t = s.t; this.ep = s.ep; this.half = s.half; this.full = s.full;
    this.castle = s.castle; this.sk = s.sk; this.kings = s.kings;
  };

  P._key = function () {
    return this.fen().split(' ').slice(0, 4).join(' ') + ' ' + skillsText(this.sk.w, true) + '/' + skillsText(this.sk.b, false);
  };

  /** Is square `sq` attacked by side `by`? Includes that side's king skills. */
  P._attacked = function (sq, by) {
    var b = this.b;
    var f = sq & 7;
    var r = sq >> 3;
    var white = by === 'w';
    var sk = this.sk[by];
    var i, nf, nr, p;
    // pawns
    var pr = white ? r - 1 : r + 1;
    if (pr >= 0 && pr < 8) {
      for (i = -1; i <= 1; i += 2) {
        nf = f + i;
        if (nf >= 0 && nf < 8) { p = b[pr * 8 + nf]; if (p === (white ? 'P' : 'p')) return true; }
      }
    }
    // knights, and a king that has eaten a knight
    for (i = 0; i < 8; i++) {
      nf = f + KNIGHT[i][0]; nr = r + KNIGHT[i][1];
      if (!onBoard(nf, nr)) continue;
      p = b[nr * 8 + nf];
      if (p && colorOf(p) === by && (typeOf(p) === 'n' || (typeOf(p) === 'k' && sk.n))) return true;
    }
    // king steps
    for (i = 0; i < 8; i++) {
      nf = f + KING[i][0]; nr = r + KING[i][1];
      if (!onBoard(nf, nr)) continue;
      p = b[nr * 8 + nf];
      if (p === (white ? 'K' : 'k')) return true;
    }
    // lines: bishops, rooks, queens, and kings with those skills
    for (var d = 0; d < 8; d++) {
      var diag = d < 4;
      var df = KING[d][0];
      var dr = KING[d][1];
      nf = f + df; nr = r + dr;
      while (onBoard(nf, nr)) {
        p = b[nr * 8 + nf];
        if (p) {
          if (colorOf(p) === by) {
            var t = typeOf(p);
            if (t === 'q' || (diag && t === 'b') || (!diag && t === 'r')) return true;
            if (t === 'k' && ((diag && sk.b) || (!diag && sk.r))) return true;
          }
          break;
        }
        nf += df; nr += dr;
      }
    }
    return false;
  };

  P._inCheck = function (c) {
    c = c || this.t;
    var k = this.kings[c];
    return k >= 0 && this._attacked(k, opp(c));
  };

  function mv(color, from, to, piece, captured, flags, extra) {
    var m = { color: color, from: from, to: to, piece: piece, flags: flags };
    if (captured) m.captured = captured;
    if (extra) for (var k in extra) m[k] = extra[k];
    return m;
  }

  /** All moves that follow the piece rules, before checking whether the king is left in check. */
  P._pseudo = function () {
    var b = this.b;
    var c = this.t;
    var out = [];
    var white = c === 'w';
    for (var from = 0; from < 64; from++) {
      var p = b[from];
      if (!p || colorOf(p) !== c) continue;
      var t = typeOf(p);
      var f = from & 7;
      var r = from >> 3;
      var i, nf, nr, to, q;
      if (t === 'p') {
        var dir = white ? 1 : -1;
        var last = white ? 7 : 0;
        nr = r + dir;
        if (nr >= 0 && nr < 8) {
          to = nr * 8 + f;
          if (!b[to]) {
            if (nr === last) ['q', 'r', 'b', 'n'].forEach(function (pr) { out.push(mv(c, from, to, 'p', null, 'np', { promotion: pr })); });
            else out.push(mv(c, from, to, 'p', null, 'n'));
            var startRank = white ? 1 : 6;
            var to2 = (r + 2 * dir) * 8 + f;
            if (r === startRank && !b[to2]) out.push(mv(c, from, to2, 'p', null, 'b'));
          }
          for (i = -1; i <= 1; i += 2) {
            nf = f + i;
            if (nf < 0 || nf > 7) continue;
            to = nr * 8 + nf;
            q = b[to];
            if (q && colorOf(q) !== c) {
              if (nr === last) ['q', 'r', 'b', 'n'].forEach(function (pr) { out.push(mv(c, from, to, 'p', typeOf(q), 'cp', { promotion: pr })); });
              else out.push(mv(c, from, to, 'p', typeOf(q), 'c'));
            } else if (to === this.ep && !q) {
              out.push(mv(c, from, to, 'p', 'p', 'e'));
            }
          }
        }
        continue;
      }
      if (t === 'n') {
        for (i = 0; i < 8; i++) {
          nf = f + KNIGHT[i][0]; nr = r + KNIGHT[i][1];
          if (!onBoard(nf, nr)) continue;
          to = nr * 8 + nf; q = b[to];
          if (!q) out.push(mv(c, from, to, 'n', null, 'n'));
          else if (colorOf(q) !== c) out.push(mv(c, from, to, 'n', typeOf(q), 'c'));
        }
        continue;
      }
      if (t === 'b' || t === 'r' || t === 'q') {
        var dirs = t === 'b' ? DIAG : t === 'r' ? STRAIGHT : KING;
        for (i = 0; i < dirs.length; i++) {
          nf = f + dirs[i][0]; nr = r + dirs[i][1];
          while (onBoard(nf, nr)) {
            to = nr * 8 + nf; q = b[to];
            if (!q) out.push(mv(c, from, to, t, null, 'n'));
            else { if (colorOf(q) !== c) out.push(mv(c, from, to, t, typeOf(q), 'c')); break; }
            nf += dirs[i][0]; nr += dirs[i][1];
          }
        }
        continue;
      }
      if (t === 'k') this._kingMoves(from, out);
    }
    return out;
  };

  /** King moves: steps, skill moves, eating its own pieces, castling. */
  P._kingMoves = function (from, out) {
    var b = this.b;
    var c = this.t;
    var sk = this.sk[c];
    var f = from & 7;
    var r = from >> 3;
    var seen = {};
    function land(to, via) {
      if (seen[to]) return;
      var q = b[to];
      if (!q) { seen[to] = true; out.push(mv(c, from, to, 'k', null, 'n', via ? { via: via } : null)); return; }
      if (typeOf(q) === 'k') return;
      seen[to] = true;
      if (colorOf(q) !== c) out.push(mv(c, from, to, 'k', typeOf(q), 'c', via ? { via: via } : null));
      else out.push(mv(c, from, to, 'k', typeOf(q), 'c', { eat: true, via: via || null }));
    }
    var i, nf, nr;
    for (i = 0; i < 8; i++) {
      nf = f + KING[i][0]; nr = r + KING[i][1];
      if (onBoard(nf, nr)) land(nr * 8 + nf, null);
    }
    if (sk.n) {
      for (i = 0; i < 8; i++) {
        nf = f + KNIGHT[i][0]; nr = r + KNIGHT[i][1];
        if (onBoard(nf, nr)) land(nr * 8 + nf, 'n');
      }
    }
    var lines = (sk.b ? DIAG : []).concat(sk.r ? STRAIGHT : []);
    for (i = 0; i < lines.length; i++) {
      var df = lines[i][0];
      var dr = lines[i][1];
      nf = f + df; nr = r + dr;
      while (onBoard(nf, nr)) {
        var to = nr * 8 + nf;
        land(to, i < (sk.b ? 4 : 0) ? 'b' : 'r');
        if (b[to]) break;
        nf += df; nr += dr;
      }
    }
    // Castling: only from the starting square, with the rights still there.
    var white = c === 'w';
    var home = white ? 4 : 60;
    if (from === home && !this._inCheck(c)) {
      var them = opp(c);
      var rook = white ? 'R' : 'r';
      if (this.castle[white ? 'K' : 'k'] && b[home + 3] === rook && !b[home + 1] && !b[home + 2] &&
          !this._attacked(home + 1, them) && !this._attacked(home + 2, them)) {
        out.push(mv(c, from, home + 2, 'k', null, 'k'));
      }
      if (this.castle[white ? 'Q' : 'q'] && b[home - 4] === rook && !b[home - 1] && !b[home - 2] && !b[home - 3] &&
          !this._attacked(home - 1, them) && !this._attacked(home - 2, them)) {
        out.push(mv(c, from, home - 2, 'k', null, 'q'));
      }
    }
  };

  /** Play a move found by the generator (squares as numbers). */
  P._make = function (m) {
    this.stack.push({ snap: this._snap(), move: null });
    var b = this.b;
    var c = m.color;
    var piece = b[m.from];
    b[m.from] = null;
    if (m.flags.indexOf('e') !== -1) b[m.to + (c === 'w' ? -8 : 8)] = null;
    b[m.to] = m.promotion ? (c === 'w' ? m.promotion.toUpperCase() : m.promotion) : piece;
    if (m.flags === 'k' || m.flags === 'q') {
      var home = c === 'w' ? 4 : 60;
      var rf = m.flags === 'k' ? home + 3 : home - 4;
      var rt = m.flags === 'k' ? home + 1 : home - 1;
      b[rt] = b[rf];
      b[rf] = null;
    }
    if (m.eat) {
      var gain = this.sk[c];
      if (m.captured === 'n') gain.n = true;
      if (m.captured === 'b' || m.captured === 'q') gain.b = true;
      if (m.captured === 'r' || m.captured === 'q') gain.r = true;
    }
    if (m.piece === 'k') {
      this.kings[c] = m.to;
      if (c === 'w') { this.castle.K = false; this.castle.Q = false; } else { this.castle.k = false; this.castle.q = false; }
    }
    // A rook leaving or taken on its corner ends that castling right.
    [[0, 'Q'], [7, 'K'], [56, 'q'], [63, 'k']].forEach(function (cr) {
      if (m.from === cr[0] || m.to === cr[0]) this.castle[cr[1]] = false;
    }, this);
    this.ep = m.flags === 'b' ? (m.from + m.to) / 2 : -1;
    this.half = m.piece === 'p' || m.captured ? 0 : this.half + 1;
    if (c === 'b') this.full++;
    this.t = opp(c);
  };

  P._unmake = function () {
    var e = this.stack.pop();
    if (e) this._restore(e.snap);
    return e;
  };

  /** Legal moves for the side to move (internal form). */
  P._legal = function () {
    var c = this.t;
    var out = [];
    var list = this._pseudo();
    for (var i = 0; i < list.length; i++) {
      this._make(list[i]);
      if (!this._attacked(this.kings[c], opp(c))) out.push(list[i]);
      this._unmake();
    }
    return out;
  };

  P._san = function (m, legal) {
    var s;
    if (m.flags === 'k') s = 'O-O';
    else if (m.flags === 'q') s = 'O-O-O';
    else {
      var to = sqName(m.to);
      if (m.piece === 'p') {
        s = (m.captured ? FILES.charAt(m.from & 7) + 'x' : '') + to + (m.promotion ? '=' + m.promotion.toUpperCase() : '');
      } else {
        var dis = '';
        if (m.piece !== 'k') {
          var others = legal.filter(function (o) { return o !== m && o.piece === m.piece && o.to === m.to && o.from !== m.from; });
          if (others.length) {
            var sameFile = others.some(function (o) { return (o.from & 7) === (m.from & 7); });
            var sameRank = others.some(function (o) { return (o.from >> 3) === (m.from >> 3); });
            if (!sameFile) dis = FILES.charAt(m.from & 7);
            else if (!sameRank) dis = String((m.from >> 3) + 1);
            else dis = sqName(m.from);
          }
        }
        s = m.piece.toUpperCase() + dis + (m.captured ? 'x' : '') + to;
      }
    }
    this._make(m);
    if (this._inCheck()) s += this._legal().length ? '+' : '#';
    this._unmake();
    return s;
  };

  /** A move in the chess.js shape: squares as names, with SAN. */
  P._public = function (m, legal) {
    var out = { color: m.color, from: sqName(m.from), to: sqName(m.to), piece: m.piece, flags: m.flags, san: this._san(m, legal) };
    if (m.captured) out.captured = m.captured;
    if (m.promotion) out.promotion = m.promotion;
    if (m.eat) {
      out.eat = true;
      var sk = this.sk[m.color];
      var g = [];
      if (m.captured === 'n' && !sk.n) g.push('n');
      if ((m.captured === 'b' || m.captured === 'q') && !sk.b) g.push('b');
      if ((m.captured === 'r' || m.captured === 'q') && !sk.r) g.push('r');
      out.gained = g;
    }
    if (m.via) out.via = m.via;
    return out;
  };

  P.moves = function (opts) {
    opts = opts || {};
    var legal = this._legal();
    var self = this;
    if (opts.square) {
      var sq = sqIndex(opts.square);
      legal = legal.filter(function (m) { return m.from === sq; });
    }
    if (!opts.verbose) {
      var all = opts.square ? this._legal() : legal;
      return legal.map(function (m) { return self._san(m, all); });
    }
    var full = opts.square ? this._legal() : legal;
    return legal.map(function (m) { return self._public(m, full); });
  };

  P._find = function (move) {
    var legal = this._legal();
    if (typeof move === 'string') {
      var want = move.replace(/[+#?!]+$/, '').replace(/0/g, 'O');
      for (var i = 0; i < legal.length; i++) {
        if (this._san(legal[i], legal).replace(/[+#]$/, '') === want) return legal[i];
      }
      return null;
    }
    if (!move || !move.from || !move.to) return null;
    var from = sqIndex(move.from);
    var to = sqIndex(move.to);
    var promo = move.promotion || null;
    var hits = legal.filter(function (m) { return m.from === from && m.to === to; });
    if (!hits.length) return null;
    if (hits[0].promotion) return hits.filter(function (m) { return m.promotion === (promo || 'q'); })[0] || null;
    return hits[0];
  };

  P.move = function (move) {
    var m = this._find(move);
    if (!m) return null;
    var pub = this._public(m, this._legal());
    this._make(m);
    this.stack[this.stack.length - 1].move = pub;
    this.keys.push(this._key());
    return pub;
  };

  P.undo = function () {
    if (!this.stack.length) return null;
    var e = this._unmake();
    this.keys.pop();
    return e.move;
  };

  P.history = function (opts) {
    var list = this.stack.map(function (e) { return e.move; }).filter(Boolean);
    return opts && opts.verbose ? list : list.map(function (m) { return m.san; });
  };

  P.fen = function () {
    var rows = [];
    for (var r = 7; r >= 0; r--) {
      var s = '';
      var empty = 0;
      for (var f = 0; f < 8; f++) {
        var p = this.b[r * 8 + f];
        if (!p) { empty++; continue; }
        if (empty) { s += empty; empty = 0; }
        s += p;
      }
      rows.push(s + (empty || ''));
    }
    var c = (this.castle.K ? 'K' : '') + (this.castle.Q ? 'Q' : '') + (this.castle.k ? 'k' : '') + (this.castle.q ? 'q' : '');
    return [rows.join('/'), this.t, c || '-', this.ep >= 0 ? sqName(this.ep) : '-', this.half, this.full].join(' ');
  };

  /** The FEN plus the kings' skills, for saving and for starting again from here. */
  P.fenFull = function () {
    return this.fen() + ' ' + skillsText(this.sk.w, true) + '/' + skillsText(this.sk.b, false);
  };

  /** { n, b, r }: which skills this side's king has eaten. */
  P.skills = function (color) {
    var s = this.sk[color];
    return { n: s.n, b: s.b, r: s.r };
  };

  P.turn = function () { return this.t; };

  P.get = function (sq) {
    var p = this.b[sqIndex(sq)];
    return p ? { type: typeOf(p), color: colorOf(p) } : null;
  };

  P.board = function () {
    var out = [];
    for (var r = 7; r >= 0; r--) {
      var row = [];
      for (var f = 0; f < 8; f++) {
        var p = this.b[r * 8 + f];
        row.push(p ? { type: typeOf(p), color: colorOf(p) } : null);
      }
      out.push(row);
    }
    return out;
  };

  P.in_check = function () { return this._inCheck(); };
  P.in_checkmate = function () { return this._inCheck() && this._legal().length === 0; };
  P.in_stalemate = function () { return !this._inCheck() && this._legal().length === 0; };

  /** Only the usual dead positions, and only while neither king has eaten anything. */
  P.insufficient_material = function () {
    var sw = this.sk.w;
    var sb = this.sk.b;
    if (sw.n || sw.b || sw.r || sb.n || sb.b || sb.r) return false;
    var pieces = [];
    for (var i = 0; i < 64; i++) {
      var p = this.b[i];
      if (p && typeOf(p) !== 'k') pieces.push({ t: typeOf(p), shade: ((i & 7) + (i >> 3)) % 2 });
    }
    if (!pieces.length) return true;
    if (pieces.length === 1 && (pieces[0].t === 'n' || pieces[0].t === 'b')) return true;
    if (pieces.every(function (x) { return x.t === 'b'; })) {
      return pieces.every(function (x) { return x.shade === pieces[0].shade; });
    }
    return false;
  };

  P.in_threefold_repetition = function () {
    var now = this.keys[this.keys.length - 1];
    var n = 0;
    for (var i = 0; i < this.keys.length; i++) if (this.keys[i] === now) n++;
    return n >= 3;
  };

  P.in_draw = function () {
    return this.half >= 100 || this.in_stalemate() || this.insufficient_material() || this.in_threefold_repetition();
  };

  P.game_over = function () { return this.in_checkmate() || this.in_draw(); };

  /* ---------------------------------------------------------------------- */
  /* The bot: a small alpha-beta search that knows the cannibal rules       */
  /* ---------------------------------------------------------------------- */

  var MATE = 100000;
  var CENTER = [0, 1, 2, 3, 3, 2, 1, 0];

  /** Score from White's side: material, eaten skills, a little for good squares. */
  function evaluate(g) {
    var s = 0;
    for (var i = 0; i < 64; i++) {
      var p = g.b[i];
      if (!p) continue;
      var t = typeOf(p);
      var w = colorOf(p) === 'w';
      var v = VALUE[t];
      var f = i & 7;
      var r = i >> 3;
      if (t === 'p') v += (w ? r - 1 : 6 - r) * 6 + (f >= 2 && f <= 5 ? 4 : 0);
      else if (t === 'n' || t === 'b') v += (CENTER[f] + CENTER[r]) * 4;
      s += w ? v : -v;
    }
    // A roaming king matters more once the board empties, so skills are worth more in the endgame.
    var left = 0;
    for (var j = 0; j < 64; j++) if (g.b[j]) left += VALUE[typeOf(g.b[j])];
    var mult = 1 + 0.35 * (1 - Math.min(1, left / 8000));
    ['w', 'b'].forEach(function (c) {
      var sk = g.sk[c];
      var v = ((sk.n ? SKILL_VALUE.n : 0) + (sk.b ? SKILL_VALUE.b : 0) + (sk.r ? SKILL_VALUE.r : 0)) * mult;
      s += c === 'w' ? v : -v;
    });
    return Math.round(s);
  }

  function orderKey(m) {
    if (m.captured && !m.eat) return 1000 + VALUE[m.captured] * 10 - VALUE[m.piece] / 10;
    if (m.promotion) return 900;
    if (m.eat) return 100;
    return 0;
  }

  function sortMoves(list) {
    return list.sort(function (a, b) { return orderKey(b) - orderKey(a); });
  }

  function Search(g, deadline) {
    this.g = g;
    this.deadline = deadline;
    this.nodes = 0;
    this.stopped = false;
  }

  Search.prototype.timeUp = function () {
    if ((++this.nodes & 255) === 0 && Date.now() > this.deadline) this.stopped = true;
    return this.stopped;
  };

  Search.prototype.quiesce = function (alpha, beta, depth) {
    var g = this.g;
    var stand = evaluate(g) * (g.t === 'w' ? 1 : -1);
    if (depth <= 0 || this.timeUp()) return stand;
    if (stand >= beta) return stand;
    if (stand > alpha) alpha = stand;
    var list = sortMoves(g._legal().filter(function (m) { return m.captured && !m.eat; }));
    for (var i = 0; i < list.length; i++) {
      g._make(list[i]);
      var sc = -this.quiesce(-beta, -alpha, depth - 1);
      g._unmake();
      if (sc >= beta) return sc;
      if (sc > alpha) alpha = sc;
    }
    return alpha;
  };

  Search.prototype.negamax = function (depth, alpha, beta, ply) {
    var g = this.g;
    if (this.timeUp()) return 0;
    var list = g._legal();
    if (!list.length) return g._inCheck() ? -MATE + ply : 0;
    if (g.half >= 100) return 0;
    if (depth <= 0) return this.quiesce(alpha, beta, 4);
    sortMoves(list);
    var best = -Infinity;
    for (var i = 0; i < list.length; i++) {
      g._make(list[i]);
      var sc = -this.negamax(depth - 1, -beta, -alpha, ply + 1);
      g._unmake();
      if (this.stopped) return best === -Infinity ? 0 : best;
      if (sc > best) best = sc;
      if (sc > alpha) alpha = sc;
      if (alpha >= beta) break;
    }
    return best;
  };

  // Strength by bot level (Rookie .. Stockfish): depth, random slips, score noise.
  var LEVELS = [
    { depth: 1, random: 0.3, noise: 200 },
    { depth: 1, random: 0.12, noise: 90 },
    { depth: 2, random: 0.04, noise: 40 },
    { depth: 2, random: 0, noise: 15 },
    { depth: 3, random: 0, noise: 8 },
    { depth: 4, random: 0, noise: 0 }
  ];

  /**
   * Pick a move for the side to move. opts: { level (0-5), timeMs, rand }.
   * Returns { uci, san, score } or null when there is no legal move.
   */
  function bestMove(game, opts) {
    opts = opts || {};
    var rand = opts.rand || Math.random;
    var lvl = LEVELS[Math.max(0, Math.min(LEVELS.length - 1, opts.level === undefined ? 5 : opts.level))];
    var g = new CannibalGame(game.fenFull());
    var root = sortMoves(g._legal());
    if (!root.length) return null;
    var pick;
    if (lvl.random && rand() < lvl.random) {
      pick = root[Math.floor(rand() * root.length)];
      return { uci: uciOf(pick), san: g._san(pick, root), score: 0 };
    }
    var deadline = Date.now() + (opts.timeMs || 900);
    var scores = root.map(function () { return 0; });
    var done = false;
    for (var depth = 1; depth <= lvl.depth && !done; depth++) {
      var s = new Search(g, deadline);
      var next = [];
      var alpha = -Infinity;
      for (var i = 0; i < root.length; i++) {
        g._make(root[i]);
        // With noise the scores must be exact, so search every root move fully.
        var beta = lvl.noise || alpha === -Infinity ? Infinity : -alpha;
        var sc = -s.negamax(depth - 1, -Infinity, beta, 1);
        g._unmake();
        if (s.stopped) { done = true; break; }
        next.push(sc);
        if (sc > alpha) alpha = sc;
      }
      if (!done) scores = next;
      if (alpha >= MATE - 100) break; // found a mate
    }
    var bestIdx = 0;
    var bestScore = -Infinity;
    for (var j = 0; j < root.length; j++) {
      var noisy = scores[j] + (lvl.noise && Math.abs(scores[j]) < MATE - 100 ? (rand() - 0.5) * 2 * lvl.noise : 0);
      if (noisy > bestScore) { bestScore = noisy; bestIdx = j; }
    }
    pick = root[bestIdx];
    return { uci: uciOf(pick), san: g._san(pick, root), score: scores[bestIdx] };
  }

  function uciOf(m) {
    return sqName(m.from) + sqName(m.to) + (m.promotion || '');
  }

  root.Cannibal = { Game: CannibalGame, bestMove: bestMove, evaluate: evaluate, START: START };
})(typeof window !== 'undefined' ? window : globalThis);
