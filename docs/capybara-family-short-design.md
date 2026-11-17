# Capybara Family Short — contribution design

## Purpose

Add a reviewable, reusable example recipe for a 5–8 minute English-language
animated short-film pre-production workflow. The recipe prepares a 12-scene
screenplay and storyboard plan; it does not render 3D animation or video.

## Audience and creative boundaries

- Children aged 3–10, with simple English dialogue and visual comedy.
- A warm, original stylized 3D family-film feeling, with no branded or
  copyrighted character references.
- No villains, frightening threats, violence, or shame-based comedy.
- The central lesson is that mistakes are a useful, enjoyable part of learning.

## Characters

The original ensemble is a clearly capybara-shaped anthropomorphic family:

- Bramble and Marigold, the parents.
- Pip, the curious older child; Nell, the careful planner; and Momo, the
  playful youngest child.
- Pebble, a small pet turtle; Biscuit, a puppy; and Poppy, a kitten.
- Ollie, a well-meaning young otter who initially tries to solve everything
  alone and later joins the team.

Capybaras use an elongated blunt muzzle, a wide dark nose, small high-set
round ears, coarse brown fur, a barrel-shaped body and short legs. They must
not be described as bears, teddy bears or bear cubs.

## Story premise and structure

The family prepares an entry for a neighbourhood festival when Momo turns the
wrong control and their toy boat drifts along the river. Ollie's impatient
solo rescue fails harmlessly. The family follows the boat using Biscuit and
Poppy's observations, Pebble's calm attention to detail and Nell's plan.
Pip's quick ideas lead to safe, funny mistakes. In the final four scenes the
group combines what each failed attempt taught them, retrieves the boat and
floats it at the festival together.

The default 12 scenes form three four-scene story units that can later be
adapted into short clips.

## Implementation

Use the existing `storyboard-builder` template only:

- Add `examples/capybara-family-short.agent.json` with `scenes: 12` and
  `form: "short film"`.
- Add `examples/capybara-family-short.md` with a reproducible local command,
  expected output, review notes and clear non-goals.
- Do not add a runtime, dependency, network permission, model download or new
  output contract.

## Validation and non-functional requirements

The example must pass the manifest validator and all existing checks:

```sh
node scripts/verify.mjs examples/capybara-family-short.agent.json
npm test
npm run verify
```

It must stay within the existing local-model limits, need no credentials or
personal data, and surface existing actionable errors when an eligible local
model is unavailable or output validation fails. Model quality remains
variable, so an adult creator reviews all generated material before using it
in production.

## Decision log

| Decision | Alternatives considered | Reason |
| --- | --- | --- |
| Reuse `storyboard-builder` | New catalog template; new screenplay runtime | It already supports 2–12 validated scene plans and avoids unnecessary scope. |
| Use 12 short scenes | A 3-scene draft; a custom unlimited screenplay | It fits a 5–8 minute story and supports later short-form editing. |
| English output | Turkish output | It makes the reusable GitHub example accessible to a wider builder audience. |
| Original capybara family | Bear-like animal designs; existing branded references | Clear species identity and safe, reusable source material. |
| Gentle rival, no villain | Scary antagonist; no rival | It creates comic tension without violating the young-audience boundary. |
