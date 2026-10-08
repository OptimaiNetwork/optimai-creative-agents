import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile,readdir} from 'node:fs/promises';
import {AGENT_CATALOG} from '../src/index.mjs';

test('every reviewed agent ships a distinct self-contained original SVG thumbnail', async()=> {
  const root = new URL('../artwork/',import.meta.url);
  assert.deepEqual((await readdir(root)).sort(), AGENT_CATALOG.map(agent=>agent.id+'.svg').sort());
  const seen = new Set();
  for(const agent of AGENT_CATALOG){
    const svg = await readFile(new URL(agent.id+'.svg',root),'utf8');
    assert.match(svg,/viewBox="0 0 480 270"/);
    assert.match(svg,/<svg[^>]*xmlns="http:\/\/www.w3.org\/2000\/svg"/);
    assert.equal(/<script|<foreignObject|\son[a-z]+\s*=|(?:href|src)\s*=|url\(\s*['"]?(?!#)/i.test(svg),false,agent.id);
    assert.ok(Buffer.byteLength(svg)<256000);
    assert.equal(seen.has(svg),false,agent.id);
    seen.add(svg);
  }
});
