import { bestMoveWithTable } from "./piddleSolver.js";

self.onmessage = ({ data }) => {
  const { id, dice, rollsLeft, target, playersAfter } = data;

  try {
    self.postMessage({
      id,
      move: bestMoveWithTable(dice, rollsLeft, target, playersAfter),
    });
  } catch (error) {
    self.postMessage({
      id,
      error: error instanceof Error ? error.message : String(error),
    });
  }
};
