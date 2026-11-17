# Capybara Family Short

`capybara-family-short.agent.json` is a reusable recipe for preparing the
screenplay and storyboard of a warm, child-safe 3D animated family short. It
uses the reviewed `storyboard-builder` template and makes a 12-scene plan for
a 5–8 minute film.

## Validate the recipe

From the repository root, run:

```sh
node scripts/verify.mjs examples/capybara-family-short.agent.json
```

Validation does not need a model, a network connection, an API key or a
Studio account.

## Generate a draft locally

Choose an eligible model that is already installed in your local Ollama
service, then run:

```sh
node scripts/run.mjs --manifest examples/capybara-family-short.agent.json \
  --model YOUR_INSTALLED_MODEL
```

The output should contain 12 sequential scenes. Each scene includes its
purpose, action, visual treatment, camera framing, simple English dialogue
and sound direction. Review the draft before production: confirm that the
characters remain recognisably capybaras, the story stays gentle and
age-appropriate, and the toy boat, family and supporting characters remain
continuous from scene to scene.

## Limits

This recipe prepares written pre-production material. It does not create a
3D model, illustrations, animation, a video file or a finished project.
Generated writing depends on the selected local model and must be reviewed by
a creator before it is used. The recipe has no network permission and contains
no credentials, media or executable code.
