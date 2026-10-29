# Agent catalog

Choose a template by the result its reviewed implementation produces. The current catalog has **39 templates: 11 canvas, 3 browser vision, 5 writing, 6 interactive and 14 guided entries**. Every template can prepare a prompt; execution uses the runtime listed below.

These groups follow each template's versioned `workspace` descriptor. The SDK exposes `getAgentWorkspace(id)` for dispatch, `getAgentInputPolicy(id)` for file limits, accepted types and browser needs, and derives `CANVAS_LAB_AGENTS` from the same catalog. The two sketch workspaces include browser drawing before guided production; the other 12 guided templates prepare direction directly. Display categories and legacy `runtime` and `executionKind` metadata remain compatible with older recipes. Hosts maintain their own supported-operation allowlist as described in [host integration](./host-integration.md).

## Canvas tools

These 10 tools render selected images or text into still-image PNGs in the browser. They need no model, API key or external dependency. Use `runLocalTool` for the original image operations and `runCanvasLab` for the additional compositions; see [canvas APIs and settings](./runtimes.md#canvas-processing).

| Agent | Template ID | Reviewed operation | Actual result |
| --- | --- | --- | --- |
| Mockup Maker | `mockup-maker` | `image-resize` or `mockup` | Resize/crop one image, or place it in a phone, desktop or gallery frame; PNG |
| Image Finish | `image-finish` | `image-filter` | Color finish on one image with adjustable intensity; PNG |
| Image Grid | `image-grid` | `image-grid` | Contact sheet containing up to eight images; PNG |
| Title Frame | `title-frame` | `type-overlay` | Plain-text title on one still image; PNG |
| Reference Blend | `reference-blend` | `blend` | Two images composited at a selected blend percentage; PNG |
| Pixel Layout | `pixel-layout` | `bento` | Static hero-and-details layout containing up to eight images; PNG |
| Poster Lab | `poster-lab` | `poster` | Title artboard with an optional background image; PNG |
| Transition Lab | `transition-lab` | `transition` | A still frame of a wipe, iris, light-key or push between exactly two images at a selected time, plus a strip of the whole move; PNG |
| Glitch Cut | `glitch-cut` | `glitch` | A seeded glitch (shifted bands and blocks, colour trails or echoes, RGB split and scanlines) on one still image; the same seed redraws it exactly; PNG |
| Print Shop | `print-shop` | `print` | A riso duotone, halftone dots or a Floyd–Steinberg, Bayer or blue-noise dither of one still image on warm paper; the seed redraws the same grain; PNG |
| Letter Pose | `letter-pose` | `letter` | Typographic artboard with an optional background image; PNG |

Inputs must be selected PNG, JPEG or WebP files, each at most 20 MiB and 4096 pixels per side. The original image processors enforce a 16-million-pixel budget for retained images and output; compositions validate each input through that processor and enforce a shared budget for normalized inputs. Compositions have a 1200-pixel output width and ratios of 1:1, 4:5, 16:9 or 9:16. Exported PNGs are limited to 20 MiB.

Canvas tools render supplied artwork and text. A blend preview is not a synthesized scene, and a static layout or transition preview is not an encoded video. Mockup Maker's two operations are alternative host workspaces, counted as one template.

Use `canvasLabRecipeSettings(id, values)` to normalize recipe fields into direct composition settings. Canonical `ratio`, `treatment`, `title`, `color`, `amount` and `mix` settings take precedence over saved legacy aliases when explicitly supplied. Old `format`, `text`, `style`, `intensity` and bento layout fields remain accepted; no saved v1 field is removed. Try the [browser example](../examples/browser/README.md) for a complete image resize/filter workflow.

## Browser vision

These three tools analyze one selected still image using a fixed reviewed MediaPipe model. The host installs the pinned optional dependency, serves a reviewed local worker and WASM assets, and applies the selected-agent model setup policy. See [browser vision setup](./runtimes.md#browser-vision).

| Agent | Template ID | Reviewed operation | Actual result |
| --- | --- | --- | --- |
| Select & Replace | `select-and-replace` | `person-cutout` | Person cutout with a transparent or solid-color background; PNG and segmentation analysis |
| Motion Pose | `motion-pose` | `pose-reference` | Pose overlay for one person with 33 body landmarks; PNG and landmark analysis |
| Face Performance | `face-performance` | `face-reference` | Face overlay with 478 landmarks and raw blendshape coefficients; PNG and analysis |

Person Cutout uses Selfie Segmenter (249,537 bytes); Motion Pose uses Pose Landmarker Lite (5,777,746 bytes); Face Performance uses Face Landmarker (3,758,596 bytes). Downloads use fixed URLs, exact byte lengths and SHA-256 verification. Running a tool does not download its model implicitly.

Image inputs share the 20 MiB, 4096-pixel-per-side and 16-million-pixel limits. Analysis and PNG output are scaled to at most 1600 pixels per side. Inference uses a local CPU WASM worker with a 60-second timeout and cancellation. Detection quality depends on visibility, lighting and occlusion; missing subjects produce an error.

Select & Replace's local implementation segments people rather than performing arbitrary regional replacement. Motion Pose produces a still reference rather than animation or measured body distances. Face Performance provides geometry and raw rig coefficients; it does not identify people, infer emotions or personality, or swap faces. The templates can also prepare direction for a separate host workflow.

## Writing agents

These five templates generate validated written artifacts through either the [browser writing runtime](./runtimes.md#browser-writing) or [local Ollama writing](./runtimes.md#local-ollama-writing). Browser writing needs supported WebGPU hardware, a locally bundled worker and reviewed fixed-model setup; the host may start preparation when the selected-agent policy permits. Ollama writing needs a running loopback service and an explicitly selected eligible installed model.

| Agent | Template ID | Actual written result |
| --- | --- | --- |
| Cast Notes | `cast-notes` | Character identity, motivation, strengths and limits, arc and consistency notes |
| Style Brief | `style-brief` | Art direction, palette, line/material treatment, lighting, composition and things to avoid |
| Storyboard Builder | `storyboard-builder` | 2–12 sequential scene plans with purpose, action, visual treatment, framing, dialogue and sound |
| Prompt Branches | `prompt-branches` | 2–6 creative directions with a shared premise, complete prompt and explanation of each difference |
| Story Seed | `story-seed` | Premise, cast, setting, chapter outline and visual/production direction |

The result includes a title, summary, sections and a prompt to review before a production handoff. It is text; creating illustrations, video or a finished project requires the destination host. Browser briefs are limited to 2,000 characters with a 2,048-token output budget; the manifest contract permits briefs up to 4,000 characters. Start with the three-scene storyboard default for a short draft.

The runtimes validate structure and task-specific content, allow one bounded repair attempt and report failure when the model still returns invalid output. Model choice and hardware affect speed and creative quality. Review the result before using it for production. Recipe preparation with `compileAgentPrompt` works without a model, as shown in the [quickstart](./quickstart.md).

## Interactive 3D, camera, avatars, music and frames

These six templates use shared public engines rather than preparing direction alone. A host owns the interface and its camera permission, recording, selected input and export actions. See the [interactive runtime guide](./runtimes.md#interactive-3d-scenes) and [runnable host example](../examples/interactive/README.md).

| Agent | Template ID | Workspace | Actual result |
| --- | --- | --- | --- |
| Model Turntable | `model-turntable` | `3d:scene` | Original procedural subjects or a self-contained static GLB; orbit, camera/lens, material and light controls; PNG and scene recipe |
| Scene Lighting | `scene-lighting` | `3d:scene` | Architectural scene with adjustable key light, atmosphere and camera framing; same real scene engine |
| Camera Stage | `camera-stage` | `camera:effects` | Local webcam or selected image/video filters, with optional tracked halo; canvas output |
| Avatar Stage | `avatar-stage` | `camera:avatar` | Original procedural 3D avatar driven by local face geometry/blendshapes, or an animated demo |
| Sound Canvas | `music-reactive` | `music:reactive` | Four original looks driven by a selected song's analyser data; still PNG or host-recorded visualizer |
| Frame Sculpture | `frame-sculpture` | `frame:sculpture` | Real frames sampled from a short local clip, arranged as an interactive 2.5D sculpture; PNG and composition record |

`scene3DRecipeSettings(id, values)` maps `demo`, `lighting`, `finish`, `view`, lens and exposure into actual engine settings. `cameraRecipeSettings(id, values)` maps effect, look, intensity and mirror controls. Neither recipe can provide a model URL, decoder, renderer script or worker path. Three.js is an optional pinned peer. Face tracking reuses the pinned, verified Face Landmarker in a local CPU worker; basic filters and the avatar demo work without a downloaded face model.

GLB imports are limited to 20 MiB, 300,000 visible vertices, 128 primitive parts and 256 nodes, with one embedded static scene. Textures must be embedded PNG/JPEG, no larger than 4096 pixels per side or 16 megapixels total. External/data URLs, compressed decoders, skins, morph targets, instancing and animations are rejected. This is a scene visualizer and composition reference, not generative 3D reconstruction. Avatars are original characters, not identity swaps or emotion classifications.

## Guided workflows

These 14 templates prepare a bounded prompt and a named Studio destination. The SDK does not process their selected media or execute the production step. A host must implement that workflow and handle any generation, editing, cost confirmation, project persistence or publishing. Use `compileAgentPrompt` to prepare direction and [host integration](./host-integration.md) to design the handoff.

| Agent | Template ID | Prepared direction | Destination |
| --- | --- | --- | --- |
| Sketch to Scene | `sketch-to-scene` | Develop a selected sketch while preserving composition and shapes | Image Studio |
| World Finder | `world-finder` | Setting, time, atmosphere and coherent visual-world direction | Image Studio |
| Shot Atlas | `shot-atlas` | Alternate camera shots and lens treatment for a selected subject | Image Studio |
| Motion Finish | `motion-finish` | Effect treatment and strength for a clip | Editor Studio |
| Sketch to Motion | `sketch-to-motion` | Action and camera direction for animating a selected sketch | Video Studio |
| Dream Signal | `dream-signal` | Surreal motifs, mood and camera direction | Video Studio |
| Frame Fit | `frame-fit` | Aspect-ratio and framing instructions for selected clips | Editor Studio |
| Rough Cut | `rough-cut` | Structure and pace for a first edit of selected footage | Editor Studio |
| Rhythm Cut | `rhythm-cut` | Rhythm and fragment-length direction for an edit | Editor Studio |
| Frame Study | `frame-study` | Instructions for studying composition, lighting, depth and framing | Image Studio |
| Motion Tracker | `motion-tracker` | Subject and overlay instructions for a tracking workflow | Editor Studio |
| Depth Motion | `depth-motion` | Layered-depth movement and camera direction for a still | Video Studio |
| Scene Scout | `scene-scout` | Location and time-of-day direction for exploring scene angles | Image Studio |
| Scene Remix | `scene-remix` | Setting and visual direction for recomposing a selected subject | Image Studio |

A successful prompt preparation confirms valid recipe data; it is not evidence of completed rendering, tracking, depth reconstruction, video resizing or export. Interactive camera and 3D capabilities are listed separately below. They have real public engines; guided templates still require their destination host.

## Inspect and remix a template

From the repository root, use `npm run verify` to list current capabilities. Read a template's actual fields before choosing settings:

```sh
node --input-type=module -e 'import { getAgentTemplate } from "./src/index.mjs"; console.log(JSON.stringify(getAgentTemplate("image-finish").fields, null, 2));'
```

Scaffold a recipe with a known template ID, then validate the resulting JSON. [Create your first recipe](./quickstart.md) walks through those steps. Unknown template IDs and settings are rejected; new capabilities require a reviewed source contribution following [CONTRIBUTING.md](../CONTRIBUTING.md#new-reviewed-operations).

The [MCP adapter](./mcp.md) exposes all 39 template names. It prepares recipes by default and supports explicit local Ollama execution for the five writers. Canvas and vision execute through a browser host. Sharing source or importing recipe JSON does not create a public catalog listing; see [release and review](./release-and-feature.md).
