/*
 * coach.js
 * ---------------------------------------------------------------------------
 * 1. Deterministic plain-English explanations of chess moves for beginners.
 *    Everything here is pure logic on FEN strings and chess.js-style move
 *    objects, so the same position always produces the same advice.
 * 2. The Blunder Bank: saves mistakes to localStorage so they can be replayed
 *    as puzzles later.
 *
 * Exposed as window.Coach.
 */
(function (global) {
  'use strict';

  var FILES = 'abcdefgh';
  var VALUES = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 100 };
  var NAMES = { p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king' };
  var COLOR_NAMES = { w: 'White', b: 'Black' };
  var GLYPHS = { k: '♚', q: '♛', r: '♜', b: '♝', n: '♞', p: '♟' };

  var MATE_CP = 10000;
  var CLAMP_CP = 1000;
  var BLUNDER_CP = 150;
  var MISTAKE_CP = 80;
  var INACCURACY_CP = 40;

  /* ---------------------------------------------------------------------- */
  /* Board helpers                                                          */
  /* ---------------------------------------------------------------------- */

  function sqToIdx(sq) {
    return (sq.charCodeAt(0) - 97) + (parseInt(sq.charAt(1), 10) - 1) * 8;
  }

  function idxToSq(i) {
    return FILES.charAt(i % 8) + (Math.floor(i / 8) + 1);
  }

  function opposite(color) {
    return color === 'w' ? 'b' : 'w';
  }

  function parseFen(fen) {
    var parts = String(fen || '').trim().split(/\s+/);
    var board = new Array(64);
    for (var k = 0; k < 64; k++) board[k] = null;
    var rows = (parts[0] || '').split('/');
    for (var r = 0; r < 8 && r < rows.length; r++) {
      var file = 0;
      var row = rows[r];
      for (var j = 0; j < row.length; j++) {
        var ch = row.charAt(j);
        if (ch >= '1' && ch <= '8') {
          file += parseInt(ch, 10);
        } else if (file < 8) {
          var color = ch === ch.toUpperCase() ? 'w' : 'b';
          board[(7 - r) * 8 + file] = { t: ch.toLowerCase(), c: color };
          file++;
        }
      }
    }
    return {
      board: board,
      turn: parts[1] === 'b' ? 'b' : 'w',
      castling: parts[2] || '-',
      ep: parts[3] || '-',
      halfmove: parseInt(parts[4], 10) || 0,
      fullmove: parseInt(parts[5], 10) || 1
    };
  }

  var KNIGHT_STEPS = [[1, 2], [2, 1], [2, -1], [1, -2], [-1, -2], [-2, -1], [-2, 1], [-1, 2]];
  var KING_STEPS = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];
  var DIAGONALS = [[1, 1], [1, -1], [-1, 1], [-1, -1]];
  var LINES = [[1, 0], [-1, 0], [0, 1], [0, -1]];

  /** Squares (indices) the piece on `idx` attacks or defends. */
  function attacksFrom(board, idx) {
    var p = board[idx];
    if (!p) return [];
    var f = idx % 8;
    var r = Math.floor(idx / 8);
    var out = [];
    function step(df, dr) {
      var nf = f + df;
      var nr = r + dr;
      if (nf >= 0 && nf < 8 && nr >= 0 && nr < 8) out.push(nr * 8 + nf);
    }
    function rays(dirs) {
      for (var d = 0; d < dirs.length; d++) {
        var nf = f + dirs[d][0];
        var nr = r + dirs[d][1];
        while (nf >= 0 && nf < 8 && nr >= 0 && nr < 8) {
          var j = nr * 8 + nf;
          out.push(j);
          if (board[j]) break;
          nf += dirs[d][0];
          nr += dirs[d][1];
        }
      }
    }
    var i;
    switch (p.t) {
      case 'p': {
        var dir = p.c === 'w' ? 1 : -1;
        step(-1, dir);
        step(1, dir);
        break;
      }
      case 'n':
        for (i = 0; i < KNIGHT_STEPS.length; i++) step(KNIGHT_STEPS[i][0], KNIGHT_STEPS[i][1]);
        break;
      case 'k':
        for (i = 0; i < KING_STEPS.length; i++) step(KING_STEPS[i][0], KING_STEPS[i][1]);
        break;
      case 'b':
        rays(DIAGONALS);
        break;
      case 'r':
        rays(LINES);
        break;
      case 'q':
        rays(DIAGONALS);
        rays(LINES);
        break;
      default:
        break;
    }
    return out;
  }

  /** Pieces of `color` that attack (or defend) square index `idx`. */
  function attackersOf(board, idx, color) {
    var res = [];
    for (var i = 0; i < 64; i++) {
      var p = board[i];
      if (!p || p.c !== color || i === idx) continue;
      if (attacksFrom(board, i).indexOf(idx) !== -1) res.push({ idx: i, sq: idxToSq(i), t: p.t });
    }
    return res;
  }

  function findKing(board, color) {
    for (var i = 0; i < 64; i++) {
      var p = board[i];
      if (p && p.t === 'k' && p.c === color) return i;
    }
    return -1;
  }

  /**
   * Pieces of `color` that can be won: attacked and either undefended or
   * attacked by something cheaper. Pins and x-rays are ignored, so callers
   * phrase the result as "looks" rather than "is".
   */
  function findHanging(board, color) {
    var opp = opposite(color);
    var list = [];
    for (var i = 0; i < 64; i++) {
      var p = board[i];
      if (!p || p.c !== color || p.t === 'k') continue;
      var attackers = attackersOf(board, i, opp);
      if (!attackers.length) continue;
      var defenders = attackersOf(board, i, color);
      // A king can only capture a piece nobody defends.
      var real = attackers.filter(function (a) { return a.t !== 'k' || defenders.length === 0; });
      if (!real.length) continue;
      var cheapest = Math.min.apply(null, real.map(function (a) { return VALUES[a.t]; }));
      if (defenders.length === 0 || cheapest < VALUES[p.t]) {
        list.push({
          sq: idxToSq(i),
          idx: i,
          t: p.t,
          value: VALUES[p.t],
          attackers: real,
          defenders: defenders,
          undefended: defenders.length === 0
        });
      }
    }
    list.sort(function (a, b) { return b.value - a.value; });
    return list;
  }

  /** Apply a move {from,to,promotion} to a parsed board copy (no legality). */
  function applyToBoard(board, move) {
    var b = board.slice();
    var from = sqToIdx(move.from);
    var to = sqToIdx(move.to);
    var piece = b[from];
    if (!piece) return b;
    b[from] = null;
    b[to] = move.promotion ? { t: move.promotion, c: piece.c } : piece;
    // Castling: move the rook too.
    if (piece.t === 'k' && Math.abs(to - from) === 2) {
      var rookFrom = to > from ? from + 3 : from - 4;
      var rookTo = to > from ? from + 1 : from - 1;
      b[rookTo] = b[rookFrom];
      b[rookFrom] = null;
    }
    // En passant: remove the passed pawn.
    if (piece.t === 'p' && (to % 8) !== (from % 8) && !board[to]) {
      var behind = piece.c === 'w' ? to - 8 : to + 8;
      b[behind] = null;
    }
    return b;
  }

  /** Material count per color, in pawns. */
  function material(board) {
    var m = { w: 0, b: 0 };
    for (var i = 0; i < 64; i++) {
      var p = board[i];
      if (p && p.t !== 'k') m[p.c] += VALUES[p.t];
    }
    return m;
  }

  var START_COUNTS = { p: 8, n: 2, b: 2, r: 2, q: 1 };

  /** Pieces each side has captured, e.g. { w: ['p','n'], b: ['p'] }. */
  function capturedPieces(fen) {
    var board = parseFen(fen).board;
    var counts = { w: { p: 0, n: 0, b: 0, r: 0, q: 0 }, b: { p: 0, n: 0, b: 0, r: 0, q: 0 } };
    for (var i = 0; i < 64; i++) {
      var p = board[i];
      if (p && p.t !== 'k') counts[p.c][p.t]++;
    }
    var out = { w: [], b: [] };
    ['q', 'r', 'b', 'n', 'p'].forEach(function (t) {
      // Promotions can push a count above the start; never show negatives.
      var missingBlack = Math.max(0, START_COUNTS[t] - counts.b[t]);
      var missingWhite = Math.max(0, START_COUNTS[t] - counts.w[t]);
      for (var k = 0; k < missingBlack; k++) out.w.push(t);
      for (var j = 0; j < missingWhite; j++) out.b.push(t);
    });
    var m = material(board);
    return { byWhite: out.w, byBlack: out.b, diff: m.w - m.b };
  }

  /* ---------------------------------------------------------------------- */
  /* Scores                                                                 */
  /* ---------------------------------------------------------------------- */

  /** Convert a UCI score (side-to-move view) to centipawns from White's view. */
  function uciScoreToWhiteCp(score, fen) {
    if (!score) return 0;
    var stm = String(fen).split(/\s+/)[1] === 'b' ? 'b' : 'w';
    var cp;
    if (score.type === 'mate') {
      var v = score.value;
      if (v === 0) cp = -MATE_CP;
      else if (v > 0) cp = MATE_CP - v;
      else cp = -MATE_CP - v;
    } else {
      cp = score.value;
    }
    return stm === 'w' ? cp : -cp;
  }

  function perspective(whiteCp, color) {
    return color === 'w' ? whiteCp : -whiteCp;
  }

  function clampCp(cp) {
    return Math.max(-CLAMP_CP, Math.min(CLAMP_CP, cp));
  }

  function isMateScore(cp) {
    return Math.abs(cp) >= MATE_CP - 500;
  }

  function mateDistance(cp) {
    return MATE_CP - Math.abs(cp);
  }

  /** "+1.4", "−0.3", "M3", "−M2". */
  function formatEval(cp) {
    if (isMateScore(cp)) {
      var n = mateDistance(cp);
      if (n === 0) return cp > 0 ? '1-0' : '0-1'; // checkmate already on the board
      return (cp < 0 ? '−' : '') + 'M' + n;
    }
    var pawns = cp / 100;
    if (Math.abs(pawns) < 0.05) return '0.0';
    return (pawns > 0 ? '+' : '−') + Math.abs(pawns).toFixed(1);
  }

  function pawnsText(cp) {
    var v = Math.abs(cp) / 100;
    var rounded = v >= 10 ? Math.round(v) : Math.round(v * 10) / 10;
    return rounded + (rounded === 1 ? ' pawn' : ' pawns');
  }

  /* ---------------------------------------------------------------------- */
  /* Beginner words: values as pieces, moves as sentences                   */
  /* ---------------------------------------------------------------------- */

  /** Size of a score swing, measured in pieces a beginner knows. */
  function worthStep(cp) {
    var a = Math.abs(cp) / 100;
    if (a < 0.75) return 'little';
    if (a < 1.5) return 'pawn';
    if (a < 2.5) return 'pawns2';
    if (a < 4) return 'minor';
    if (a < 6.5) return 'rook';
    if (a < 12) return 'queen';
    return 'more';
  }

  var LOSS_WORDS = {
    little: 'a tiny bit',
    pawn: 'a pawn',
    pawns2: 'two pawns',
    minor: 'a knight or a bishop',
    rook: 'a rook',
    queen: 'a queen',
    more: 'more than a queen'
  };

  var EXTRA_WORDS = {
    little: 'a tiny edge',
    pawn: 'an extra pawn',
    pawns2: 'two extra pawns',
    minor: 'an extra knight',
    rook: 'an extra rook',
    queen: 'an extra queen',
    more: 'more than an extra queen'
  };

  var LOSS_GLYPHS = { little: '−', pawn: '−♟', pawns2: '−♟♟', minor: '−♞', rook: '−♜', queen: '−♛', more: '−♛+' };

  /** "like giving away a knight or a bishop" */
  function lossLike(cp) {
    return 'like giving away ' + LOSS_WORDS[worthStep(cp)];
  }

  /** "an extra knight" */
  function extraWords(cp) {
    return EXTRA_WORDS[worthStep(cp)];
  }

  /** "−♞": a loss drawn as the piece it's worth. */
  function lossGlyphs(cp) {
    return LOSS_GLYPHS[worthStep(cp)];
  }

  /** Plain-English summary of who's ahead, from the player's side. */
  function describeEval(cpPlayer) {
    if (isMateScore(cpPlayer)) {
      var n = mateDistance(cpPlayer);
      if (cpPlayer > 0) {
        return n <= 1
          ? 'You can checkmate the bot right now! Look for it.'
          : 'You can force checkmate in ' + n + ' moves. Look at every check!';
      }
      return n <= 1
        ? 'Danger! The bot is threatening checkmate. Protect your king.'
        : 'Danger! The bot can force checkmate in ' + n + ' moves.';
    }
    var a = Math.abs(cpPlayer);
    if (a < 35) return "It's an even game.";
    if (cpPlayer > 0) {
      if (a < 120) return "You're a little ahead.";
      if (a < 400) return "You're ahead. It's like having " + extraWords(cpPlayer) + '.';
      return "You're winning! It's like having " + extraWords(cpPlayer) + '. Trade pieces and keep your king safe.';
    }
    if (a < 120) return 'The bot is a little ahead.';
    if (a < 400) return "The bot is ahead. It's like it has " + extraWords(cpPlayer) + '.';
    return "The bot is winning, like it has " + extraWords(cpPlayer) + ". Don't give up: bots make mistakes too.";
  }

  /** Two or three words for the Coach Guard banner: "Even", "Bot is winning". */
  function shortScore(cpPlayer) {
    if (isMateScore(cpPlayer)) return cpPlayer > 0 ? 'You can checkmate' : 'Bot can checkmate';
    var a = Math.abs(cpPlayer);
    if (a < 35) return 'Even';
    if (cpPlayer > 0) return a < 120 ? "You're a bit ahead" : a < 400 ? "You're ahead" : "You're winning";
    return a < 120 ? 'Bot is a bit ahead' : a < 400 ? 'Bot is ahead' : 'Bot is winning';
  }

  /** The small score chip: "Even", "You +1.5", "Bot +3.0", "Bot: mate in 2". */
  function scoreChip(cpPlayer) {
    if (isMateScore(cpPlayer)) {
      var n = mateDistance(cpPlayer);
      if (n === 0) return cpPlayer > 0 ? 'You won' : 'Bot won';
      return (cpPlayer > 0 ? 'You' : 'Bot') + ': mate in ' + n;
    }
    var a = Math.abs(cpPlayer) / 100;
    if (a < 0.35) return 'Even';
    return (cpPlayer > 0 ? 'You +' : 'Bot +') + a.toFixed(1);
  }

  function isCastle(m) {
    var f = (m && m.flags) || '';
    return f.indexOf('k') !== -1 || f.indexOf('q') !== -1;
  }

  function isEnPassant(m) {
    return ((m && m.flags) || '').indexOf('e') !== -1;
  }

  /**
   * A move as an action, without a subject, so it fits after "to" or "could":
   *   mine:  "move your knight from g1 to f3", "take the bot's pawn on e5 with your knight"
   *   bot's: "move its queen from d8 to h4", "take your rook on a1 with its bishop"
   */
  function moveAction(m, mine) {
    if (!m) return '';
    var own = mine ? 'your ' : 'its ';
    var other = mine ? "the bot's " : 'your ';
    var name = pieceName(m.piece);
    var promo = m.promotion ? ', turning it into ' + article(pieceName(m.promotion)) : '';
    if (isCastle(m)) return 'castle (' + own + 'king jumps to ' + m.to + ', where it is safer)';
    if (isEnPassant(m)) return 'take ' + other + 'pawn by moving ' + own + 'pawn to ' + m.to + ' (a special pawn capture called "en passant")';
    if (m.captured) return 'take ' + other + pieceName(m.captured) + ' on ' + m.to + ' with ' + own + name + promo;
    return 'move ' + own + name + ' from ' + m.from + ' to ' + m.to + promo;
  }

  /** Short label for the coach feed: "You: knight to f3", "Bot: bishop takes pawn on c4". */
  function moveTitle(m, mine) {
    if (!m) return mine ? 'You' : 'Bot';
    var who = mine ? 'You: ' : 'Bot: ';
    var name = pieceName(m.piece);
    var promo = m.promotion ? ', becomes ' + article(pieceName(m.promotion)) : '';
    if (isCastle(m)) return who + 'castled';
    if (isEnPassant(m)) return who + 'pawn takes pawn (en passant)';
    if (m.captured) return who + name + ' takes ' + pieceName(m.captured) + ' on ' + m.to + promo;
    return who + name + ' to ' + m.to + promo;
  }

  function capitalize(s) {
    return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
  }

  /* ---------------------------------------------------------------------- */
  /* Move explanations                                                      */
  /* ---------------------------------------------------------------------- */

  function tip(tone, icon, text, priority) {
    return { tone: tone, icon: icon, text: text, priority: priority || 0 };
  }

  function pieceName(t) {
    return NAMES[t] || 'piece';
  }

  function article(word) {
    return /^[aeiou]/i.test(word) ? 'an ' + word : 'a ' + word;
  }

  function hasCastled(history, color) {
    for (var i = 0; i < history.length; i++) {
      var m = history[i];
      if (m.color === color && m.flags && (m.flags.indexOf('k') !== -1 || m.flags.indexOf('q') !== -1)) return true;
    }
    return false;
  }

  function canStillCastle(castling, color) {
    if (!castling || castling === '-') return false;
    return color === 'w' ? /[KQ]/.test(castling) : /[kq]/.test(castling);
  }

  var CENTER = ['d4', 'e4', 'd5', 'e5'];
  var BACK_RANK_MINORS = {
    w: ['b1', 'g1', 'c1', 'f1'],
    b: ['b8', 'g8', 'c8', 'f8']
  };

  function finishTips(list, max) {
    // Drop the generic "good move" line when there is something more useful to say.
    if (list.some(function (t) { return t.priority > 5; })) {
      list = list.filter(function (t) { return t.priority !== 5; });
    }
    return list
      .sort(function (a, b) { return b.priority - a.priority; })
      .slice(0, max || 3)
      .map(function (t) { return { tone: t.tone, icon: t.icon, text: t.text }; });
  }

  function gameEndTip(ctx, moverIsPlayer) {
    if (ctx.isCheckmate) {
      return moverIsPlayer
        ? tip('good', '★', "Checkmate! The bot's king is trapped and can't escape, so you win. Well played!", 100)
        : tip('bad', '✕', 'Checkmate. Your king is trapped and can\'t escape, so the bot wins this one. Tap Take back to try a different idea, or start a new game.', 100);
    }
    if (ctx.drawReason === 'stalemate') {
      return tip('tip', '½', "Stalemate, so it's a draw. The player whose turn it is has no legal move, but their king isn't under attack.", 100);
    }
    if (ctx.drawReason === 'repetition') {
      return tip('tip', '½', "It's a draw: the same position came up three times.", 100);
    }
    if (ctx.drawReason === 'insufficient') {
      return tip('tip', '½', "It's a draw: there aren't enough pieces left for either side to checkmate.", 100);
    }
    if (ctx.drawReason === 'fifty') {
      return tip('tip', '½', "It's a draw by the 50-move rule: 50 moves in a row went by with no capture and no pawn move.", 100);
    }
    return null;
  }

  /**
   * Explain a move that was just played.
   * ctx: {
   *   move, fenBefore, fenAfter, mover: 'player'|'bot', playerColor,
   *   history (verbose moves incl. this one), prevMove,
   *   inCheck, isCheckmate, drawReason,
   *   verdict: { isBest, drop, best (move object) | null, isBlunder } | null, savedToBank
   * }
   */
  function describeMove(ctx) {
    var m = ctx.move;
    var tips = [];
    var isPlayer = ctx.mover === 'player';
    var me = ctx.playerColor;
    var oppColor = opposite(me);
    var before = parseFen(ctx.fenBefore);
    var after = parseFen(ctx.fenAfter);
    var moveNo = before.fullmove;
    var opening = moveNo <= 12;
    var glyph = GLYPHS[m.piece] || '♟';
    var flags = m.flags || '';

    var end = gameEndTip(ctx, isPlayer);
    if (end) tips.push(end);

    if (isPlayer) {
      // --- How good was the move? ---------------------------------------------
      var v = ctx.verdict;
      var better = v && v.best && !v.isBest ? ' Better was to ' + moveAction(v.best, true) + '.' : '';
      if (v && !ctx.isCheckmate) {
        if (v.isBlunder) {
          tips.push(tip('bad', '✕', 'Big mistake (a "blunder"): that was ' + lossLike(v.drop) + '.' + better +
            (ctx.savedToBank ? ' It\'s saved in My Blunder Bank so you can practice it later.' : ''), 90));
        } else if (v.drop > MISTAKE_CP) {
          tips.push(tip('warn', '!', 'Mistake: that was ' + lossLike(v.drop) + '.' + better, 80));
        } else if (v.drop > INACCURACY_CP) {
          tips.push(tip('tip', '?', 'OK move, but there was a slightly better one.' + better, 40));
        } else if (v.isBest) {
          tips.push(tip('good', '✓', 'Excellent! That\'s exactly the move the computer liked best.', 45));
        } else {
          tips.push(tip('good', '✓', "Good move. You didn't give anything away.", 5));
        }
      }

      // --- What happened on the board ---------------------------------------
      if (isCastle(m)) {
        tips.push(tip('good', '♚', 'You castled. In one move, your king hid in the corner, away from the middle, and a rook came out to help.', 60));
      }
      if (m.promotion) {
        tips.push(tip('good', GLYPHS[m.promotion], 'Your pawn reached the far end of the board and turned into ' + article(pieceName(m.promotion)) + '!', 70));
      }
      if (m.captured) {
        var prev = ctx.prevMove;
        var isRecapture = prev && prev.to === m.to && prev.captured;
        var text = isRecapture
          ? 'You took back on ' + m.to + '. You each took a piece, so this is called a trade.'
          : "You took the bot's " + pieceName(m.captured) + ' on ' + m.to + '.';
        tips.push(tip('tip', GLYPHS[m.captured], text, 30));
      }
      if (ctx.inCheck && !ctx.isCheckmate) {
        tips.push(tip('tip', '+', "Check! You're attacking the bot's king, so the bot has to protect it on its next move.", 35));
      }

      // --- Good habits for the first moves ---------------------------------------
      if (opening && m.piece === 'p' && CENTER.indexOf(m.to) !== -1) {
        tips.push(tip('good', '♟', 'Nice! A pawn in the middle of the board gives your pieces room to come out and takes space from the bot.', 25));
      }
      if (opening && (m.piece === 'n' || m.piece === 'b') && BACK_RANK_MINORS[me].indexOf(m.from) !== -1 && !m.captured) {
        if (m.piece === 'n' && (m.to.charAt(0) === 'a' || m.to.charAt(0) === 'h')) {
          var goodSquares = me === 'w' ? 'c3 or f3' : 'c6 or f6';
          tips.push(tip('tip', '♞', 'A knight on the edge of the board can reach fewer squares. Knights usually do better closer to the middle, like on ' + goodSquares + '.', 22));
        } else {
          tips.push(tip('good', glyph, 'Good! Bringing your knights and bishops out early is one of the best habits in chess.', 20));
        }
      }
      if (moveNo <= 6 && m.piece === 'q' && !m.captured) {
        tips.push(tip('warn', '♛', 'Careful bringing your queen out this early. The bot can chase her with smaller pieces, and you waste moves running away.', 28));
      }
      if (moveNo <= 15 && m.piece === 'k' && !isCastle(m)) {
        var kingIdx = findKing(before.board, me);
        var wasInCheck = kingIdx >= 0 && attackersOf(before.board, kingIdx, oppColor).length > 0;
        if (!wasInCheck && canStillCastle(before.castling, me)) {
          tips.push(tip('warn', '♚', "Moving your king this early means you can't castle anymore (castling is the special move that tucks your king safely in the corner).", 27));
        }
      }
      if (moveNo <= 8 && m.piece === 'p' && !m.captured && (m.from.charAt(0) === 'a' || m.from.charAt(0) === 'h')) {
        tips.push(tip('tip', '♟', 'Pawns on the edge (the a and h columns) rarely help early on. Middle pawns and bringing out your pieces usually do more.', 12));
      }
      return finishTips(tips, 3);
    }

    // ---------------- Bot move -----------------------------------------------
    if (isCastle(m)) {
      var castledAlready = hasCastled(ctx.history || [], me);
      tips.push(tip('tip', '♚', 'The bot castled: its king is now hiding safely in the corner.' +
        (!castledAlready && canStillCastle(after.castling, me) ? ' Have you castled yet? It\'s usually a good idea in your first 10 moves.' : ''), 40));
    }
    if (m.promotion) {
      tips.push(tip('warn', GLYPHS[m.promotion], "The bot's pawn reached the end of the board and turned into " + article(pieceName(m.promotion)) + '. Watch out for it!', 70));
    }
    if (m.captured) {
      var p = ctx.prevMove;
      var trade = p && p.to === m.to && p.captured;
      tips.push(tip(trade ? 'tip' : 'warn', GLYPHS[m.captured], trade
        ? 'The bot took back on ' + m.to + '. You each took a piece, so that was a trade.'
        : 'The bot took your ' + pieceName(m.captured) + ' on ' + m.to + '.', 50));
    }
    if (ctx.inCheck && !ctx.isCheckmate) {
      tips.push(tip('warn', '+', 'Check! Your king is under attack. You must save it now: move the king, put a piece in the way, or take the attacking piece.', 85));
    }
    if (!ctx.isCheckmate && !ctx.drawReason) {
      var hanging = findHanging(after.board, me);
      if (hanging.length) {
        var h = hanging[0];
        var attacker = h.attackers.slice().sort(function (a, b) { return VALUES[a.t] - VALUES[b.t]; })[0];
        var msg = h.undefended
          ? 'Watch out: your ' + pieceName(h.t) + ' on ' + h.sq + ' is under attack and nothing protects it. Move it or protect it.'
          : "Watch out: the bot's " + pieceName(attacker.t) + ' is attacking your ' + pieceName(h.t) + ' on ' + h.sq + '. Even though you could take back, ' +
            article(pieceName(attacker.t)) + ' is worth less than ' + article(pieceName(h.t)) + ', so you would lose out.';
        tips.push(tip('warn', GLYPHS[h.t], msg, 60));
      }
    }
    if (opening && m.piece === 'p' && CENTER.indexOf(m.to) !== -1 && !m.captured) {
      tips.push(tip('tip', '♟', 'The bot put a pawn in the middle of the board. Try to get your own pawns and pieces into the middle too.', 10));
    }
    return finishTips(tips, 3);
  }

  /**
   * After the bot moves and the computer has looked at the new position:
   * point out when the bot slipped up.
   * ctx: { prevEvalP, evalP, playerColor, bestMove: move object | null, fen }
   */
  function describeOpportunity(ctx) {
    if (typeof ctx.prevEvalP !== 'number' || typeof ctx.evalP !== 'number') return [];
    var gain = clampCp(ctx.evalP) - clampCp(ctx.prevEvalP);
    if (gain <= BLUNDER_CP || ctx.evalP < -200) return [];
    if (isMateScore(ctx.evalP) && ctx.evalP > 0) {
      return [tip('good', '★', "The bot made a big mistake! You can now trap its king (checkmate). Look at every move that attacks the king.", 0)];
    }
    var b = ctx.bestMove;
    if (b && b.captured) {
      var board = parseFen(ctx.fen).board;
      var target = board[sqToIdx(b.to)];
      var defended = target && attackersOf(board, sqToIdx(b.to), target.c).length > 0;
      if (!defended) {
        return [tip('good', GLYPHS[b.captured], "The bot made a mistake! Its " + pieceName(b.captured) + ' on ' + b.to + " has no protection. Can you take it for free?", 0)];
      }
    }
    return [tip('good', '!', "The bot made a mistake, so there's a chance for you. Look at every check, every capture and every attack.", 0)];
  }

  /**
   * Explain why a player move is a blunder, for the Coach Guard banner.
   * ctx: {
   *   move, fenBefore, fenAfter, playerColor, drop, pAfter,
   *   refutation: { from, to, san, captured, piece, promotion, flags } | null,
   *   opponentMateIn: number | null, terminal: 'stalemate'|'repetition'|'insufficient'|'fifty'|null
   * }
   * returns { message, dangerSquares: [], threat: {from,to} | null }
   */
  function explainBlunder(ctx) {
    var me = ctx.playerColor;
    var oppColor = opposite(me);
    var m = ctx.move;
    var before = parseFen(ctx.fenBefore);
    var after = parseFen(ctx.fenAfter);
    var ref = ctx.refutation;
    var cost = lossLike(ctx.drop);

    if (ctx.terminal) {
      var oppKing = findKing(after.board, oppColor);
      var reason = {
        stalemate: "Careful! After this move the bot has no legal move, but its king isn't under attack. That's called stalemate, and the game would end in a draw even though you're ahead.",
        repetition: "This repeats the same position for the third time, so the game would end in a draw even though you're ahead.",
        insufficient: "After this, there wouldn't be enough pieces left to checkmate, so the game would end in a draw.",
        fifty: 'This would end the game in a draw by the 50-move rule (50 moves with no capture and no pawn move).'
      }[ctx.terminal] || 'This would end the game in a draw while you are ahead.';
      return { message: reason, dangerSquares: oppKing >= 0 ? [idxToSq(oppKing)] : [], threat: null };
    }

    if (!ref) {
      return { message: 'This move is ' + cost + '. Look again for a safer move.', dangerSquares: [m.to], threat: null };
    }

    var threat = { from: ref.from, to: ref.to };
    var botReply = moveAction(ref, false);

    if (ctx.opponentMateIn) {
      var myKing = findKing(after.board, me);
      var squares = [ref.to];
      if (myKing >= 0 && idxToSq(myKing) !== ref.to) squares.push(idxToSq(myKing));
      var mateMsg = ctx.opponentMateIn <= 1
        ? 'Danger! After this, the bot can checkmate you right away: it would ' + botReply + ', and your king could not escape.'
        : 'Danger! This lets the bot trap your king (checkmate) in ' + ctx.opponentMateIn + ' moves. Its first move would be to ' + botReply + '.';
      return { message: mateMsg, dangerSquares: squares, threat: threat };
    }

    if (ref.captured) {
      var capturedName = pieceName(ref.captured);
      var msg;
      if (ref.to === m.to) {
        var movedName = pieceName(m.promotion || m.piece);
        msg = 'Your ' + movedName + ' on ' + m.to + " isn't safe there. The bot can take it with its " + pieceName(ref.piece) + '.';
      } else {
        msg = 'The bot could take your ' + capturedName + ' on ' + ref.to + ' with its ' + pieceName(ref.piece) + '.';
        var wasGuard = attacksFrom(before.board, sqToIdx(m.from)).indexOf(sqToIdx(ref.to)) !== -1;
        if (wasGuard) msg += ' Your ' + pieceName(m.piece) + ' was protecting it before this move.';
      }
      return { message: msg + ' That would be ' + cost + '.', dangerSquares: [ref.to], threat: threat };
    }

    // Fork: the reply attacks two or more valuable pieces at once.
    var boardAfterRef = applyToBoard(after.board, ref);
    var forker = boardAfterRef[sqToIdx(ref.to)];
    if (forker) {
      var hits = attacksFrom(boardAfterRef, sqToIdx(ref.to))
        .map(function (i) { return { i: i, p: boardAfterRef[i] }; })
        .filter(function (x) {
          if (!x.p || x.p.c !== me) return false;
          if (x.p.t === 'k') return true;
          if (VALUES[x.p.t] < 3) return false;
          var defended = attackersOf(boardAfterRef, x.i, me).length > 0;
          return VALUES[x.p.t] > VALUES[forker.t] || !defended;
        });
      if (hits.length >= 2) {
        var names = hits.slice(0, 2).map(function (x) { return pieceName(x.p.t); });
        var squaresHit = [ref.to].concat(hits.slice(0, 2).map(function (x) { return idxToSq(x.i); }));
        return {
          message: 'The bot could move its ' + pieceName(forker.t) + ' to ' + ref.to + ', attacking your ' + names[0] + ' and your ' + names[1] +
            ' at the same time. This trick is called a "fork": you can only save one of them.',
          dangerSquares: squaresHit,
          threat: threat
        };
      }
    }

    // A piece left without protection by this move.
    var hangingNow = findHanging(after.board, me);
    var hangingBefore = findHanging(before.board, me).map(function (h) { return h.sq; });
    var newlyLoose = hangingNow.filter(function (h) { return hangingBefore.indexOf(h.sq) === -1 && h.sq !== m.to; });
    if (newlyLoose.length) {
      var h = newlyLoose[0];
      return {
        message: 'Moving your ' + pieceName(m.piece) + ' leaves your ' + pieceName(h.t) + ' on ' + h.sq + ' without protection. The bot\'s best answer would be to ' + botReply + '.',
        dangerSquares: [h.sq],
        threat: threat
      };
    }

    if (typeof ctx.pAfter === 'number' && ctx.pAfter >= 200) {
      return {
        message: "You're still ahead, but this move throws away a lot of your lead. That's " + cost + '. There is a much better move.',
        dangerSquares: [ref.to],
        threat: threat
      };
    }

    return {
      message: 'This lets the bot ' + botReply + '. That would be ' + cost + '.',
      dangerSquares: [ref.to],
      threat: threat
    };
  }

  /* ---------------------------------------------------------------------- */
  /* Blunder Bank (localStorage)                                            */
  /* ---------------------------------------------------------------------- */

  var BANK_KEY = 'chessTrainer.blunderBank.v1';
  var STATS_KEY = 'chessTrainer.blunderStats.v1';
  var MAX_ENTRIES = 300;
  var memoryStore = {};

  function storageGet(key) {
    try {
      return global.localStorage.getItem(key);
    } catch (e) {
      return Object.prototype.hasOwnProperty.call(memoryStore, key) ? memoryStore[key] : null;
    }
  }

  function storageSet(key, value) {
    try {
      global.localStorage.setItem(key, value);
      return true;
    } catch (e) {
      memoryStore[key] = value;
      return false;
    }
  }

  function makeId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function positionKey(fen) {
    return String(fen).split(/\s+/).slice(0, 4).join(' ');
  }

  function isValidEntry(e) {
    return e && typeof e === 'object' && typeof e.id === 'string' && typeof e.fen === 'string' &&
      typeof e.bestMove === 'string' && /^[a-h][1-8][a-h][1-8][qrbn]?$/.test(e.bestMove) &&
      (e.color === 'w' || e.color === 'b');
  }

  function emitChange() {
    try {
      global.dispatchEvent(new CustomEvent('blunderbank:change'));
    } catch (e) {
      /* non-browser environment */
    }
  }

  var BlunderBank = {
    key: BANK_KEY,

    _read: function () {
      var raw = storageGet(BANK_KEY);
      if (!raw) return [];
      try {
        var list = JSON.parse(raw);
        return Array.isArray(list) ? list.filter(isValidEntry) : [];
      } catch (e) {
        return [];
      }
    },

    _write: function (list) {
      storageSet(BANK_KEY, JSON.stringify(list));
      emitChange();
    },

    /** Newest first. */
    list: function () {
      return this._read().sort(function (a, b) { return b.createdAt - a.createdAt; });
    },

    count: function () {
      return this._read().length;
    },

    get: function (id) {
      var list = this._read();
      for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
      return null;
    },

    /**
     * Save a blunder. Same position + same wrong move is stored once.
     * data: { fen, color, bestMove, bestSan, playedMove, playedSan, refutationSan,
     *         evalBefore, evalAfter, drop, moveNumber, caught, gameId }
     */
    add: function (data) {
      var list = this._read();
      var key = positionKey(data.fen) + '|' + data.playedMove;
      for (var i = 0; i < list.length; i++) {
        if (list[i].key === key) {
          // Retrying the same mistake within one game doesn't count as a repeat.
          if (!data.gameId || list[i].lastGameId !== data.gameId) {
            list[i].timesBlundered = (list[i].timesBlundered || 1) + 1;
          }
          list[i].lastGameId = data.gameId || '';
          list[i].lastSeenAt = Date.now();
          list[i].caught = !!data.caught;
          this._write(list);
          return { entry: list[i], isNew: false };
        }
      }
      var entry = {
        id: makeId(),
        key: key,
        fen: data.fen,
        color: data.color,
        bestMove: data.bestMove,
        bestSan: data.bestSan || data.bestMove,
        playedMove: data.playedMove,
        playedSan: data.playedSan || data.playedMove,
        refutationSan: data.refutationSan || '',
        evalBefore: Math.round(data.evalBefore || 0),
        evalAfter: Math.round(data.evalAfter || 0),
        drop: Math.round(data.drop || 0),
        moveNumber: data.moveNumber || 1,
        caught: !!data.caught,
        gameId: data.gameId || '',
        lastGameId: data.gameId || '',
        createdAt: Date.now(),
        lastSeenAt: Date.now(),
        timesBlundered: 1,
        attempts: 0
      };
      list.push(entry);
      if (list.length > MAX_ENTRIES) {
        list.sort(function (a, b) { return a.createdAt - b.createdAt; });
        list = list.slice(list.length - MAX_ENTRIES);
      }
      this._write(list);
      return { entry: entry, isNew: true };
    },

    update: function (id, patch) {
      var list = this._read();
      for (var i = 0; i < list.length; i++) {
        if (list[i].id === id) {
          for (var k in patch) if (Object.prototype.hasOwnProperty.call(patch, k)) list[i][k] = patch[k];
          this._write(list);
          return list[i];
        }
      }
      return null;
    },

    remove: function (id) {
      var list = this._read();
      var next = list.filter(function (e) { return e.id !== id; });
      if (next.length !== list.length) this._write(next);
      return next.length !== list.length;
    },

    recordAttempt: function (id, solved) {
      var e = this.get(id);
      if (!e) return null;
      var stats = this.stats();
      stats.attempts += 1;
      if (solved) {
        stats.cleared += 1;
        this._saveStats(stats);
        this.remove(id);
        return null;
      }
      this._saveStats(stats);
      return this.update(id, { attempts: (e.attempts || 0) + 1, lastAttemptAt: Date.now() });
    },

    clear: function () {
      this._write([]);
    },

    stats: function () {
      var raw = storageGet(STATS_KEY);
      var s = { cleared: 0, attempts: 0 };
      if (raw) {
        try {
          var parsed = JSON.parse(raw);
          s.cleared = parseInt(parsed.cleared, 10) || 0;
          s.attempts = parseInt(parsed.attempts, 10) || 0;
        } catch (e) {
          /* keep defaults */
        }
      }
      return s;
    },

    _saveStats: function (s) {
      storageSet(STATS_KEY, JSON.stringify(s));
    }
  };

  global.Coach = {
    VALUES: VALUES,
    NAMES: NAMES,
    COLOR_NAMES: COLOR_NAMES,
    GLYPHS: GLYPHS,
    MATE_CP: MATE_CP,
    CLAMP_CP: CLAMP_CP,
    BLUNDER_CP: BLUNDER_CP,
    MISTAKE_CP: MISTAKE_CP,
    INACCURACY_CP: INACCURACY_CP,
    sqToIdx: sqToIdx,
    idxToSq: idxToSq,
    opposite: opposite,
    parseFen: parseFen,
    attacksFrom: attacksFrom,
    attackersOf: attackersOf,
    findKing: findKing,
    findHanging: findHanging,
    applyToBoard: applyToBoard,
    capturedPieces: capturedPieces,
    uciScoreToWhiteCp: uciScoreToWhiteCp,
    perspective: perspective,
    clampCp: clampCp,
    isMateScore: isMateScore,
    mateDistance: mateDistance,
    formatEval: formatEval,
    pawnsText: pawnsText,
    describeEval: describeEval,
    shortScore: shortScore,
    scoreChip: scoreChip,
    lossLike: lossLike,
    extraWords: extraWords,
    lossGlyphs: lossGlyphs,
    moveAction: moveAction,
    moveTitle: moveTitle,
    capitalize: capitalize,
    describeMove: describeMove,
    describeOpportunity: describeOpportunity,
    explainBlunder: explainBlunder,
    pieceName: pieceName,
    BlunderBank: BlunderBank
  };
})(typeof window !== 'undefined' ? window : globalThis);
