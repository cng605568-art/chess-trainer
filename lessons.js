/*
 * lessons.js: the Learn path for complete beginners.
 *
 * Step types
 *   stars   Move one piece (the "hero") to collect every star. Pieces don't
 *           take turns. White pieces other than the hero are walls.
 *   capture Same moves, but take every black piece.
 *   find    A real chess position: make one move that meets the goal.
 *           goal: mate | check | king-move | block | capture | castle |
 *                 promote | moves (with a list of accepted moves, from+to)
 *   play    Play a real game from the position against the bot until you
 *           checkmate it (stalemate or losing your pieces means try again).
 *
 * Pieces for stars/capture: { square: letter }, uppercase = yours (White),
 * lowercase = the bot's. `par` is the fewest moves the step can be done in.
 */
window.LESSONS = [
  {
    id: 'pieces',
    title: 'How the pieces move',
    lessons: [
      {
        id: 'rook',
        title: 'The rook',
        icon: '♜',
        intro: 'The rook moves in straight lines: up, down, left or right, as far as it likes. It cannot jump over other pieces.',
        steps: [
          { type: 'stars', pieces: { a1: 'R' }, hero: 'a1', stars: ['a6'], par: 1, text: 'Move the rook to the star. Click the rook, then click the star (or drag it).' },
          { type: 'stars', pieces: { d4: 'R' }, hero: 'd4', stars: ['d8', 'h8'], par: 2, text: 'Collect both stars. The rook can go as far as it likes in one move.' },
          { type: 'stars', pieces: { b2: 'R', b5: 'P', e2: 'P' }, hero: 'b2', stars: ['b4', 'h4', 'h8'], par: 3, text: 'Your own pawns are in the way. The rook cannot jump over them, so go around.' },
          { type: 'capture', pieces: { d1: 'R', d6: 'p', a6: 'p', a2: 'p' }, hero: 'd1', par: 3, text: "Take all the bot's pawns. To take a piece, move onto its square." }
        ]
      },
      {
        id: 'bishop',
        title: 'The bishop',
        icon: '♝',
        intro: 'The bishop moves diagonally, as far as it likes. Because it only moves diagonally, it always stays on squares of the same colour.',
        steps: [
          { type: 'stars', pieces: { c1: 'B' }, hero: 'c1', stars: ['h6'], par: 1, text: 'Move the bishop to the star along the diagonal.' },
          { type: 'stars', pieces: { f1: 'B' }, hero: 'f1', stars: ['b5', 'e8'], par: 2, text: 'Collect both stars.' },
          { type: 'capture', pieces: { d4: 'B', g7: 'p', b2: 'p', a3: 'p' }, hero: 'd4', par: 3, text: "Take all the bot's pawns. Notice they are all on dark squares, like your bishop." }
        ]
      },
      {
        id: 'queen',
        title: 'The queen',
        icon: '♛',
        intro: 'The queen is the strongest piece. She moves like a rook and a bishop together: straight lines and diagonals, as far as she likes.',
        steps: [
          { type: 'stars', pieces: { d1: 'Q' }, hero: 'd1', stars: ['a4', 'a8', 'h1'], par: 3, text: 'Collect all three stars. Use straight lines and diagonals.' },
          { type: 'capture', pieces: { e4: 'Q', b7: 'p', b1: 'p', h1: 'p' }, hero: 'e4', par: 3, text: "Take all the bot's pawns." }
        ]
      },
      {
        id: 'king',
        title: 'The king',
        icon: '♚',
        intro: 'The king moves one square in any direction. It is the most important piece: if your king is trapped (checkmate), you lose the game.',
        steps: [
          { type: 'stars', pieces: { e1: 'K' }, hero: 'e1', stars: ['d2', 'd3', 'e4'], par: 3, text: 'Collect the stars, one square at a time.' },
          { type: 'capture', pieces: { d4: 'K', c5: 'p', d6: 'p', e6: 'p' }, hero: 'd4', par: 3, text: "Take the bot's pawns with your king." }
        ]
      },
      {
        id: 'knight',
        title: 'The knight',
        icon: '♞',
        intro: 'The knight moves in an L shape: two squares in one direction, then one square to the side. It is the only piece that can jump over others.',
        steps: [
          { type: 'stars', pieces: { b1: 'N' }, hero: 'b1', stars: ['c3'], par: 1, text: 'Move the knight to the star: two squares up, one to the side.' },
          { type: 'stars', pieces: { g1: 'N' }, hero: 'g1', stars: ['f3', 'e5', 'd7'], par: 3, text: 'Hop from star to star.' },
          { type: 'stars', pieces: { b1: 'N', a2: 'P', b2: 'P', c2: 'P', d2: 'P' }, hero: 'b1', stars: ['c3', 'e4'], par: 2, text: 'The knight can jump over pieces. Jump over your pawns!' },
          { type: 'capture', pieces: { d4: 'N', e6: 'p', g7: 'p', h5: 'p' }, hero: 'd4', par: 3, text: "Take all the bot's pawns." }
        ]
      },
      {
        id: 'pawn',
        title: 'The pawn',
        icon: '♟',
        intro: 'Pawns move straight forward, one square at a time. On its very first move, a pawn may move two squares. Pawns take pieces diagonally forward, never backward.',
        steps: [
          { type: 'stars', pieces: { e2: 'P' }, hero: 'e2', stars: ['e4', 'e5'], par: 2, text: 'Move the pawn to the stars. On its first move it can go two squares.' },
          { type: 'capture', pieces: { d2: 'P', c3: 'p', d4: 'p', e5: 'p' }, hero: 'd2', par: 3, text: "Pawns take diagonally forward. Take all the bot's pawns." },
          { type: 'find', fen: '7k/4P3/8/8/8/8/8/K7 w - - 0 1', goal: 'promote', text: 'When a pawn reaches the last row, it turns into a new piece. Push the pawn to the end and choose a queen.', done: 'Your pawn became a queen! You could also pick a rook, bishop or knight, but the queen is almost always best.' }
        ]
      }
    ]
  },
  {
    id: 'check',
    title: 'Check and checkmate',
    lessons: [
      {
        id: 'give-check',
        title: 'Check',
        icon: '+',
        intro: 'When a piece attacks the king, that is called check. The player in check must get their king safe on the very next move.',
        steps: [
          { type: 'find', fen: '4k3/8/8/8/8/8/8/R3K3 w - - 0 1', goal: 'check', text: "Give check: attack the bot's king with your rook.", done: 'Check! The bot must now save its king.' },
          { type: 'find', fen: '4k3/8/8/8/4N3/8/8/4K3 w - - 0 1', goal: 'check', text: 'Give check with your knight.', done: 'Check! A knight check cannot be blocked, because the knight jumps.' }
        ]
      },
      {
        id: 'escape-check',
        title: 'Getting out of check',
        icon: '!',
        intro: 'There are three ways out of check: move your king to a safe square, block the attack by putting a piece in the way, or take the piece that is giving check.',
        steps: [
          { type: 'find', fen: '4r1k1/8/8/8/8/8/8/4K3 w - - 0 1', goal: 'king-move', text: 'The rook is checking your king. Move your king to a safe square.', done: 'Safe! Moving the king out of the line of attack is the first way out of check.' },
          { type: 'find', fen: '4r1k1/8/8/8/8/8/2B5/4K3 w - - 0 1', goal: 'block', text: 'This time, block the check: put your bishop between the rook and your king.', done: 'Blocked! The bishop stands in the way, so the rook cannot reach your king.' },
          { type: 'find', fen: '4k3/8/8/8/8/8/4q3/4K1N1 w - - 0 1', goal: 'capture', target: 'e2', text: 'The queen is checking you. Take the piece that is giving check.', done: 'You took the attacker, so the check is gone. That is the third way out of check.' }
        ]
      },
      {
        id: 'checkmate',
        title: 'Checkmate',
        icon: '#',
        intro: 'Checkmate is a check with no way out: the king cannot move to safety, the attack cannot be blocked, and the attacker cannot be taken. Checkmate wins the game.',
        steps: [
          { type: 'find', fen: '6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1', goal: 'mate', text: 'Checkmate in one move. The king is stuck behind its own pawns.', done: 'Checkmate! The pawns block the king in. This is called a back-row mate.' },
          { type: 'find', fen: '7k/8/6K1/8/8/8/8/1Q6 w - - 0 1', goal: 'mate', text: 'Checkmate in one move with your queen. Your king helps.', done: 'Checkmate! Your queen attacks the king, and your king guards the escape squares.' },
          { type: 'find', fen: 'r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5Q2/PPPP1PPP/RNB1K1NR w KQkq - 2 3', goal: 'mate', text: 'Find the checkmate. Look at the weak pawn next to the black king.', done: 'Checkmate! Your queen takes on f7, and your bishop protects her. This quick checkmate is a trap many beginners fall into.' }
        ]
      },
      {
        id: 'stalemate',
        title: 'Stalemate',
        icon: '½',
        intro: 'Stalemate is when the player to move has no legal move, but their king is NOT in check. Stalemate is a draw, even if one side has many more pieces. Be careful when you are winning!',
        steps: [
          { type: 'find', fen: '7k/8/6K1/8/8/8/8/5Q2 w - - 0 1', goal: 'mate', text: 'Checkmate in one move. Careful: one queen move takes away all the king\'s squares without giving check. That is stalemate!', done: 'Checkmate! If you had played your queen to f7, the king would have had no moves but no check: a draw by stalemate.' }
        ]
      }
    ]
  },
  {
    id: 'special',
    title: 'Special moves',
    lessons: [
      {
        id: 'castling',
        title: 'Castling',
        icon: '♔',
        intro: 'Castling is a special move to keep your king safe. The king moves two squares toward a rook, and that rook jumps over to the other side of the king. You can only castle if the king and that rook have not moved yet, the squares between them are empty, and your king is not in check.',
        steps: [
          { type: 'find', fen: '4k3/pppppppp/8/8/8/8/PPPPPPPP/R3K2R w KQ - 0 1', goal: 'castle', text: 'Castle! Move your king two squares toward either rook.', done: 'You castled. Your king is tucked in the corner and your rook is ready to join the game.' },
          { type: 'find', fen: 'r3k2r/ppp2ppp/2nqbn2/2bpp3/2BPP3/2NQBN2/PPP2PPP/R3K2R w KQkq - 0 8', goal: 'castle', text: 'Here you can castle to either side. On the queen side, the king still moves two squares and the rook jumps over it.', done: 'Well done. Most good players castle in their first ten moves.' }
        ]
      },
      {
        id: 'promotion',
        title: 'Pawn to queen',
        icon: '♕',
        intro: 'A pawn that reaches the last row turns into a queen, rook, bishop or knight. Almost always, you should choose a queen.',
        steps: [
          { type: 'stars', pieces: { b5: 'P' }, hero: 'b5', stars: ['b8'], par: 3, text: 'Walk the pawn to the last row. It becomes a queen when it gets there.' },
          { type: 'find', fen: '3r2k1/2P2ppp/8/8/8/8/5PPP/6K1 w - - 0 1', goal: 'moves', moves: ['c7d8q'], text: "Take the bot's rook with your pawn and make a queen in the same move.", wrong: 'Pawns take diagonally. Take the rook on d8 with your pawn and choose a queen.', done: 'You won a rook and got a new queen at the same time.' }
        ]
      },
      {
        id: 'en-passant',
        title: 'En passant',
        icon: '♙',
        intro: 'A special pawn capture. If an enemy pawn jumps two squares and lands right next to your pawn, you may take it as if it had moved only one square. You can only do this on the very next move.',
        steps: [
          { type: 'find', fen: '4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 1', goal: 'moves', moves: ['e5d6'], text: 'The black pawn just jumped from d7 to d5, right next to your pawn. Take it en passant: move your pawn diagonally to d6.', wrong: 'Move your pawn from e5 diagonally to d6.', done: 'En passant! The black pawn disappears even though you moved behind it.' }
        ]
      }
    ]
  },
  {
    id: 'tactics',
    title: 'Winning pieces',
    lessons: [
      {
        id: 'free-pieces',
        title: 'Free pieces',
        icon: '♟',
        intro: 'Before every move, look for pieces with no protection. If nothing guards a piece, you can take it for free.',
        steps: [
          { type: 'find', fen: '4k3/8/8/3n4/8/8/8/3RK3 w - - 0 1', goal: 'moves', moves: ['d1d5'], text: "One of the bot's pieces has no protection. Take it.", done: 'Free knight! Nothing could take your rook back.' },
          { type: 'find', fen: '4k3/8/8/1r6/8/8/8/4KB2 w - - 0 1', goal: 'moves', moves: ['f1b5'], text: 'Find the free piece again. Look along the diagonals.', done: 'You won a rook for free.' }
        ]
      },
      {
        id: 'forks',
        title: 'Forks',
        icon: '♞',
        intro: 'A fork is one move that attacks two pieces at once. The bot can only save one of them, so you win the other.',
        steps: [
          { type: 'find', fen: 'r3k3/8/8/1N6/8/8/8/4K3 w - - 0 1', goal: 'moves', moves: ['b5c7'], text: 'Knights are great at forks. Attack the king and the rook with one knight move.', wrong: 'Find the square where your knight attacks both the king and the rook.', done: 'Fork! The king must move out of check, and then you take the rook.' },
          { type: 'find', fen: '4k3/8/8/2n1b3/8/3P4/8/4K3 w - - 0 1', goal: 'moves', moves: ['d3d4'], text: 'Even a pawn can fork. Attack both black pieces at once.', wrong: 'Move your pawn so it attacks both the knight and the bishop.', done: 'Pawn fork! One of those pieces is lost.' },
          { type: 'find', fen: '1k6/6r1/8/8/8/8/8/K3Q3 w - - 0 1', goal: 'moves', moves: ['e1e5'], text: 'Fork with your queen: give check and attack the rook at the same time.', wrong: 'Look for a queen move that checks the king and also attacks the rook on g7.', done: 'Queen fork! After the king moves, the rook is yours.' }
        ]
      },
      {
        id: 'pins',
        title: 'Pins',
        icon: '♝',
        intro: 'A pin attacks a piece that cannot move away, because a more valuable piece (often the king) is standing right behind it.',
        steps: [
          { type: 'find', fen: '4k3/8/2n5/8/8/8/8/4KB2 w - - 0 1', goal: 'moves', moves: ['f1b5'], text: "Pin the knight to the king: put your bishop on the same diagonal as the knight and the bot's king.", wrong: 'Move the bishop so the knight is stuck between your bishop and the king.', done: "Pinned! The knight can't move, because that would put its own king in check." }
        ]
      }
    ]
  },
  {
    id: 'mates',
    title: 'Basic checkmates',
    lessons: [
      {
        id: 'queen-mate',
        title: 'King and queen checkmate',
        icon: '♛',
        intro: 'With a king and a queen you can always checkmate a lone king. Use your queen to make the king\'s box smaller, step by step. Keep your queen a knight\'s move away from the king so you never stalemate it. Then bring your king close and finish with the queen.',
        steps: [
          { type: 'play', fen: '8/8/8/4k3/8/8/8/3QK3 w - - 0 1', goal: 'mate', text: 'Checkmate the bot. It will try to escape!', tip: 'Shrink the box with your queen, then walk your king up to help.', done: 'Checkmate with king and queen! You can now win any game where you have a queen left against a lone king.' }
        ]
      },
      {
        id: 'rook-mate',
        title: 'King and rook checkmate',
        icon: '♜',
        intro: 'A king and a rook can also force checkmate. Push the bot\'s king to the edge of the board with your rook, bring your king face to face with it, then give check along the edge.',
        steps: [
          { type: 'play', fen: '8/8/8/4k3/8/8/8/R3K3 w - - 0 1', goal: 'mate', text: 'Checkmate the bot with your king and rook.', tip: 'Use the rook to cut the king off, keep the rook far from the king so it is safe, and bring your king up.', done: 'Checkmate with king and rook! This one takes patience. Well done.' }
        ]
      }
    ]
  },
  {
    id: 'opening',
    title: 'How to start a game',
    lessons: [
      {
        id: 'center',
        title: 'Take the middle',
        icon: '♙',
        intro: 'The four squares in the middle of the board are the most important. Pieces in the middle can reach more squares. Start by moving a middle pawn two squares.',
        steps: [
          { type: 'find', fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', goal: 'moves', moves: ['e2e4', 'd2d4'], text: 'Make a good first move: push the pawn in front of your king or queen two squares.', wrong: 'Try moving the pawn in front of your king (e2) or queen (d2) two squares forward.', done: 'A great start. Your pawn takes space in the middle and opens a path for your pieces.' }
        ]
      },
      {
        id: 'develop',
        title: 'Bring out your pieces',
        icon: '♘',
        intro: 'In the first moves, bring your knights and bishops off the back row. Every piece should join the game before you attack.',
        steps: [
          { type: 'find', fen: 'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2', goal: 'moves', moves: ['g1f3', 'b1c3', 'f1c4', 'f1b5'], text: 'Bring a knight or a bishop out toward the middle.', wrong: 'Move a knight toward the middle (f3 or c3), or a bishop to c4 or b5.', done: 'Good! That piece now helps control the middle.' },
          { type: 'find', fen: 'r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3', goal: 'moves', moves: ['f1c4', 'f1b5', 'b1c3'], text: 'Bring out another piece. Which one is still on the back row?', wrong: 'Your bishop on f1 and knight on b1 still need to come out.', done: 'Your pieces are joining the game. Next comes castling.' }
        ]
      },
      {
        id: 'castle-early',
        title: 'Castle early',
        icon: '♔',
        intro: 'Once your knight and bishop on one side are out, castle. Your king is much safer in the corner than in the middle.',
        steps: [
          { type: 'find', fen: 'r1bqk1nr/pppp1ppp/2n5/2b1p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4', goal: 'castle', text: 'Your knight and bishop are out. Castle to keep your king safe.', done: 'Castled! Middle pawns, pieces out, king safe: that is a great start to any game.' }
        ]
      }
    ]
  }
];
