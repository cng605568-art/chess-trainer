/*
 * chess960.js: Chess960 (Fischer Random) on top of chess.js 0.10.
 *
 * chess.js only knows normal castling, so a Chess960 game keeps a chess.js
 * board with no castling rights and handles castling itself:
 *   - castling rights are the files of the rooks that may still castle,
 *     written Shredder-style in the FEN ("HAha" = both rooks on h and a),
 *   - a castling move is written as the king moving onto its own rook
 *     (e1h1), which is also how Stockfish writes it with UCI_Chess960 on,
 *   - after castling the king stands on the g- or c-file and the rook next
 *     to it on the f- or d-file, just like in normal chess.
 *
 * Game960 has the parts of the chess.js API that the app uses: move, undo,
 * moves, history, fen, turn, get and the game-over checks. fen() leaves the
 * castling field empty ("-") so the FEN works anywhere a normal one does;
 * fen960() gives the full FEN with castling rights.
 */
(function (root) {
  'use strict';

  var FILES = 'abcdefgh';

  function rows(placement) {
    // 8 arrays of 8 cells, rank 8 first, null for empty.
    return placement.split('/').map(function (row) {
      var out = [];
      for (var i = 0; i < row.length; i++) {
        var ch = row.charAt(i);
        if (/\d/.test(ch)) for (var n = +ch; n > 0; n--) out.push(null);
        else out.push(ch);
      }
      return out;
    });
  }

  function placementOf(grid) {
    return grid.map(function (row) {
      var s = '';
      var empty = 0;
      row.forEach(function (c) {
        if (!c) { empty++; return; }
        if (empty) { s += empty; empty = 0; }
        s += c;
      });
      return s + (empty || '');
    }).join('/');
  }

  function cell(grid, sq) {
    return grid[8 - +sq.charAt(1)][FILES.indexOf(sq.charAt(0))];
  }

  function setCell(grid, sq, v) {
    grid[8 - +sq.charAt(1)][FILES.indexOf(sq.charAt(0))] = v;
  }

  function homeRank(color) { return color === 'w' ? '1' : '8'; }

  function kingFile(grid, color) {
    var rank = homeRank(color);
    var k = color === 'w' ? 'K' : 'k';
    for (var f = 0; f < 8; f++) if (cell(grid, FILES.charAt(f) + rank) === k) return f;
    return -1;
  }

  /** Castling field (Shredder "HAha" or X-FEN "KQkq") -> { w: [files], b: [files] }. */
  function parseRights(field, placement) {
    var grid = rows(placement);
    var out = { w: [], b: [] };
    if (!field || field === '-') return out;
    field.split('').forEach(function (ch) {
      var color = ch === ch.toUpperCase() ? 'w' : 'b';
      var rank = homeRank(color);
      var rook = color === 'w' ? 'R' : 'r';
      var kf = kingFile(grid, color);
      if (kf < 0) return;
      var file = null;
      var up = ch.toUpperCase();
      if (up === 'K' || up === 'Q') {
        // X-FEN: the outermost rook on that side of the king.
        var step = up === 'K' ? -1 : 1;
        for (var f = up === 'K' ? 7 : 0; up === 'K' ? f > kf : f < kf; f += step) {
          if (cell(grid, FILES.charAt(f) + rank) === rook) { file = FILES.charAt(f); break; }
        }
      } else if (/[A-H]/.test(up)) {
        file = up.toLowerCase();
        if (cell(grid, file + rank) !== rook) file = null;
      }
      if (file && out[color].indexOf(file) === -1) out[color].push(file);
    });
    return out;
  }

  function rightsField(rights) {
    var s = rights.w.slice().sort().reverse().join('').toUpperCase() + rights.b.slice().sort().reverse().join('');
    return s || '-';
  }

  function copyRights(r) { return { w: r.w.slice(), b: r.b.slice() }; }

  function Game960(fen) {
    var parts = String(fen || '').trim().split(/\s+/);
    while (parts.length < 6) parts.push(['w', '-', '-', '0', '1'][parts.length - 1]);
    this.rights = parseRights(parts[2], parts[0]);
    parts[2] = '-';
    this.inner = new root.Chess(parts.join(' '));
    this.stack = [];
    this.isChess960 = true;
  }

  var P = Game960.prototype;

  P.fen = function () { return this.inner.fen(); };

  /** The FEN with Chess960 castling rights, for saving and for Stockfish. */
  P.fen960 = function () {
    var p = this.inner.fen().split(' ');
    p[2] = rightsField(this.rights);
    return p.join(' ');
  };

  P.turn = function () { return this.inner.turn(); };
  P.get = function (sq) { return this.inner.get(sq); };
  P.board = function () { return this.inner.board(); };
  P.in_check = function () { return this.inner.in_check(); };
  P.in_checkmate = function () { return this.inner.in_checkmate(); };
  P.insufficient_material = function () { return this.inner.insufficient_material(); };

  P.in_stalemate = function () {
    return this.inner.in_stalemate() && this._castles().length === 0;
  };

  P._key = function (fen) {
    var p = fen.split(' ');
    return p.slice(0, 4).join(' ');
  };

  P.in_threefold_repetition = function () {
    var now = this._key(this.fen960());
    var n = 1;
    for (var i = 0; i < this.stack.length; i++) {
      if (this._key(this.stack[i].fen960) === now) n++;
    }
    return n >= 3;
  };

  P.in_draw = function () {
    var half = parseInt(this.inner.fen().split(' ')[4], 10) || 0;
    return half >= 100 || this.in_stalemate() || this.insufficient_material() || this.in_threefold_repetition();
  };

  P.game_over = function () { return this.in_checkmate() || this.in_draw(); };

  /** Is `sq` attacked by the side not to move? Asks chess.js with the king put there. */
  P._attacked = function (grid, color, fromSq, sq) {
    var g = grid.map(function (r) { return r.slice(); });
    var k = cell(g, fromSq);
    setCell(g, fromSq, null);
    setCell(g, sq, k);
    var probe = new root.Chess(placementOf(g) + ' ' + color + ' - - 0 1');
    return probe.in_check();
  };

  /** Legal castling moves for the side to move. */
  P._castles = function () {
    var color = this.turn();
    var files = this.rights[color];
    if (!files.length || this.inner.in_check()) return [];
    var grid = rows(this.inner.fen().split(' ')[0]);
    var rank = homeRank(color);
    var kf = kingFile(grid, color);
    if (kf < 0) return [];
    var rook = color === 'w' ? 'R' : 'r';
    var out = [];
    var self = this;
    files.forEach(function (file) {
      var rf = FILES.indexOf(file);
      if (cell(grid, file + rank) !== rook) return;
      var side = rf > kf ? 'k' : 'q';
      var kt = side === 'k' ? 6 : 2;
      var rt = side === 'k' ? 5 : 3;
      var lo = Math.min(kf, rf, kt, rt);
      var hi = Math.max(kf, rf, kt, rt);
      for (var f = lo; f <= hi; f++) {
        if (f === kf || f === rf) continue;
        if (cell(grid, FILES.charAt(f) + rank)) return;
      }
      var kingFrom = FILES.charAt(kf) + rank;
      var step = kt > kf ? 1 : -1;
      for (var x = kf + step; step > 0 ? x <= kt : x >= kt; x += step) {
        if (self._attacked(grid, color, kingFrom, FILES.charAt(x) + rank)) return;
      }
      // The king must also be safe once the rook has moved (a rook can block a line).
      var after = grid.map(function (r) { return r.slice(); });
      setCell(after, kingFrom, null);
      setCell(after, file + rank, null);
      setCell(after, FILES.charAt(kt) + rank, color === 'w' ? 'K' : 'k');
      setCell(after, FILES.charAt(rt) + rank, rook);
      if (new root.Chess(placementOf(after) + ' ' + color + ' - - 0 1').in_check()) return;
      out.push({
        color: color,
        from: kingFrom,
        to: file + rank,
        piece: 'k',
        flags: side,
        san: side === 'k' ? 'O-O' : 'O-O-O',
        kingTo: FILES.charAt(kt) + rank,
        rookFrom: file + rank,
        rookTo: FILES.charAt(rt) + rank,
        castle: side
      });
    });
    return out;
  };

  /** Castling moves with + or # added, as chess.js does for SAN. */
  P._castlesWithChecks = function () {
    var self = this;
    return this._castles().map(function (m) {
      var g = new Game960(self.fen960());
      g._playCastle(m, true);
      if (g.inner.in_checkmate()) m.san += '#';
      else if (g.inner.in_check()) m.san += '+';
      return m;
    });
  };

  P.moves = function (opts) {
    opts = opts || {};
    // chess.js 0.10 returns nothing if a `square` key is present but empty.
    var list = this.inner.moves(opts.square ? { verbose: true, square: opts.square } : { verbose: true });
    var castles = this._castlesWithChecks().filter(function (m) { return !opts.square || m.from === opts.square; });
    list = list.concat(castles);
    return opts.verbose ? list : list.map(function (m) { return m.san; });
  };

  /** King squares the player can also drop the king on to castle (g1 or c1), when that isn't a normal move. */
  P.extraTargets = function (from) {
    var normal = this.inner.moves({ verbose: true, square: from }).map(function (m) { return m.to; });
    return this._castles()
      .filter(function (m) { return m.from === from && m.kingTo !== m.from && m.kingTo !== m.to && normal.indexOf(m.kingTo) === -1; })
      .map(function (m) { return m.kingTo; });
  };

  P._playCastle = function (m, quiet) {
    var p = this.inner.fen().split(' ');
    var grid = rows(p[0]);
    var king = cell(grid, m.from);
    var rook = cell(grid, m.rookFrom);
    setCell(grid, m.from, null);
    setCell(grid, m.rookFrom, null);
    setCell(grid, m.kingTo, king);
    setCell(grid, m.rookTo, rook);
    var next = [
      placementOf(grid),
      m.color === 'w' ? 'b' : 'w',
      '-',
      '-',
      String((parseInt(p[4], 10) || 0) + 1),
      String((parseInt(p[5], 10) || 1) + (m.color === 'b' ? 1 : 0))
    ].join(' ');
    if (!quiet) this.stack.push({ fen: this.inner.fen(), fen960: this.fen960(), rights: copyRights(this.rights), move: m });
    this.inner.load(next);
    this.rights[m.color] = [];
    return m;
  };

  P._findCastle = function (move) {
    var castles = this._castlesWithChecks();
    if (typeof move === 'string') {
      var s = move.replace(/[+#?!]+$/, '').replace(/0/g, 'O');
      if (s !== 'O-O' && s !== 'O-O-O') return null;
      var side = s === 'O-O' ? 'k' : 'q';
      return castles.filter(function (m) { return m.castle === side; })[0] || null;
    }
    if (!move || !move.from) return null;
    var hit = castles.filter(function (m) { return m.from === move.from && m.to === move.to; })[0];
    if (hit) return hit;
    // Dropping the king on g1 / c1 also castles, unless that is a normal king move.
    var normal = this.inner.moves({ verbose: true, square: move.from }).some(function (m) { return m.to === move.to; });
    if (normal) return null;
    return castles.filter(function (m) { return m.from === move.from && m.kingTo === move.to; })[0] || null;
  };

  P.move = function (move) {
    var castle = this._findCastle(move);
    if (castle) return this._playCastle(castle, false);
    var before = { fen: this.inner.fen(), fen960: this.fen960(), rights: copyRights(this.rights) };
    var res = this.inner.move(move);
    if (!res) return null;
    var opp = res.color === 'w' ? 'b' : 'w';
    if (res.piece === 'k') this.rights[res.color] = [];
    if (res.piece === 'r' && res.from.charAt(1) === homeRank(res.color)) {
      this.rights[res.color] = this.rights[res.color].filter(function (f) { return f !== res.from.charAt(0); });
    }
    if (res.captured === 'r' && res.to.charAt(1) === homeRank(opp)) {
      this.rights[opp] = this.rights[opp].filter(function (f) { return f !== res.to.charAt(0); });
    }
    before.move = res;
    this.stack.push(before);
    return res;
  };

  P.undo = function () {
    var e = this.stack.pop();
    if (!e) return null;
    this.inner.load(e.fen);
    this.rights = e.rights;
    return e.move;
  };

  P.history = function (opts) {
    var list = this.stack.map(function (e) { return e.move; });
    return opts && opts.verbose ? list : list.map(function (m) { return m.san; });
  };

  /** A random Chess960 start: bishops on opposite colours, king between the rooks. */
  function randomFen(rand) {
    rand = rand || Math.random;
    var pick = function (n) { return Math.floor(rand() * n); };
    for (;;) {
      var row = new Array(8);
      row[[0, 2, 4, 6][pick(4)]] = 'b';
      row[[1, 3, 5, 7][pick(4)]] = 'b';
      var free = function () { var f = []; for (var i = 0; i < 8; i++) if (!row[i]) f.push(i); return f; };
      var f = free(); row[f[pick(6)]] = 'q';
      f = free(); row[f[pick(5)]] = 'n';
      f = free(); row[f[pick(4)]] = 'n';
      f = free(); row[f[0]] = 'r'; row[f[1]] = 'k'; row[f[2]] = 'r';
      var back = row.join('');
      if (back === 'rnbqkbnr') continue; // that's normal chess
      var rights = FILES.charAt(f[2]) + FILES.charAt(f[0]);
      return back + '/pppppppp/8/8/8/8/PPPPPPPP/' + back.toUpperCase() + ' w ' + rights.toUpperCase() + rights + ' - 0 1';
    }
  }

  /** A FEN whose castling field names rook files (Shredder-FEN) is a Chess960 position. */
  function is960Fen(fen) {
    var c = String(fen || '').trim().split(/\s+/)[2] || '';
    return /[A-Ha-h]/.test(c);
  }

  function makeGame(fen) {
    if (fen && is960Fen(fen)) return new Game960(fen);
    return fen ? new root.Chess(fen) : new root.Chess();
  }

  /** The FEN to save or to start a new game from: keeps Chess960 castling rights. */
  function fullFen(game) {
    return game && game.fen960 ? game.fen960() : game.fen();
  }

  root.Chess960 = { Game960: Game960, makeGame: makeGame, fullFen: fullFen, randomFen: randomFen, is960Fen: is960Fen };
})(typeof window !== 'undefined' ? window : globalThis);
