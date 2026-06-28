export const EPS = 1e-12;

export const COUNT_WORD = {
  2: "pair of",
  3: "three",
  4: "four",
  5: "five",
  6: "six",
};

const FACT = [1, 1, 2, 6, 24, 120, 720];

export function evalHand(dice) {
  let wilds = 0;
  const counts = {};
  for (const d of dice) {
    if (d === 1) wilds++;
    else counts[d] = (counts[d] || 0) + 1;
  }

  let best = [-1, -1];
  for (let v = 2; v <= 6; v++) {
    const c = (counts[v] || 0) + wilds;
    if (c > best[0] || (c === best[0] && v > best[1])) best = [c, v];
  }
  return best;
}

function cmpHand(a, b) {
  return a[0] !== b[0] ? a[0] - b[0] : a[1] - b[1];
}

export function compareHands(a, b) {
  return cmpHand(a, b);
}

function outcome(dice, target) {
  const c = cmpHand(evalHand(dice), target);
  return c > 0 ? [1, 0] : c === 0 ? [0, 1] : [0, 0];
}

function better(a, b) {
  if (a[0] > b[0] + EPS) return true;
  if (a[0] < b[0] - EPS) return false;
  return a[1] > b[1] + EPS;
}

function cwr(k) {
  const res = [];
  const rec = (s, cur) => {
    if (cur.length === k) {
      res.push(cur.slice());
      return;
    }
    for (let v = s; v <= 6; v++) {
      cur.push(v);
      rec(v, cur);
      cur.pop();
    }
  };
  rec(1, []);
  return res;
}

const REROLL = {};
for (let k = 0; k <= 6; k++) {
  const denom = Math.pow(6, k);
  REROLL[k] = cwr(k).map((combo) => {
    const c = {};
    for (const x of combo) c[x] = (c[x] || 0) + 1;
    let ways = FACT[k];
    for (const key in c) ways /= FACT[c[key]];
    return [combo, ways / denom];
  });
}

function keepSets(dice) {
  const sorted = dice.slice().sort((a, b) => a - b);
  const seen = new Set();
  const out = [];
  const rec = (s, cur) => {
    const key = cur.join(",");
    if (!seen.has(key)) {
      seen.add(key);
      out.push(cur.slice());
    }
    for (let i = s; i < sorted.length; i++) {
      cur.push(sorted[i]);
      rec(i + 1, cur);
      cur.pop();
    }
  };
  rec(0, []);
  return out;
}

function compareKeeps(a, b) {
  if (a.length !== b.length) return a.length - b.length;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return a[i] - b[i];
  }
  return 0;
}

function preferredAction(candidate, best) {
  if (better(candidate.val, best.val)) return true;
  if (better(best.val, candidate.val)) return false;
  if (candidate.action !== best.action) return candidate.action === "stop";
  return compareKeeps(candidate.keep, best.keep) > 0;
}

const MEMO = new Map();
const TABLE_MEMO = new Map();
const FUTURE_MEMO = new Map();

function emptyFuture() {
  return { pBeat: 0, pTie: 0, pMiss: 1 };
}

function addScaledTable(sum, dist, p) {
  sum.pBeat += p * dist.pBeat;
  sum.pTie += p * dist.pTie;
  sum.pMiss += p * dist.pMiss;
}

function stopTableResult(dice, target, rollsLeft, playersAfter) {
  const hand = evalHand(dice);
  const rel = cmpHand(hand, target);

  if (rel > 0) {
    const future = futureChallengerDistribution(hand, rollsLeft, playersAfter);
    return {
      val: [future.pMiss, future.pTie],
      table: { pBeat: 1, pTie: 0, pMiss: 0 },
    };
  }

  if (rel === 0) {
    const future = futureChallengerDistribution(target, rollsLeft, playersAfter);
    const notBeaten = future.pTie + future.pMiss;
    return {
      val: [0, notBeaten],
      table: { pBeat: future.pBeat, pTie: notBeaten, pMiss: 0 },
    };
  }

  return {
    val: [0, 0],
    table: futureChallengerDistribution(target, rollsLeft, playersAfter),
  };
}

export function value(dice, rollsLeft, target) {
  const sorted = dice.slice().sort((a, b) => a - b);
  const key = sorted.join("") + "|" + rollsLeft + "|" + target[0] + target[1];
  if (MEMO.has(key)) return MEMO.get(key);

  let best = outcome(sorted, target);
  if (rollsLeft > 0) {
    for (const kept of keepSets(sorted)) {
      const k = 6 - kept.length;
      if (k === 0) continue;
      let pw = 0;
      let pt = 0;
      for (const [faces, p] of REROLL[k]) {
        const child = value(kept.concat(faces), rollsLeft - 1, target);
        pw += p * child[0];
        pt += p * child[1];
      }
      if (better([pw, pt], best)) best = [pw, pt];
    }
  }

  MEMO.set(key, best);
  return best;
}

function tableState(dice, rollsLeft, target, playersAfter) {
  const sorted = dice.slice().sort((a, b) => a - b);
  const key = `${sorted.join("")}|${rollsLeft}|${target[0]}${target[1]}|${playersAfter}`;
  if (TABLE_MEMO.has(key)) return TABLE_MEMO.get(key);

  const stop = stopTableResult(sorted, target, rollsLeft, playersAfter);
  let best = {
    action: "stop",
    keep: sorted,
    val: stop.val,
    table: stop.table,
  };

  if (rollsLeft > 0) {
    for (const kept of keepSets(sorted)) {
      const k = 6 - kept.length;
      if (k === 0) continue;
      let pwin = 0;
      let ptie = 0;
      const table = { pBeat: 0, pTie: 0, pMiss: 0 };
      for (const [faces, p] of REROLL[k]) {
        const child = tableState(kept.concat(faces), rollsLeft - 1, target, playersAfter);
        pwin += p * child.val[0];
        ptie += p * child.val[1];
        addScaledTable(table, child.table, p);
      }
      const candidate = { action: "reroll", keep: kept, val: [pwin, ptie], table };
      if (preferredAction(candidate, best)) best = candidate;
    }
  }

  TABLE_MEMO.set(key, best);
  return best;
}

export function futureChallengerDistribution(target, rollsLeft, playersAfter) {
  if (playersAfter <= 0) return emptyFuture();

  const key = `${target[0]}${target[1]}|${rollsLeft}|${playersAfter}`;
  if (FUTURE_MEMO.has(key)) return FUTURE_MEMO.get(key);

  const table = { pBeat: 0, pTie: 0, pMiss: 0 };
  for (const [dice, p] of REROLL[6]) {
    const child = tableState(dice, rollsLeft, target, playersAfter - 1);
    addScaledTable(table, child.table, p);
  }

  FUTURE_MEMO.set(key, table);
  return table;
}

export function bestMove(dice, rollsLeft, target) {
  const sorted = dice.slice().sort((a, b) => a - b);
  let best = { action: "stop", keep: sorted, val: outcome(sorted, target) };

  if (rollsLeft > 0) {
    for (const kept of keepSets(sorted)) {
      const k = 6 - kept.length;
      if (k === 0) continue;
      let pw = 0;
      let pt = 0;
      for (const [faces, p] of REROLL[k]) {
        const child = value(kept.concat(faces), rollsLeft - 1, target);
        pw += p * child[0];
        pt += p * child[1];
      }
      const candidate = { action: "reroll", keep: kept, val: [pw, pt] };
      if (preferredAction(candidate, best)) best = candidate;
    }
  }

  const [pw, pt] = best.val;
  return {
    keep: best.keep,
    action: best.action,
    pwin: pw,
    ptie: pt,
    plose: Math.max(0, 1 - pw - pt),
    handNow: evalHand(sorted),
  };
}

export function bestMoveWithTable(dice, rollsLeft, target, playersAfter = 0) {
  const sorted = dice.slice().sort((a, b) => a - b);
  const normalizedPlayersAfter = Math.max(0, Math.trunc(playersAfter));
  const best = tableState(sorted, rollsLeft, target, normalizedPlayersAfter);
  const [pw, pt] = best.val;
  return {
    keep: best.keep,
    action: best.action,
    pwin: pw,
    ptie: pt,
    plose: Math.max(0, 1 - pw - pt),
    handNow: evalHand(sorted),
    playersAfter: normalizedPlayersAfter,
    table: best.table,
  };
}

export function handName(hand) {
  const [c, v] = hand;
  if (c >= 6) return `six ${v}s`;
  if (c === 2) return `pair of ${v}s`;
  return `${COUNT_WORD[c]} ${v}s`;
}
