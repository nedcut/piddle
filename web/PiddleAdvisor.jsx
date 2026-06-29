import React, { useEffect, useMemo, useRef, useState } from "react";
import { detectDiceFromFile } from "../src/diceVision.js";
import { EPS, bestMove, bestMoveWithTable, evalHand, handName } from "../src/piddleSolver.js";

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
const DIE_VALUES = [1, 2, 3, 4, 5, 6];
const ROLL_SIZE = 6;

const randDie = () => 1 + Math.floor(Math.random() * 6);
const pct = (x) => `${Math.round(x * 1000) / 10}%`;
const SCAN_UNCERTAIN_CONFIDENCE = 0.68;

const emptyRoll = () => Array.from({ length: ROLL_SIZE }, () => null);
const emptyUncertainty = () => Array.from({ length: ROLL_SIZE }, () => false);

function isCompleteRoll(values) {
  return values.length === ROLL_SIZE && values.every((value) => Number.isInteger(value));
}

function nextOpenSlot(values, current) {
  for (let offset = 1; offset <= values.length; offset += 1) {
    const index = (current + offset) % values.length;
    if (!values[index]) return index;
  }
  return current;
}

function PipGrid({ value }) {
  const filled = new Set(PIPS[value] || []);

  return (
    <span className="pipGrid" aria-hidden="true">
      {Array.from({ length: 9 }).map((_, index) => (
        <span key={index} className={filled.has(index) ? "pip isOn" : "pip"} />
      ))}
    </span>
  );
}

function Die({ value, held, muted, selected, uncertain, onClick, small = false, label }) {
  const empty = !value;
  const style = {
    "--die-size": small ? "34px" : "clamp(48px, 13.5vw, 58px)",
    "--pip-size": small ? "5px" : "clamp(6px, 1.8vw, 8px)",
  };

  return (
    <button
      type="button"
      className={`die${held ? " isHeld" : ""}${muted ? " isMuted" : ""}${selected ? " isSelected" : ""}${uncertain ? " isUncertain" : ""}${empty ? " isEmpty" : ""}${small ? " isSmall" : ""}`}
      style={style}
      onClick={onClick}
      disabled={!onClick}
      aria-label={label || (value ? `Die showing ${value}` : "Empty die slot")}
    >
      {value ? <PipGrid value={value} /> : <span className="emptySlotMark" aria-hidden="true" />}
    </button>
  );
}

function DieFace({ value }) {
  return (
    <span className="dieFace" aria-hidden="true">
      <PipGrid value={value} />
    </span>
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
  const [dice, setDice] = useState(() => [6, 6, 6, 2, 3, 1]);
  const [draftDice, setDraftDice] = useState(() => [6, 6, 6, 2, 3, 1]);
  const [activeSlot, setActiveSlot] = useState(0);
  const [uncertainSlots, setUncertainSlots] = useState(emptyUncertainty);
  const [rollsLeft, setRollsLeft] = useState(2);
  const [tCount, setTCount] = useState(5);
  const [tValue, setTValue] = useState(5);
  const [playersAfter, setPlayersAfter] = useState(1);
  const [solverState, setSolverState] = useState({ key: "", status: "idle", move: null, error: "" });
  const [photo, setPhoto] = useState(null);
  const [scanState, setScanState] = useState({ status: "idle", result: null, error: "" });
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
  const filledCount = draftDice.filter(Boolean).length;
  const diceLeft = ROLL_SIZE - filledCount;
  const draftComplete = isCompleteRoll(draftDice);
  const draftDirty = draftDice.some((value, index) => value !== dice[index]);
  const hasUncertainSlots = uncertainSlots.some(Boolean);
  const draftHandLabel = draftComplete
    ? handName(evalHand(draftDice))
    : `${diceLeft} ${diceLeft === 1 ? "die" : "dice"} left`;
  const doneLabel = draftComplete ? (draftDirty || hasUncertainSlots ? "Done" : "Saved") : draftHandLabel;
  const topStatus = solving ? "Solving table" : draftDirty ? "Editing draft" : modeLabel;
  const adviceBasisLabel = draftDirty ? "Saved roll" : modeLabel;
  const scanTitle =
    scanState.status === "analyzing"
      ? "Reading dice..."
      : scanState.status === "error"
        ? "Scan failed"
        : scanState.result?.complete
          ? "Roll pad filled"
          : scanState.result
            ? scanState.result.message
            : "Photo loaded";
  const scanHint =
    scanState.status === "error"
      ? `Could not read that image: ${scanState.error}`
      : scanState.result?.complete
        ? "Check the highlighted slots, then save the roll."
        : scanState.result
          ? "Fill the open slots or retake the photo."
          : "A straight-down, bright shot works best.";

  const selectSlot = (index) => {
    setActiveSlot(index);
  };

  const fillSlot = (value) => {
    const slot = activeSlot;
    const next = draftDice.map((current, index) => (index === slot ? value : current));
    setDraftDice(next);
    setUncertainSlots((flags) => flags.map((flag, index) => (index === slot ? false : flag)));
    setActiveSlot(nextOpenSlot(next, slot));
  };

  const clearPhoto = () => {
    scanIdRef.current += 1;
    if (photoUrlRef.current) URL.revokeObjectURL(photoUrlRef.current);
    photoUrlRef.current = "";
    setPhoto(null);
    setScanState({ status: "idle", result: null, error: "" });
  };

  const clearDraftRoll = () => {
    clearPhoto();
    setDraftDice(emptyRoll());
    setUncertainSlots(emptyUncertainty());
    setActiveSlot(0);
  };

  const commitDraftRoll = () => {
    if (!draftComplete) return;
    const next = draftDice.slice();
    setDice(next);
    setDraftDice(next);
    setUncertainSlots(emptyUncertainty());
    setActiveSlot(0);
  };

  const applyRecommendation = () => {
    if (!canRollRecommendation) return;
    const need = {};
    for (const d of move.keep) need[d] = (need[d] || 0) + 1;

    const next = dice.map((d) => {
      if (need[d] > 0) {
        need[d] -= 1;
        return d;
      }
      return randDie();
    });

    setDice(next);
    setDraftDice(next);
    setUncertainSlots(emptyUncertainty());
    setActiveSlot(0);
    clearPhoto();
    setRollsLeft((n) => Math.max(0, n - 1));
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
    setScanState({ status: "analyzing", result: null, error: "" });
    event.target.value = "";

    try {
      const result = await detectDiceFromFile(file);
      if (scanIdRef.current !== scanId) return;
      const nextDraft = emptyRoll();
      const nextUncertain = emptyUncertainty();
      result.dice.slice(0, ROLL_SIZE).forEach((die, index) => {
        nextDraft[index] = die.value;
        nextUncertain[index] = die.confidence < SCAN_UNCERTAIN_CONFIDENCE;
      });
      const firstFix = nextDraft.findIndex((value, index) => !value || nextUncertain[index]);
      setDraftDice(nextDraft);
      setUncertainSlots(nextUncertain);
      setActiveSlot(firstFix === -1 ? ROLL_SIZE - 1 : firstFix);
      setScanState({ status: "ready", result, error: "" });
    } catch (error) {
      if (scanIdRef.current !== scanId) return;
      setScanState({
        status: "error",
        result: null,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  };

  return (
    <main className="app">
      <style>{css}</style>

      <header className="topbar">
        <div className="brand">
          <span className="brandMark" aria-hidden="true">P</span>
          <div>
            <h1>Piddle Advisor</h1>
            <span className={`solveStatus${solving ? " isBusy" : ""}${draftDirty ? " isDraft" : ""}`}>
              {topStatus}
            </span>
          </div>
        </div>
        <label className="scanButton">
          <input type="file" accept="image/*" capture="environment" onChange={handlePhoto} />
          <span className="scanGlyph" aria-hidden="true" />
          Scan dice
        </label>
      </header>

      {photo && (
        <section className="photoPanel" aria-label="Photo scan preview">
          <div className="photoPreview">
            <img src={photo.url} alt={`Photo scan preview: ${photo.name}`} />
          </div>
          <div className="scanReadout">
            <div className="scanTopline">
              <strong>{scanTitle}</strong>
              <button type="button" onClick={clearPhoto}>Clear</button>
            </div>

            <p className="scanHint">{scanHint}</p>
          </div>
        </section>
      )}

      <section className="rollPanel" aria-label="Your roll">
        <div className="panelHead">
          <div>
            <span className="eyebrow">{draftDirty ? "Draft roll" : "Saved roll"}</span>
            <strong aria-live="polite">{draftHandLabel}</strong>
          </div>
          <button type="button" className="ghostButton" onClick={clearDraftRoll}>New roll</button>
        </div>

        <div className="diceRow">
          {draftDice.map((value, index) => (
            <Die
              key={index}
              value={value}
              selected={activeSlot === index}
              uncertain={uncertainSlots[index]}
              held={!draftDirty && holdFlags[index] && !solving}
              muted={!draftDirty && !holdFlags[index] && move.action !== "stop" && !solving}
              onClick={() => selectSlot(index)}
              label={value
                ? `Slot ${index + 1}, showing ${value}. Tap to select.`
                : `Slot ${index + 1}, empty. Tap to select.`}
            />
          ))}
        </div>

        <div className="keypad" aria-label="Dice value keypad">
          {DIE_VALUES.map((value) => (
            <button
              key={value}
              type="button"
              className="keyButton"
              onClick={() => fillSlot(value)}
              aria-label={`Set selected slot to ${value}`}
            >
              <DieFace value={value} />
            </button>
          ))}
        </div>

        <div className="rollFooter">
          <span className={draftDirty ? "rollStatus isDraft" : "rollStatus"}>
            {draftDirty ? "Advice uses saved roll" : "Advice current"}
          </span>
          <button
            type="button"
            className="doneButton"
            onClick={commitDraftRoll}
            disabled={!draftComplete || (!draftDirty && !hasUncertainSlots)}
          >
            {doneLabel}
          </button>
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
          <span className="modeChip">{adviceBasisLabel}</span>
        </div>

        {draftDirty && (
          <div className="savedRollStrip" aria-label="Saved roll used for advice">
            <span>Saved roll</span>
            <div className="miniDiceRow">
              {dice.map((value, index) => (
                <Die key={`${value}-${index}`} value={value} small />
              ))}
            </div>
          </div>
        )}

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
.solveStatus.isDraft::before{background:${C.oxblood};}
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
.scanHint{
  margin:0;
  color:rgba(245,238,223,.72);
  font-size:12px;
  line-height:1.3;
}
.rollPanel,.controlsPanel,.movePanel{
  border-radius:8px;
  border:1px solid ${C.line};
  background:${C.panel};
  box-shadow:0 18px 36px rgba(0,0,0,.22);
}
.rollPanel{padding:14px 13px 15px;margin-bottom:10px;}
.rollPanel .ghostButton{
  border-color:${C.line};
  background:${C.panelAlt};
  color:${C.ink};
}
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
  position:relative;
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
.die.isSelected{
  border-color:${C.oxblood};
  box-shadow:0 0 0 3px rgba(169,74,50,.32),0 10px 18px rgba(20,19,15,.28);
}
.die.isUncertain::after{
  content:"";
  position:absolute;
  top:5px;
  right:5px;
  width:7px;
  height:7px;
  border-radius:50%;
  background:${C.oxblood};
  box-shadow:0 0 0 2px ${C.die};
}
.die.isEmpty{
  border-style:dashed;
  background:rgba(255,248,233,.58);
  box-shadow:inset 0 -5px 10px rgba(100,39,30,.06);
}
.die.isMuted{opacity:.46;}
.die.isSmall{box-shadow:inset 0 -4px 8px rgba(100,39,30,.08);}
.emptySlotMark{
  width:12px;
  height:12px;
  border-radius:50%;
  border:2px solid rgba(23,25,21,.32);
}
.dieFace{
  --pip-size:7px;
  width:42px;
  height:42px;
  display:grid;
  place-items:center;
  border-radius:8px;
  border:1px solid #d9caa9;
  background:${C.die};
  color:${C.ink};
  box-shadow:inset 0 -4px 8px rgba(100,39,30,.08);
}
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
.keypad{
  display:grid;
  grid-template-columns:repeat(3, minmax(0, 1fr));
  gap:8px;
  margin-top:12px;
}
.keyButton{
  min-height:56px;
  display:grid;
  place-items:center;
  border-radius:8px;
  border:1px solid ${C.line};
  background:${C.panelAlt};
  cursor:pointer;
  transition:transform .14s ease, background .14s ease, border-color .14s ease;
}
.keyButton:active{transform:translateY(1px);}
.keyButton:focus-visible,.die:focus-visible,.chip:focus-visible,.segButton:focus-visible,.primaryButton:focus-visible,.doneButton:focus-visible,.ghostButton:focus-visible,.scanButton:focus-within{
  outline:3px solid rgba(201,145,47,.42);
  outline-offset:2px;
}
.rollFooter{
  display:flex;
  align-items:center;
  justify-content:space-between;
  gap:10px;
  margin-top:12px;
}
.rollStatus{
  min-width:0;
  color:${C.muted};
  font-size:12px;
  font-weight:900;
}
.rollStatus.isDraft{color:${C.oxbloodDark};}
.doneButton{
  min-width:112px;
  min-height:40px;
  padding:0 14px;
  border-radius:8px;
  background:${C.oxblood};
  color:${C.panel};
  font-size:13px;
  font-weight:900;
  cursor:pointer;
}
.doneButton:disabled{
  cursor:not-allowed;
  background:#d9ccb3;
  color:${C.muted};
}
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
.savedRollStrip{
  display:flex;
  align-items:center;
  justify-content:space-between;
  gap:10px;
  margin-top:10px;
  padding:8px 9px;
  border:1px solid ${C.line};
  border-radius:8px;
  background:rgba(235,224,203,.62);
}
.savedRollStrip>span{
  color:${C.muted};
  font-size:11px;
  font-weight:900;
  white-space:nowrap;
}
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
