"""Tests for the Piddle solver. Run with: pytest solver/tests"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from piddle_solver import eval_hand, best_move, value, better


def test_eval_wilds():
    assert eval_hand((1, 1, 5, 5, 5, 6)) == (5, 5)   # five 5s beats four 6s
    assert eval_hand((1, 1, 1, 1, 1, 1)) == (6, 6)   # all wild -> six 6s
    assert eval_hand((1, 2, 3, 4, 5, 6)) == (2, 6)   # one wild, no pairs
    assert eval_hand((6, 6, 6, 6, 5, 3)) == (4, 6)
    assert eval_hand((1, 1, 1, 5, 5, 6)) == (5, 5)
    assert eval_hand((3, 3, 3, 5, 5, 2)) == (3, 3)   # best group only
    assert eval_hand((2, 3, 4, 5, 6, 6)) == (2, 6)   # pigeonhole: always >= a pair


def test_sure_win():
    assert best_move((4, 4, 4, 2, 3, 5), 0, (2, 2))["pwin"] == 1.0


def test_play_for_the_tie():
    m = best_move((1, 6, 6, 2, 3, 4), 2, (6, 6))
    assert m["pwin"] == 0.0 and m["ptie"] > 0.0


def test_more_rolls_never_worse():
    for r in range(0, 2):
        a = value((2, 3, 4, 5, 6, 6), r, (4, 4))
        b = value((2, 3, 4, 5, 6, 6), r + 1, (4, 4))
        assert not better(a, b)


def test_known_probabilities():
    m = best_move((6, 6, 6, 2, 3, 1), 2, (5, 5))
    assert abs(m["pwin"] - 0.802) < 1e-3
    assert tuple(m["keep"]) == (1, 6, 6, 6)
