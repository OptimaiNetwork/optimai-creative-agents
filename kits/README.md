# Starter kits

Templates for `npm run create -- --kit <id>`. Each folder becomes a small runnable app in `apps/<name>/` with its `{{PLACEHOLDERS}}` filled in, so the files here are not meant to be opened directly. List the kits with `npm run create -- --kits`, and see the [quickstart](../docs/quickstart.md#start-an-app-from-a-starter-kit) for what each one does.

Kit code imports the SDK only by package name, through the subpaths its entry in [`src/starter-kits.mjs`](../src/starter-kits.mjs) lists; `test/starter-kits.test.mjs` checks this, fills every template and runs the MCP kit end to end. All kits are MIT licensed.
