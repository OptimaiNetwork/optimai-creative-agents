# Benchmarks

How long each SDK operation takes, in milliseconds per operation, on one test picture. Run it on your own device and compare.

## Run it

```bash
python3 -m http.server 8765 --bind 127.0.0.1
```

Open `http://127.0.0.1:8765/examples/benchmark/`, pick an image size and press **Run benchmarks**. Add `?auto` to the address to start at once. **Copy for the docs** gives the table below as Markdown. Nothing is uploaded.

From code, `@optimai/creative-agents/benchmark` does the same:

```js
import { runBenchmarks, describeBenchmarkDevice, formatBenchmarkTable } from '@optimai/creative-agents/benchmark';
const report = await runBenchmarks({ now: () => performance.now(), createCanvas: (w, h) => new OffscreenCanvas(w, h), width: 1920, height: 1080 });
console.log(formatBenchmarkTable(report, describeBenchmarkDevice(navigator)));
```

## How it measures

- One deterministic RGBA picture (`createBenchmarkImage`) feeds every operation, so devices time identical pixels. Operations that change pixels work on a copy.
- Each operation runs untimed warm-up rounds, then at least `minRuns` timed rounds and more until `budgetMs` (400 ms) is spent or `maxRuns` (60) is reached. The table shows the **median** and the **p95** (the slow tail); a big gap between them means the device was busy.
- **Mpx/s** is the image's megapixels divided by the median time, for operations that read the whole picture. The focus map and palette read a 256 px thumbnail, as the SDK does, so they have no Mpx/s.
- The canvas group needs a canvas (`createCanvas`); without one it is skipped and says so. `drawImage` and `putImageData` finish on the GPU later, so each timed round ends with a 1 px read-back to make the cost real.
- Browsers round timers (Chrome gives 0.1 ms headless, coarser in some privacy modes), so treat anything near 0.1 ms as "too fast to measure".
- A failing operation is listed with its error and never stops the others.

## Published run

Headless Chrome on a 10-core Mac laptop, run on 2026-11-16 (one run, other apps open: expect a few percent of noise).

### 1920×1080

| Operation | Median ms | p95 ms | Mpx/s | Runs |
| --- | ---: | ---: | ---: | ---: |
| Colour grade · punchy | 175 | 176 | 11.9 | 5 |
| Film LUT · matte | 58.70 | 59.30 | 35.3 | 7 |
| Glitch · block displacement | 37.20 | 38.30 | 55.7 | 11 |
| Print · riso duotone | 227 | 274 | 9.1 | 5 |
| Print · error diffusion | 116 | 117 | 17.9 | 5 |
| Transition frame · luma | 21.70 | 22.30 | 95.6 | 19 |
| Transition frame · push | 9.60 | 9.90 | 216 | 42 |
| Smart crop · focus map (256 px thumbnail) | 7.20 | 7.50 | – | 56 |
| Palette · dominant colours (256 px thumbnail) | 4.40 | 4.70 | – | 60 |
| Compare · SSIM and ΔE | 37.30 | 38.10 | 55.6 | 11 |
| Typeset · fit a title | 0.10 | 0.20 | – | 60 |
| Canvas · drawImage downscale + 1 px readback | 5.40 | 8.00 | 384 | 60 |
| Canvas · getImageData | 2.30 | 2.90 | 902 | 60 |
| Canvas · putImageData + 1 px readback | 0.40 | 0.60 | 5184 | 60 |

### 640×360

| Operation | Median ms | p95 ms | Mpx/s | Runs |
| --- | ---: | ---: | ---: | ---: |
| Colour grade · punchy | 19.80 | 20.20 | 11.6 | 21 |
| Film LUT · matte | 6.60 | 6.90 | 34.9 | 60 |
| Glitch · block displacement | 4.30 | 4.90 | 53.6 | 60 |
| Print · riso duotone | 27.30 | 28.90 | 8.4 | 15 |
| Print · error diffusion | 13.40 | 18.80 | 17.2 | 28 |
| Transition frame · luma | 2.40 | 4.00 | 96.0 | 60 |
| Transition frame · push | 1.10 | 1.20 | 209 | 60 |
| Smart crop · focus map (256 px thumbnail) | 7.50 | 7.80 | – | 54 |
| Palette · dominant colours (256 px thumbnail) | 4.30 | 6.80 | – | 60 |
| Compare · SSIM and ΔE | 24.10 | 25.00 | 9.6 | 18 |
| Typeset · fit a title | 0.10 | 0.20 | – | 60 |
| Canvas · drawImage downscale + 1 px readback | 1.30 | 3.20 | 177 | 60 |
| Canvas · getImageData | 0.30 | 0.40 | 768 | 60 |
| Canvas · putImageData + 1 px readback | 0.10 | 0.10 | 2304 | 60 |

## What the table says

- Per-pixel cost is flat with size (Mpx/s barely moves between the two tables), so a 1080p frame costs about 9× a 640×360 one. Budget a 33 ms video frame accordingly: at 1080p, transitions, glitch and film LUTs fit; a colour grade or print look does not, so run those once and cache, or at preview size.
- Analysis steps (focus map, palette) cost the same at any size because they read a thumbnail.
- Title fitting is effectively free.

To add your device, run the page, paste the table under a new heading with the browser, OS, core count and date, and open a pull request.
