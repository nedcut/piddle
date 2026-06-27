"""Parity checks between the Python reference solver and browser JS solver."""
import json
import os
import shutil
import subprocess
import sys
import textwrap
from itertools import combinations_with_replacement
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "solver"))

from piddle_solver import best_move


def _expected_case(dice, rolls_left, target):
    move = best_move(dice, rolls_left, target)
    return {
        "dice": list(dice),
        "rollsLeft": rolls_left,
        "target": list(target),
        "keep": list(move["keep"]),
        "action": move["action"],
        "pwin": move["pwin"],
        "ptie": move["ptie"],
        "plose": move["plose"],
        "handNow": list(move["hand_now"]),
    }


def test_js_solver_matches_python_reference(tmp_path):
    bun = shutil.which("bun")
    if bun is None:
        pytest.skip("bun is required for JS solver parity")

    dice_sets = list(combinations_with_replacement(range(1, 7), 6))[::37]
    dice_sets += [
        (6, 6, 6, 2, 3, 1),
        (2, 2, 2, 2, 6, 6),
        (4, 4, 4, 4, 6, 6),
        (2, 2, 2, 2, 5, 5),
    ]
    targets = [
        (2, 2),
        (3, 6),
        (4, 4),
        (5, 3),
        (5, 4),
        (5, 5),
        (6, 6),
    ]

    cases = [
        _expected_case(dice, rolls_left, target)
        for dice in dice_sets
        for target in targets
        for rolls_left in range(3)
    ]
    case_file = tmp_path / "parity_cases.json"
    case_file.write_text(json.dumps(cases))

    script = textwrap.dedent(
        """
        import { bestMove } from "./src/piddleSolver.js";

        const cases = await Bun.file(Bun.env.PIDDLE_PARITY_CASES).json();
        const tolerance = 1e-12;

        for (const expected of cases) {
          const actual = bestMove(expected.dice, expected.rollsLeft, expected.target);
          for (const field of ["pwin", "ptie", "plose"]) {
            const delta = Math.abs(actual[field] - expected[field]);
            if (delta > tolerance) {
              throw new Error(`${field} mismatch: expected ${JSON.stringify(expected)}, actual ${JSON.stringify(actual)}`);
            }
          }

          for (const field of ["action", "keep", "handNow"]) {
            if (JSON.stringify(actual[field]) !== JSON.stringify(expected[field])) {
              throw new Error(`${field} mismatch: expected ${JSON.stringify(expected)}, actual ${JSON.stringify(actual)}`);
            }
          }
        }
        """
    )

    env = os.environ.copy()
    env["PIDDLE_PARITY_CASES"] = str(case_file)
    result = subprocess.run(
        [bun, "--eval", script],
        cwd=ROOT,
        env=env,
        text=True,
        capture_output=True,
        check=False,
    )

    assert result.returncode == 0, result.stderr or result.stdout
