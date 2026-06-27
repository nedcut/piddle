import React, { useMemo, useState } from "react";
import { EPS, bestMove, handName } from "../src/piddleSolver.js";

/* ===========================================================================
   PIDDLE ADVISOR — live optimal-move helper (rung 1: vs a known target)
   Tap your dice, set rolls left and the hand to beat. It computes the exact
   best keep and your win / push / lose odds. Ones are wild.
   =========================================================================== */

const C = {
  felt: "#16382E", felt2: "#1E4A3C", rim: "#0E261F",
  bone: "#F3ECD8", boneEdge: "#D8CEB0", ink: "#1B1A16",
  gold: "#E3B23C", oxblood: "#A8412A", oxbloodHi: "#C25438",
  cream: "#ECE4CF", creamDim: "#9FB0A6", win: "#5BBF8A",
};

const PIPS = {
  1: [4], 2: [0, 8], 3: [0, 4, 8], 4: [0, 2, 6, 8],
  5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8],
};
const COUNT_LABEL = { 2: "Pair", 3: "Three", 4: "Four", 5: "Five", 6: "Six" };

/* --------------------------------- Die UI --------------------------------- */
function Die({ value: v, wild, hold, faded, onClick, small, label }) {
  const size = small ? 38 : 56;
  const pip = small ? 6 : 9;
  const filled = new Set(PIPS[v]);
  return (
    <button type="button" onClick={onClick} disabled={!onClick} className="die" aria-label={label}
      style={{
        width: size, height: size,
        background: wild ? C.gold : C.bone,
        borderColor: C.boneEdge,
        opacity: faded ? 0.5 : 1,
        boxShadow: hold
          ? `0 0 0 3px ${C.cream}, 0 0 14px rgba(236,228,207,.5), 0 4px 8px rgba(0,0,0,.35)`
          : `0 4px 8px rgba(0,0,0,.3)`,
        cursor: onClick ? "pointer" : "default",
      }}>
      <div className="pipGrid" style={{ gridTemplateColumns: `repeat(3, ${pip}px)`, gap: small ? 5 : 7 }}>
        {Array.from({ length: 9 }).map((_, i) => (
          <span key={i} style={{ width: pip, height: pip, borderRadius: "50%",
            background: filled.has(i) ? (wild ? C.rim : C.ink) : "transparent" }} />
        ))}
      </div>
      {hold && <span className="tag hold">HOLD</span>}
      {!hold && onClick && <span className="tag reroll">reroll</span>}
    </button>
  );
}

/* --------------------------------- App ------------------------------------ */
const randDie = () => 1 + Math.floor(Math.random() * 6);

export default function PiddleAdvisor() {
  const [dice, setDice] = useState([6, 6, 6, 2, 3, 1]);
  const [rollsLeft, setRollsLeft] = useState(2);
  const [tCount, setTCount] = useState(5);
  const [tValue, setTValue] = useState(5);
  const target = useMemo(() => [tCount, tValue], [tCount, tValue]);

  const move = useMemo(() => bestMove(dice, rollsLeft, target), [dice, rollsLeft, target]);

  // map recommended keep-multiset back onto the displayed dice
  const holdFlags = useMemo(() => {
    const need = {}; for (const d of move.keep) need[d] = (need[d] || 0) + 1;
    return dice.map((d) => {
      if (need[d] > 0) { need[d]--; return true; }
      return false;
    });
  }, [dice, move]);

  const cycle = (i) => setDice((arr) => arr.map((v, j) => (j === i ? (v % 6) + 1 : v)));
  const newHand = () => {
    setDice(Array.from({ length: 6 }, randDie));
    setRollsLeft(2);
  };
  const applyRecommendation = () => {
    if (move.action === "stop" || rollsLeft === 0) return;

    const need = {};
    for (const d of move.keep) need[d] = (need[d] || 0) + 1;

    setDice((arr) => arr.map((d) => {
      if (need[d] > 0) {
        need[d]--;
        return d;
      }
      return randDie();
    }));
    setRollsLeft((n) => Math.max(0, n - 1));
  };

  const pct = (x) => Math.round(x * 100);
  const verdict =
    move.action === "stop"
      ? rollsLeft === 0 ? "This is your hand." : "Stand pat — don't reroll."
      : move.keep.length === 0
        ? "Reroll everything."
        : `Hold the highlighted dice, reroll ${6 - move.keep.length}.`;

  return (
    <div className="wrap">
      <style>{css}</style>

      <header className="top">
        <span className="mark">⚅</span>
        <span className="word">Piddle Advisor</span>
      </header>

      {/* dice */}
      <section className="card">
        <div className="rowhead">
          <span className="label">Your dice</span>
          <button className="mini" onClick={newHand}>new hand</button>
        </div>
        <div className="diceRow">
          {dice.map((v, i) => (
            <Die key={i} value={v} wild={v === 1} hold={holdFlags[i]}
              faded={!holdFlags[i] && move.action !== "stop"} onClick={() => cycle(i)}
              label={`Die ${i + 1}, showing ${v}. Tap to change.`} />
          ))}
        </div>
        <p className="sub">Tap a die to change it. You have {handName(move.handNow)} right now.</p>
      </section>

      {/* rolls left */}
      <section className="card">
        <span className="label">Rolls left (rerolls you can still take)</span>
        <div className="seg">
          {[2, 1, 0].map((n) => (
            <button key={n} className={"segbtn" + (rollsLeft === n ? " on" : "")}
              aria-pressed={rollsLeft === n} onClick={() => setRollsLeft(n)}>{n}</button>
          ))}
        </div>
      </section>

      {/* target */}
      <section className="card">
        <span className="label">Hand to beat</span>
        <div className="chips">
          {[2, 3, 4, 5, 6].map((c) => (
            <button key={c} className={"chip" + (tCount === c ? " on" : "")}
              aria-pressed={tCount === c} onClick={() => setTCount(c)}>{COUNT_LABEL[c]}</button>
          ))}
        </div>
        <div className="chips vals">
          {[2, 3, 4, 5, 6].map((v) => (
            <button key={v} className={"chip val" + (tValue === v ? " on" : "")}
              aria-pressed={tValue === v} onClick={() => setTValue(v)}>{v}</button>
          ))}
        </div>
        <p className="sub">Beating: <b>{handName(target)}</b> {tCount >= 6 ? "(the nuts)" : ""}</p>
      </section>

      {/* verdict */}
      <section className="verdict">
        <span className="vlabel">Best move</span>
        <p className="vtext">{verdict}</p>
        <button className="primary" onClick={applyRecommendation}
          disabled={move.action === "stop" || rollsLeft === 0}>
          {move.action === "stop" || rollsLeft === 0 ? "No reroll needed" : "Roll the recommendation"}
        </button>
        <div className="bar">
          <div className="seg-win" style={{ width: `${pct(move.pwin)}%` }} />
          <div className="seg-push" style={{ width: `${pct(move.ptie)}%` }} />
          <div className="seg-lose" style={{ width: `${pct(move.plose)}%` }} />
        </div>
        <div className="legend">
          <span><i className="dot" style={{ background: C.win }} /> Win {pct(move.pwin)}%</span>
          <span><i className="dot" style={{ background: C.gold }} /> Push {pct(move.ptie)}%</span>
          <span><i className="dot" style={{ background: C.oxbloodHi }} /> Lose {pct(move.plose)}%</span>
        </div>
        {move.pwin < EPS && move.ptie > EPS && (
          <p className="note">Can't win outright — playing for the tie to force a push.</p>
        )}
      </section>

      <footer className="foot">exact optimum vs a known target · ones wild · count beats value</footer>
    </div>
  );
}

const css = `
@import url('https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,700;1,9..144,800;1,9..144,900&family=Space+Grotesk:wght@400;500;700&display=swap');
*{box-sizing:border-box;-webkit-tap-highlight-color:transparent;}
html,body,#root{min-height:100%;margin:0;background:${C.rim};}
button{font:inherit;}
.wrap{min-height:100vh;margin:0 auto;max-width:480px;padding:16px 14px 36px;
  font-family:'Space Grotesk',system-ui,sans-serif;color:${C.cream};
  background:radial-gradient(120% 80% at 50% -10%, ${C.felt2}, ${C.felt} 55%, ${C.rim});background-attachment:fixed;}
.top{display:flex;align-items:center;gap:9px;margin-bottom:14px;}
.mark{font-size:24px;color:${C.gold};}
.word{font-family:'Fraunces',serif;font-weight:900;font-style:italic;font-size:24px;}
.card{background:rgba(8,26,20,.45);border:1px solid rgba(236,228,207,.10);border-radius:8px;padding:15px 15px;margin-bottom:12px;}
.rowhead{display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;}
.label{font-size:11px;letter-spacing:2px;text-transform:uppercase;color:${C.creamDim};}
.sub{font-size:13px;color:${C.creamDim};margin:12px 0 0;line-height:1.4;}
.sub b{color:${C.gold};font-family:'Fraunces',serif;}
.mini{background:rgba(255,255,255,.07);border:1px solid rgba(236,228,207,.15);color:${C.cream};
  border-radius:9px;padding:6px 10px;font-size:12px;font-family:'Space Grotesk';font-weight:500;cursor:pointer;}
.diceRow{display:flex;gap:9px;justify-content:center;flex-wrap:wrap;padding-top:6px;}
.die{position:relative;border-radius:8px;border:1px solid;display:grid;place-items:center;padding:0;transition:.12s;}
.pipGrid{display:grid;}
.tag{position:absolute;bottom:-8px;left:50%;transform:translateX(-50%);font-size:7.5px;font-weight:700;
  letter-spacing:.5px;padding:1px 5px;border-radius:5px;white-space:nowrap;}
.tag.hold{background:${C.cream};color:${C.rim};}
.tag.reroll{background:rgba(168,65,42,.85);color:${C.cream};text-transform:lowercase;}
.seg{display:flex;gap:8px;margin-top:10px;}
.segbtn{flex:1;padding:12px 0;border-radius:11px;font-weight:700;font-size:17px;cursor:pointer;
  background:rgba(255,255,255,.05);color:${C.cream};border:1px solid rgba(236,228,207,.12);}
.segbtn.on{background:${C.gold};color:${C.rim};border-color:${C.gold};}
.chips{display:flex;gap:6px;margin-top:10px;flex-wrap:wrap;}
.chips.vals{margin-top:7px;}
.chip{flex:1;min-width:54px;padding:10px 0;border-radius:10px;font-weight:700;font-size:14px;cursor:pointer;
  background:rgba(255,255,255,.05);color:${C.cream};border:1px solid rgba(236,228,207,.12);}
.chip.val{min-width:0;}
.chip.on{background:${C.oxbloodHi};color:${C.cream};border-color:${C.oxbloodHi};}
.verdict{background:rgba(0,0,0,.28);border:1px solid rgba(227,178,60,.3);border-radius:8px;padding:18px 16px;margin-bottom:12px;}
.vlabel{font-size:11px;letter-spacing:2px;text-transform:uppercase;color:${C.gold};}
.vtext{font-family:'Fraunces',serif;font-weight:800;font-size:21px;line-height:1.15;margin:8px 0 14px;}
.primary{width:100%;margin:0 0 14px;padding:12px 14px;border-radius:8px;border:1px solid ${C.gold};
  background:${C.gold};color:${C.rim};font-family:'Space Grotesk';font-size:14px;font-weight:800;cursor:pointer;}
.primary:disabled{cursor:not-allowed;background:rgba(255,255,255,.05);border-color:rgba(236,228,207,.12);color:${C.creamDim};}
.bar{display:flex;height:16px;border-radius:8px;overflow:hidden;background:rgba(0,0,0,.3);}
.seg-win{background:${C.win};}.seg-push{background:${C.gold};}.seg-lose{background:${C.oxbloodHi};}
.legend{display:flex;gap:14px;flex-wrap:wrap;margin-top:10px;font-size:13px;color:${C.cream};}
.legend .dot{display:inline-block;width:9px;height:9px;border-radius:50%;margin-right:5px;}
.note{margin:12px 0 0;font-size:13px;color:${C.gold};line-height:1.4;}
.foot{text-align:center;margin-top:8px;font-size:10.5px;letter-spacing:.5px;color:${C.creamDim};opacity:.7;}
`;
