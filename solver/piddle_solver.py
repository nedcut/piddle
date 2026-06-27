"""
Piddle solver — rung 1: provably optimal play against a KNOWN target.

The question this answers, exactly:
    "I have these 6 dice and R rerolls left. The hand I must beat is TARGET.
     Which dice should I keep, and what are my odds?"

This is the true optimum for the last player to act (who sees every hand they
must beat). For earlier players it is a mild over-estimate, because it ignores
that someone after them might still beat their final hand — that's rung 2,
which replaces the fixed target with a distribution.

Rules baked in:
  - 6 dice, faces 1..6. 1s are WILD.
  - Best hand = single best matching group. Count beats value; within a count,
    higher face wins. All wilds pile into the one best group. Six 1s = six 6s.
  - Keep-and-reroll: each "roll left" lets you keep any subset and reroll
    the rest. You may also just stop.

Objective (the part that's a *choice*, not a fact):
  Maximize P(win) lexicographically, breaking ties by P(push/tie). A push keeps
  you in the pot for another dollar, so it dominates a loss — which is exactly
  why, when you can't beat the leader, this solver will correctly play for the
  tie. To use a different objective (e.g. dollar-EV with an explicit push
  value), change only `better()`.
"""

from functools import lru_cache
from itertools import combinations, combinations_with_replacement
from math import factorial, prod
from collections import Counter

EPS = 1e-12


def _normalize_dice(dice):
    """Validate and return dice as a sorted tuple."""
    try:
        normalized = tuple(sorted(dice))
    except TypeError as exc:
        raise ValueError("dice must be an iterable of six integers from 1 to 6") from exc

    if len(normalized) != 6:
        raise ValueError("dice must contain exactly six values")
    if any(type(d) is not int or d < 1 or d > 6 for d in normalized):
        raise ValueError("dice values must be integers from 1 to 6")
    return normalized


def _normalize_rolls_left(rolls_left):
    if type(rolls_left) is not int or rolls_left < 0 or rolls_left > 2:
        raise ValueError("rolls_left must be 0, 1, or 2")
    return rolls_left


def _normalize_target(target):
    try:
        normalized = tuple(target)
    except TypeError as exc:
        raise ValueError("target must be a (count, value) pair") from exc

    if len(normalized) != 2:
        raise ValueError("target must be a (count, value) pair")
    count, value_ = normalized
    if type(count) is not int or count < 2 or count > 6:
        raise ValueError("target count must be an integer from 2 to 6")
    if type(value_) is not int or value_ < 2 or value_ > 6:
        raise ValueError("target value must be an integer from 2 to 6")
    return normalized


# ----------------------------- hand evaluation -----------------------------
def _eval_hand_unchecked(dice):
    wilds = sum(1 for d in dice if d == 1)
    counts = Counter(d for d in dice if d != 1)
    best = (-1, -1)
    for v in range(2, 7):
        c = counts.get(v, 0) + wilds
        cand = (c, v)
        if cand > best:           # tuple compare: count first, then value
            best = cand
    return best                   # always (count>=2) for 6 dice; see note below


def eval_hand(dice):
    """Return (count, value) of the best single group, treating 1s as wild."""
    return _eval_hand_unchecked(_normalize_dice(dice))


COUNT_WORD = {2: "pair of", 3: "three", 4: "four", 5: "five", 6: "six"}


def hand_name(hand):
    c, v = hand
    if c >= 6:
        return f"six {v}s (the nuts)"
    if c == 2:
        return f"pair of {v}s"
    return f"{COUNT_WORD[c]} {v}s"


# --------------------------- outcome vs a target ---------------------------
def _outcome_unchecked(dice, target):
    h = _eval_hand_unchecked(dice)
    if h > target:
        return (1.0, 0.0)
    if h == target:
        return (0.0, 1.0)
    return (0.0, 0.0)


def outcome(dice, target):
    """(pwin, ptie) for a *final* hand vs target. Loss is implied = 1-pwin-ptie."""
    return _outcome_unchecked(_normalize_dice(dice), _normalize_target(target))


def better(a, b):
    """Lexicographic: higher P(win), then higher P(tie)."""
    if a[0] > b[0] + EPS:
        return True
    if a[0] < b[0] - EPS:
        return False
    return a[1] > b[1] + EPS


# ----------------------- reroll outcome distribution -----------------------
def reroll_dists(k):
    """All size-k multisets of faces 1..6 with their probabilities.

    Yields (faces_tuple, probability). Iterating multisets (not 6**k ordered
    tuples) with multinomial weights keeps the solve fast.
    """
    denom = 6 ** k
    out = []
    for combo in combinations_with_replacement(range(1, 7), k):
        counts = Counter(combo)
        ways = factorial(k) // prod(factorial(c) for c in counts.values())
        out.append((combo, ways / denom))
    return out


_REROLL_CACHE = {k: reroll_dists(k) for k in range(0, 7)}


def keep_sets(dice):
    """Distinct sub-multisets to keep, as sorted tuples (deduped)."""
    seen = set()
    for r in range(0, 7):
        for combo in combinations(dice, r):
            t = tuple(sorted(combo))
            if t not in seen:
                seen.add(t)
                yield t


# --------------------------------- the DP ----------------------------------
@lru_cache(maxsize=None)
def _value(dice, rolls_left, target):
    """Optimal (pwin, ptie) from state (dice, rolls_left) against target."""
    stop_val = _outcome_unchecked(dice, target)
    if rolls_left == 0:
        return stop_val

    best = stop_val
    for kept in keep_sets(dice):
        k = 6 - len(kept)
        if k == 0:
            continue                      # keeping all == stopping; already covered
        pwin = ptie = 0.0
        for faces, p in _REROLL_CACHE[k]:
            child = _value(tuple(sorted(kept + faces)), rolls_left - 1, target)
            pwin += p * child[0]
            ptie += p * child[1]
        if better((pwin, ptie), best):
            best = (pwin, ptie)
    return best


def value(dice, rolls_left, target):
    """Optimal (pwin, ptie) from state (dice, rolls_left) against target."""
    dice = _normalize_dice(dice)
    rolls_left = _normalize_rolls_left(rolls_left)
    target = _normalize_target(target)
    return _value(dice, rolls_left, target)


def best_move(dice, rolls_left, target):
    """Recommend the optimal action and report (pwin, ptie, plose).

    Returns a dict: keep (tuple of kept faces), action ('stop'|'reroll'),
    pwin/ptie/plose, and the current hand if you stopped now.
    """
    dice = _normalize_dice(dice)
    rolls_left = _normalize_rolls_left(rolls_left)
    target = _normalize_target(target)
    stop_val = outcome(dice, target)
    best = {"action": "stop", "keep": dice, "val": stop_val}

    if rolls_left > 0:
        for kept in keep_sets(dice):
            k = 6 - len(kept)
            if k == 0:
                continue
            pwin = ptie = 0.0
            for faces, p in _REROLL_CACHE[k]:
                child = _value(tuple(sorted(kept + faces)), rolls_left - 1, target)
                pwin += p * child[0]
                ptie += p * child[1]
            if better((pwin, ptie), best["val"]):
                best = {"action": "reroll", "keep": kept, "val": (pwin, ptie)}

    pwin, ptie = best["val"]
    return {
        "keep": best["keep"],
        "reroll_count": 6 - len(best["keep"]),
        "action": best["action"],
        "pwin": pwin,
        "ptie": ptie,
        "plose": max(0.0, 1.0 - pwin - ptie),
        "hand_now": _eval_hand_unchecked(dice),
    }


def explain(dice, rolls_left, target):
    m = best_move(dice, rolls_left, target)
    print(f"  dice {dice}  | {rolls_left} roll(s) left | beat {hand_name(target)}")
    if m["action"] == "stop":
        print(f"    -> STOP. Hand stands at {hand_name(m['hand_now'])}.")
    else:
        kept = m["keep"] if m["keep"] else "(nothing)"
        print(f"    -> KEEP {kept}, reroll {m['reroll_count']} "
              f"(currently {hand_name(m['hand_now'])}).")
    print(f"       win {m['pwin']:.3f}  push {m['ptie']:.3f}  lose {m['plose']:.3f}")


# ------------------------------- self-tests --------------------------------
def _tests():
    # eval_hand: the load-bearing wild cases
    assert eval_hand((1, 1, 5, 5, 5, 6)) == (5, 5)   # five 5s beats four 6s
    assert eval_hand((1, 1, 1, 1, 1, 1)) == (6, 6)   # all wild -> six 6s
    assert eval_hand((1, 2, 3, 4, 5, 6)) == (2, 6)   # one wild, no pairs
    assert eval_hand((6, 6, 6, 6, 5, 3)) == (4, 6)
    assert eval_hand((1, 1, 1, 5, 5, 6)) == (5, 5)
    assert eval_hand((3, 3, 3, 5, 5, 2)) == (3, 3)   # best group only
    assert eval_hand((2, 3, 4, 5, 6, 6)) == (2, 6)   # pigeonhole: always >= a pair

    # DP sanity 1: already beat target, 0 rolls -> sure win
    assert best_move((4, 4, 4, 2, 3, 5), 0, (2, 2))["pwin"] == 1.0

    # DP sanity 2: cannot possibly beat six 6s -> play for the tie, win prob 0
    m = best_move((1, 6, 6, 2, 3, 4), 2, (6, 6))
    assert m["pwin"] == 0.0 and m["ptie"] > 0.0

    # DP sanity 3: more rolls is never worse vs a fixed target
    for r in range(0, 2):
        a = value((2, 3, 4, 5, 6, 6), r, (4, 4))
        b = value((2, 3, 4, 5, 6, 6), r + 1, (4, 4))
        assert not better(a, b), (a, b)   # b should be >= a
    print("all tests passed\n")


if __name__ == "__main__":
    _tests()

    print("Sample situations:\n")

    # You're last. Leader has four 5s. You opened with three 6s + junk, 2 rolls left.
    explain((6, 6, 6, 2, 3, 1), 2, (5, 5))
    print()
    # Same spot, but now you must beat five 6s — much steeper.
    explain((6, 6, 6, 2, 3, 1), 2, (6, 6))
    print()
    # You already hold five 6s with a roll left, only need to beat four 4s.
    explain((6, 6, 6, 6, 6, 2), 1, (4, 4))
    print()
    # Hopeless against six 6s: solver should chase the push.
    explain((1, 1, 6, 6, 5, 4), 2, (6, 6))
