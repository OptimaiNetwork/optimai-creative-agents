# {{TITLE}}

A music visualizer built on [OptimAI Creative Agents](https://github.com/OptimaiNetwork/optimai-creative-agents) (starter kit `{{KIT}}`). Choose an audio file on your device; the browser's analyser feeds the SDK's music-reactive renderer and beat tracker. The song is never uploaded and no model is downloaded.

## Run it

ES modules need an HTTP origin, so serve a folder that contains both this kit and the SDK (the SDK is at `{{SDK_PATH}}` from here). If you made the kit with `npm run create` in the SDK folder, run this there:

```sh
python3 -m http.server 8080 --bind 127.0.0.1
```

Then open **http://127.0.0.1:8080/apps/{{NAME}}/**, choose a song and press play. Stop the server with Ctrl+C.

## What it shows

- Four looks (`orbital`, `ribbons`, `spectrum`, `aurora`) from `MUSIC_REACTIVE_LOOKS`.
- A beat pulse from `createBeatTracker`, limited to three flashes a second. It changes size, never brightness.
- With *Reduce motion* turned on in the system settings, the page shows a still cover frame instead of moving visuals.
- **Save cover** downloads the current frame as a PNG.

## Make it yours

Change the title and artist in [app.mjs](./app.mjs), add your own look by drawing over `renderMusicReactiveFrame`, or restyle [styles.css](./styles.css). In a bundled app, run `npm install` (it links the local SDK folder and downloads nothing), delete the import map from [index.html](./index.html) and keep the same imports.

The SDK and this kit are MIT licensed.
