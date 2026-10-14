# Music and motion engines

Two browser engines extend the catalog in SDK 0.4.0 / workspace contract 1.2. They use selected local media, have no cloud provider, and require no model download. The portable v1 manifest still carries only a declarative recipe. An application must install the matching reviewed adapter before it can run these workspaces.

## Sound Canvas (`music-reactive`)

The `music/reactive` workspace draws four original looks: Orbital bloom, Silk ribbons, Spectrum stage and Midnight aurora. The engine is dependency-free, deterministic and bounded. Its input is playback time and actual analyser data. Normalized frequency bytes are display signals, **not** loudness, BPM, beat timestamps or a music transcription.

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
