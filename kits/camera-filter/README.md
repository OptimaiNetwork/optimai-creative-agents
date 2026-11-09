# {{TITLE}}

Live camera effects built on [OptimAI Creative Agents](https://github.com/OptimaiNetwork/optimai-creative-agents) (starter kit `{{KIT}}`). The controls come from the Camera Stage form schema and pass through the same recipe rules Studio uses (`cameraRecipeSettings`), then the SDK draws each frame. The camera starts only when you click, turns off when the tab is hidden, and frames never leave the device. No model is downloaded.

## Run it

Cameras need a secure origin; `127.0.0.1` counts. Serve a folder that contains both this kit and the SDK (the SDK is at `{{SDK_PATH}}` from here). If you made the kit with `npm run create` in the SDK folder, run this there:

```sh
python3 -m http.server 8080 --bind 127.0.0.1
```

Then open **http://127.0.0.1:8080/apps/{{NAME}}/** and click **Start camera**, or open a photo if you have no camera. Stop the server with Ctrl+C.

## Make it yours

- Effects: `studio`, `neon`, `prism`, `duotone` and `film`, with an intensity slider and mirroring. The `halo` effect needs face tracking with a downloaded model; the SDK's interactive example shows how to add it.
- Draw your own overlay after `drawCameraEffect` in [app.mjs](./app.mjs), or restyle [styles.css](./styles.css).
- In a bundled app, run `npm install` (it links the local SDK folder and downloads nothing), delete the import map from [index.html](./index.html) and keep the same imports.

The SDK and this kit are MIT licensed.
