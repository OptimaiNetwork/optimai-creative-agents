# A browser workspace you can build on

This example runs the public SDK's real canvas engines. It needs no install, account, API key or model download. Selected images and exported results stay in the browser; the local HTTP server serves source files only.

## Run it

From the repository root, with Python 3 installed:

```sh
python3 -m http.server 8080 --bind 127.0.0.1
```

Open **http://127.0.0.1:8080/examples/browser/** in a current browser with Canvas 2D and ImageBitmap support. Use localhost HTTP rather than opening the HTML through `file://`; ES modules need an HTTP origin. Stop the server with Ctrl+C. Use another free port if 8080 is occupied.

1. Click **Create poster** to produce a real 1200 × 1500 PNG.
2. Click **Use as input**, then choose **Image Finish** and run a color treatment.
3. Choose the resize workspace, set width to **800** and ratio to **1:1**, then run it.
4. Review the result and click **Export PNG** to save the 800 × 800 image.

You can also select your own PNG, JPEG or WebP. Source files are limited to 20 MiB, 4096 pixels per side and 16 million pixels. If processing fails or you stop a job, the previous successful export remains available.

## What it demonstrates

| Workspace | Real SDK call | Result |
| --- | --- | --- |
| Poster Lab | `runCanvasLab('poster', …)` | Typography over an optional image; 1200-pixel canvas width |
| Mockup Maker / device composition | `runCanvasLab('mockup', …)` | Phone, desktop or gallery composition |
| Mockup Maker / resize | `runLocalTool('image-resize', …)` | PNG at the requested size and ratio |
| Image Finish | `runLocalTool('image-filter', …)` | PNG with the selected color treatment |

These are deterministic canvas processors, not model-generated imagery. Other writing and vision agents have separate explicit setup requirements in the [runtime guide](../../docs/runtimes.md).

## Make it your own

- [index.html](./index.html) defines the accessible controls and preview.
- [app.mjs](./app.mjs) imports the engines, validates files, handles cancellation and releases result URLs.
- [styles.css](./styles.css) provides the responsive layout, focus states and reduced-motion support.

For a bundled host, replace the relative SDK imports with the package's exported entry points after installing the source package locally. Keep file limits, output review, cancellation and URL cleanup. No account, payment or publishing service is included in this demo.

All example files are [MIT licensed](../../LICENSE). The interface uses system fonts and original [agent artwork](../../artwork/poster-lab.svg); it does not load a CDN or third-party analytics.
