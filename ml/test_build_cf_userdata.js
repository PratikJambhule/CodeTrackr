/**
 * Tests for ml/build_cf_userdata.js: CSV parsing and mapping the Kaggle files to rowsFor()'s shape.
 * Run: node ml/test_build_cf_userdata.js
 */
const assert = require('assert');
const { parseLine, toPerson } = require('./build_cf_userdata');

let passed = 0;
const check = (name, fn) => { fn(); passed++; console.log(`  PASS  ${name}`); };

check('CSV lines: commas inside quotes and escaped quotes', () => {
  assert.deepStrictEqual(parseLine('"Fake, NP",805:A,1494892715,OK'), ['Fake, NP', '805:A', '1494892715', 'OK']);
  assert.deepStrictEqual(parseLine('"say ""hi""",x,'), ['say "hi"', 'x', '']);
});

check('a person: contests sorted by time, verdict OK = solved, problem tags and rating joined in', () => {
  const problems = new Map([['805:A', { rating: 1000, tags: ['math'] }]]);
  const p = toPerson('asha',
    [{ updateTime: '200', oldRating: '1500', newRating: '1520' }, { updateTime: '100', oldRating: '0', newRating: '1500' }],
    [{ problemId: '805:A', creationTime: '150', verdict: 'OK' }, { problemId: '17:A', creationTime: '160', verdict: 'WRONG_ANSWER' }, { problemId: '', creationTime: 'x' }],
    problems);
  assert.deepStrictEqual(p.rating.map((r) => r.t), [100, 200]);
  assert.deepStrictEqual(p.subs, [
    { t: 150, ok: true, key: '805:A', rating: 1000, tags: ['math'] },
    { t: 160, ok: false, key: '17:A', rating: null, tags: [] },
  ]);
});

console.log(`\n${passed} passed, 0 failed`);
