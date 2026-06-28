"""Tests for the Piddle solver. Run with: pytest solver/tests"""
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from piddle_solver import (
    best_move,
    best_move_with_table,
    better,
    eval_hand,
    future_challenger_distribution,
    value,
)


def test_public_api_accepts_lists():
    assert eval_hand([1, 1, 5, 5, 5, 6]) == (5, 5)

    m = best_move([6, 6, 6, 2, 3, 1], 2, [5, 5])
    assert tuple(m["keep"]) == (1, 6, 6, 6)


def test_public_api_rejects_invalid_states():
    with pytest.raises(ValueError, match="six values"):
        best_move((1, 2, 3, 4, 5), 2, (4, 4))

    with pytest.raises(ValueError, match="integers from 1 to 6"):
        best_move((1, 2, 3, 4, 5, 7), 2, (4, 4))

    with pytest.raises(ValueError, match="0, 1, or 2"):
        best_move((1, 2, 3, 4, 5, 6), 3, (4, 4))

    with pytest.raises(ValueError, match="target count"):
        best_move((1, 2, 3, 4, 5, 6), 2, (1, 6))


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


def test_tied_moves_use_stable_human_tiebreak():
    m = best_move((2, 2, 2, 2, 6, 6), 1, (5, 4))
    assert m["action"] == "reroll"
    assert m["keep"] == (2, 2, 2, 2)
    assert m["pwin"] == pytest.approx(1 / 9)


def test_table_mode_matches_known_target_when_no_players_remain():
    dice = (6, 6, 6, 2, 3, 1)
    target = (5, 5)
    last_player = best_move(dice, 2, target)
    table_aware = best_move_with_table(dice, 2, target, players_after=0)

    assert table_aware["action"] == last_player["action"]
    assert table_aware["keep"] == last_player["keep"]
    assert table_aware["pwin"] == pytest.approx(last_player["pwin"])
    assert table_aware["ptie"] == pytest.approx(last_player["ptie"])
    assert table_aware["plose"] == pytest.approx(last_player["plose"])


def test_table_mode_improves_a_winning_hand_when_future_players_can_challenge():
    last_player = best_move((6, 6, 6, 6, 2, 3), 1, (4, 5))
    table_aware = best_move_with_table((6, 6, 6, 6, 2, 3), 1, (4, 5), players_after=1)

    assert last_player["action"] == "stop"
    assert table_aware["action"] == "reroll"
    assert table_aware["keep"] == (6, 6, 6, 6)
    assert table_aware["pwin"] < 1
    assert table_aware["ptie"] > 0


def test_future_challenger_distribution_is_normalized_and_pressure_grows():
    one_player = future_challenger_distribution((5, 5), 2, 1)
    three_players = future_challenger_distribution((5, 5), 2, 3)

    assert sum(one_player) == pytest.approx(1)
    assert sum(three_players) == pytest.approx(1)
    assert three_players[0] > one_player[0]
