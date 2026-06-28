const PIP_SLOTS = {
  1: [4],
  2: [0, 8],
  3: [0, 4, 8],
  4: [0, 2, 6, 8],
  5: [0, 2, 4, 6, 8],
  6: [0, 2, 3, 5, 6, 8],
};

const DEFAULT_OPTIONS = {
  maxImageSize: 1200,
  minDieSize: 24,
  maxDice: 6,
};

const clamp = (n, min, max) => Math.max(min, Math.min(max, n));

function luminance(r, g, b) {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function saturation(r, g, b) {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  return max === 0 ? 0 : (max - min) / max;
}

function quantile(values, q) {
  const sorted = Array.from(values).sort((a, b) => a - b);
  if (sorted.length === 0) return 0;
  return sorted[Math.floor((sorted.length - 1) * q)];
}

function componentBounds(indices, width) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const index of indices) {
    const x = index % width;
    const y = Math.floor(index / width);
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }

  return {
    x: minX,
    y: minY,
    width: maxX - minX + 1,
    height: maxY - minY + 1,
    area: indices.length,
  };
}

function connectedComponents(mask, width, height, minArea = 1) {
  const seen = new Uint8Array(mask.length);
  const components = [];
  const queue = [];

  for (let start = 0; start < mask.length; start += 1) {
    if (!mask[start] || seen[start]) continue;
    seen[start] = 1;
    queue.length = 0;
    queue.push(start);
    const pixels = [];

    for (let q = 0; q < queue.length; q += 1) {
      const index = queue[q];
      pixels.push(index);
      const x = index % width;
      const y = Math.floor(index / width);
      const neighbors = [
        x > 0 ? index - 1 : -1,
        x < width - 1 ? index + 1 : -1,
        y > 0 ? index - width : -1,
        y < height - 1 ? index + width : -1,
      ];

      for (const next of neighbors) {
        if (next >= 0 && mask[next] && !seen[next]) {
          seen[next] = 1;
          queue.push(next);
        }
      }
    }

    if (pixels.length >= minArea) {
      components.push(componentBounds(pixels, width));
    }
  }

  return components;
}

function expandBox(box, width, height, ratio) {
  const padX = box.width * ratio;
  const padY = box.height * ratio;
  const x1 = clamp(Math.floor(box.x - padX), 0, width - 1);
  const y1 = clamp(Math.floor(box.y - padY), 0, height - 1);
  const x2 = clamp(Math.ceil(box.x + box.width + padX), 0, width);
  const y2 = clamp(Math.ceil(box.y + box.height + padY), 0, height);
  return { x: x1, y: y1, width: x2 - x1, height: y2 - y1 };
}

function medianBrightness(data, width, box) {
  const samples = [];
  const step = Math.max(1, Math.floor(Math.min(box.width, box.height) / 40));
  const x2 = box.x + box.width;
  const y2 = box.y + box.height;

  for (let y = box.y; y < y2; y += step) {
    for (let x = box.x; x < x2; x += step) {
      const offset = (y * width + x) * 4;
      samples.push(luminance(data[offset], data[offset + 1], data[offset + 2]));
    }
  }

  return quantile(samples, 0.5);
}

function makeDieMask(data, width, height) {
  const samples = [];
  const step = Math.max(1, Math.floor(Math.sqrt(width * height) / 320));

  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      const offset = (y * width + x) * 4;
      samples.push(luminance(data[offset], data[offset + 1], data[offset + 2]));
    }
  }

  const brightCut = Math.max(118, quantile(samples, 0.72));
  const mask = new Uint8Array(width * height);

  for (let i = 0; i < width * height; i += 1) {
    const offset = i * 4;
    const r = data[offset];
    const g = data[offset + 1];
    const b = data[offset + 2];
    const y = luminance(r, g, b);
    const sat = saturation(r, g, b);
    const warmWhite = r >= g * 0.82 && g >= b * 0.72;

    if (y >= brightCut && sat < 0.42 && warmWhite) {
      mask[i] = 1;
    }
  }

  return mask;
}

function detectPips(data, imageWidth, imageHeight, dieBox) {
  const inset = Math.max(3, Math.round(Math.min(dieBox.width, dieBox.height) * 0.13));
  const inner = {
    x: clamp(dieBox.x + inset, 0, imageWidth - 1),
    y: clamp(dieBox.y + inset, 0, imageHeight - 1),
    width: Math.max(1, dieBox.width - inset * 2),
    height: Math.max(1, dieBox.height - inset * 2),
  };
  const localMedian = medianBrightness(data, imageWidth, inner);
  const darkCut = Math.max(34, Math.min(120, localMedian - 58));
  const mask = new Uint8Array(inner.width * inner.height);

  for (let y = 0; y < inner.height; y += 1) {
    for (let x = 0; x < inner.width; x += 1) {
      const sourceX = inner.x + x;
      const sourceY = inner.y + y;
      const offset = (sourceY * imageWidth + sourceX) * 4;
      const r = data[offset];
      const g = data[offset + 1];
      const b = data[offset + 2];
      const lum = luminance(r, g, b);
      const idx = y * inner.width + x;
      if (lum <= darkCut) mask[idx] = 1;
    }
  }

  const dieArea = inner.width * inner.height;
  const minPipArea = Math.max(4, dieArea * 0.003);
  const maxPipArea = dieArea * 0.085;
  const raw = connectedComponents(mask, inner.width, inner.height, minPipArea);
  const pips = [];

  for (const blob of raw) {
    if (blob.area > maxPipArea) continue;
    const aspect = blob.width / Math.max(1, blob.height);
    if (aspect < 0.42 || aspect > 2.35) continue;

    const cx = inner.x + blob.x + blob.width / 2;
    const cy = inner.y + blob.y + blob.height / 2;
    pips.push({
      x: cx,
      y: cy,
      area: blob.area,
      slot: pointToSlot(cx, cy, inner),
    });
  }

  return { pips, inner };
}

function pointToSlot(x, y, box) {
  const nx = clamp((x - box.x) / box.width, 0, 0.999);
  const ny = clamp((y - box.y) / box.height, 0, 0.999);
  const col = Math.floor(nx * 3);
  const row = Math.floor(ny * 3);
  return row * 3 + col;
}

function classifyPips(pips) {
  const countsBySlot = new Map();
  for (const pip of pips) {
    countsBySlot.set(pip.slot, (countsBySlot.get(pip.slot) || 0) + 1);
  }
  const observed = new Set(countsBySlot.keys());
  let best = { value: Math.max(1, Math.min(6, observed.size)), score: 0 };

  for (let value = 1; value <= 6; value += 1) {
    const expected = PIP_SLOTS[value];
    let matches = 0;
    for (const slot of expected) {
      if (observed.has(slot)) matches += 1;
    }
    const extras = observed.size - matches;
    const misses = expected.length - matches;
    const score = matches / expected.length - extras * 0.23 - misses * 0.28;

    if (score > best.score) {
      best = { value, score };
    }
  }

  return {
    value: best.value,
    confidence: clamp(0.2 + best.score * 0.8, 0, 0.99),
    pipCount: pips.length,
  };
}

function scoreDieCandidate(box, pips, classification) {
  const aspect = box.width / Math.max(1, box.height);
  const shapeScore = clamp(1 - Math.abs(Math.log(aspect)) / Math.log(1.65), 0, 1);
  const pipScore = pips.length >= 1 && pips.length <= 8 ? classification.confidence : 0;
  return clamp(shapeScore * 0.42 + pipScore * 0.58, 0, 0.99);
}

function dedupeDice(dice) {
  const sorted = dice.slice().sort((a, b) => b.confidence - a.confidence);
  const kept = [];

  for (const candidate of sorted) {
    const overlaps = kept.some((die) => {
      const ax1 = candidate.box.x;
      const ay1 = candidate.box.y;
      const ax2 = ax1 + candidate.box.width;
      const ay2 = ay1 + candidate.box.height;
      const bx1 = die.box.x;
      const by1 = die.box.y;
      const bx2 = bx1 + die.box.width;
      const by2 = by1 + die.box.height;
      const interW = Math.max(0, Math.min(ax2, bx2) - Math.max(ax1, bx1));
      const interH = Math.max(0, Math.min(ay2, by2) - Math.max(ay1, by1));
      const inter = interW * interH;
      const minArea = Math.min(candidate.box.width * candidate.box.height, die.box.width * die.box.height);
      return inter / Math.max(1, minArea) > 0.45;
    });

    if (!overlaps) kept.push(candidate);
  }

  return kept;
}

export function detectDiceInImageData(imageData, options = {}) {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const { data, width, height } = imageData;
  const mask = makeDieMask(data, width, height);
  const minArea = opts.minDieSize * opts.minDieSize * 0.36;
  const maxArea = width * height * 0.22;
  const components = connectedComponents(mask, width, height, minArea);
  const dice = [];

  for (const component of components) {
    if (component.area > maxArea) continue;
    if (component.width < opts.minDieSize || component.height < opts.minDieSize) continue;

    const aspect = component.width / Math.max(1, component.height);
    if (aspect < 0.52 || aspect > 1.92) continue;

    const fill = component.area / (component.width * component.height);
    if (fill < 0.28) continue;

    const box = expandBox(component, width, height, 0.04);
    const pipResult = detectPips(data, width, height, box);
    const classification = classifyPips(pipResult.pips);
    const confidence = scoreDieCandidate(box, pipResult.pips, classification);

    if (classification.pipCount === 0 || confidence < 0.34) continue;

    dice.push({
      value: classification.value,
      confidence,
      pipCount: classification.pipCount,
      box,
      pips: pipResult.pips.map((pip) => ({ x: pip.x, y: pip.y, slot: pip.slot })),
    });
  }

  const selected = dedupeDice(dice)
    .sort((a, b) => a.box.y + a.box.height / 2 - (b.box.y + b.box.height / 2))
    .slice(0, opts.maxDice)
    .sort((a, b) => a.box.x + a.box.y * width - (b.box.x + b.box.y * width));

  const values = selected.map((die) => die.value);
  const averageConfidence = selected.length
    ? selected.reduce((sum, die) => sum + die.confidence, 0) / selected.length
    : 0;

  return {
    dice: selected,
    values,
    count: selected.length,
    averageConfidence,
    complete: selected.length === opts.maxDice,
    message: selected.length === opts.maxDice
      ? `Detected ${selected.length} dice.`
      : `Detected ${selected.length} of ${opts.maxDice} dice.`,
  };
}

function imageBitmapFromFile(file) {
  if (typeof createImageBitmap === "function") {
    return createImageBitmap(file, { imageOrientation: "from-image" }).catch(() => createImageBitmap(file));
  }

  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Could not load image"));
    };
    img.src = url;
  });
}

export async function detectDiceFromFile(file, options = {}) {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const bitmap = await imageBitmapFromFile(file);
  const scale = Math.min(1, opts.maxImageSize / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(bitmap, 0, 0, width, height);
  if (typeof bitmap.close === "function") bitmap.close();

  const imageData = ctx.getImageData(0, 0, width, height);
  return {
    ...detectDiceInImageData(imageData, opts),
    image: { width, height, scale },
  };
}
