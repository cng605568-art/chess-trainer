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

## What's inside

| File | Job |
| --- | --- |
| `index.html` | Layout, Tailwind CDN, chess.js CDN, Cburnett piece SVGs, promotion and Coach Guard modals |
| `style.css` | Board, highlights, danger pulse, dark theme, responsive rules |
| `stockfish-worker.js` | Web Worker that loads Stockfish 10 from cdnjs (jsDelivr as backup) and answers search requests as JSON. Falls back to a small built-in engine if both CDNs are blocked |
| `coach.js` | Plain-English move explanations (hanging pieces, checks, center control, castling, evaluation swings) and the Blunder Bank storage |
| `app.js` | Board rendering and piece animation, click or drag to move, pawn promotion, sound effects, the game loop, Coach Guard, replay, game summary, puzzle trainer |
| `vercel.json` | `cleanUrls` so Vercel serves `index.html` at `/` |

## How the features work

**Coach Guard.** While you think, Stockfish evaluates the position. When you move, it evaluates the new position too. If your move drops the evaluation by more than 1.5 pawns (scores are capped at ±10 so mates and huge leads don't trigger false alarms), the move pauses, the threatened square pulses red, and you choose **Undo & Rethink** or **Play Anyway**. Turn the guard off in the side panel to play freely.

**Coach notes.** After each move, deterministic rules in `coach.js` describe what happened in beginner language: captures, checks, castling, central pawns, development, early queen moves, loose pieces, and when the bot slips up.

**My Blunder Bank.** Every blunder is saved (position + Stockfish's best move), whether the guard caught it or not. In the Blunder Bank tab you replay the position and look for a better move. Stockfish's move, or any move that keeps the position within 0.6 pawns of it, solves the puzzle and clears it from the queue.

**Bot levels.** Six levels, from Rookie (plays random moves part of the time) up to full-strength Stockfish, using Stockfish's `Skill Level` option.

**Sounds.** Wooden piece clicks for moves and captures, a double click for castling, chimes for check, promotion, hints and solved puzzles, a low two-note alert when Coach Guard steps in, and short tunes for a win, loss or draw. They are generated in the browser with the Web Audio API, so there are no audio files to download or license. Turn them off in the side panel.

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
- Board colours: `--sq-light` and `--sq-dark` in `style.css`.

## Credits and licenses

- **Stockfish 10** via [stockfish.js](https://github.com/lichess-org/stockfish.js), GPLv3. It's loaded from a public CDN at runtime, not bundled.
- **chess.js** 0.10.3 by Jeff Hlywa, BSD-2-Clause.
- **Chess pieces** by Cburnett, [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/), via Wikimedia Commons.
- **Tailwind CSS** Play CDN, MIT. Fonts: Atkinson Hyperlegible and Bricolage Grotesque (SIL Open Font License) from Google Fonts.

The Tailwind Play CDN prints a console note that it is meant for development. It works fine for a hobby site. For a larger production deployment you can swap it for a compiled Tailwind stylesheet.
