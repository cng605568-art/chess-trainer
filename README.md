# Second Look: chess trainer with a live coach

A free, static chess site for complete beginners. Short lessons teach the pieces, 1,366 beginner puzzles build your eye, and when you play the bots a coach checks every move before it lands. Every blunder you make becomes a puzzle in your own Blunder Bank. The site works in English, Bahasa Melayu and Chinese, installs on a phone like an app, and runs offline after the first visit.

No build step and no server of its own. Everything runs in the browser and saves to `localStorage`; signing in with Google to sync between devices is optional.

## Deploy in 3 steps

1. **Create a GitHub repo and push these files.** Unzip the folder, then from inside it run:

   ```bash
   git init
   git add .
   git commit -m "Second Look chess trainer"
   git branch -M main
   git remote add origin https://github.com/<your-username>/chess-trainer.git
   git push -u origin main
   ```

   (Create the empty `chess-trainer` repo on github.com first, or use `gh repo create chess-trainer --public --source=. --push`.)

2. **Import the repo into Vercel.** Go to [vercel.com/new](https://vercel.com/new), pick the repo, and leave the settings as they are: Framework Preset **Other**, no build command, output directory = the project root. Click **Deploy**.

3. **Open your `.vercel.app` URL and play a move.** The engine pill in the header turns green ("Stockfish 10 ready") after a few seconds. Every later push to `main` redeploys automatically.

## Run it locally

Web Workers don't run from `file://`, so serve the folder over HTTP:

```bash
npx serve .            # or: python3 -m http.server 8000
```

Then open `http://localhost:3000` (or `:8000`).

## Layout

A sidebar on the left switches between **Home**, **Learn**, **Play**, **Puzzles**, **Analyze**, **Blunder Bank** and **Settings**, with a language picker at the bottom. The board sits in the middle with player bars above and below it. The right panel has three tabs: **Game** (status, controls, game summary, coach notes, moves), **New game** (choose your colour and time limit, then pick a bot from six cards) and **Settings** (Coach Guard, evaluation bar, sounds, board colour). On phones the sidebar turns into a slide-out menu behind the ☰ button, the top bar gets quick buttons for the Blunder Bank and sound, and the site opens on **Home**: a Play card with level chips and a big Start game button, shortcut buttons, a puzzle card showing your newest saved blunder, your game history, and stats (games, wins, Coach Guard saves, puzzles solved and waiting). Finishing games without a blunder builds a clean-game streak. During a game on a phone, the board runs edge to edge between the two player bars, the panel tabs become an icon bar under the board, and the step buttons stay pinned to the bottom of the screen. The evaluation bar is left out on phones to keep the board full width; the score still shows next to the status.

## What's inside

| File | Job |
| --- | --- |
| `index.html` | Sidebar, Home, Learn, Play, Puzzles and Blunder Bank views, right panel with Game / New game / Settings tabs, promotion, Coach Guard and transfer-code dialogs, share and search tags |
| `style.css` | Grey theme, board colours, highlights, danger pulse, menu cards, responsive rules |
| `stockfish-worker.js` | Web Worker that loads Stockfish 10 from cdnjs (jsDelivr as backup) and answers search requests as JSON. Falls back to a small built-in engine if both CDNs are blocked |
| `account.js` | Optional Google sign-in through Supabase and merging progress between devices |
| `cannibal.js` | Cannibal King: the rules (kings eat their own pieces and keep their moves) and the bot that plays them |
| `chess960.js` | Chess960 on top of chess.js: random starts, castling with rook-file rights (Shredder-FEN), and the chess.js methods the app uses |
| `coach.js` | Plain-English move explanations (hanging pieces, checks, center control, castling, evaluation swings) and the Blunder Bank storage |
| `app.js` | Board rendering and piece animation, click or drag to move, pawn promotion, sound effects, the game loop, Coach Guard, replay, game summary, lessons, puzzles, XP and badges, sharing, backups |
| `lessons.js` | The 38 lessons in Learn, including the six opening drills (positions, goals and text) |
| `puzzles.json` | 1,366 beginner puzzles from the Lichess puzzle database |
| `i18n.js` | Picks the language and translates text (`T('English text')`) |
| `lang.js` | Bahasa Melayu and Chinese, as rows of `[English, Malay, Chinese]`. Only loaded when one of them is chosen |
| `sw.js`, `manifest.webmanifest`, `icons/` | Install as an app and play offline |
| `about.html`, `og-image.png`, `robots.txt`, `sitemap.xml` | The About page and what search engines and chat apps show |
| `tools/check-lang.js` | Lists any English text that still needs a Malay or Chinese translation |
| `vercel.json` | `cleanUrls` so Vercel serves `index.html` at `/`, and no caching for `sw.js` |

## How the features work

**Learn.** 38 lessons in eleven units: how the pieces move, check and checkmate, special moves, winning pieces, basic checkmates, how to start a game, openings, more tactics (skewers, discovered attacks, safe captures), checkmate patterns (smothered mate, rook and knight, the two-rook ladder), traps and defence (stopping the four-move mate, fool's mate, giving your king air) and endgames (the square of the pawn, walking a pawn home). Each lesson is a few steps on a real board: collect stars with one piece, find a move that does something (give check, block, castle, promote, stop a mate), or play a short ending against the bot. Wrong moves get a hint about what to try instead, and progress is saved per lesson. The speaker button reads each step out loud.

**Openings.** Six openings to learn move by move: the Italian Game, Scotch Game, London System and Queen's Gambit as White, and the Caro-Kann and Queen's Gambit Declined as Black. First every move comes with an instruction and the reason for it, and the bot plays the other side's book moves. Then you play the whole line again from memory; after two misses a green arrow shows the move.

**Puzzles.** Beginner puzzles from real games on Lichess: checkmate in 1 and 2, free pieces, forks, pins, back-row mates and pawn promotion. The bot plays the first move, then you find the answer. Pick a type or mix them. Your puzzle rating starts at 600 and moves like a chess rating: up when you solve one, down when you miss it.

**Daily practice.** Every game, puzzle and lesson step earns XP, and XP raises your level (Pawn up to King). Home shows today's goal (finish a game, solve 3 puzzles, do a lesson step), a puzzle of the day that is the same for everyone, your day streak, and 20 badges.

**Try that moment again.** After a game, Key moments lists your biggest mistakes and the bot's slips. **Try again** starts a new game from just before your mistake, so you can find the better move. **Play from here** works from any position while you step through a game.

**Languages.** English, Bahasa Melayu and 中文 (Simplified Chinese). The site picks the browser's language the first time; change it with the picker at the bottom of the sidebar (the ☰ menu on phones) or in Settings. The coach's explanations, lessons, puzzles, badges and the About page are all translated. Chess words follow common local use: in Malay raja, menteri, tir, gajah, kuda, bidak, sah and sah mati; in Chinese 王, 后, 车, 象, 马, 兵, 将军 and 将死.

**Install as an app.** On Android and desktop Chrome, Home shows an **Install app** button. On iPhone and iPad it explains Share, then Add to Home Screen. Once installed (or after one visit), the bots, lessons and puzzles work without internet.

**Accounts (optional).** Settings → Account → Sign in with Google keeps progress the same on every device. Data lives in a Supabase project (`second-look`): one row per player in `public.progress`, protected by row level security so each player can only read and write their own row. `account.js` only downloads supabase-js for people who sign in. Syncing merges instead of overwriting: finished lessons, badges, games and saved blunders from both sides are kept, and counts like XP keep the higher number. Changes from other devices arrive when the site opens (one quick reload); while you play, the device sends its changes every minute or when you leave. Settings and the game in progress stay on each device. Delete account (in Settings) deletes the account and its saved progress. To set it up on a copy of the site, see `account.js` for the project URL and publishable key, and turn on Google under Authentication → Providers in Supabase.

**Move to another device.** Without an account, progress is saved only in the browser. Settings → Move to another device makes a backup file or a transfer code (a long text you can paste into a chat to yourself) that loads everything on another phone or computer.

**Share.** After a game, **Share result** makes a picture of the final board with the result and opens your phone's share menu, or saves the picture and copies the link on a computer.

**Coach Guard.** While you think, Stockfish evaluates the position. When you move, it evaluates the new position too. If your move drops the evaluation by more than 1.5 pawns (scores are capped at ±10 so mates and huge leads don't trigger false alarms), the move pauses, the threatened square pulses red, and you choose **Undo & Rethink** or **Play Anyway**. Turn the guard off in the Settings tab of the right panel to play freely.

**Coach notes.** After each move, deterministic rules in `coach.js` describe what happened in beginner language: captures, checks, castling, central pawns, development, early queen moves, loose pieces, and when the bot slips up. Everything is written for complete beginners: moves are described in words ("move your knight from g1 to f3") instead of chess notation, gains and losses are measured in pieces ("like giving away a knight") instead of engine numbers, and chess words like check, fork, castling and stalemate are explained where they come up. The opponent is always called "the bot".

**My Blunder Bank.** Every blunder is saved (position + Stockfish's best move), whether the guard caught it or not. In the Blunder Bank tab you replay the position and look for a better move. Stockfish's move, or any move that keeps the position within 0.6 pawns of it, solves the puzzle and clears it from the queue.

**Clocks.** Each player bar has a clock that turns white while that side is thinking. Pick a time limit under New game: **Bullet** (1 min, 1 | 1, 2 | 1), **Blitz** (3 min, 3 | 2, 5 min), **Rapid** (10 min, 15 | 10, 30 min) or **No limit** (the clocks count how long each side spends thinking). "3 | 2" means 3 minutes each plus 2 seconds after every move. Your clock stops while the coach checks your move and while the Coach Guard banner is open, so the coach never costs you time. If a clock runs out, that side loses, unless the other side has only a king, or a king and one bishop or knight, which makes it a draw. The bot speeds up when it's short on time.

**Premoves.** While the bot is thinking you can already make your next move. It shows in red on the board and plays the moment the bot has moved, if it is still legal. Tap an empty square (or right-click) to cancel it. Handy in Bullet.

**Bot ladder.** Home has a ladder of all six bots. Beat a bot and the next one unlocks. A win earns three stars with no blunders and no take-backs, two if you needed a take-back or Coach Guard, and one if a blunder slipped through.

**Analysis board.** The Analyze tab is a free board: move pieces for both sides and Stockfish shows the best move as an arrow, the top lines and the score in words. Set up any position with the piece palette or paste a FEN, step through the moves, flip the board, copy the FEN, or start a game against the bot from the position. After a game, **Analyze this game** opens it here.

**Review your games.** Under Analyze → My games, type a Chess.com or Lichess username to list recent games, or choose Paste a game for a PGN. Pick one and Stockfish checks every move: you get a graph of who was ahead, your inaccuracies, mistakes and blunders, and each key moment opens on the analysis board. Lichess allows this from any website; if Chess.com can't be reached from the browser, paste the PGN from the game's Share button instead.

**Read aloud.** The speaker buttons in Learn and in the coach notes read the text out loud with the browser's own voices, in English, Malay or Chinese.

**Game modes.** Under New game (or the Ways to play tiles on Home):
- **Standard**: normal chess against a bot.
- **Head start**: the bot starts without its queen, a rook or a knight.
- **King of the Hill**: checkmate wins, and so does getting your king to one of the four centre squares (outlined on the board). The bot plays normal chess, but it always takes a winning king move and never lets you reach the centre in one move. Coach Guard warns before a move that lets the bot's king reach the centre.
- **Three-check**: checkmate wins, and so does giving three checks. Dots next to each name count them. The bot gives the third check when it can and avoids allowing yours.
- **Cannibal King**: both kings may eat their own pieces by moving onto them, and keep that piece's moves for the rest of the game: a knight lets the king jump, a bishop slide diagonally, a rook slide straight, a queen both (a pawn is just a snack). A king with skills also gives check along them, and a king that has eaten a knight and a rook can even checkmate on its own. Kings still can't move into check. Stockfish doesn't know these rules, so `cannibal.js` has its own move generator (checked against chess.js in thousands of positions) and a small alpha-beta bot whose strength follows the six levels. Coach Guard, the score bar and the Blunder Bank rest in this mode. Saved games keep the kings' skills as a 7th FEN field (`NR/-`).
- **Chess960**: the back row starts in one of 960 shuffled orders, the same for both sides (bishops on opposite colours, king between the rooks). Castle by moving your king onto your rook, or straight to g1 or c1 when that isn't also a normal king move; the king ends on the g- or c-file and the rook beside it, as in normal chess. Stockfish plays it with `UCI_Chess960` on, and the game is saved with Shredder-FEN castling rights (`HAha`).
- **Play a friend**: two people on one device. The board turns after each move (switch it off under New game), the clocks run for both, and Take back undoes one move. No coach or Blunder Bank in these games.

Blunders in King of the Hill and Three-check games aren't saved to the Blunder Bank, since its puzzles are normal chess.

**Puzzle Sprint and Survival.** In Puzzles, **Sprint** gives you 3 minutes to solve as many puzzles as you can, and **Survival** has no clock. Both start easy and get harder, and three wrong moves end the run. Your best scores are saved.

**Step buttons.** Under the panel: jump to the start, step back, play through the moves (press again to pause), step forward, and return to the live position. From the live position, the play button replays the whole game from move 1.

**Bot levels.** Six levels, from Rookie (plays random moves part of the time) up to full-strength Stockfish, using Stockfish's `Skill Level` option.

**Sounds.** Out of the box, sounds are modelled in the browser: each move is a short click that rings a few wooden resonances plus a low board thump, with a little room echo and slight variation every time, and alerts use marimba-style notes. Turn them off in Settings (or with the speaker button on phones), where you can also switch the board between green (the default), grey and brown.

### Using recorded sounds instead

Add a `sounds` folder next to `index.html` with any of these MP3 files and the site uses them automatically (anything missing falls back to the built-in sound):

| File | Plays when |
| --- | --- |
| `move.mp3` | A piece moves (required: the site checks for this one first) |
| `capture.mp3` | A piece is captured |
| `castle.mp3` | Either side castles |
| `check.mp3` | A king is put in check |
| `promote.mp3` | A pawn promotes |
| `game-start.mp3` | A new game starts |
| `game-win.mp3`, `game-lose.mp3`, `game-draw.mp3` | The game ends (or one `game-end.mp3` for all three) |
| `warning.mp3` | Coach Guard steps in |
| `notify.mp3` | The bot slips up and the coach points it out |
| `puzzle-correct.mp3`, `puzzle-wrong.mp3` | You solve or miss a Blunder Bank puzzle |

On GitHub you can add them with **Add file → Upload files**, typing `sounds/` in front of the names; Vercel redeploys on its own. Settings then says "Playing the recorded sounds from your sounds folder."

Use sounds you are allowed to publish, since files in a public repo can be downloaded by anyone. Chess.com's sound files belong to Chess.com, and Lichess lists its standard sound set as non-free, so neither can be reused. Sounds marked CC0 (public domain) are the simplest; for anything else, check the licence allows putting the files on a public website and add the credit it asks for.

**Game summary and replay.** When a game ends, the side panel shows how your moves were rated (best, good, inaccuracies, mistakes, blunders), how many times Coach Guard saved you, and a graph of who was ahead. Click the graph, any move in the move list, or use the arrow keys to step back through the game. Moves marked `?!`, `?` and `??` in the list are your inaccuracies, mistakes and blunders.

## Keyboard

| Key | Action |
| --- | --- |
| ← / → | Step back or forward through the game |
| Home / End | Jump to the start, or back to the live position |
| Esc | In the Coach Guard banner: Undo & Rethink. In the promotion picker: cancel |
| Q / R / B / N | Pick a promotion piece |

## Changing things

- Blunder threshold: `BLUNDER_CP` in `coach.js` (centipawns, default `150`).
- Coach analysis depth and time: `ANALYSIS` in `app.js`.
- Bot levels: the `LEVELS` array in `app.js`.
- Board colours: the `body[data-board="…"]` rules at the top of `style.css`.
- Wording in Malay or Chinese: edit the row in `lang.js` (the English in the first column has to stay exactly as it is in the code). After changing any English text, run `node tools/check-lang.js` to see what still needs translating.
- Lessons: `lessons.js`. Puzzles: `puzzles.json` (`[id, FEN, "moves", rating, "themes"]`).

**Visitor stats.** The site loads Vercel Web Analytics (`/_vercel/insights/script.js`): page views and countries, with no cookies and nothing personal. Turn it on once in the Vercel dashboard under the project's **Analytics** tab; until then the script does nothing.

## Credits and licenses

- **Stockfish 10** via [stockfish.js](https://github.com/lichess-org/stockfish.js), GPLv3. It's loaded from a public CDN at runtime, not bundled.
- **chess.js** 0.10.3 by Jeff Hlywa, BSD-2-Clause.
- **Chess pieces** by Cburnett, [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/), via Wikimedia Commons.
- **Puzzles** from the [Lichess puzzle database](https://database.lichess.org/#puzzles), CC0 (public domain).
- **Tailwind CSS** Play CDN, MIT. Fonts: Atkinson Hyperlegible and Bricolage Grotesque (SIL Open Font License) from Google Fonts.

The Tailwind Play CDN prints a console note that it is meant for development. It works fine for a hobby site. For a larger production deployment you can swap it for a compiled Tailwind stylesheet.
