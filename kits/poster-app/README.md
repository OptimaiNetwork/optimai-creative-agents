# {{TITLE}}

A poster maker built on [OptimAI Creative Agents](https://github.com/OptimaiNetwork/optimai-creative-agents) (starter kit `{{KIT}}`). The settings form is drawn from the Poster Lab form schema, the poster is rendered by the SDK's canvas engine on this device, and the result gets generated alt text and a PNG download. Nothing is uploaded and no model is downloaded.

## Run it

ES modules need an HTTP origin, so serve a folder that contains both this kit and the SDK (the SDK is at `{{SDK_PATH}}` from here). If you made the kit with `npm run create` in the SDK folder, run this there:

```sh
python3 -m http.server 8080 --bind 127.0.0.1
```

Then open **http://127.0.0.1:8080/apps/{{NAME}}/** and click **Make poster**. Stop the server with Ctrl+C.

## Make it yours

- Change `AGENT` in [app.mjs](./app.mjs) to `letter-studio` or `glitch-cut`, and the form rebuilds itself from that agent's schema.
- Restyle [styles.css](./styles.css); it follows the system light or dark theme.
- In a bundled app (Vite, Next.js and so on), run `npm install` (it links the local SDK folder and downloads nothing), delete the import map from [index.html](./index.html) and keep the same imports.

The SDK and this kit are MIT licensed.
