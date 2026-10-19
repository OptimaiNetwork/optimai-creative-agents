# Changelog

Notable changes to OptimAI Creative Agents. Each entry names what a builder or creator can now do. Versions follow [Semantic Versioning](https://semver.org/). Portable v1 manifests and saved recipe fields stay compatible across every release listed here.

## Unreleased

### Added

- **Focus-aware cropping for every canvas cover fit.** Image Grid, resize, Mockup Maker, Pixel Layout, Reference Blend, Transition Lab, Glitch Cut, Poster Lab and Letter Pose now keep an off-centre subject in frame instead of cropping from the middle.
  - Each image is analysed once from a thumbnail of at most 96 pixels. The analysis combines Sobel detail with OKLab color distinctiveness, takes about a millisecond, and uses no model, network or face/skin heuristic.
  - Flat images, matching aspect ratios and environments that cannot read canvas pixels keep the classic centred crop.
  - Pass `crop: 'center'` to opt out.
- **`@optimai/creative-agents/smart-crop`.** `analyzeImageFocus`, `focusCoverRect`, `computeFocusMap` and `findFocusCrop` for your own layouts. The pure steps run in Node. See [focus-aware cropping](./docs/runtimes.md#focus-aware-cropping).
- **`@optimai/creative-agents/verify`: tier-0 checks.** Deterministic local checks an agent can run before paying for a model to judge a draft: WCAG text contrast over the actual background (low percentile, not the mean), text size, text over the subject (using the smart-crop focus map), safe zones, aspect, duration, detector counts, OKLab palette coverage and cut-on-beat timing. Every check returns `{ pass, score, threshold, confidence, costMs }` with higher-is-better scores. See [tier-0 verification](./docs/runtimes.md#tier-0-verification).
- **Steadier, more responsive avatars.** `createFaceRigSmoother()` in `camera-runtime` smooths face rigs with a One-Euro filter: the avatar holds still while the head rests and follows fast turns and blinks without the lag of the fixed 80 ms moving average. In the bundled tests it shows a third less jitter at rest and under half the lag on a quick head turn. `smoothFaceRig` keeps working.
- **`@optimai/creative-agents/landmark-filter`.** `createOneEuroFilter` and `createOneEuroVectorFilter` (with a `stride` for x,y or x,y,z points) to smooth your own face, hand or pose landmarks. Runs in Node and the browser. See [landmark smoothing](./docs/runtimes.md#landmark-smoothing).
- **Documentation guard.** `test/docs.test.mjs` checks that the README and guides state the shipped template count, capability groups and package version.

### Fixed

- The README, catalog, quickstart and MCP guides now describe the shipped catalog: **38 templates** (10 canvas, 3 vision, 5 writing, 6 interactive, 14 guided) and version 0.4.0. The catalog now lists Sound Canvas and Frame Sculpture.
- The MCP adapter reports the package version in `serverInfo` instead of a hard-coded `0.3.0`.

## 0.4.0 — 2026-10-14

### Added

- **Sound Canvas** (`music:reactive`): four original looks driven by a selected song's analyser data.
- **Frame Sculpture** (`frame:sculpture`): real frames from a short clip arranged as an interactive 2.5D sculpture.
- Workspace contract **1.2**.

## 0.3.0 — 2026-10-13

### Added

- Reusable engines for **3D scenes** (`3d:scene`), **camera effects** (`camera:effects`) and **face-driven original avatars** (`camera:avatar`), with model-setup policy and verified tracker models.
- Workspace contract **1.1**.

## 0.2.0 — 2026-10-09

### Added

- Versioned workspace descriptors, so hosts dispatch each template through a reviewed, allowlisted binding.

## 0.1.0 — 2026-10-08

### Added

- First public source release: catalog, manifest schema and validation, canvas and browser-vision engines, local writing through WebLLM or Ollama, the recipe scaffolder and the stdio MCP adapter.
