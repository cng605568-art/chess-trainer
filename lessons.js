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
 *           goal: 'promote' instead means "make a queen".
 *   line    An opening, move by move. You play `side`; the bot plays the
 *           other moves. Each move is { san, say, why }: `say` tells you what
 *           to play (left out when `recall` is true), `why` explains it.
 *
 * Extra find goal: nomate = after your move the bot has no checkmate in one.
 *
 * Pieces for stars/capture: { square: letter }, uppercase = yours (White),
 * lowercase = the bot's. `par` is the fewest moves the step can be done in.
 */
/* Openings, shared by the "learn" and "from memory" steps. */
var ITALIAN = [
  { san: 'e4', say: 'Push the pawn in front of your king two squares: e2 to e4.', why: 'This pawn takes the middle and opens a path for your queen and bishop.' },
  { san: 'e5', why: 'The bot does the same, so both sides have a pawn in the middle.' },
  { san: 'Nf3', say: 'Bring your knight from g1 to f3.', why: 'The knight attacks the pawn on e5 and gets ready to guard your king.' },
  { san: 'Nc6', why: 'The bot protects its pawn with a knight.' },
  { san: 'Bc4', say: 'Move your bishop from f1 to c4.', why: "The bishop aims at f7, the weakest square near the bot's king, because only the king protects it." },
  { san: 'Bc5', why: 'The bot copies you and aims its bishop at your f2 square.' },
  { san: 'c3', say: 'Push your c-pawn one square: c2 to c3.', why: 'This pawn gets ready to push d4 later and build a strong middle.' },
  { san: 'Nf6', why: 'Another bot piece comes out and attacks your e4 pawn.' },
  { san: 'd3', say: 'Push your d-pawn one square: d2 to d3.', why: 'It protects your e4 pawn and opens a path for your other bishop.' },
  { san: 'd6', why: 'The bot protects its pawn the same way.' },
  { san: 'O-O', say: 'Castle: move your king two squares to the right, to g1.', why: 'Your king is safe in the corner and your rook joins the game.' }
];

var SCOTCH = [
  { san: 'e4', say: 'Push the pawn in front of your king two squares: e2 to e4.', why: 'It takes the middle and frees your queen and bishop.' },
  { san: 'e5', why: 'The bot answers with its own pawn in the middle.' },
  { san: 'Nf3', say: 'Bring your knight from g1 to f3.', why: 'The knight attacks the pawn on e5.' },
  { san: 'Nc6', why: 'The bot protects its pawn with a knight.' },
  { san: 'd4', say: 'Push your d-pawn two squares: d2 to d4.', why: 'Now you attack e5 a second time and open the middle straight away.' },
  { san: 'exd4', why: 'The bot takes your pawn.' },
  { san: 'Nxd4', say: 'Take back with your knight: f3 takes d4.', why: 'You get the pawn back, and your knight now stands in the middle.' },
  { san: 'Nf6', why: 'The bot brings out its other knight and attacks your e4 pawn.' },
  { san: 'Nc3', say: 'Bring your other knight out to c3.', why: 'It protects your e4 pawn and joins the game.' },
  { san: 'Bb4', why: 'The bot pins your knight to your king with its bishop.' },
  { san: 'Nxc6', say: 'Trade knights: your d4 knight takes on c6.', why: "After the trade the bot's pawns are split up, and that makes them weaker." },
  { san: 'bxc6', why: 'The bot takes back with a pawn.' },
  { san: 'Bd3', say: 'Move your bishop from f1 to d3.', why: 'It protects e4 again and clears the way for castling next.' }
];

var LONDON = [
  { san: 'd4', say: 'Push the pawn in front of your queen two squares: d2 to d4.', why: 'It takes the middle, and it is already protected by your queen.' },
  { san: 'd5', why: 'The bot puts its own pawn in the middle.' },
  { san: 'Bf4', say: 'Bring your bishop from c1 to f4, before your e-pawn moves.', why: 'This bishop is the heart of the London System. Out early, it is never stuck behind your pawns.' },
  { san: 'Nf6', why: 'The bot brings out a knight.' },
  { san: 'e3', say: 'Push your e-pawn one square: e2 to e3.', why: 'It makes a strong chain of pawns and opens a path for your other bishop.' },
  { san: 'e6', why: 'The bot does the same.' },
  { san: 'Nf3', say: 'Bring your knight from g1 to f3.', why: 'The knight guards the middle and your king.' },
  { san: 'Bd6', why: 'The bot offers to trade bishops.' },
  { san: 'Bg3', say: 'Move your bishop back to g3.', why: 'You keep your good bishop. If the bot takes it, you take back with a pawn and your king stays safe.' },
  { san: 'O-O', why: 'The bot castles.' },
  { san: 'Bd3', say: 'Move your other bishop from f1 to d3.', why: 'It points at the bot\'s king and clears the way for castling.' },
  { san: 'c5', why: 'The bot attacks your d4 pawn.' },
  { san: 'c3', say: 'Push your c-pawn one square: c2 to c3.', why: 'It protects d4. Your pawns now form a solid wall.' },
  { san: 'Nc6', why: 'The bot attacks d4 again.' },
  { san: 'Nbd2', say: 'Bring your last knight from b1 to d2.', why: 'Every piece is out. Next you castle, and your position is ready.' }
];

var QUEENS_GAMBIT = [
  { san: 'd4', say: 'Push the pawn in front of your queen two squares: d2 to d4.', why: 'It takes the middle.' },
  { san: 'd5', why: 'The bot answers in the middle too.' },
  { san: 'c4', say: 'Offer a pawn: push your c-pawn two squares, c2 to c4.', why: "This is the gambit. If the bot takes, you win the pawn back easily, and the bot's pawn leaves the middle." },
  { san: 'e6', why: 'The bot says no thanks and protects its d5 pawn.' },
  { san: 'Nc3', say: 'Bring your knight from b1 to c3.', why: 'It attacks d5 a second time.' },
  { san: 'Nf6', why: 'The bot protects d5 with a knight.' },
  { san: 'Bg5', say: 'Bring your bishop from c1 to g5.', why: 'It pins the knight that protects d5. That knight can no longer move freely.' },
  { san: 'Be7', why: 'The bot breaks the pin with its bishop.' },
  { san: 'e3', say: 'Push your e-pawn one square: e2 to e3.', why: 'It opens a path for your other bishop and makes your middle solid.' },
  { san: 'O-O', why: 'The bot castles.' },
  { san: 'Nf3', say: 'Bring your other knight from g1 to f3.', why: 'All your pieces are coming out. Castling comes next.' }
];

var CARO_KANN = [
  { san: 'e4', why: 'The bot starts with its king pawn in the middle.' },
  { san: 'c6', say: 'Push the pawn in front of your queen-side bishop one square: c7 to c6.', why: 'It gets ready to support d5. This is the Caro-Kann, a very solid start for Black.' },
  { san: 'd4', why: 'The bot takes more of the middle.' },
  { san: 'd5', say: 'Push your d-pawn two squares: d7 to d5.', why: 'Now you challenge the e4 pawn, and c6 protects your pawn.' },
  { san: 'Nc3', why: 'The bot protects e4 with its knight.' },
  { san: 'dxe4', say: 'Take the pawn on e4 with your d-pawn.', why: 'You trade pawns in the middle.' },
  { san: 'Nxe4', why: 'The bot takes back with its knight.' },
  { san: 'Bf5', say: 'Bring your bishop from c8 to f5.', why: 'It attacks the knight and comes out before you push e6, so it is never stuck.' },
  { san: 'Ng3', why: 'The knight steps back and attacks your bishop.' },
  { san: 'Bg6', say: 'Move your bishop back to g6.', why: 'It stays on its good diagonal and is safe.' },
  { san: 'Nf3', why: 'The bot brings out another knight.' },
  { san: 'Nd7', say: 'Bring your knight from b8 to d7.', why: 'It gets ready to come to f6 and protects e5.' },
  { san: 'Bd3', why: 'The bot offers to trade bishops.' },
  { san: 'Bxd3', say: 'Take the bishop on d3.', why: 'You trade bishops, which makes your position easy to play.' },
  { san: 'Qxd3', why: 'The bot takes back with its queen.' },
  { san: 'e6', say: 'Push your e-pawn one square: e7 to e6.', why: 'Your pawns are solid, your other bishop can come out, and you can castle soon.' }
];

var QGD = [
  { san: 'd4', why: 'The bot starts with its queen pawn in the middle.' },
  { san: 'd5', say: 'Push your d-pawn two squares: d7 to d5.', why: 'You stop the bot from taking the whole middle.' },
  { san: 'c4', why: 'The bot offers a pawn: the Queen\'s Gambit.' },
  { san: 'e6', say: 'Push your e-pawn one square: e7 to e6.', why: 'You protect d5 and decline the gambit. This is the Queen\'s Gambit Declined.' },
  { san: 'Nc3', why: 'The bot attacks d5 with a knight.' },
  { san: 'Nf6', say: 'Bring your knight from g8 to f6.', why: 'It protects d5 and gets your king ready to castle.' },
  { san: 'Bg5', why: 'The bot pins your knight.' },
  { san: 'Be7', say: 'Move your bishop from f8 to e7.', why: 'It breaks the pin, so your knight is free again.' },
  { san: 'e3', why: 'The bot gets its pieces ready.' },
  { san: 'O-O', say: 'Castle: move your king two squares towards your rook on h8, to g8.', why: 'Your king is safe in the corner.' },
  { san: 'Nf3', why: 'The bot brings out its other knight.' },
  { san: 'Nbd7', say: 'Bring your last knight from b8 to d7.', why: 'All your pieces are ready. Black has a solid, safe position.' }
];

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
  },
  {
    id: 'openings',
    title: 'Openings',
    lessons: [
      {
        id: 'italian',
        title: 'The Italian Game',
        icon: '♗',
        intro: 'A classic start for White: pawn in the middle, knight out, bishop aiming at f7, then castle. It is easy to learn and works in almost every game.',
        steps: [
          { type: 'line', side: 'w', moves: ITALIAN, text: 'Learn the Italian Game, one move at a time.', done: 'That is the Italian Game: pawn in the middle, knights and bishops out, king castled.' },
          { type: 'line', side: 'w', recall: true, moves: ITALIAN, text: 'Now play the Italian Game from memory.', done: 'You know the Italian Game! Try it in your next game as White.' }
        ]
      },
      {
        id: 'scotch',
        title: 'The Scotch Game',
        icon: '♘',
        intro: 'A direct start for White: push d4 early, open the middle and get your pieces out fast.',
        steps: [
          { type: 'line', side: 'w', moves: SCOTCH, text: 'Learn the Scotch Game, one move at a time.', done: 'That is the Scotch Game. The middle is open and your pieces are active.' },
          { type: 'line', side: 'w', recall: true, moves: SCOTCH, text: 'Now play the Scotch Game from memory.', done: 'You know the Scotch Game!' }
        ]
      },
      {
        id: 'london',
        title: 'The London System',
        icon: '♖',
        intro: 'A calm, safe set-up for White that you can play against almost anything: d4, bishop to f4, e3, knight to f3, and a solid wall of pawns.',
        steps: [
          { type: 'line', side: 'w', moves: LONDON, text: 'Learn the London System, one move at a time.', done: 'That is the London System: a solid wall of pawns and every piece ready.' },
          { type: 'line', side: 'w', recall: true, moves: LONDON, text: 'Now play the London System from memory.', done: 'You know the London System!' }
        ]
      },
      {
        id: 'queens-gambit',
        title: "The Queen's Gambit",
        icon: '♕',
        intro: 'One of the oldest openings. White offers a pawn on c4 to pull the bot\'s pawn away from the middle.',
        steps: [
          { type: 'line', side: 'w', moves: QUEENS_GAMBIT, text: "Learn the Queen's Gambit, one move at a time.", done: "That is the Queen's Gambit: pressure on d5 and all your pieces coming out." },
          { type: 'line', side: 'w', recall: true, moves: QUEENS_GAMBIT, text: "Now play the Queen's Gambit from memory.", done: "You know the Queen's Gambit!" }
        ]
      },
      {
        id: 'caro-kann',
        title: 'The Caro-Kann (Black)',
        icon: '♟',
        intro: 'A safe answer to 1.e4 for Black. You support d5 with c6 and bring your bishop out before closing it in.',
        steps: [
          { type: 'line', side: 'b', moves: CARO_KANN, text: 'Learn the Caro-Kann as Black, one move at a time.', done: 'That is the Caro-Kann: solid pawns, a good bishop, and an easy game for Black.' },
          { type: 'line', side: 'b', recall: true, moves: CARO_KANN, text: 'Now play the Caro-Kann from memory.', done: 'You know the Caro-Kann!' }
        ]
      },
      {
        id: 'qgd',
        title: "The Queen's Gambit Declined (Black)",
        icon: '♛',
        intro: 'A safe answer to 1.d4 for Black. You keep a pawn on d5, protect it, castle, and bring out every piece.',
        steps: [
          { type: 'line', side: 'b', moves: QGD, text: "Learn the Queen's Gambit Declined as Black, one move at a time.", done: "That is the Queen's Gambit Declined: a solid middle and a safe king." },
          { type: 'line', side: 'b', recall: true, moves: QGD, text: "Now play the Queen's Gambit Declined from memory.", done: "You know the Queen's Gambit Declined!" }
        ]
      }
    ]
  },
  {
    id: 'tactics2',
    title: 'More tactics',
    lessons: [
      {
        id: 'skewer',
        title: 'Skewers',
        icon: '♜',
        intro: 'A skewer attacks a valuable piece that has a weaker piece behind it on the same line. When the front piece moves away, you take the one behind.',
        steps: [
          { type: 'find', fen: '8/3k3q/8/8/8/8/8/R5K1 w - - 0 1', goal: 'moves', moves: ['a1a7'], text: "The bot's king and queen stand on the same row. Give check with your rook so the king has to move out of the way.", wrong: 'Look along the 7th row: a rook check there hits the king, with the queen behind it.', done: 'Skewer! The king must move, and then your rook takes the queen.' },
          { type: 'find', fen: '6q1/8/8/3k4/8/8/8/3B3K w - - 0 1', goal: 'moves', moves: ['d1b3'], text: 'Now skewer with your bishop. Find the check that has the queen behind the king.', wrong: 'Look at the diagonal from b3 to g8: the king is on it, and the queen is behind.', done: 'Skewer! After the king moves, your bishop takes the queen on g8.' }
        ]
      },
      {
        id: 'discovered',
        title: 'Discovered attacks',
        icon: '♗',
        intro: 'When one of your pieces moves out of the way, the piece behind it can suddenly attack. If the piece that moves also attacks something, the bot faces two threats at once.',
        steps: [
          { type: 'find', fen: '4q1k1/8/8/8/4B3/8/8/K3R3 w - - 0 1', goal: 'moves', moves: ['e4d5'], text: "Your bishop stands between your rook and the bot's queen. Move the bishop with check.", wrong: 'Find the bishop move that checks the king. Moving the bishop also opens the e-file for your rook.', done: "Discovered attack! The bot has to deal with the check, and then your rook takes the queen." }
        ]
      },
      {
        id: 'safe-captures',
        title: 'Safe captures',
        icon: '♛',
        intro: 'Before you take a piece, check what protects it. Taking a protected piece with something more valuable often loses material.',
        steps: [
          { type: 'find', fen: '6k1/5ppp/8/4p3/3n2b1/8/5PPP/3Q2K1 w - - 0 1', goal: 'capture', target: 'g4', text: 'Your queen can take two pieces. One of them is protected by a pawn. Take the one that is free.', wrong: 'The knight on d4 is protected by the pawn on e5. Look for the piece that nothing protects.', done: 'Good! The bishop was free. Taking the knight would have lost your queen to the pawn.' }
        ]
      }
    ]
  },
  {
    id: 'patterns',
    title: 'Checkmate patterns',
    lessons: [
      {
        id: 'smothered',
        title: 'Smothered mate',
        icon: '♞',
        intro: "Sometimes a king is boxed in by its own pieces. Then a single knight can checkmate it, because a knight check can't be blocked.",
        steps: [
          { type: 'find', fen: '6rk/6pp/8/6N1/8/8/8/6K1 w - - 0 1', goal: 'mate', text: 'The king is boxed in by its own rook and pawns. Checkmate with your knight.', wrong: 'Find the knight move that attacks h8. The king has nowhere to go.', done: 'Smothered mate! The king was trapped by its own pieces.' }
        ]
      },
      {
        id: 'arabian',
        title: 'Rook and knight mate',
        icon: '♘',
        intro: 'A rook and a knight work well together near the corner: the knight guards the squares the rook cannot.',
        steps: [
          { type: 'find', fen: '7k/8/5N2/8/8/8/8/6RK w - - 0 1', goal: 'mate', text: 'Checkmate in one move. Your knight already guards g8 and h7.', wrong: 'Look for a rook check that the knight protects.', done: 'Checkmate! The knight protects the rook and covers the escape squares.' }
        ]
      },
      {
        id: 'ladder',
        title: 'Two-rook ladder',
        icon: '♖',
        intro: 'Two rooks can push a king to the edge like climbing a ladder: one rook checks, the other cuts off the next row, and they take turns.',
        steps: [
          { type: 'play', fen: '8/8/8/3k4/8/8/8/R3K2R w - - 0 1', goal: 'mate', text: 'Checkmate the bot with your two rooks.', tip: 'One rook checks the king, the other guards the next row. Keep both rooks far away from the king, so it cannot attack them.', done: 'Ladder mate! Two rooks can always do this, even without help from the king.' }
        ]
      }
    ]
  },
  {
    id: 'traps',
    title: 'Traps and defence',
    lessons: [
      {
        id: 'stop-scholar',
        title: "Stop the four-move mate",
        icon: '♛',
        intro: "A very common trap: White's queen and bishop both attack f7 and threaten checkmate. As Black, you must see it coming.",
        steps: [
          { type: 'find', fen: 'r1bqkbnr/pppp1ppp/2n5/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR b KQkq - 3 3', goal: 'nomate', text: "You are Black. The bot's queen and bishop both attack f7. Stop the checkmate.", wrong: 'Your move still lets the queen take on f7 with checkmate. Protect f7, or block the queen with your g-pawn.', done: 'Safe! The four-move mate is stopped. Pawn to g6 is a good answer, because it also attacks the queen.' }
        ]
      },
      {
        id: 'fools-mate',
        title: "Fool's mate",
        icon: '♟',
        intro: 'The fastest checkmate in chess. It only happens when White weakens the king by moving the f- and g-pawns too early.',
        steps: [
          { type: 'find', fen: 'rnbqkbnr/pppp1ppp/8/4p3/6P1/5P2/PPPPP2P/RNBQKBNR b KQkq g3 0 2', goal: 'mate', text: 'You are Black. White pushed two pawns next to its king. Checkmate in one move.', wrong: "Look at the diagonal from your queen to White's king.", done: "Fool's mate! Early in the game, leave the pawns next to your own king where they are." }
        ]
      },
      {
        id: 'escape-square',
        title: 'Give your king air',
        icon: '♔',
        intro: 'A king behind three pawns on the back row can be checkmated by a single rook. Pushing one pawn gives the king an escape square.',
        steps: [
          { type: 'find', fen: '4r1k1/R4ppp/8/8/8/8/5PPP/6K1 w - - 0 1', goal: 'nomate', text: 'The bot threatens to put its rook on e1 with checkmate. Stop it.', wrong: 'That still allows the rook to e1 with checkmate. Push a pawn in front of your king to give it a square, or guard e1.', done: "Your king can breathe now. Pushing the h-pawn one square is the usual way: it's called giving your king air." }
        ]
      }
    ]
  },
  {
    id: 'endgames',
    title: 'Endgames',
    lessons: [
      {
        id: 'catch-pawn',
        title: 'Catch the pawn',
        icon: '♚',
        intro: 'Can your king catch a pawn running to its last row? Imagine a square from the pawn down to that row. If your king can step into the square, it catches the pawn.',
        steps: [
          { type: 'find', fen: '7k/8/8/p7/5K2/8/8/8 w - - 0 1', goal: 'moves', moves: ['f4e4', 'f4e5', 'f4e3'], text: 'The pawn on a5 runs to a1. Move your king into its square (a1 to e5) so it can catch the pawn.', wrong: 'Step towards the pawn, onto the e-file. Then the king is inside the square.', done: 'You are inside the square. Now your king reaches the pawn in time, whatever the bot does.' }
        ]
      },
      {
        id: 'escort-pawn',
        title: 'Walk your pawn home',
        icon: '♙',
        intro: 'With king and pawn against a king, your king leads the way. If your king gets in front of the pawn, the pawn can walk to the last row.',
        steps: [
          { type: 'play', fen: '4k3/8/4K3/4P3/8/8/8/8 w - - 0 1', goal: 'promote', text: 'Make a new queen: walk the pawn to the last row with your king in front.', tip: 'Keep your king next to the pawn and in front of it. Never leave the pawn where the bot\'s king can take it.', wrong: "The bot's king took your pawn, so nobody can win now. Try again: keep your king next to the pawn.", done: 'A new queen! With the king in front, the pawn walks home.' }
        ]
      }
    ]
  }
];
