import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

// Run the real app and its event handlers without touching the production GAS.
const source = await readFile(new URL('../script.js', import.meta.url), 'utf8');
const reference = await readFile(new URL('../../tiling-quest/game.js', import.meta.url), 'utf8').catch(() => '');
const endpoint = 'https://script.google.com/macros/s/AKfycbxssCIHsD-N97SHxNC_GN0ihYeC0qy-lb-EY0KmSs6Gnztaph1sITMerLVEnNWOGkYc/exec?app=binomial-normal';
const options = { method: 'GET', mode: 'no-cors', cache: 'no-store', credentials: 'omit', keepalive: true };
assert.equal((source.match(/\bfetch\s*\(/g) || []).length, 1);
if (reference) assert.ok(reference.includes(endpoint.replace('app=binomial-normal', 'app=tiling-quest')));

function pageLoad(scenario) {
  const elements = new Map(), requests = [], intervals = new Map();
  const context2d = new Proxy({}, { get: (target, key) => target[key] ?? (() => {}) });
  let nextTimer = 0, downloads = 0;
  class Element {
    constructor(tag = 'div', id = '') {
      this.tag = tag; this.id = id; this.children = []; this.attributes = {}; this.listeners = {};
      this.style = {}; this.dataset = {}; this.value = ''; this.textContent = ''; this.checked = true;
      this.lastChild = { textContent: '' }; this.scrollLeft = 0; this.clientWidth = 1000;
      this.classList = { toggle() {} };
    }
    get valueAsNumber() { return this.value === '' ? NaN : Number(this.value); }
    get rows() { return this.children[0]?.children ?? []; }
    get cells() { return this.children; }
    get tBodies() { return this.children; }
    append(...children) { for (const child of children) { child.parent = this; this.children.push(child); } }
    replaceWith(element) { const parent = this.parent; parent.children[parent.children.indexOf(this)] = element; element.parent = parent; }
    setAttribute(key, value) { this.attributes[key] = String(value); }
    addEventListener(event, handler) { (this.listeners[event] ??= []).push(handler); }
    dispatch(event, extra = {}) { for (const handler of this.listeners[event] ?? []) handler({ target: this, preventDefault() {}, ...extra }); }
    click() { if (this.tag === 'a') downloads++; this.dispatch('click'); }
    focus() {}
    remove() {}
    getBoundingClientRect() { return { left: 0, top: 0, width: this.id === 'chart' ? 1000 : 112, height: 340 }; }
    getContext() { return context2d; }
    toBlob(callback) { callback({ type: 'image/png' }); }
  }
  const element = id => {
    if (!elements.has(id)) elements.set(id, new Element(id === 'chart' ? 'canvas' : 'div', id));
    return elements.get(id);
  };
  const table = element('distributionTable'); table.append(new Element('tbody'));
  element('chart').parentElement = new Element();
  const presets = [10, 20, 50, 100, 500, 1000].map(n => { const b = new Element('button'); b.dataset.n = String(n); return b; });
  const document = { getElementById: element, createElement: tag => new Element(tag),
    querySelectorAll: selector => { assert.equal(selector, '[data-n]'); return presets; },
    body: new Element('body'), addEventListener() {}, hidden: false };
  const sandbox = { document, window: { devicePixelRatio: 1 },
    ResizeObserver: class { observe() {} }, requestAnimationFrame: () => 1, cancelAnimationFrame() {},
    setInterval: fn => { const id = ++nextTimer; intervals.set(id, fn); return id; },
    clearInterval: id => intervals.delete(id), setTimeout: () => 1,
    URL: { createObjectURL: () => 'blob:test', revokeObjectURL() {} } };
  if (scenario !== 'unavailable') sandbox.fetch = (...args) => {
    requests.push(args);
    if (scenario === 'throw') throw new Error('blocked');
    if (scenario === 'reject') return Promise.reject(new Error('offline'));
    if (scenario === 'pending') return new Promise(() => {});
    return Promise.resolve({ type: 'opaque' });
  };
  const context = vm.createContext(sandbox);
  vm.runInContext(source, context); // Must finish without waiting for the fetch.
  return { element, requests, presets, intervals, context, get downloads() { return downloads; } };
}

for (const scenario of ['success', 'reject', 'throw', 'pending', 'unavailable']) {
  const page = pageLoad(scenario);
  const count = scenario === 'unavailable' ? 0 : 1;
  assert.equal(page.requests.length, count, `${scenario}: one call at initial display`);
  if (count) assert.deepEqual(JSON.parse(JSON.stringify(page.requests[0])), [endpoint, options]);
  assert.equal(page.element('mean').textContent, '10');
  assert.equal(page.element('exactValue').textContent, '0.1761970520');
  assert.equal(page.element('status').textContent, '', 'logging must never show a notice');
  const input = (id, value) => { const e = page.element(id); e.value = String(value); e.dispatch('input'); e.dispatch('change'); };
  input('nInput', 100); input('pInput', 0.1);
  assert.equal(page.element('exactValue').textContent, '0.1318653468');
  input('nSlider', 1000); input('pSlider', 0.01);
  assert.equal(page.element('mean').textContent, '10');
  assert.equal(page.element('distributionTable').rows[0].cells.length, 1002);
  page.presets[1].click();
  page.element('standardMode').click();
  assert.equal(page.element('xMin').value, -4);
  assert.equal(page.element('xMax').value, 4);
  for (const id of ['showCurve', 'showCorrection']) {
    page.element(id).checked = false; page.element(id).dispatch('change');
    page.element(id).checked = true; page.element(id).dispatch('change');
  }
  page.element('fullRange').click(); page.element('focusRange').click();
  input('selectedK', 2);
  page.element('chart').dispatch('keydown', { key: 'ArrowRight' });
  assert.equal(page.element('selectedK').value, 3);
  page.element('precision').value = '4'; page.element('precision').dispatch('change');
  page.element('play').click();
  assert.equal(page.element('pInput').disabled, true);
  page.element('speed').value = '30'; page.element('speed').dispatch('change');
  for (let i = 0; i < 15; i++) for (const tick of [...page.intervals.values()]) tick();
  assert.equal(page.element('nInput').value, 25);
  page.element('play').click(); assert.equal(page.intervals.size, 0);
  page.element('reset').click(); assert.equal(page.element('nInput').value, 10);
  page.element('normalMode').click();
  page.element('save').click(); assert.equal(page.downloads, 1);
  // Allow rejected fetch promises to settle before checking for retries or notices.
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(page.requests.length, count, `${scenario}: no additional calls after all operations`);
  assert.equal(page.element('status').textContent, 'PNGを作成しました。保存先を確認してください。');
  const reloaded = pageLoad(scenario); // A reload creates a new document / script context.
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(reloaded.requests.length, count, `${scenario}: one new call on reload`);
  assert.equal(reloaded.element('mean').textContent, '10');
  assert.equal(reloaded.element('status').textContent, '');
  console.log(`PASS ${scenario}: initial load + reload; no requests from UI or animation; app stays operational.`);
}
