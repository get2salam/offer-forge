// Smoke test for security-hardened render and import paths in js/main.js.
// Stubs the browser environment, loads the source, and asserts that:
//   - escapeHtml neutralizes <script>, attribute breakouts, and falsy input
//   - safeId rejects unsafe characters
//   - normalize strips control over types and lengths
//   - mergeImported refuses non-object roots and non-array item collections
//   - rendered list HTML never contains a raw <script> tag from a malicious item
//   - invalid dates and numeric fields are normalized before priority/render work
//
// Run with: node scripts/security-smoke.mjs

import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import assert from 'node:assert/strict';

const source = readFileSync(new URL('../js/main.js', import.meta.url), 'utf8');

function fakeElement() {
  const node = {
    innerHTML: '',
    textContent: '',
    value: '',
    children: [],
    classList: { add() {}, remove() {} },
    appendChild(child) { this.children.push(child); return child; },
    addEventListener() {},
    click() {},
    setAttribute() {},
  };
  return node;
}

const storage = new Map();
const sandbox = {
  console,
  setTimeout,
  clearTimeout,
  Math,
  Date,
  JSON,
  Number,
  Set,
  Map,
  Array,
  Object,
  String,
  RegExp,
  Blob: class { constructor(parts) { this.parts = parts; } },
  URL: { createObjectURL: () => 'blob:', revokeObjectURL: () => {} },
  localStorage: {
    getItem: (key) => (storage.has(key) ? storage.get(key) : null),
    setItem: (key, value) => storage.set(key, value),
    removeItem: (key) => storage.delete(key),
  },
  navigator: { clipboard: { writeText: async () => {} } },
  window: { prompt: () => '' },
  requestAnimationFrame: (fn) => fn(),
  document: {
    body: fakeElement(),
    createElement: () => fakeElement(),
    querySelector: () => fakeElement(),
    addEventListener: () => {},
  },
};

const captured = {};
const exposeTail = `
;globalThis.__test = {
  escapeHtml, safeId, safeString, normalize, mergeImported, seedState,
  renderList, refs, state, commit, SPEC, daysFromToday, formatDate, priority,
};
`;

runInNewContext(source + exposeTail, sandbox);
Object.assign(captured, sandbox.__test);

const { escapeHtml, safeId, normalize, mergeImported, seedState, SPEC, daysFromToday, formatDate, priority } = captured;

assert.equal(escapeHtml('<script>x</script>'), '&lt;script&gt;x&lt;/script&gt;');
assert.equal(escapeHtml('"><img onerror=1>'), '&quot;&gt;&lt;img onerror=1&gt;');
assert.equal(escapeHtml("o'reilly"), 'o&#39;reilly');
assert.equal(escapeHtml(null), '');
assert.equal(escapeHtml(undefined), '');
assert.equal(escapeHtml(0), '0');

assert.match(safeId('safe_id-1'), /^safe_id-1$/);
assert.notEqual(safeId('"><script>'), '"><script>');
assert.notEqual(safeId(''), '');
assert.notEqual(safeId({ toString: () => 'evil' }), 'evil');

const normalized = normalize({
  id: '"><script>alert(1)</script>',
  title: 42,
  note: null,
  category: 'NotARealCategory',
  state: 'NotARealState',
  textOne: { evil: true },
  date: 'not-a-date',
  score: 999,
  effort: -5,
});
assert.match(normalized.id, /^[A-Za-z0-9_-]+$/, 'malicious id must be replaced');
assert.equal(typeof normalized.title, 'string');
assert.ok(SPEC.categories.includes(normalized.category));
assert.ok(SPEC.states.includes(normalized.state));
assert.match(normalized.date, /^\d{4}-\d{2}-\d{2}$/);
assert.ok(normalized.score >= 1 && normalized.score <= 10);
assert.ok(normalized.effort >= 1 && normalized.effort <= 10);

const invalidNumbers = normalize({ score: 'not-a-number', effort: Number.NaN, metric: Infinity });
assert.equal(invalidNumbers.score, 7, 'invalid score must use the product default');
assert.equal(invalidNumbers.effort, 3, 'invalid effort must use the product default');
assert.equal(invalidNumbers.metric, SPEC.metric.default, 'invalid buyer-fit metric must use the product default');
assert.ok(Number.isFinite(priority(invalidNumbers)), 'priority must remain finite after numeric normalization');

const invalidDate = normalize({ date: '2026-99-99' });
assert.notEqual(invalidDate.date, '2026-99-99', 'impossible dates must be replaced');
assert.match(invalidDate.date, /^\d{4}-\d{2}-\d{2}$/);
assert.equal(daysFromToday('2026-99-99'), 999, 'invalid dates must sort as unscheduled');
assert.equal(formatDate('2026-99-99'), 'No date', 'invalid dates must not throw while rendering');

function isSeedShape(value) {
  return value
    && typeof value === 'object'
    && typeof value.boardTitle === 'string'
    && Array.isArray(value.items)
    && value.ui && typeof value.ui === 'object';
}
assert.ok(isSeedShape(mergeImported(null)), 'null payload must fall back to seed shape');
assert.ok(isSeedShape(mergeImported('string-not-object')), 'string payload must fall back to seed shape');
assert.ok(isSeedShape(mergeImported([1, 2, 3])), 'array payload must fall back to seed shape');
assert.equal(mergeImported([1, 2, 3]).items.length, seedState().items.length);

const huge = { items: Array.from({ length: 5000 }, () => ({ title: 'x' })) };
assert.ok(mergeImported(huge).items.length <= 500, 'must cap imported item count');

const malicious = mergeImported({
  items: [{ title: '<script>alert(1)</script>', note: '<img src=x onerror=1>', textOne: '"><iframe>', textTwo: "</span>'><svg onload=1>" }],
});
sandbox.__test.state = { ...sandbox.__test.state, items: malicious.items, ui: { ...sandbox.__test.state.ui, selectedId: malicious.items[0].id } };
sandbox.__test.renderList(malicious.items);
const rendered = sandbox.__test.refs.list.innerHTML;
for (const tag of ['<script', '<iframe', '<img', '<svg']) {
  assert.ok(!rendered.toLowerCase().includes(tag), `rendered HTML must not contain a raw ${tag} tag`);
}
assert.ok(rendered.includes('&lt;script&gt;'), 'script payload must be HTML-escaped');
assert.ok(rendered.includes('&lt;img src=x onerror=1&gt;'), 'img payload must be HTML-escaped');
assert.ok(rendered.includes('&lt;/span&gt;'), 'breakout attempt must be HTML-escaped');

const seeded = seedState();
sandbox.__test.commit({ ...seeded, ui: { ...seeded.ui, selectedId: seeded.items[0].id } });
const selectedList = sandbox.__test.refs.list.innerHTML;
assert.ok(selectedList.includes('aria-current="true"'), 'selected list item must expose current state to assistive tech');
assert.ok(selectedList.includes('aria-label="Select Promise around visible wins'), 'list item buttons need descriptive accessible labels');
assert.equal(
  sandbox.__test.refs.liveStatus.textContent,
  '3 offer blocks visible. Promise around visible wins selected.',
  'render should announce visible results and selected offer block',
);

console.log('security-smoke: OK');
