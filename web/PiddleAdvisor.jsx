import React, { useEffect, useMemo, useRef, useState } from "react";
import { detectDiceFromFile } from "../src/diceVision.js";
import { EPS, bestMove, bestMoveWithTable, handName } from "../src/piddleSolver.js";

const C = {
  felt: "#14362d",
  feltDark: "#0a1e19",
  panel: "#f5eedf",
  panelAlt: "#ebe0cb",
  ink: "#171915",
  muted: "#677069",
  line: "#d3c4a8",
  brass: "#c9912f",
  brassDark: "#7a551b",
  oxblood: "#a94a32",
  oxbloodDark: "#64271e",
  win: "#287a54",
  push: "#c9912f",
  lose: "#b44834",
  die: "#fff8e9",
};

const PIPS = {
  1: [4],
  2: [0, 8],
  3: [0, 4, 8],
  4: [0, 2, 6, 8],
  5: [0, 2, 4, 6, 8],
  6: [0, 2, 3, 5, 6, 8],
};

const COUNT_LABEL = { 2: "Pair", 3: "Three", 4: "Four", 5: "Five", 6: "Six" };
const PLAYER_OPTIONS = [0, 1, 2, 3];

const randDie = () => 1 + Math.floor(Math.random() * 6);
const pct = (x) => `${Math.round(x * 1000) / 10}%`;
const scanPct = (x) => `${Math.round(x * 100)}%`;
const AUTO_APPLY_CONFIDENCE = 0.56;

function Die({ value, held, muted, onClick, small = false, label }) {
  const filled = new Set(PIPS[value]);
  const style = {
    "--die-size": small ? "34px" : "clamp(48px, 13.5vw, 58px)",
    "--pip-size": small ? "5px" : "clamp(6px, 1.8vw, 8px)",
  };

  return (
    <button
      type="button"
      className={`die${held ? " isHeld" : ""}${muted ? " isMuted" : ""}${small ? " isSmall" : ""}`}
      style={style}
      onClick={onClick}
      disabled={!onClick}
      aria-label={label || `Die showing ${value}`}
    >
      <span className="pipGrid" aria-hidden="true">
        {Array.from({ length: 9 }).map((_, index) => (
          <span key={index} className={filled.has(index) ? "pip isOn" : "pip"} />
        ))}
      </span>
    </button>
  );
}

function Segmented({ label, value, options, onChange, format = (x) => x }) {
  return (
    <div className="controlGroup">
      <span className="controlLabel">{label}</span>
      <div className="segmented">
        {options.map((option) => (
          <button
            key={option}
            type="button"
            className={value === option ? "segButton isActive" : "segButton"}
            aria-pressed={value === option}
            onClick={() => onChange(option)}
          >
            {format(option)}
          </button>
        ))}
      </div>
    </div>
  );
}

function OddsBar({ move, solving }) {
  const win = Math.max(0, Math.min(100, move.pwin * 100));
  const push = Math.max(0, Math.min(100, move.ptie * 100));
  const lose = Math.max(0, Math.min(100, move.plose * 100));

  return (
    <div className={solving ? "odds isSolving" : "odds"}>
      <div className="oddsBar" aria-label={`Win ${pct(move.pwin)}, push ${pct(move.ptie)}, lose ${pct(move.plose)}`}>
        <span className="oddsWin" style={{ width: `${win}%` }} />
        <span className="oddsPush" style={{ width: `${push}%` }} />
        <span className="oddsLose" style={{ width: `${lose}%` }} />
      </div>
      <div className="oddsGrid">
        <span><b>Win</b>{pct(move.pwin)}</span>
        <span><b>Push</b>{pct(move.ptie)}</span>
        <span><b>Lose</b>{pct(move.plose)}</span>
      </div>
    </div>
  );
}

function heldFlagsFor(dice, keep) {
  const need = {};
  for (const d of keep) need[d] = (need[d] || 0) + 1;
  return dice.map((d) => {
    if (need[d] > 0) {
      need[d] -= 1;
      return true;
    }
    return false;
  });
}

function recommendationText(move, rollsLeft) {
  if (move.action === "stop") {
    return rollsLeft === 0 ? "This is your hand." : "Stand pat.";
  }
  if (move.keep.length === 0) return "Reroll all six.";
  return `Hold ${move.keep.length}, reroll ${6 - move.keep.length}.`;
}

function normalizeMoveForTable(move) {
  return {
    ...move,
    table: {
      pBeat: move.pwin,
      pTie: move.ptie,
      pMiss: move.plose,
    },
    playersAfter: 0,
  };
}

export default function PiddleAdvisor() {
  const [dice, setDice] = useState([6, 6, 6, 2, 3, 1]);
  const [rollsLeft, setRollsLeft] = useState(2);
  const [tCount, setTCount] = useState(5);
  const [tValue, setTValue] = useState(5);
  const [playersAfter, setPlayersAfter] = useState(1);
  const [solverState, setSolverState] = useState({ key: "", status: "idle", move: null, error: "" });
  const [photo, setPhoto] = useState(null);
  const [scanState, setScanState] = useState({ status: "idle", result: null, applied: false, error: "" });
  const workerRef = useRef(null);
  const photoUrlRef = useRef("");
  const scanIdRef = useRef(0);

  const target = useMemo(() => [tCount, tValue], [tCount, tValue]);
  const requestKey = `${dice.join(",")}|${rollsLeft}|${target.join(",")}|${playersAfter}`;
  const baselineMove = useMemo(
    () => normalizeMoveForTable(bestMove(dice, rollsLeft, target)),
    [dice, rollsLeft, target],
  );

  useEffect(() => {
    if (playersAfter === 0) {
      setSolverState({ key: requestKey, status: "ready", move: null, error: "" });
      return undefined;
    }

    let cancelled = false;
    const id = `${requestKey}|${performance.now()}`;
    setSolverState({ key: requestKey, status: "loading", move: null, error: "" });

    const handleResult = (event) => {
      if (event.data.id !== id || cancelled) return;
      if (event.data.error) {
        setSolverState({ key: requestKey, status: "error", move: null, error: event.data.error });
      } else {
        setSolverState({ key: requestKey, status: "ready", move: event.data.move, error: "" });
      }
    };

    if (typeof Worker !== "undefined") {
      const worker = new Worker(new URL("../src/solverWorker.js", import.meta.url), { type: "module" });
      workerRef.current = worker;
      worker.addEventListener("message", handleResult);
      worker.postMessage({ id, dice, rollsLeft, target, playersAfter });
      return () => {
        cancelled = true;
        worker.terminate();
        if (workerRef.current === worker) workerRef.current = null;
      };
    }

    const fallback = window.setTimeout(async () => {
      try {
        if (!cancelled) {
          setSolverState({
            key: requestKey,
            status: "ready",
            move: bestMoveWithTable(dice, rollsLeft, target, playersAfter),
            error: "",
          });
        }
      } catch (error) {
        if (!cancelled) {
          setSolverState({
            key: requestKey,
            status: "error",
            move: null,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    }, 0);

    return () => {
      cancelled = true;
      window.clearTimeout(fallback);
    };
  }, [dice, rollsLeft, target, playersAfter, requestKey]);

  useEffect(() => () => {
    if (photoUrlRef.current) URL.revokeObjectURL(photoUrlRef.current);
  }, []);

  const tableMove =
    playersAfter > 0 && solverState.key === requestKey && solverState.status === "ready"
      ? solverState.move
      : null;
  const solving = playersAfter > 0 && (!tableMove || solverState.status === "loading");
  const move = tableMove || baselineMove;
  const holdFlags = useMemo(() => heldFlagsFor(dice, move.keep), [dice, move.keep]);
  const canRollRecommendation = !solving && move.action !== "stop" && rollsLeft > 0;
  const modeLabel = playersAfter === 0 ? "Known target" : "Table aware";

  const cycle = (index) => {
    setDice((arr) => arr.map((v, j) => (j === index ? (v % 6) + 1 : v)));
  };

  const newHand = () => {
    setDice(Array.from({ length: 6 }, randDie));
    setRollsLeft(2);
  };

  const applyRecommendation = () => {
    if (!canRollRecommendation) return;
    const need = {};
    for (const d of move.keep) need[d] = (need[d] || 0) + 1;

    setDice((arr) => arr.map((d) => {
      if (need[d] > 0) {
        need[d] -= 1;
        return d;
      }
      return randDie();
    }));
    setRollsLeft((n) => Math.max(0, n - 1));
  };

  const applyScanResult = (result) => {
    if (!result?.complete) return;
    setDice(result.values);
    setScanState((state) => ({ ...state, applied: true }));
  };

  const handlePhoto = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (photoUrlRef.current) URL.revokeObjectURL(photoUrlRef.current);
    const url = URL.createObjectURL(file);
    photoUrlRef.current = url;
    setPhoto({ url, name: file.name });
    const scanId = scanIdRef.current + 1;
    scanIdRef.current = scanId;
    setScanState({ status: "analyzing", result: null, applied: false, error: "" });
    event.target.value = "";

    try {
      const result = await detectDiceFromFile(file);
      if (scanIdRef.current !== scanId) return;
      const shouldApply = result.complete && result.averageConfidence >= AUTO_APPLY_CONFIDENCE;
      if (shouldApply) setDice(result.values);
      setScanState({ status: "ready", result, applied: shouldApply, error: "" });
    } catch (error) {
      if (scanIdRef.current !== scanId) return;
      setScanState({
        status: "error",
        result: null,
        applied: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  };

  const clearPhoto = () => {
    scanIdRef.current += 1;
    if (photoUrlRef.current) URL.revokeObjectURL(photoUrlRef.current);
    photoUrlRef.current = "";
    setPhoto(null);
    setScanState({ status: "idle", result: null, applied: false, error: "" });
  };

  return (
    <main className="app">
      <style>{css}</style>

      <header className="topbar">
        <div className="brand">
          <span className="brandMark" aria-hidden="true">P</span>
          <div>
            <h1>Piddle Advisor</h1>
            <span className={solving ? "solveStatus isBusy" : "solveStatus"}>
              {solving ? "Solving table" : modeLabel}
            </span>
          </div>
        </div>
        <label className="scanButton">
          <input type="file" accept="image/*" capture="environment" onChange={handlePhoto} />
          <span className="scanGlyph" aria-hidden="true" />
          Photo scan
        </label>
      </header>

      {photo && (
        <section className="photoPanel" aria-label="Photo scan preview">
          <div className="photoPreview">
            <img src={photo.url} alt={`Photo scan preview: ${photo.name}`} />
          </div>
          <div className="scanReadout">
            <div className="scanTopline">
              <strong>
                {scanState.status === "analyzing"
                  ? "Reading dice..."
                  : scanState.status === "error"
                    ? "Scan failed"
                    : scanState.result?.message || "Photo loaded"}
              </strong>
              <button type="button" onClick={clearPhoto}>Clear</button>
            </div>

            {scanState.result && (
              <>
                <div className="scanDice" aria-label="Detected dice">
                  {scanState.result.dice.map((die, index) => (
                    <span key={`${die.value}-${index}`}>
                      {die.value}
                      <small>{scanPct(die.confidence)}</small>
                    </span>
                  ))}
                </div>
                <p className="scanHint">
                  {scanState.applied
                    ? "Applied to your roll. Tap any die below to fix a miss."
                    : scanState.result.complete
                      ? "Looks usable, but confidence is lower. Apply it or retake."
                      : "I need all six dice. Try a brighter, straight-down shot."}
                </p>
                {scanState.result.complete && !scanState.applied && (
                  <button type="button" className="applyScanButton" onClick={() => applyScanResult(scanState.result)}>
                    Apply detected dice
                  </button>
                )}
              </>
            )}

            {scanState.status === "error" && (
              <p className="scanHint">Could not read that image: {scanState.error}</p>
            )}
          </div>
        </section>
      )}

      <section className="rollPanel" aria-label="Your roll">
        <div className="panelHead">
          <div>
            <span className="eyebrow">Your roll</span>
            <strong>{handName(move.handNow)}</strong>
          </div>
          <button type="button" className="ghostButton" onClick={newHand}>New hand</button>
        </div>

        <div className="diceRow">
          {dice.map((value, index) => (
            <Die
              key={index}
              value={value}
              held={holdFlags[index] && !solving}
              muted={!holdFlags[index] && move.action !== "stop" && !solving}
              onClick={() => cycle(index)}
              label={`Die ${index + 1}, showing ${value}. Tap to change.`}
            />
          ))}
        </div>
      </section>

      <section className="controlsPanel" aria-label="Game context">
        <div className="targetBlock">
          <span className="controlLabel">Hand to beat</span>
          <div className="targetRows">
            <div className="chipRow">
              {[2, 3, 4, 5, 6].map((count) => (
                <button
                  key={count}
                  type="button"
                  className={tCount === count ? "chip isActive" : "chip"}
                  aria-pressed={tCount === count}
                  onClick={() => setTCount(count)}
                >
                  {COUNT_LABEL[count]}
                </button>
              ))}
            </div>
            <div className="chipRow valueRow">
              {[2, 3, 4, 5, 6].map((value) => (
                <button
                  key={value}
                  type="button"
                  className={tValue === value ? "chip valueChip isActive" : "chip valueChip"}
                  aria-pressed={tValue === value}
                  onClick={() => setTValue(value)}
                >
                  {value}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="contextGrid">
          <Segmented
            label="Rolls left"
            value={rollsLeft}
            options={[2, 1, 0]}
            onChange={setRollsLeft}
          />
          <Segmented
            label="Players after you"
            value={playersAfter}
            options={PLAYER_OPTIONS}
            onChange={setPlayersAfter}
          />
        </div>
      </section>

      <section className={solving ? "movePanel isSolving" : "movePanel"} aria-label="Best move">
        <div className="moveTop">
          <span className="eyebrow">Best move</span>
          <span className="modeChip">{modeLabel}</span>
        </div>

        <p className="moveText">{recommendationText(move, rollsLeft)}</p>

        <div className="keepStrip" aria-label="Hold these dice">
          <span>Hold these</span>
          <div className="miniDiceRow">
            {move.keep.length > 0 ? (
              move.keep.map((value, index) => (
                <Die key={`${value}-${index}`} value={value} small />
              ))
            ) : (
              <strong>None</strong>
            )}
          </div>
        </div>

        <button
          type="button"
          className="primaryButton"
          onClick={applyRecommendation}
          disabled={!canRollRecommendation}
        >
          {solving
            ? "Solving exact tree"
            : canRollRecommendation
              ? "Roll recommendation"
              : "No reroll needed"}
        </button>

        <OddsBar move={move} solving={solving} />

        {solverState.status === "error" && (
          <p className="inlineError">Solver worker failed: {solverState.error}</p>
        )}

        {move.pwin < EPS && move.ptie > EPS && !solving && (
          <p className="pushNote">Playing for the push is optimal here.</p>
        )}
      </section>

      <footer className="foot">
        exact DP engine / ones wild / count beats value
      </footer>
    </main>
  );
}

const css = `
*{box-sizing:border-box;-webkit-tap-highlight-color:transparent;}
html,body,#root{min-height:100%;margin:0;}
body{background:${C.feltDark};}
button,input{font:inherit;}
button{border:0;}
.app{
  min-height:100vh;
  width:100%;
  max-width:520px;
  margin:0 auto;
  padding:14px 13px 28px;
  color:${C.ink};
  font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;
  background:
    radial-gradient(circle at 20% 0%, rgba(201,145,47,.24), transparent 32%),
    linear-gradient(160deg, ${C.felt} 0%, #0e2a24 52%, ${C.feltDark} 100%);
}
.topbar{
  display:flex;
  align-items:center;
  justify-content:space-between;
  gap:12px;
  margin-bottom:12px;
  color:${C.panel};
}
.brand{display:flex;align-items:center;gap:10px;min-width:0;}
.brandMark{
  width:34px;height:34px;display:grid;place-items:center;
  border:1px solid rgba(245,238,223,.5);
  border-radius:8px;
  background:${C.brass};
  color:${C.feltDark};
  font-weight:900;
}
h1{
  margin:0;
  font-size:21px;
  line-height:1.05;
  letter-spacing:0;
  font-family:Georgia,"Times New Roman",serif;
  font-style:italic;
}
.solveStatus{
  display:inline-flex;
  align-items:center;
  gap:6px;
  margin-top:3px;
  font-size:12px;
  color:rgba(245,238,223,.72);
}
.solveStatus::before{
  content:"";
  width:7px;height:7px;border-radius:50%;
  background:${C.win};
}
.solveStatus.isBusy::before{background:${C.brass};box-shadow:0 0 0 3px rgba(201,145,47,.18);}
.scanButton{
  position:relative;
  display:inline-flex;
  align-items:center;
  justify-content:center;
  gap:7px;
  min-height:36px;
  padding:0 10px;
  border-radius:8px;
  border:1px solid rgba(245,238,223,.28);
  background:rgba(245,238,223,.1);
  color:${C.panel};
  font-size:12px;
  font-weight:800;
  white-space:nowrap;
  cursor:pointer;
}
.scanButton input{position:absolute;inset:0;opacity:0;cursor:pointer;}
.scanGlyph{
  width:15px;
  height:12px;
  position:relative;
  border:2px solid currentColor;
  border-radius:4px;
}
.scanGlyph::before{
  content:"";
  position:absolute;
  left:3px;
  top:-5px;
  width:6px;
  height:4px;
  border-radius:3px 3px 0 0;
  background:currentColor;
}
.scanGlyph::after{
  content:"";
  position:absolute;
  left:4px;
  top:3px;
  width:4px;
  height:4px;
  border-radius:50%;
  background:currentColor;
}
.photoPanel{
  display:grid;
  grid-template-columns:118px minmax(0, 1fr);
  align-items:stretch;
  gap:10px;
  margin-bottom:10px;
  padding:8px;
  border:1px solid rgba(245,238,223,.18);
  border-radius:8px;
  background:rgba(8,24,20,.52);
  color:${C.panel};
}
.photoPreview{
  min-height:104px;
  border-radius:6px;
  overflow:hidden;
  background:rgba(0,0,0,.22);
}
.photoPreview img{
  width:100%;
  height:100%;
  min-height:104px;
  object-fit:cover;
  display:block;
}
.photoPanel button,.ghostButton{
  min-height:34px;
  padding:0 10px;
  border-radius:8px;
  border:1px solid rgba(245,238,223,.26);
  background:rgba(245,238,223,.1);
  color:${C.panel};
  font-size:12px;
  font-weight:800;
  cursor:pointer;
}
.scanReadout{
  min-width:0;
  display:flex;
  flex-direction:column;
  gap:7px;
}
.scanTopline{
  display:flex;
  align-items:center;
  justify-content:space-between;
  gap:8px;
  min-width:0;
}
.scanTopline strong{
  min-width:0;
  color:${C.panel};
  font-size:13px;
  line-height:1.2;
}
.scanDice{
  display:flex;
  flex-wrap:wrap;
  gap:5px;
}
.scanDice span{
  min-width:34px;
  min-height:34px;
  display:grid;
  place-items:center;
  border-radius:8px;
  border:1px solid rgba(245,238,223,.24);
  background:${C.panel};
  color:${C.ink};
  font-size:16px;
  font-weight:900;
  line-height:1;
}
.scanDice small{
  display:block;
  margin-top:1px;
  color:${C.muted};
  font-size:8px;
  font-weight:900;
}
.scanHint{
  margin:0;
  color:rgba(245,238,223,.72);
  font-size:12px;
  line-height:1.3;
}
.applyScanButton{
  align-self:start;
  background:${C.brass}!important;
  border-color:${C.brass}!important;
  color:${C.feltDark}!important;
}
.rollPanel,.controlsPanel,.movePanel{
  border-radius:8px;
  border:1px solid ${C.line};
  background:${C.panel};
  box-shadow:0 18px 36px rgba(0,0,0,.22);
}
.rollPanel{padding:14px 13px 15px;margin-bottom:10px;}
.panelHead{
  display:flex;
  align-items:flex-start;
  justify-content:space-between;
  gap:12px;
  margin-bottom:13px;
}
.panelHead strong{
  display:block;
  margin-top:3px;
  font-family:Georgia,"Times New Roman",serif;
  font-size:23px;
  line-height:1;
}
.eyebrow,.controlLabel{
  display:block;
  font-size:10px;
  line-height:1.2;
  letter-spacing:1.3px;
  text-transform:uppercase;
  color:${C.muted};
  font-weight:900;
}
.diceRow{
  display:grid;
  grid-template-columns:repeat(6, minmax(0, 1fr));
  gap:7px;
}
.die{
  width:var(--die-size);
  height:var(--die-size);
  max-width:100%;
  justify-self:center;
  display:grid;
  place-items:center;
  padding:0;
  border-radius:8px;
  border:1px solid #d9caa9;
  background:${C.die};
  box-shadow:inset 0 -5px 10px rgba(100,39,30,.08),0 8px 14px rgba(20,19,15,.22);
  color:${C.ink};
  cursor:pointer;
  transition:transform .14s ease, opacity .14s ease, box-shadow .14s ease;
}
.die:disabled{cursor:default;}
.die:not(:disabled):active{transform:translateY(1px);}
.die.isHeld{
  border-color:${C.brass};
  box-shadow:0 0 0 3px rgba(201,145,47,.3),0 10px 18px rgba(20,19,15,.25);
}
.die.isMuted{opacity:.46;}
.die.isSmall{box-shadow:inset 0 -4px 8px rgba(100,39,30,.08);}
.pipGrid{
  display:grid;
  grid-template-columns:repeat(3, var(--pip-size));
  gap:calc(var(--pip-size) * .74);
}
.pip{
  width:var(--pip-size);
  height:var(--pip-size);
  border-radius:50%;
}
.pip.isOn{background:currentColor;}
.controlsPanel{padding:13px;margin-bottom:10px;}
.targetBlock{margin-bottom:13px;}
.targetRows{display:grid;gap:7px;margin-top:8px;}
.chipRow{display:grid;grid-template-columns:repeat(5, minmax(0, 1fr));gap:6px;}
.chip,.segButton{
  min-height:36px;
  border-radius:8px;
  border:1px solid ${C.line};
  background:${C.panelAlt};
  color:${C.ink};
  font-size:12px;
  font-weight:900;
  cursor:pointer;
}
.valueChip{font-size:15px;}
.chip.isActive,.segButton.isActive{
  background:${C.oxblood};
  border-color:${C.oxblood};
  color:${C.panel};
}
.contextGrid{display:grid;grid-template-columns:1fr 1.25fr;gap:10px;}
.controlGroup{min-width:0;}
.segmented{display:grid;grid-auto-flow:column;grid-auto-columns:1fr;gap:5px;margin-top:7px;}
.movePanel{
  padding:14px 13px 15px;
  border-color:rgba(201,145,47,.75);
  background:linear-gradient(180deg, #fff7e8, ${C.panel});
}
.movePanel.isSolving{border-color:${C.brass};}
.moveTop{display:flex;align-items:center;justify-content:space-between;gap:10px;}
.modeChip{
  min-height:24px;
  display:inline-flex;
  align-items:center;
  padding:0 8px;
  border-radius:8px;
  background:${C.felt};
  color:${C.panel};
  font-size:11px;
  font-weight:900;
}
.moveText{
  margin:8px 0 12px;
  font-family:Georgia,"Times New Roman",serif;
  font-size:28px;
  line-height:1.02;
  font-weight:800;
  letter-spacing:0;
}
.keepStrip{
  display:flex;
  align-items:center;
  justify-content:space-between;
  gap:12px;
  min-height:46px;
  padding:8px 0;
  border-top:1px solid ${C.line};
  border-bottom:1px solid ${C.line};
}
.keepStrip>span{
  color:${C.muted};
  font-size:12px;
  font-weight:900;
}
.miniDiceRow{display:flex;align-items:center;justify-content:flex-end;gap:5px;min-width:0;flex-wrap:wrap;}
.miniDiceRow strong{font-size:13px;color:${C.muted};}
.primaryButton{
  width:100%;
  min-height:44px;
  margin:13px 0;
  border-radius:8px;
  background:${C.brass};
  color:${C.feltDark};
  font-size:14px;
  font-weight:900;
  cursor:pointer;
}
.primaryButton:disabled{
  cursor:not-allowed;
  background:#d9ccb3;
  color:${C.muted};
}
.odds{transition:opacity .15s ease;}
.odds.isSolving{opacity:.62;}
.oddsBar{
  display:flex;
  height:15px;
  overflow:hidden;
  border-radius:8px;
  background:#ded0b4;
}
.oddsBar span{display:block;min-width:0;}
.oddsWin{background:${C.win};}
.oddsPush{background:${C.push};}
.oddsLose{background:${C.lose};}
.oddsGrid{
  display:grid;
  grid-template-columns:repeat(3, 1fr);
  gap:6px;
  margin-top:9px;
}
.oddsGrid span{
  display:flex;
  align-items:baseline;
  justify-content:space-between;
  gap:7px;
  min-width:0;
  color:${C.ink};
  font-size:14px;
  font-weight:900;
}
.oddsGrid b{
  color:${C.muted};
  font-size:10px;
  letter-spacing:1px;
  text-transform:uppercase;
}
.inlineError,.pushNote{
  margin:11px 0 0;
  padding-top:10px;
  border-top:1px solid ${C.line};
  color:${C.oxbloodDark};
  font-size:13px;
  line-height:1.35;
  font-weight:800;
}
.pushNote{color:${C.brassDark};}
.foot{
  padding:13px 4px 0;
  text-align:center;
  color:rgba(245,238,223,.62);
  font-size:11px;
  font-weight:700;
}
@media (max-width:380px){
  .app{padding-left:10px;padding-right:10px;}
  .diceRow{gap:5px;}
  .moveText{font-size:25px;}
  .contextGrid{grid-template-columns:1fr;}
  .photoPanel{grid-template-columns:1fr;}
  .photoPreview{max-height:140px;}
}
`;
