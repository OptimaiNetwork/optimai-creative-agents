# Music and motion engines

Two browser engines extend the catalog in SDK 0.4.0 / workspace contract 1.2, and run unchanged on workspace contract 1.3. They use selected local media, have no cloud provider, and require no model download. The portable v1 manifest still carries only a declarative recipe. An application must install the matching reviewed adapter before it can run these workspaces.

## Sound Canvas (`music-reactive`)

The `music/reactive` workspace draws four original looks: Orbital bloom, Silk ribbons, Spectrum stage and Midnight aurora. The engine is dependency-free, deterministic and bounded. Its input is playback time and actual analyser data. Normalized frequency bytes are display signals, **not** loudness, BPM, beat timestamps or a music transcription. For tempo and beats, add the separate beat tracker below.

```js
import {
  extractMusicReactiveFeatures,
  smoothMusicReactiveFeatures,
  renderMusicReactiveFrame,
} from '@optimai/creative-agents/music-reactive';

analyser.fftSize = 2048;
analyser.smoothingTimeConstant = 0;
const bytes = new Uint8Array(analyser.frequencyBinCount);
analyser.getByteFrequencyData(bytes);
const measured = extractMusicReactiveFeatures(bytes, {
  sampleRate: audioContext.sampleRate, fftSize: analyser.fftSize,
});
// Retain the prior result between frames. Reset it to null after a seek/source change.
const features = smoothMusicReactiveFeatures(previousFeatures, measured, elapsedMs);
renderMusicReactiveFrame(canvas.getContext('2d'), {
  width: canvas.width, height: canvas.height, time: audio.currentTime,
  look: 'orbital', intensity: 0.7, title: 'Your song', ...features,
  reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
});
```

The host owns the audio graph, file selection, playback, canvas, recording and disposal. Use one `MediaElementAudioSourceNode` per media element and route it to an analyser, speakers and a `MediaStreamAudioDestinationNode`. Full-song recording can combine `canvas.captureStream()` with a **clone** of the destination audio track. Stop cloned export tracks without destroying the reusable audio graph. Check `MediaRecorder.isTypeSupported()`, handle runtime encoder failures, wait for a real seek to the beginning, bound retained chunks, and discard a canceled or hidden-tab recording instead of presenting it as complete. If recording APIs are absent, provide preview and still export.

### Beat sync (`beat-tracker`)

`beat-tracker` reads the same analyser bytes and finds onsets, tempo and beats on the device. It has no dependencies, no timers and no model, and it runs in Node for tests.

1. **Onsets.** Spectral flux on 24 logarithmic bands (30 Hz–11 kHz) counts how much each band rose since the last frame. An onset is a rising crossing of an adaptive threshold: `0.012 + sensitivity × median(flux over the last second)`.
2. **Tempo.** Every pair of recent onsets (eight seconds, at most 64) votes for the tempo of its interval and of its halves, thirds and quarters. This is the autocorrelation of the onset train on a log-tempo axis. A mild prior around 120 BPM breaks ties, and a doubled tempo that the onsets support almost as well wins, so off-beat hi-hats do not halve the count. Confidence measures how tightly the onsets sit on the chosen grid, above what chance would give.
3. **Beat clock.** A second-order phase-locked loop predicts each beat from the tempo and pulls its phase and period toward onsets that land near a prediction. It keeps time through a fill and drops the lock after four seconds without onsets.

```js
import { createBeatTracker, prefersReducedMotion } from '@optimai/creative-agents/beat-tracker';

const beats = createBeatTracker({
  sampleRate: audioContext.sampleRate, fftSize: analyser.fftSize,
  reducedMotion: prefersReducedMotion(),
});
// Every animation frame, after analyser.getByteFrequencyData(bytes):
const beat = beats.push(bytes, audio.currentTime * 1000);
renderMusicReactiveFrame(ctx, { ...frameOptions, ...features, pulse: beat.pulse });
// beat.onset, beat.bpm, beat.confidence, beat.locked, beat.beat, beat.phase (0 → 1)
```

Pass the **playback** time, not the wall clock, so beats follow pauses and seeks. A backwards step or a jump of more than a second resets the tracker. On tracked synthetic material, predicted beats land within about one frame of the true beat: under 25 ms at 60 fps and under 45 ms at 30 fps. At 30 fps, tempos above about 160 BPM can lock to half time. That is still on the beat, and the flash cap would thin those pulses anyway.

**Photosensitivity.** `pulse` is a 0–1 envelope that starts only on a *flash-limited* beat. `createFlashLimiter()` allows at most three flashes in any one second, evenly spaced, as [WCAG 2.3.1](https://www.w3.org/WAI/WCAG22/Understanding/three-flashes-or-below-threshold) requires, and the cap cannot be raised. Sound Canvas uses the pulse to swell geometry only. It never changes colour or brightness. With reduced motion, the tracker still reports tempo and beats, but `flash` is always false and `pulse` is 0. The renderer also ignores `pulse` when `reducedMotion` is set.

`estimateTempo(onsetTimesMs)`, `logBandSpectrum` and `spectralFlux` expose the pure steps. To check that an edit cuts on the beat, pass the tracker's beat times to `checkCutAlignment` in `verify`.

## Frame Sculpture (`frame-sculpture`)

The `frame/sculpture` workspace extracts up to twelve actual frames from selected video and arranges them as textured planes. It is explicitly a **2.5D composition, not 3D reconstruction**. Local MP4/WebM/MOV/M4V clips are decoded using the browser's installed codecs; PNG/JPEG/WebP stills become one plane. Animated GIF extraction is unsupported. Source files are limited to 64 MB and video to 60 seconds; textures are reduced to a 768-pixel edge.

```js
import { extractFrameSamples, createFrameSculptureStage } from '@optimai/creative-agents/frame-sculpture';
const abort = new AbortController();
const result = await extractFrameSamples(selectedFile, {
  count: 8, signal: abort.signal, onProgress: (done, total) => showProgress(done / total),
});
const stage = await createFrameSculptureStage(container, {
  layout: 'fan', spacing: 0.26, spread: 0.8,
}, { onError: showError });
stage.frames(result.frames); // Takes ownership after validating the complete frame set.
const png = await stage.png();
const recipe = stage.configuration(); // Settings, sample times and camera; no source file bytes.
stage.dispose(); // Releases renderer, textures, retained canvases, observers and listeners.
```

Three.js is an optional pinned peer. Hosts may supply their reviewed `THREE` and `OrbitControls` through `createFrameSculptureStageWithRuntime()`; this avoids duplicate engines. If transferring the frame set fails, the caller must invoke `releaseFrameSamples()`. The renderer respects reduced motion, hidden tabs and off-screen visibility. Keep original source media alongside exported configurations; the JSON is a composition record, not an embedded media archive.
