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

  /** Plain-English summary of an evaluation from the player's side. */
  function describeEval(cpPlayer, opponentName) {
    if (isMateScore(cpPlayer)) {
      var n = mateDistance(cpPlayer);
      if (cpPlayer > 0) return n <= 1 ? 'You can deliver checkmate right now.' : 'You have a forced checkmate in ' + n + '.';
      return n <= 1 ? opponentName + ' is threatening checkmate.' : opponentName + ' has a forced checkmate in ' + n + '.';
    }
    var a = Math.abs(cpPlayer);
    if (a < 35) return 'The position is roughly equal.';
    if (cpPlayer > 0) {
      if (a < 120) return "You're slightly better.";
      if (a < 400) return "You're ahead by about " + pawnsText(cpPlayer) + '.';
      return "You're winning. Keep it simple and stay alert.";
    }
    if (a < 120) return opponentName + ' is slightly better.';
    if (a < 400) return "You're behind by about " + pawnsText(cpPlayer) + '.';
    return opponentName + ' is winning, but games can still turn around.';
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
    // Drop the generic "solid move" line when there is something more useful to say.
    if (list.some(function (t) { return t.priority > 5; })) {
      list = list.filter(function (t) { return t.priority !== 5; });
    }
    return list
      .sort(function (a, b) { return b.priority - a.priority; })
      .slice(0, max || 3)
      .map(function (t) { return { tone: t.tone, icon: t.icon, text: t.text }; });
  }

  function gameEndTip(ctx, moverIsPlayer) {
    var opp = COLOR_NAMES[opposite(ctx.playerColor)];
    if (ctx.isCheckmate) {
      return moverIsPlayer
        ? tip('good', '★', 'Checkmate! You won the game. Well played.', 100)
        : tip('bad', '✕', 'Checkmate. ' + opp + ' wins this one. Use Take back to try another idea, or start a new game.', 100);
    }
    if (ctx.drawReason === 'stalemate') {
      return tip('tip', '½', 'Stalemate: the side to move has no legal moves but is not in check, so the game is a draw.', 100);
    }
    if (ctx.drawReason === 'repetition') {
      return tip('tip', '½', 'Draw by repetition: the same position appeared three times.', 100);
    }
    if (ctx.drawReason === 'insufficient') {
      return tip('tip', '½', 'Draw: neither side has enough pieces left to deliver checkmate.', 100);
    }
    if (ctx.drawReason === 'fifty') {
      return tip('tip', '½', 'Draw by the 50-move rule: 50 moves passed with no capture or pawn move.', 100);
    }
    return null;
  }

  /**
   * Explain a move that was just played.
   * ctx: {
   *   move, fenBefore, fenAfter, mover: 'player'|'bot', playerColor,
   *   history (verbose moves incl. this one), prevMove,
   *   inCheck, isCheckmate, drawReason,
   *   verdict: { isBest, drop, bestSan, isBlunder } | null, savedToBank
   * }
   */
  function describeMove(ctx) {
    var m = ctx.move;
    var tips = [];
    var isPlayer = ctx.mover === 'player';
    var me = ctx.playerColor;
    var oppColor = opposite(me);
    var oppName = COLOR_NAMES[oppColor];
    var before = parseFen(ctx.fenBefore);
    var after = parseFen(ctx.fenAfter);
    var moveNo = before.fullmove;
    var opening = moveNo <= 12;
    var glyph = GLYPHS[m.piece] || '♟';
    var flags = m.flags || '';

    var end = gameEndTip(ctx, isPlayer);
    if (end) tips.push(end);

    if (isPlayer) {
      // --- Engine verdict -------------------------------------------------
      var v = ctx.verdict;
      if (v && !ctx.isCheckmate) {
        if (v.isBlunder) {
          tips.push(tip('bad', '✕', 'Blunder: that cost about ' + pawnsText(v.drop) + '. ' +
            (v.bestSan ? v.bestSan + ' was the move to find.' : '') +
            (ctx.savedToBank ? ' Saved to My Blunder Bank.' : ''), 90));
        } else if (v.drop > MISTAKE_CP) {
          tips.push(tip('warn', '!', 'Mistake: you gave up about ' + pawnsText(v.drop) + '.' +
            (v.bestSan ? ' ' + v.bestSan + ' was stronger.' : ''), 80));
        } else if (v.drop > INACCURACY_CP) {
          tips.push(tip('tip', '?', 'Playable' + (v.bestSan ? ', though ' + v.bestSan + ' was a little better.' : ', but there was a slightly better move.'), 40));
        } else if (v.isBest) {
          tips.push(tip('good', '✓', "That's Stockfish's top choice. Well spotted!", 45));
        } else {
          tips.push(tip('good', '✓', 'Solid move. Your position held steady.', 5));
        }
      }

      // --- What happened on the board ---------------------------------------
      if (flags.indexOf('k') !== -1 || flags.indexOf('q') !== -1) {
        var side = flags.indexOf('k') !== -1 ? 'kingside' : 'queenside';
        tips.push(tip('good', '♚', 'You castled ' + side + '. Your king is tucked away and your rook can join the game.', 60));
      }
      if (m.promotion) {
        tips.push(tip('good', GLYPHS[m.promotion], 'Your pawn reached the last row and became ' + article(pieceName(m.promotion)) + '!', 70));
      }
      if (m.captured) {
        var prev = ctx.prevMove;
        var isRecapture = prev && prev.to === m.to && prev.captured;
        var text = isRecapture
          ? 'You recaptured on ' + m.to + ', winning back the material.'
          : 'You captured ' + oppName + "'s " + pieceName(m.captured) + ' on ' + m.to + '.';
        tips.push(tip('tip', GLYPHS[m.captured], text, 30));
      }
      if (ctx.inCheck && !ctx.isCheckmate) {
        tips.push(tip('tip', '+', 'Check! ' + oppName + "'s king is under attack, so they must deal with it right away.", 35));
      }

      // --- Opening habits --------------------------------------------------------
      if (opening && m.piece === 'p' && CENTER.indexOf(m.to) !== -1) {
        tips.push(tip('good', '♟', 'Great central pawn. Pawns in the center give your pieces room and make it harder for ' + oppName + ' to get comfortable.', 25));
      }
      if (opening && (m.piece === 'n' || m.piece === 'b') && BACK_RANK_MINORS[me].indexOf(m.from) !== -1 && !m.captured) {
        if (m.piece === 'n' && (m.to.charAt(0) === 'a' || m.to.charAt(0) === 'h')) {
          tips.push(tip('tip', '♞', 'Knights on the edge reach fewer squares. Try c3/f3 (or c6/f6) so it helps control the center.', 22));
        } else {
          tips.push(tip('good', glyph, 'Good development. Getting your knights and bishops off the back row early is one of the best opening habits.', 20));
        }
      }
      if (moveNo <= 6 && m.piece === 'q' && !m.captured) {
        tips.push(tip('warn', '♛', 'Careful with early queen trips. ' + oppName + ' can chase her while developing pieces, and you lose time.', 28));
      }
      if (moveNo <= 15 && m.piece === 'k' && flags.indexOf('k') === -1 && flags.indexOf('q') === -1) {
        var kingIdx = findKing(before.board, me);
        var wasInCheck = kingIdx >= 0 && attackersOf(before.board, kingIdx, oppColor).length > 0;
        if (!wasInCheck && canStillCastle(before.castling, me)) {
          tips.push(tip('warn', '♚', 'Moving your king this early gives up castling. Castling first usually keeps the king much safer.', 27));
        }
      }
      if (moveNo <= 8 && m.piece === 'p' && !m.captured && (m.from.charAt(0) === 'a' || m.from.charAt(0) === 'h')) {
        tips.push(tip('tip', '♟', 'Edge pawn moves rarely help in the opening. Center pawns and piece development usually do more.', 12));
      }
      return finishTips(tips, 3);
    }

    // ---------------- Bot move -----------------------------------------------
    if (flags.indexOf('k') !== -1 || flags.indexOf('q') !== -1) {
      var myHistory = ctx.history || [];
      var castledAlready = hasCastled(myHistory, me);
      tips.push(tip('tip', '♚', oppName + ' castled to keep their king safe.' +
        (!castledAlready && canStillCastle(after.castling, me) ? ' Have you thought about castling too?' : ''), 40));
    }
    if (m.promotion) {
      tips.push(tip('warn', GLYPHS[m.promotion], oppName + "'s pawn promoted to " + article(pieceName(m.promotion)) + '. Watch out for the new piece.', 70));
    }
    if (m.captured) {
      var p = ctx.prevMove;
      var trade = p && p.to === m.to && p.captured;
      tips.push(tip(trade ? 'tip' : 'warn', GLYPHS[m.captured], trade
        ? oppName + ' recaptured on ' + m.to + '. That was a trade.'
        : oppName + ' captured your ' + pieceName(m.captured) + ' on ' + m.to + '.', 50));
    }
    if (ctx.inCheck && !ctx.isCheckmate) {
      tips.push(tip('warn', '+', 'Check! Your king is under attack. You can move the king, block the check, or capture the attacking piece.', 85));
    }
    if (!ctx.isCheckmate && !ctx.drawReason) {
      var hanging = findHanging(after.board, me);
      if (hanging.length) {
        var h = hanging[0];
        var attacker = h.attackers.slice().sort(function (a, b) { return VALUES[a.t] - VALUES[b.t]; })[0];
        var msg = h.undefended
          ? 'Heads up: your ' + pieceName(h.t) + ' on ' + h.sq + ' is under attack and nothing protects it.'
          : 'Heads up: your ' + pieceName(h.t) + ' on ' + h.sq + ' is attacked by ' + article(pieceName(attacker.t)) + '. Even with protection, that trade loses value.';
        tips.push(tip('warn', GLYPHS[h.t], msg, 60));
      }
    }
    if (opening && m.piece === 'p' && CENTER.indexOf(m.to) !== -1 && !m.captured) {
      tips.push(tip('tip', '♟', oppName + ' is claiming space in the center. Challenge it with your own pawns and pieces.', 10));
    }
    return finishTips(tips, 3);
  }

  /**
   * After the bot moves and Stockfish has looked at the new position:
   * point out when the bot slipped up.
   * ctx: { prevEvalP, evalP, playerColor, bestMove: {san, captured, to} | null, fen }
   */
  function describeOpportunity(ctx) {
    if (typeof ctx.prevEvalP !== 'number' || typeof ctx.evalP !== 'number') return [];
    var gain = clampCp(ctx.evalP) - clampCp(ctx.prevEvalP);
    if (gain <= BLUNDER_CP || ctx.evalP < -200) return [];
    var oppName = COLOR_NAMES[opposite(ctx.playerColor)];
    if (isMateScore(ctx.evalP) && ctx.evalP > 0) {
      return [tip('good', '★', oppName + ' just made a big mistake. There is a forced checkmate for you here. Look for checks!', 0)];
    }
    var b = ctx.bestMove;
    if (b && b.captured) {
      var board = parseFen(ctx.fen).board;
      var target = board[sqToIdx(b.to)];
      var defended = target && attackersOf(board, sqToIdx(b.to), target.c).length > 0;
      if (!defended) {
        return [tip('good', GLYPHS[b.captured], oppName + ' just slipped. Their ' + pieceName(b.captured) + ' on ' + b.to + " isn't protected. Can you win it?", 0)];
      }
    }
    return [tip('good', '!', oppName + ' just slipped. There is a chance to gain something. Look at every check, capture and threat.', 0)];
  }

  /**
   * Explain why a player move is a blunder, for the Coach Guard banner.
   * ctx: {
   *   move, fenBefore, fenAfter, playerColor, drop, pAfter,
   *   refutation: { from, to, san, captured, piece, promotion } | null,
   *   opponentMateIn: number | null, terminal: 'stalemate'|'repetition'|'insufficient'|'fifty'|null,
   *   bestSan
   * }
   * returns { message, dangerSquares: [], threat: {from,to} | null }
   */
  function explainBlunder(ctx) {
    var me = ctx.playerColor;
    var oppColor = opposite(me);
    var opp = COLOR_NAMES[oppColor];
    var m = ctx.move;
    var before = parseFen(ctx.fenBefore);
    var after = parseFen(ctx.fenAfter);
    var ref = ctx.refutation;
    var cost = pawnsText(ctx.drop);

    if (ctx.terminal) {
      var oppKing = findKing(after.board, oppColor);
      var reason = {
        stalemate: 'This stalemates ' + opp + ": they would have no legal moves, and the game ends in a draw even though you're ahead.",
        repetition: "This repeats the position a third time, so the game ends in a draw even though you're ahead.",
        insufficient: 'This leaves too little material to checkmate, so the game ends in a draw.',
        fifty: 'This triggers the 50-move rule, and the game ends in a draw.'
      }[ctx.terminal] || 'This ends the game in a draw while you are ahead.';
      return { message: reason, dangerSquares: oppKing >= 0 ? [idxToSq(oppKing)] : [], threat: null };
    }

    if (!ref) {
      return { message: 'This move costs about ' + cost + ' of value. Look again for something safer.', dangerSquares: [m.to], threat: null };
    }

    var threat = { from: ref.from, to: ref.to };

    if (ctx.opponentMateIn) {
      var myKing = findKing(after.board, me);
      var squares = [ref.to];
      if (myKing >= 0 && idxToSq(myKing) !== ref.to) squares.push(idxToSq(myKing));
      var mateMsg = ctx.opponentMateIn <= 1
        ? opp + ' can checkmate you right away with ' + ref.san + '.'
        : 'This lets ' + opp + ' force checkmate in ' + ctx.opponentMateIn + ' moves, starting with ' + ref.san + '.';
      return { message: mateMsg, dangerSquares: squares, threat: threat };
    }

    if (ref.captured) {
      var capturedName = pieceName(ref.captured);
      var msg;
      if (ref.to === m.to) {
        var movedName = pieceName(m.promotion || m.piece);
        msg = 'Your ' + movedName + ' on ' + m.to + " isn't safe there. " + opp + ' can take it with ' + ref.san + '.';
      } else {
        msg = opp + ' can win your ' + capturedName + ' on ' + ref.to + ' with ' + ref.san + '.';
        var wasGuard = attacksFrom(before.board, sqToIdx(m.from)).indexOf(sqToIdx(ref.to)) !== -1;
        if (wasGuard) msg += ' Your ' + pieceName(m.piece) + ' was protecting it before this move.';
      }
      return { message: msg + ' That costs about ' + cost + '.', dangerSquares: [ref.to], threat: threat };
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
          message: opp + ' has ' + ref.san + ', attacking your ' + names[0] + ' and ' + names[1] + ' at the same time. That fork costs about ' + cost + '.',
          dangerSquares: squaresHit,
          threat: threat
        };
      }
    }

    // A piece left hanging by this move.
    var hangingNow = findHanging(after.board, me);
    var hangingBefore = findHanging(before.board, me).map(function (h) { return h.sq; });
    var newlyLoose = hangingNow.filter(function (h) { return hangingBefore.indexOf(h.sq) === -1 && h.sq !== m.to; });
    if (newlyLoose.length) {
      var h = newlyLoose[0];
      return {
        message: 'Moving your ' + pieceName(m.piece) + ' leaves your ' + pieceName(h.t) + ' on ' + h.sq + ' unprotected. ' + opp + "'s best reply is " + ref.san + '.',
        dangerSquares: [h.sq],
        threat: threat
      };
    }

    if (typeof ctx.pAfter === 'number' && ctx.pAfter >= 200) {
      return {
        message: "You're still doing well, but this throws away about " + cost + ' of your advantage. There is a much stronger move here.',
        dangerSquares: [ref.to],
        threat: threat
      };
    }

    return {
      message: 'This gives ' + opp + ' a strong reply: ' + ref.san + '. It costs you about ' + cost + '.',
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
    describeMove: describeMove,
    describeOpportunity: describeOpportunity,
    explainBlunder: explainBlunder,
    pieceName: pieceName,
    BlunderBank: BlunderBank
  };
})(typeof window !== 'undefined' ? window : globalThis);
