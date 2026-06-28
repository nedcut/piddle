# Piddle

A solver and live advisor for **Piddle**, a family dice game. The interesting
claim: the game is small enough to play *provably optimally* with plain dynamic
programming — no machine learning, no self-play, no approximation.

## The game

- 6 dice, faces 1–6. **Ones are wild.**
- Each player rolls one die; highest breaks first (ties reroll).
- On your turn you roll all 6, then keep any subset and reroll the rest,
  **up to 3 rolls** (Yahtzee-style).
- Whoever breaks first decides when to stop, and that roll count caps everyone
  for the round (others may stop earlier, never later).
- **Hand ranking:** your single best matching group. Count beats value, then
  higher face wins. Five 3s beats four 6s; four 6s beats four 5s. All wilds pile
  into one group. Six 1s = six 6s, the best possible hand.
- Tie for the top hand is a **push**: everyone adds a dollar and the round
  replays. A clean winner takes the pot.

## Why it's exactly solvable

Piddle has none of the features that make games hard. There are no shared dice,
no hidden simultaneous bets, no bluffing. The only coupling between players is
informational — later players see the hands they must beat, and the first player
picks the roll cap. So a player's entire decision state collapses to four things:

1. the dice in front of you,
2. rolls you have left,
3. the best hand you must beat,
4. how many players act after you.

That space is tiny (a few hundred thousand states at most), so backward-induction
DP gives the optimal move and exact win/push/lose probabilities. ML would be the
wrong tool: it would approximate an answer we can compute exactly.

## The non-obvious part: pushes

Maximizing your *hand strength* is not the objective — beat/tie/lose against a
specific target is. Because a tie forces a push (you stay in for another dollar
instead of losing), the solver does something a strength-maximizer never would:
**when you can't beat the leader, it plays for the tie.** The objective lives in
one function (`better`) so it's easy to swap for dollar-EV with an explicit push
value.

## Roadmap

- **Rung 1 — optimal play vs a known target.** *(done — `solver/piddle_solver.py`)*
  Exact for the last player to act.
- **Rung 2 — account for players after you.** *(done — `best_move_with_table`)*
  Replaces the fixed target with an exact challenger distribution via backward
  induction over the players still to act. This can change the best move even
  when you already beat the current hand, because improving your made hand can
  reduce the chance that someone behind you catches or beats it.
- **Rung 3 — full solve including the cap.** The first player picks the roll
  count K that maximizes their own equilibrium value.

## Use it

**Python solver / CLI:**

```bash
python3 solver/piddle_solver.py        # runs self-tests + sample situations
```

```python
from solver.piddle_solver import best_move
best_move(dice=(6, 6, 6, 2, 3, 1), rolls_left=2, target=(5, 5))
# -> keep (1, 6, 6, 6), reroll 2, win 0.802 / push 0.000 / lose 0.198
```

```python
from solver.piddle_solver import best_move_with_table
best_move_with_table(
    dice=(6, 6, 6, 6, 2, 3),
    rolls_left=1,
    target=(4, 5),
    players_after=1,
)
# -> keep (6, 6, 6, 6), reroll 2
#    You already beat four 5s, but rolling the junk dice improves your shield.
```

**Web advisor:** `web/PiddleAdvisor.jsx` is a self-contained React component with
the same solver ported to JS. The table-aware solve runs in a Web Worker so the
interface stays responsive while the exact future-player tree is computed. This
repo also includes a Bun/Vite app shell so you can run and deploy it directly.

The advisor also has local **Photo scan** support: choose or take a photo of six
light dice on a darker table and the browser estimates the die values with a
small canvas-based CV pipeline. High-confidence scans apply automatically; lower
confidence scans show the detected dice so you can apply or retake. No image is
uploaded anywhere.

```bash
bun install
bun run dev
```

Then open the local URL printed by Vite, usually `http://localhost:5173`.

For a production build:

```bash
bun run build
bun run preview
```

**Tests:**

```bash
pip install pytest
bun run test
```

The test suite checks the Python solver, verifies that the browser solver
matches the Python reference on deterministic parity sets for both the known
target solver and the table-aware solver, and runs a deterministic synthetic
dice-image test for the photo scanner.

## License

MIT — see [LICENSE](LICENSE).
