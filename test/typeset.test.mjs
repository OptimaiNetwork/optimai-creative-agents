import assert from 'node:assert/strict';
import test from 'node:test';
import { TYPESET_LIMITS, WRAP_MODES, breakLines, canvasMeasure, fitTitle, opticalSize } from '../src/typeset.mjs';

// A proportional stub font: narrow i/l/., wide m/w and capitals, everything scaled by size.
const unit = character => /[il.,'!|]/.test(character) ? .28 : /[mwMW]/.test(character) ? .86 : /[A-Z]/.test(character) ? .68 : character === ' ' ? .3 : .55;
const measure = (text, size) => Array.from(text).reduce((sum, character) => sum + unit(character), 0) * size;
const spread = widths => Math.max(...widths) - Math.min(...widths);
const words = text => text.split(/\s+/).filter(Boolean);

/** Every way to break `list` into exactly `count` lines that fit, by brute force. */
function* partitions(list, count, start = 0) {
  if (count === 1) { yield [list.slice(start)]; return; }
  for (let end = start + 1; end <= list.length - count + 1; end++) for (const rest of partitions(list, count - 1, end)) yield [list.slice(start, end), ...rest];
}
// Deterministic word lists for exhaustive checks.
function* corpus() {
  let seed = 7;
  const random = () => (seed = (seed * 1103515245 + 12345) >>> 0) / 2 ** 32;
  const dictionary = ['a', 'to', 'the', 'light', 'remarkable', 'make', 'we', 'something', 'is', 'wild', 'morning', 'of', 'quiet', 'studio', 'on', 'every', 'device'];
  for (let index = 0; index < 60; index++) yield Array.from({ length: 4 + Math.floor(random() * 7) }, () => dictionary[Math.floor(random() * dictionary.length)]).join(' ');
}

test('optical sizing tightens tracking and leading as display type grows', () => {
  assert.deepEqual(opticalSize(12), { tracking: .01, leading: 1.25 });
  assert.deepEqual(opticalSize(16), { tracking: .01, leading: 1.25 });
  assert.deepEqual(opticalSize(128), { tracking: -.02, leading: 1.08 });
  assert.deepEqual(opticalSize(400), opticalSize(128));
  let previous = opticalSize(16);
  for (let size = 17; size <= 128; size++) {
    const next = opticalSize(size);
    assert.ok(next.tracking <= previous.tracking && next.leading <= previous.leading, `monotone at ${size}px`);
    assert.ok(size * next.leading > (size - 1) * previous.leading, 'line height still grows with size');
    previous = next;
  }
  for (const bad of [0, -4, NaN]) assert.throws(() => opticalSize(bad), /positive/);
});

test('balanced breaks keep the greedy line count and are the most even layout possible', () => {
  let improved = 0;
  for (const text of corpus()) for (const width of [120, 180, 260]) {
    const greedy = breakLines(text, { measure, fontSize: 20, width, wrap: 'greedy' });
    const balanced = breakLines(text, { measure, fontSize: 20, width });
    assert.equal(balanced.lines.length, greedy.lines.length, 'Balancing never adds a line.');
    assert.deepEqual(words(balanced.lines.join(' ')), words(text), 'Every word kept, in order.');
    assert.ok(balanced.widths.every(value => value <= width + 1e-9), 'No line overflows.');
    balanced.lines.forEach((line, index) => assert.ok(Math.abs(balanced.widths[index] - measure(line, 20)) < 1e-9, 'Widths are the drawn widths.'));
    // Exhaustive: no other split into the same number of fitting lines has less squared slack.
    const cost = lines => lines.reduce((sum, line) => sum + ((width - measure(line.join(' '), 20)) / width) ** 2, 0);
    const best = Math.min(...[...partitions(words(text), greedy.lines.length)].filter(lines => lines.every(line => measure(line.join(' '), 20) <= width)).map(cost));
    assert.ok(Math.abs(cost(balanced.lines.map(words)) - best) < 1e-9, `optimal for “${text}” at ${width}px`);
    if (spread(balanced.widths) < spread(greedy.widths) - 1) improved++;
  }
  assert.ok(improved >= 40, `Balancing evened out many layouts (${improved}).`);
  const title = breakLines('Make something remarkable for the people you love today', { measure, fontSize: 20, width: 400 });
  assert.deepEqual(title.lines, ['Make something remarkable', 'for the people you love today']);
  assert.deepEqual(breakLines('Make something remarkable for the people you love today', { measure, fontSize: 20, width: 400, wrap: 'greedy' }).lines, ['Make something remarkable for the', 'people you love today']);
});

test('pretty breaks avoid a lone short last word; hard breaks and empty lines are kept', () => {
  let runts = 0;
  for (const text of corpus()) {
    const greedy = breakLines(text, { measure, fontSize: 20, width: 200, wrap: 'greedy' });
    const pretty = breakLines(text, { measure, fontSize: 20, width: 200, wrap: 'pretty' });
    assert.deepEqual(words(pretty.lines.join(' ')), words(text));
    assert.ok(pretty.widths.every(value => value <= 200));
    const runt = layout => layout.lines.length > 1 && !layout.lines.at(-1).includes(' ') && layout.widths.at(-1) < 200 / 3;
    if (runt(greedy)) { runts++; assert.ok(!runt(pretty) || pretty.lines.length === 1, `no runt for “${text}”`); }
  }
  assert.ok(runts >= 3, 'The corpus exercises runts.');
  const hard = breakLines('MAKE SOMETHING\n\nREMARKABLE.', { measure, fontSize: 40, width: 2000 });
  assert.deepEqual(hard.lines, ['MAKE SOMETHING', '', 'REMARKABLE.']);
  assert.deepEqual(breakLines('one\r\ntwo', { measure, width: 500 }).lines, ['one', 'two']);
});

test('words wider than the measure split between characters, with tracking counted', () => {
  const word = 'Supercalifragilisticexpialidocious';
  const { lines, widths } = breakLines(`${word} words`, { measure, fontSize: 30, width: 200, tracking: .05 });
  assert.equal(lines.slice(0, -1).join(''), word);
  assert.equal(lines.at(-1), 'words');
  assert.ok(widths.every(value => value <= 200 + 1e-9));
  assert.ok(Math.abs(widths[0] - (measure(lines[0], 30) + .05 * 30 * Array.from(lines[0]).length)) < 1e-9);
  assert.deepEqual(breakLines('😀😀😀😀', { measure: (text, size) => Array.from(text).length * size, fontSize: 10, width: 25 }).lines, ['😀😀', '😀😀'], 'Code points are never cut in half.');
});

test('fitTitle picks the largest size that fits, keeps words whole when it can and honours maxLines', () => {
  const calls = [];
  const counted = (text, size) => { calls.push([text, size]); return measure(text, size); };
  const layout = fitTitle('Make something remarkable for the people you love', { measure: counted, width: 600, height: 300, maxSize: 160 });
  assert.equal(layout.fits, true);
  assert.equal(layout.split, false);
  assert.ok(layout.height <= 300 && layout.width <= 600);
  assert.equal(layout.lineHeight, layout.fontSize * opticalSize(layout.fontSize).leading);
  assert.equal(layout.tracking, layout.fontSize * opticalSize(layout.fontSize).tracking);
  const larger = fitTitle('Make something remarkable for the people you love', { measure, width: 600, height: 300, maxSize: layout.fontSize + 1, minSize: layout.fontSize + 1 });
  assert.equal(larger.fits, false, 'One pixel larger does not fit.');
  assert.ok(calls.every(([, size]) => size === 160), 'Measured once, at maxSize.');
  assert.equal(new Set(calls.map(([text]) => text)).size, calls.length, 'Each word and character is measured once.');

  const whole = fitTitle('Supercalifragilisticexpialidocious words', { measure, width: 200, height: 400, maxSize: 64 });
  assert.deepEqual(whole.lines, ['Supercalifragilisticexpialidocious', 'words'], 'Shrinks rather than splitting a word.');
  const split = fitTitle('Supercalifragilisticexpialidocious', { measure, width: 200, height: 400, maxSize: 64, minSize: 24 });
  assert.equal(split.split, true);
  assert.equal(split.lines.join(''), 'Supercalifragilisticexpialidocious');

  const capped = fitTitle('one two three four five six seven eight', { measure, width: 120, height: 1000, maxSize: 60, maxLines: 2 });
  assert.ok(capped.lines.length <= 2 && capped.fits);
  const impossible = fitTitle('one two three four five six seven eight', { measure, width: 120, height: 10, maxSize: 60, minSize: 20 });
  assert.equal(impossible.fits, false);
  assert.equal(impossible.fontSize, 20);
  const fixed = fitTitle('Quiet', { measure, width: 1000, maxSize: 100, leading: 1.5, tracking: 0 });
  assert.deepEqual([fixed.fontSize, fixed.lineHeight, fixed.tracking], [100, 150, 0]);
});

test('typesetting validates its inputs and stays bounded', () => {
  assert.deepEqual(WRAP_MODES, ['balance', 'pretty', 'greedy']);
  assert.equal(Object.isFrozen(TYPESET_LIMITS), true);
  for (const [options, pattern] of [
    [{ measure, width: 100, wrap: 'justify' }, /wrap/], [{ measure, width: 0 }, /width/], [{ measure, width: Infinity }, /width/],
    [{ width: 100 }, /measure/], [{ measure: () => NaN, width: 100 }, /finite/], [{ measure, width: 100, fontSize: 5000 }, /fontSize/],
  ]) assert.throws(() => breakLines('a b', options), pattern);
  assert.throws(() => breakLines('x'.repeat(TYPESET_LIMITS.characters + 1), { measure, width: 100 }), /at most/);
  assert.throws(() => breakLines(42, { measure, width: 100 }), /string/);
  for (const options of [{ maxSize: 0 }, { maxSize: 2000 }, { maxSize: 20, minSize: 40 }, { maxSize: 20, height: 0 }]) assert.throws(() => fitTitle('a', { measure, width: 100, ...options }), /Sizes|height/);
  assert.deepEqual(breakLines('', { measure, width: 100 }).lines, ['']);
  const long = Array.from({ length: 300 }, (_, index) => ['make', 'a', 'remarkable', 'thing'][index % 4]).join(' ').slice(0, TYPESET_LIMITS.characters);
  const started = performance.now();
  const layout = fitTitle(long, { measure, width: 900, height: 1200, maxSize: 240 });
  assert.ok(layout.fits && performance.now() - started < 500, 'A 2000-character title lays out quickly.');
});

test('canvasMeasure sets the font for the size and measures without letter spacing', () => {
  const seen = [];
  const context = { font: '', letterSpacing: '4px', measureText(text) { seen.push([this.font, this.letterSpacing]); return { width: text.length * Number(this.font.match(/(\d+)px/)[1]) * .5 }; } };
  const width = canvasMeasure(context, size => `900 ${size}px system-ui`)('abcd', 40);
  assert.equal(width, 80);
  assert.deepEqual(seen, [['900 40px system-ui', '0px']]);
  const legacy = { font: '', measureText: () => ({ width: 10 }) };
  assert.equal(canvasMeasure(legacy, size => `${size}px serif`)('x', 12), 10);
  assert.equal('letterSpacing' in legacy, false, 'Contexts without letterSpacing are left alone.');
});
