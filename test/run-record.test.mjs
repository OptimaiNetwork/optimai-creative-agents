import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { canonicalJson, createRunHistory, createRunRecord, digestInputs, hashText, parseRunRecord, runRecipeValues, RUN_RECORD_LIMITS, verifyRunRecord } from '../src/run-record.mjs';
import { CANVAS_LAB_AGENTS, canvasLabRecipeSettings, canvasLabRecipeValues, canvasLabSettings } from '../src/canvas-lab.mjs';
import { validateRecipeValues } from '../src/index.mjs';

const sha = (...parts) => createHash('sha256').update(Buffer.concat(parts.map(part => Buffer.from(part)))).digest('hex');
const base = { templateId: 'glitch-cut', settings: { ratio: '4:5', amount: 60, effect: 'blocks', seed: 4242 }, sdkVersion: '0.5.0', inputsDigest: `sha256:${'ab'.repeat(32)}` };

test('canonical JSON ignores key order and undefined keys and rejects ambiguous values', () => {
  assert.equal(canonicalJson({ b: 1, a: { d: [1, 'x', null], c: true }, z: undefined }), '{"a":{"c":true,"d":[1,"x",null]},"b":1}');
  assert.equal(canonicalJson({ a: -0 }), '{"a":0}');
  for (const value of [{ a: NaN }, { a: Infinity }, { a: [undefined] }, { a: new Date(0) }, { a: () => 1 }]) assert.throws(() => canonicalJson(value));
  let deep = 1; for (let i = 0; i < 12; i++) deep = { deep };
  assert.throws(() => canonicalJson(deep), /nested/);
});

test('hashText is pinned, 64-bit wide and spreads near-identical strings', () => {
  assert.equal(hashText(''), hashText(''));
  assert.match(hashText('optimai'), /^[a-f0-9]{16}$/);
  assert.deepEqual([hashText(''), hashText('a'), hashText('seed:1'), hashText('Ảnh đẹp 🎞')], ['30c81dfdf2401293', '1bedc25b19569c8e', '9a31081ccee6b142', '74e693ebb9790292']);
  const seen = new Set(Array.from({ length: 20000 }, (_, index) => hashText(`{"seed":${index}}`)));
  assert.equal(seen.size, 20000);
  // Both halves change when one bit of input changes.
  const [a, b] = [hashText('seed:1'), hashText('seed:3')];
  assert.notEqual(a.slice(0, 8), b.slice(0, 8)); assert.notEqual(a.slice(8), b.slice(8));
  assert.throws(() => hashText(42), TypeError);
});

test('a run record has one stable hash for the same run, whatever the key order or display data', () => {
  const record = createRunRecord(base);
  assert.equal(record.version, 1); assert.equal(record.seed, 4242);
  assert.match(record.hash, /^[a-f0-9]{16}$/);
  const shuffled = createRunRecord({ inputsDigest: base.inputsDigest, sdkVersion: '0.5.0', settings: { seed: 4242, effect: 'blocks', amount: 60, ratio: '4:5' }, templateId: 'glitch-cut', createdAt: '2026-10-30T09:00:00.000Z', output: { width: 1200, height: 1500 } });
  assert.equal(shuffled.hash, record.hash);
  assert.deepEqual(shuffled.output, { width: 1200, height: 1500 });
  for (const change of [{ templateId: 'print-shop' }, { settings: { ...base.settings, amount: 61 } }, { seed: 4243 }, { sdkVersion: '0.6.0' }, { inputsDigest: `sha256:${'cd'.repeat(32)}` }, { inputsDigest: null }])
    assert.notEqual(createRunRecord({ ...base, ...change }).hash, record.hash, JSON.stringify(change));
  assert.ok(Object.isFrozen(record) && Object.isFrozen(record.settings));
  const owned = { ...base.settings }; const copy = createRunRecord({ ...base, settings: owned }); owned.amount = 1;
  assert.equal(copy.settings.amount, 60);
  assert.equal(createRunRecord({ templateId: 'image-finish', settings: { preset: 'warm' } }).seed, null);
});

test('a run record refuses settings, seeds, versions and digests it cannot reproduce', () => {
  for (const bad of [{ templateId: 'Glitch Cut' }, { settings: [] }, { settings: { a: NaN } }, { seed: -1 }, { seed: 1.5 }, { sdkVersion: 'latest' }, { inputsDigest: 'md5:abc' }, { createdAt: 'yesterday' }, { settings: { text: 'x'.repeat(RUN_RECORD_LIMITS.settings) } }])
    assert.throws(() => createRunRecord({ ...base, ...bad }), JSON.stringify(bad).slice(0, 60));
});

test('records survive JSON and refuse tampering', () => {
  const record = createRunRecord({ ...base, createdAt: '2026-10-30T09:00:00.000Z' });
  const text = JSON.stringify(record);
  assert.deepEqual(parseRunRecord(text), record);
  assert.ok(verifyRunRecord(JSON.parse(text)));
  const tampered = JSON.parse(text); tampered.settings.amount = 100;
  assert.throws(() => parseRunRecord(tampered), /hash does not match/);
  assert.equal(verifyRunRecord(tampered), false);
  assert.equal(verifyRunRecord({ ...JSON.parse(text), script: 'x' }), false);
  assert.equal(verifyRunRecord({ ...JSON.parse(text), version: 2 }), false);
  assert.equal(verifyRunRecord('not json'), false);
  const { seed, ...missing } = JSON.parse(text); void seed;
  assert.equal(verifyRunRecord(missing), false);
});

test('input digests are SHA-256 over bytes in order, never names, with a 64-bit fallback', async () => {
  const one = new TextEncoder().encode('first image'), two = new Uint8Array([0, 1, 2, 255]);
  const digest = await digestInputs([new Blob([one], { type: 'image/png' }), two.buffer]);
  assert.equal(digest, `sha256:${sha(`2\n${sha(one)}\n${sha(two)}`)}`);
  assert.equal(await digestInputs([new File([one], 'renamed.png'), two]), digest);
  assert.equal(await digestInputs(['first image', two.subarray(0)]), digest);
  assert.notEqual(await digestInputs([two, one]), digest);
  assert.notEqual(await digestInputs([one]), digest);
  const fallback = await digestInputs([one, two], { subtle: null });
  assert.match(fallback, /^h64:[a-f0-9]{16}$/);
  assert.equal(await digestInputs([new Blob([one]), two], { subtle: null }), fallback);
  assert.ok(createRunRecord({ ...base, inputsDigest: fallback }));
  const controller = new AbortController(); controller.abort();
  await assert.rejects(digestInputs([one], { signal: controller.signal }), { name: 'AbortError' });
  await assert.rejects(digestInputs(Array.from({ length: RUN_RECORD_LIMITS.inputs + 1 }, () => one)), RangeError);
  await assert.rejects(digestInputs([{ size: 1 }]), TypeError);
});

test('run settings split into portable recipe values and engine-only extras', () => {
  assert.deepEqual(runRecipeValues('image-finish', { preset: 'noir', intensity: 70, film: 'golden' }), { values: { preset: 'noir', intensity: 70 }, extra: { film: 'golden' } });
  assert.deepEqual(runRecipeValues('image-finish', { preset: 'no such preset' }).extra, { preset: 'no such preset' });
  assert.throws(() => runRecipeValues('nope', {}));
});

test('canvas engine settings map back to the recipe that redraws them', () => {
  for (const [templateId, operation] of Object.entries(CANVAS_LAB_AGENTS)) {
    const live = canvasLabSettings(operation, { ...canvasLabRecipeSettings(templateId), mix: 30, transition: 'push', effect: 'trails', look: 'halftone', seed: 77, ink: 'image', position: 'top' });
    const { values, extra } = canvasLabRecipeValues(templateId, live);
    assert.deepEqual(validateRecipeValues(templateId, values), [], templateId);
    assert.deepEqual({ ...canvasLabRecipeSettings(templateId, values), ...extra }, live, templateId);
  }
  // Engine names go back to the saved recipe names; a style no recipe can name stays an extra.
  assert.equal(canvasLabRecipeValues('transition-lab', { transition: 'push' }).values.transition, 'camera move');
  assert.deepEqual(canvasLabRecipeValues('transition-lab', { transition: 'dissolve', mix: 50 }).extra, { transition: 'dissolve' });
  assert.equal(canvasLabRecipeValues('glitch-cut', { effect: 'echoes', seed: 9 }).values.effect, 'frame echoes');
  assert.equal(canvasLabRecipeValues('print-shop', { look: 'bayer' }).values.look, 'ordered dither');
  assert.deepEqual(canvasLabRecipeValues('poster-lab', canvasLabRecipeSettings('poster-lab')).extra, {});
  assert.throws(() => canvasLabRecipeValues('image-finish', {}));
});

test('run history is newest first, de-duplicated, settles slider drags and releases what it drops', () => {
  let clock = 0;
  const history = createRunHistory({ limit: 3, settleMs: 1000, now: () => clock });
  const run = amount => createRunRecord({ ...base, settings: { ...base.settings, amount } });
  assert.equal(history.add(run(10), 'a').added, true);
  clock = 2000; history.add(run(20), 'b');
  // A drag: each frame within a second replaces the one before.
  clock = 2300; assert.deepEqual(history.add(run(21), 'c').evicted.map(entry => entry.attachment), ['b']);
  clock = 2600; history.add(run(22), 'd');
  assert.deepEqual(history.list().map(entry => entry.attachment), ['d', 'a']);
  // Going back to an earlier run moves it to the front and hands back the duplicate preview.
  clock = 5000; const again = history.add(run(10), 'a2');
  assert.equal(again.added, false); assert.equal(again.entry.attachment, 'a');
  assert.deepEqual(again.evicted.map(entry => entry.attachment), ['a2']);
  // A run right after a restored one never replaces it.
  clock = 5100; history.add(run(30), 'e');
  assert.deepEqual(history.list().map(entry => entry.attachment), ['e', 'a', 'd']);
  history.settle(); clock = 5200;
  const full = history.add(run(31), 'f');
  assert.deepEqual(full.evicted.map(entry => entry.attachment), ['d']);
  assert.deepEqual(history.list().map(entry => entry.attachment), ['f', 'e', 'a']);
  assert.equal(history.size, 3); assert.equal(history.get(run(30).hash).attachment, 'e'); assert.equal(history.get('0'.repeat(16)), null);
  assert.deepEqual(history.clear().map(entry => entry.attachment), ['f', 'e', 'a']); assert.equal(history.size, 0);
  assert.throws(() => history.add({ hash: 'x' }), TypeError);
  for (const options of [{ limit: 0 }, { limit: 101 }, { settleMs: -1 }]) assert.throws(() => createRunHistory(options), RangeError);
});
