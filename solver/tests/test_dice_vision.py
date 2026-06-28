"""Browser dice-vision helper tests. Run with: bun run test"""
import shutil
import subprocess
import textwrap

import pytest


def test_js_dice_vision_reads_synthetic_roll():
    bun = shutil.which("bun")
    if bun is None:
        pytest.skip("bun is required for JS dice-vision tests")

    script = textwrap.dedent(
        """
        import { detectDiceInImageData } from "./src/diceVision.js";

        const width = 660;
        const height = 128;
        const data = new Uint8ClampedArray(width * height * 4);
        const slots = {
          1: [4],
          2: [0, 8],
          3: [0, 4, 8],
          4: [0, 2, 6, 8],
          5: [0, 2, 4, 6, 8],
          6: [0, 2, 3, 5, 6, 8],
        };
        const slotPos = [
          [0.25, 0.25], [0.5, 0.25], [0.75, 0.25],
          [0.25, 0.5], [0.5, 0.5], [0.75, 0.5],
          [0.25, 0.75], [0.5, 0.75], [0.75, 0.75],
        ];

        function setPixel(x, y, r, g, b, a = 255) {
          if (x < 0 || y < 0 || x >= width || y >= height) return;
          const index = (y * width + x) * 4;
          data[index] = r;
          data[index + 1] = g;
          data[index + 2] = b;
          data[index + 3] = a;
        }

        function circle(cx, cy, radius, rgb) {
          for (let y = Math.floor(cy - radius); y <= Math.ceil(cy + radius); y += 1) {
            for (let x = Math.floor(cx - radius); x <= Math.ceil(cx + radius); x += 1) {
              const dx = x - cx;
              const dy = y - cy;
              if (dx * dx + dy * dy <= radius * radius) setPixel(x, y, ...rgb);
            }
          }
        }

        function drawDie(x0, y0, size, value) {
          for (let y = y0; y < y0 + size; y += 1) {
            for (let x = x0; x < x0 + size; x += 1) {
              setPixel(x, y, 248, 238, 213);
            }
          }

          for (const slot of slots[value]) {
            const [nx, ny] = slotPos[slot];
            circle(x0 + nx * size, y0 + ny * size, 5, [20, 20, 18]);
          }
        }

        for (let y = 0; y < height; y += 1) {
          for (let x = 0; x < width; x += 1) {
            const noise = (x * 13 + y * 7) % 9;
            setPixel(x, y, 14 + noise, 50 + noise, 42 + noise);
          }
        }

        [1, 2, 3, 4, 5, 6].forEach((value, index) => {
          drawDie(24 + index * 104, 31, 66, value);
        });

        const result = detectDiceInImageData({ data, width, height });
        if (JSON.stringify(result.values) !== JSON.stringify([1, 2, 3, 4, 5, 6])) {
          throw new Error(`wrong dice values: ${JSON.stringify(result)}`);
        }
        if (!result.complete || result.averageConfidence < 0.8) {
          throw new Error(`unexpected scan confidence: ${JSON.stringify(result)}`);
        }
        """
    )

    result = subprocess.run(
        [bun, "--eval", script],
        text=True,
        capture_output=True,
        check=False,
    )

    assert result.returncode == 0, result.stderr or result.stdout
