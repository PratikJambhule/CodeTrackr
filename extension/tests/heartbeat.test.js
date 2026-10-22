/**
 * The time engine (plan §2: E3 + E6). Pure, so every rule is tested to the second.
 */
const assert = require('assert');
const path = require('path');
const { createVscodeStub, installVscodeStub } = require('./helpers/vscodeStub');

installVscodeStub(createVscodeStub().vscode);
const { TimeEngine, OTHER_FILES } = require(path.join(__dirname, '..', 'dist', 'extension.js'));

let passed = 0;
let failed = 0;
function check(name, fn) {
  try { fn(); console.log(`  PASS  ${name}`); passed++; }
  catch (err) { console.log(`  FAIL  ${name}: ${err.message}`); failed++; }
}
const S = 1000;
const T0 = Date.UTC(2026, 9, 22, 10, 0, 0); // 10:00:00
const at = (sec) => T0 + sec * S;
/** One heartbeat per second from `from` to `to` (inclusive). */
function beats(e, from, to, kind, file, lang = 'javascript') {
  for (let s = from; s <= to; s++) e.beat(at(s), kind, file, lang);
}
const fileSec = (snap, name) => (snap.perFile.find((f) => f.name === name) || { seconds: 0 }).seconds;

console.log('\nTimeEngine');

check('the worked example: 150 s in two uploads, extension.js 50 s, tracker.js 100 s, YouTube 0', () => {
  const e = new TimeEngine();
  beats(e, 0, 49, 'writing', 'extension.js');     // 10:00:00–10:00:50 typing extension.js
  beats(e, 50, 100, 'writing', 'tracker.js');     // 10:00:50–10:01:40 typing tracker.js
  beats(e, 101, 120, 'reading', 'tracker.js');    // scrolling …
  const up1 = e.take(at(120));                    // the 10:02:00 check
  assert.strictEqual(up1.seconds, 120);
  assert.strictEqual(up1.writingSec, 100);
  assert.strictEqual(up1.readingSec, 20);
  assert.strictEqual(fileSec(up1, 'extension.js'), 50);
  assert.strictEqual(fileSec(up1, 'tracker.js'), 70);
  assert.strictEqual(up1.startMs, at(0));
  beats(e, 121, 150, 'reading', 'tracker.js');    // … until 10:02:30
  e.setFocus(false, at(150));                     // then YouTube
  assert.strictEqual(e.isIdle(at(175)), false, 'still within the 30 s grace');
  assert.strictEqual(e.isIdle(at(181)), true, 'away for more than 30 s: flush the tail');
  const up2 = e.take(at(181));
  assert.strictEqual(up2.seconds, 30);
  assert.strictEqual(up2.readingSec, 30);
  assert.strictEqual(fileSec(up2, 'tracker.js'), 30);
  assert.strictEqual(e.take(at(900)).seconds, 0, 'YouTube counts 0');
});

check('10 minutes without any action counts 0, and so does the gap when you come back', () => {
  const e = new TimeEngine();
  beats(e, 0, 10, 'writing', 'a.js');
  assert.strictEqual(e.take(at(10)).seconds, 10);
  assert.strictEqual(e.isIdle(at(71)), true);
  assert.strictEqual(e.take(at(610)).seconds, 0);
  e.beat(at(610), 'writing', 'a.js'); // back after 10 min
  assert.strictEqual(e.take(at(610)).seconds, 0);
});

check('a pause of up to 60 s counts fully; 61 s counts 0', () => {
  const e = new TimeEngine();
  e.beat(at(0), 'writing', 'a.js');
  e.beat(at(60), 'writing', 'a.js');
  e.beat(at(121), 'writing', 'a.js');
  assert.strictEqual(e.take(at(121)).seconds, 60);
});

check('a gap takes the kind of the action that ends it and the file that was open', () => {
  const e = new TimeEngine();
  e.beat(at(0), 'reading', 'a.js');
  e.beat(at(20), 'writing', 'a.js');   // 20 s of thinking before typing → writing
  e.beat(at(30), 'reading', 'b.js');   // switched file: the 10 s belong to a.js, as reading
  const s = e.take(at(30));
  assert.strictEqual(s.writingSec, 20);
  assert.strictEqual(s.readingSec, 10);
  assert.strictEqual(fileSec(s, 'a.js'), 30);
  assert.strictEqual(fileSec(s, 'b.js'), 0);
});

check('away for 20 s and back: the 20 s count as reading', () => {
  const e = new TimeEngine();
  beats(e, 0, 10, 'writing', 'a.js');
  e.setFocus(false, at(10));
  e.setFocus(true, at(30));
  const s = e.take(at(30));
  assert.strictEqual(s.writingSec, 10);
  assert.strictEqual(s.readingSec, 20);
});

check('away for 40 s and back: the time away counts 0', () => {
  const e = new TimeEngine();
  beats(e, 0, 10, 'writing', 'a.js');
  e.setFocus(false, at(10));
  e.setFocus(true, at(50));
  assert.strictEqual(e.take(at(50)).seconds, 10);
});

check('a 6-minute build with no typing counts 6 minutes running', () => {
  const e = new TimeEngine();
  e.beat(at(0), 'writing', 'app.ts', 'typescript');
  e.runStart('build', at(0));
  assert.strictEqual(e.isIdle(at(300)), false, 'running is not idle');
  e.runEnd('build', at(360));
  const s = e.take(at(360));
  assert.strictEqual(s.runningSec, 360);
  assert.strictEqual(s.seconds, 360);
  assert.strictEqual(fileSec(s, 'app.ts'), 360);
});

check('a run keeps counting with VS Code in the background', () => {
  const e = new TimeEngine();
  e.beat(at(0), 'writing', 'a.cpp');
  e.runStart('tests', at(0));
  e.setFocus(false, at(5));
  e.runEnd('tests', at(300));
  assert.strictEqual(e.take(at(300)).runningSec, 300);
});

check('one run counts at most 30 minutes', () => {
  const e = new TimeEngine();
  e.runStart('server', at(0));
  assert.strictEqual(e.isRunning(at(1799)), true);
  assert.strictEqual(e.isRunning(at(1801)), false);
  e.runEnd('server', at(2400));
  assert.strictEqual(e.take(at(2400)).runningSec, 1800);
});

check('typing while something runs is counted once, as writing: what you do wins (D-54)', () => {
  const e = new TimeEngine();
  e.beat(at(0), 'writing', 'a.js');
  e.runStart('watch', at(0));
  beats(e, 1, 100, 'writing', 'a.js');
  e.runEnd('watch', at(100));
  const s = e.take(at(100));
  assert.strictEqual(s.seconds, 100);
  assert.strictEqual(s.writingSec, 100);
  assert.strictEqual(s.runningSec, 0);
});

check('a dev server left running: typing is writing, the wait after it is running (D-54)', () => {
  const e = new TimeEngine();
  e.runStart('npm run dev', at(0));                 // started from the terminal
  beats(e, 1, 50, 'writing', 'App.tsx');            // 50 s of typing with the server up
  e.advance(at(200));                                // then 150 s of watching the browser, no action
  const s = e.take(at(200));
  assert.strictEqual(s.writingSec, 50);              // 0..50: each pause belongs to the keystroke after it
  assert.strictEqual(s.runningSec, 150);             // 50..200: waiting with the server up
  assert.strictEqual(s.seconds, 200);
});

check('running is not counted before it can no longer be claimed by your next action', () => {
  const e = new TimeEngine();
  e.runStart('build', at(0));
  e.beat(at(10), 'writing', 'a.js');
  assert.strictEqual(e.countedMs(at(40)), 10000, 'the 30 s after the keystroke are still open');
  e.beat(at(40), 'writing', 'a.js');                // ... and the keystroke at 40 s claims them
  e.beat(at(130), 'writing', 'a.js');               // 90 s later: too long a pause to claim
  e.runEnd('build', at(130));
  const s = e.take(at(130));
  assert.strictEqual(s.writingSec, 40);              // 0..40
  assert.strictEqual(s.runningSec, 90);              // 40..130: the build ran, you were not acting
});

check('two runs at the same time count the clock once', () => {
  const e = new TimeEngine();
  e.runStart('a', at(0));
  e.runStart('b', at(10));
  e.runEnd('a', at(50));
  e.runEnd('b', at(60));
  assert.strictEqual(e.take(at(60)).runningSec, 60);
});

check('reading the output right after a run counts', () => {
  const e = new TimeEngine();
  e.runStart('g++', at(0));
  e.runEnd('g++', at(5));
  e.beat(at(25), 'writing', 'a.cpp');
  const s = e.take(at(25));
  assert.strictEqual(s.runningSec, 5);
  assert.strictEqual(s.writingSec, 20);
});

check('per-file seconds always sum to the total, even with fractions', () => {
  const e = new TimeEngine();
  let t = T0;
  for (let i = 0; i < 300; i++) { t += 333 + (i % 7) * 101; e.beat(t, i % 3 ? 'writing' : 'reading', `f${i % 7}.js`); }
  const s = e.take(t);
  assert.strictEqual(s.perFile.reduce((a, f) => a + f.seconds, 0), s.seconds);
  assert.strictEqual(s.writingSec + s.readingSec + s.runningSec, s.seconds);
  for (const f of s.perFile) assert.strictEqual(f.writing + f.reading + f.running, f.seconds);
});

check('at most 30 files; the rest are merged into one row and the sum still matches', () => {
  const e = new TimeEngine();
  for (let i = 0; i < 40; i++) e.beat(at(i * 10), 'writing', `f${i}.js`);
  const s = e.take(at(400));
  assert.strictEqual(s.perFile.length, 30);
  assert.strictEqual(s.perFile[29].name, OTHER_FILES);
  assert.strictEqual(s.perFile.reduce((a, f) => a + f.seconds, 0), s.seconds);
});

check('events while VS Code is in the background are ignored', () => {
  const e = new TimeEngine();
  e.beat(at(0), 'writing', 'a.js');
  e.setFocus(false, at(1));
  e.beat(at(20), 'writing', 'a.js'); // e.g. a formatter or git changing the file
  e.beat(at(40), 'writing', 'a.js');
  assert.strictEqual(e.take(at(40)).seconds, 1);
});

check('the language comes with each file', () => {
  const e = new TimeEngine();
  e.beat(at(0), 'writing', 'two_sum.cpp', 'cpp');
  e.beat(at(10), 'writing', 'two_sum.cpp', 'cpp');
  assert.strictEqual(e.take(at(10)).perFile[0].language, 'cpp');
});

check('nothing counted gives an empty snapshot', () => {
  const s = new TimeEngine().take(at(0));
  assert.deepStrictEqual(s, { startMs: null, seconds: 0, writingSec: 0, readingSec: 0, runningSec: 0, perFile: [] });
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
