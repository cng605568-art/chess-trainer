# Second Look: chess trainer with a live coach

A free, static chess practice site. You play Stockfish, a coach checks every move before it lands, and every blunder you make becomes a puzzle in your own Blunder Bank.

No build step, no server, no accounts. Everything runs in the browser and saves to `localStorage`.

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

A sidebar on the left switches between **Home**, **Play**, **Blunder Bank** and **Settings**. The board sits in the middle with player bars above and below it. The right panel has three tabs: **Game** (status, controls, game summary, coach notes, moves), **New game** (choose your colour and time limit, then pick a bot from six cards) and **Settings** (Coach Guard, evaluation bar, sounds, board colour). On phones the sidebar turns into a slide-out menu behind the ☰ button, the top bar gets quick buttons for the Blunder Bank and sound, and the site opens on **Home**: a Play card with level chips and a big Start game button, shortcut buttons, a puzzle card showing your newest saved blunder, your game history, and stats (games, wins, Coach Guard saves, puzzles solved and waiting). Finishing games without a blunder builds a clean-game streak. During a game on a phone, the board runs edge to edge between the two player bars, the panel tabs become an icon bar under the board, and the step buttons stay pinned to the bottom of the screen. The evaluation bar is left out on phones to keep the board full width; the score still shows next to the status.

## What's inside

| File | Job |
| --- | --- |
| `index.html` | Sidebar, board, right panel with Game / New game / Settings tabs, Tailwind CDN, chess.js CDN, Cburnett piece SVGs, promotion and Coach Guard modals |
| `style.css` | Grey theme, board colours, highlights, danger pulse, menu cards, responsive rules |
| `stockfish-worker.js` | Web Worker that loads Stockfish 10 from cdnjs (jsDelivr as backup) and answers search requests as JSON. Falls back to a small built-in engine if both CDNs are blocked |
| `coach.js` | Plain-English move explanations (hanging pieces, checks, center control, castling, evaluation swings) and the Blunder Bank storage |
| `app.js` | Board rendering and piece animation, click or drag to move, pawn promotion, sound effects, the game loop, Coach Guard, replay, game summary, puzzle trainer |
| `vercel.json` | `cleanUrls` so Vercel serves `index.html` at `/` |

## How the features work

**Coach Guard.** While you think, Stockfish evaluates the position. When you move, it evaluates the new position too. If your move drops the evaluation by more than 1.5 pawns (scores are capped at ±10 so mates and huge leads don't trigger false alarms), the move pauses, the threatened square pulses red, and you choose **Undo & Rethink** or **Play Anyway**. Turn the guard off in the Settings tab of the right panel to play freely.

**Coach notes.** After each move, deterministic rules in `coach.js` describe what happened in beginner language: captures, checks, castling, central pawns, development, early queen moves, loose pieces, and when the bot slips up. Everything is written for complete beginners: moves are described in words ("move your knight from g1 to f3") instead of chess notation, gains and losses are measured in pieces ("like giving away a knight") instead of engine numbers, and chess words like check, fork, castling and stalemate are explained where they come up. The opponent is always called "the bot".

**My Blunder Bank.** Every blunder is saved (position + Stockfish's best move), whether the guard caught it or not. In the Blunder Bank tab you replay the position and look for a better move. Stockfish's move, or any move that keeps the position within 0.6 pawns of it, solves the puzzle and clears it from the queue.

**Clocks.** Each player bar has a clock that turns white while that side is thinking. Pick a time limit under New game: **No limit** (the clocks count how long each side spends thinking), **15 | 10** (15 minutes plus 10 seconds after every move), **10 min** or **5 min**. Your clock stops while the coach checks your move and while the Coach Guard banner is open, so the coach never costs you time. If a clock runs out, that side loses, unless the other side has only a king, or a king and one bishop or knight, which makes it a draw. The bot speeds up when it's short on time.

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

## Credits and licenses

- **Stockfish 10** via [stockfish.js](https://github.com/lichess-org/stockfish.js), GPLv3. It's loaded from a public CDN at runtime, not bundled.
- **chess.js** 0.10.3 by Jeff Hlywa, BSD-2-Clause.
- **Chess pieces** by Cburnett, [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/), via Wikimedia Commons.
- **Tailwind CSS** Play CDN, MIT. Fonts: Atkinson Hyperlegible and Bricolage Grotesque (SIL Open Font License) from Google Fonts.

The Tailwind Play CDN prints a console note that it is meant for development. It works fine for a hobby site. For a larger production deployment you can swap it for a compiled Tailwind stylesheet.
