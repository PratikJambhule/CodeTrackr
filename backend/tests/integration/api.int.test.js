'use strict';

/**
 * End-to-end API flow against a real (in-memory) MongoDB:
 * track -> analytics -> leaderboard -> groups -> goals.
 * Run: npm run test:int
 */
const assert = require('assert');
const request = require('supertest');
const h = require('./harness');

// A realistic upload: the extension reports window-focus time alongside the
// duration, and ingest credits time only as far as focus can vouch for it.
function flush(overrides = {}) {
  const duration = overrides.duration ?? 120;
  return {
    fileName: 'index.ts',
    language: 'typescript',
    projectName: 'demo',
    duration,
    // One minute into a 10-minute window an hour ago: anything up to 540 s stays
    // in a single bucket whatever the wall clock says, so tests are not flaky.
    timestamp: new Date(Math.floor((Date.now() - 3600e3) / 600000) * 600000 + 60000).toISOString(),
    editorAnalytics: { charsInserted: 200, linesInserted: 10, saveCount: 1 },
    focusAnalytics: { focusedMs: duration * 1000 },
    ...overrides,
  };
}

// 00:00 India time (UTC+5:30) on the instant's IST date, as a UTC epoch ms.
function istMidnightUtc(instant) {
  const local = new Date(instant + 330 * 60000);
  return Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()) - 330 * 60000;
}

async function main() {
  const app = await h.start();
  const Activity = require('../../models/Activity');

  const failed = await h.run('integration: API flow', [
    ['track: two flushes in one window merge into one bucket', async () => {
      const { apiKey } = await h.makeUser();
      const a = await request(app).post('/api/extension/track').set('x-api-key', apiKey).send(flush());
      assert.strictEqual(a.status, 201, JSON.stringify(a.body));
      const b = await request(app).post('/api/extension/track').set('x-api-key', apiKey).send(flush());
      assert.strictEqual(b.status, 201);
      assert.strictEqual(String(a.body.bucket.id), String(b.body.bucket.id));
      const docs = await Activity.find({}).lean();
      assert.strictEqual(docs.length, 1);
      assert.strictEqual(docs[0].duration, 240);
      assert.strictEqual(docs[0].flushCount, 2);
      assert.strictEqual(docs[0].editorAnalytics.charsInserted, 400);
    }],

    ['track: wrong key is 401, bad payload is 400', async () => {
      const { apiKey } = await h.makeUser();
      const bad = await request(app).post('/api/extension/track').set('x-api-key', 'nope').send(flush());
      assert.strictEqual(bad.status, 401);
      const invalid = await request(app).post('/api/extension/track').set('x-api-key', apiKey).send(flush({ duration: 99999 }));
      assert.strictEqual(invalid.status, 400);
      assert.strictEqual(await Activity.countDocuments(), 0);
    }],

    ['analytics: owner sees their week, another user gets 403', async () => {
      const me = await h.makeUser('Me');
      const other = await h.makeUser('Other');
      await request(app).post('/api/extension/track').set('x-api-key', me.apiKey).send(flush({ duration: 1800 }));
      const mine = await request(app).get(`/api/analytics/weekly/${me.user.id}`).set('Cookie', me.cookie);
      assert.strictEqual(mine.status, 200);
      assert.ok(mine.body.totalHours >= 0.49 && mine.body.totalHours <= 0.51, `totalHours ${mine.body.totalHours}`);
      const theirs = await request(app).get(`/api/analytics/weekly/${me.user.id}`).set('Cookie', other.cookie);
      assert.strictEqual(theirs.status, 403);
      const anon = await request(app).get(`/api/analytics/weekly/${me.user.id}`);
      assert.strictEqual(anon.status, 401);
    }],

    ['leaderboard: ranks by hours and never returns email', async () => {
      const a = await h.makeUser('Alice');
      const b = await h.makeUser('Bob');
      await request(app).post('/api/extension/track').set('x-api-key', a.apiKey).send(flush({ duration: 3600 }));
      await request(app).post('/api/extension/track').set('x-api-key', b.apiKey).send(flush({ duration: 600 }));
      const res = await request(app).get('/api/leaderboard').set('Cookie', a.cookie);
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body[0].name, 'Alice');
      assert.strictEqual(res.body[0].rank, 1);
      assert.ok(res.body.every((row) => !('email' in row)));
    }],

    ['groups: private join needs the password; details are members-only', async () => {
      const owner = await h.makeUser('Owner');
      const joiner = await h.makeUser('Joiner');
      const outsider = await h.makeUser('Outsider');
      const created = await request(app).post('/api/groups/create').set('Cookie', owner.cookie)
        .send({ groupName: 'Contest', groupDescription: 'week 1', visibility: 'private', password: 's3cret' });
      assert.strictEqual(created.status, 201);
      assert.ok(!('password' in created.body.group));
      const id = created.body.group._id;

      const wrong = await request(app).post(`/api/groups/${id}/join`).set('Cookie', joiner.cookie).send({ password: 'x' });
      assert.strictEqual(wrong.status, 401);
      const ok = await request(app).post(`/api/groups/${id}/join`).set('Cookie', joiner.cookie).send({ password: 's3cret' });
      assert.strictEqual(ok.status, 200);
      const again = await request(app).post(`/api/groups/${id}/join`).set('Cookie', joiner.cookie).send({ password: 's3cret' });
      assert.strictEqual(again.status, 400);

      await request(app).post('/api/extension/track').set('x-api-key', joiner.apiKey).send(flush({ duration: 1800 }));
      const details = await request(app).get(`/api/groups/${id}/details`).set('Cookie', owner.cookie);
      assert.strictEqual(details.status, 200);
      assert.strictEqual(details.body.leaderboard[0].userName, 'Joiner');
      assert.strictEqual(details.body.leaderboard[0].codingHours, 0.5);

      const denied = await request(app).get(`/api/groups/${id}/details`).set('Cookie', outsider.cookie);
      assert.strictEqual(denied.status, 403);
    }],

    ['goals: progress counts matching activity; complete is owner-only', async () => {
      const me = await h.makeUser('Me');
      const other = await h.makeUser('Other');
      const deadline = new Date(Date.now() + 7 * 864e5).toISOString();
      const goal = await request(app).post('/api/goals/create').set('Cookie', me.cookie)
        .send({ title: 'TS', targetHours: 1, techStack: 'TypeScript', deadline });
      assert.strictEqual(goal.status, 201);
      // Pin the goal's creation 5 minutes into a window W, then upload 30 minutes
      // of work starting 1 minute later. The first slice lands in bucket W, whose
      // timestamp is BEFORE createdAt; it must still count (M-31).
      const W = Math.floor((Date.now() - 50 * 60000) / 600000) * 600000;
      const Goal = require('../../models/Goal');
      await Goal.collection.updateOne({ _id: new (require('mongoose').Types.ObjectId)(goal.body._id) },
        { $set: { createdAt: new Date(W + 5 * 60000) } });
      await request(app).post('/api/extension/track').set('x-api-key', me.apiKey)
        .send(flush({ duration: 1800, timestamp: new Date(W + 6 * 60000).toISOString() }));
      const progress = await request(app).get(`/api/goals/${goal.body._id}/progress`).set('Cookie', me.cookie);
      assert.strictEqual(progress.status, 200);
      assert.strictEqual(progress.body.currentHours, 0.5);
      assert.strictEqual(progress.body.progress, 50);
      const stolen = await request(app).patch(`/api/goals/${goal.body._id}/complete`).set('Cookie', other.cookie);
      assert.strictEqual(stolen.status, 404);
      const done = await request(app).patch(`/api/goals/${goal.body._id}/complete`).set('Cookie', me.cookie);
      assert.strictEqual(done.body.goal.status, 'completed');
    }],

    ['groups: no response carries an email (M-28, M-29)', async () => {
      const owner = await h.makeUser('Owner');
      const stranger = await h.makeUser('Stranger');
      const created = await request(app).post('/api/groups/create').set('Cookie', owner.cookie)
        .send({ groupName: 'Open', groupDescription: 'd', visibility: 'public' });
      const id = created.body.group._id;
      const discover = await request(app).get('/api/groups/discover').set('Cookie', stranger.cookie);
      assert.strictEqual(discover.status, 200);
      assert.strictEqual(discover.body.groups.length, 1);
      assert.ok(!JSON.stringify(discover.body).includes('@example.test'), 'discover leaks an email');
      await request(app).post(`/api/groups/${id}/join`).set('Cookie', stranger.cookie).send({});
      for (const path of ['/api/groups/my-groups', `/api/groups/${id}/details`]) {
        const res = await request(app).get(path).set('Cookie', stranger.cookie);
        assert.strictEqual(res.status, 200);
        assert.ok(!JSON.stringify(res.body).includes('@example.test'), `${path} leaks an email`);
      }
    }],

    ['auth: login start sets a state cookie; a callback with the wrong state is refused (L-11)', async () => {
      const start = await request(app).get('/auth/google');
      assert.strictEqual(start.status, 302);
      const state = new URL(start.headers.location).searchParams.get('state');
      assert.ok(state && state.length === 32, 'no state on the Google redirect');
      const cookie = (start.headers['set-cookie'] || []).find((c) => c.startsWith('oauth_state='));
      assert.ok(cookie && cookie.includes(state) && /HttpOnly/i.test(cookie));

      const forged = await request(app).get('/auth/google/callback?code=x&state=attacker')
        .set('Cookie', cookie.split(';')[0]);
      assert.strictEqual(forged.status, 302);
      assert.strictEqual(forged.headers.location, 'http://localhost:5173/login?error=signin');
      assert.ok(!(forged.headers['set-cookie'] || []).some((c) => c.startsWith('token=')));
    }],

    ['auth: cancelling on Google returns to the frontend login, not an API 404 (M-26)', async () => {
      const res = await request(app).get('/auth/google/callback?error=access_denied&state=x');
      assert.strictEqual(res.status, 302);
      assert.strictEqual(res.headers.location, 'http://localhost:5173/login?error=signin');
    }],

    ['analytics: the daily view returns today\'s activity', async () => {
      const me = await h.makeUser();
      await request(app).post('/api/extension/track').set('x-api-key', me.apiKey)
        .send(flush({ duration: 600, timestamp: new Date().toISOString() }));
      const tz = new Date().getTimezoneOffset();
      const res = await request(app).get(`/api/analytics/${me.user.id}?timezone=${tz}`).set('Cookie', me.cookie);
      assert.strictEqual(res.status, 200);
      assert.ok(res.body.totalHours > 0, `today shows ${res.body.totalHours} h`);
    }],

    ['api keys: stored hashed; profile never returns the key; wrong secret is 401', async () => {
      const me = await h.makeUser();
      assert.match(me.apiKey, /^ct_[0-9a-f]{16}_/);
      const User = require('../../models/user');
      const raw = await User.collection.findOne({ _id: me.user._id });
      // The secret is base64url, so it can itself contain '_': take everything after ct_<id>_.
      assert.ok(!JSON.stringify(raw).includes(me.apiKey.split('_').slice(2).join('_')), 'secret stored in clear');
      assert.strictEqual(raw.apiKey, undefined);

      const profile = await request(app).get('/api/user/profile').set('Cookie', me.cookie);
      assert.strictEqual(profile.status, 200);
      assert.ok(!JSON.stringify(profile.body).includes(me.apiKey));
      assert.strictEqual(profile.body.user.hasApiKey, true);
      assert.ok(profile.body.user.apiKeyHint.endsWith(me.apiKey.slice(-4)));

      const tampered = me.apiKey.slice(0, -1) + (me.apiKey.endsWith('A') ? 'B' : 'A');
      const bad = await request(app).post('/api/extension/track').set('x-api-key', tampered).send(flush());
      assert.strictEqual(bad.status, 401);
      const good = await request(app).post('/api/extension/track').set('x-api-key', me.apiKey).send(flush());
      assert.strictEqual(good.status, 201);
    }],

    ['api keys: regenerating revokes the old key', async () => {
      const me = await h.makeUser();
      const res = await request(app).post('/api/user/regenerate-api-key').set('Cookie', me.cookie);
      assert.strictEqual(res.status, 200);
      assert.notStrictEqual(res.body.apiKey, me.apiKey);
      const old = await request(app).get('/api/extension/verify').set('x-api-key', me.apiKey);
      assert.strictEqual(old.status, 401);
      const fresh = await request(app).get('/api/extension/verify').set('x-api-key', res.body.apiKey);
      assert.strictEqual(fresh.status, 200);
    }],

    ['api keys: a legacy plaintext key still works once and is converted to a hash', async () => {
      const me = await h.makeUser();
      const User = require('../../models/user');
      const legacy = 'ab'.repeat(32);
      await User.collection.updateOne({ _id: me.user._id },
        { $set: { apiKey: legacy }, $unset: { apiKeyId: '', apiKeyHash: '', apiKeyLast4: '' } });

      const first = await request(app).get('/api/extension/verify').set('x-api-key', legacy);
      assert.strictEqual(first.status, 200);
      const raw = await User.collection.findOne({ _id: me.user._id });
      assert.strictEqual(raw.apiKey, undefined, 'plaintext key not removed');
      assert.strictEqual(raw.legacyApiKeyHash.length, 64);
      const second = await request(app).get('/api/extension/verify').set('x-api-key', legacy);
      assert.strictEqual(second.status, 200);

      const profile = await request(app).get('/api/user/profile').set('Cookie', me.cookie);
      assert.strictEqual(profile.body.user.legacyApiKey, true);
      assert.strictEqual(profile.body.user.hasApiKey, false);
    }],

    ['idempotency: the same flushId sent twice is counted once', async () => {
      const me = await h.makeUser();
      const body = flush({ duration: 300, flushId: '3f2b8c1e-9a4d-4c7b-8e2f-1a2b3c4d5e6f' });
      const first = await request(app).post('/api/extension/track').set('x-api-key', me.apiKey).send(body);
      assert.strictEqual(first.status, 201);
      const retry = await request(app).post('/api/extension/track').set('x-api-key', me.apiKey).send(body);
      assert.strictEqual(retry.status, 200);
      assert.strictEqual(retry.body.duplicate, true);
      const [doc] = await Activity.find({}).lean();
      assert.strictEqual(doc.duration, 300);
      assert.strictEqual(doc.flushCount, 1);
    }],

    ['idempotency: different ids, or no id (old extensions), are each applied', async () => {
      const me = await h.makeUser();
      for (const flushId of ['aaaaaaaa-0001', 'aaaaaaaa-0002', undefined, undefined]) {
        const r = await request(app).post('/api/extension/track').set('x-api-key', me.apiKey)
          .send(flush({ duration: 60, flushId })); // default timestamp: one fixed window, never split
        assert.strictEqual(r.status, 201);
      }
      const [doc] = await Activity.find({}).lean();
      assert.strictEqual(doc.duration, 240);
    }],

    ['idempotency: ids are per user, so two users may reuse one', async () => {
      const a = await h.makeUser('A');
      const b = await h.makeUser('B');
      const body = flush({ flushId: 'shared-id-123' });
      assert.strictEqual((await request(app).post('/api/extension/track').set('x-api-key', a.apiKey).send(body)).status, 201);
      assert.strictEqual((await request(app).post('/api/extension/track').set('x-api-key', b.apiKey).send(body)).status, 201);
    }],

    ['idempotency: if applying fails, the retry is not mistaken for a duplicate', async () => {
      const me = await h.makeUser();
      const body = flush({ duration: 120, flushId: 'retry-after-failure-1' });
      const original = Activity.findOneAndUpdate;
      Activity.findOneAndUpdate = () => { throw new Error('simulated database failure'); };
      const failedOnce = await request(app).post('/api/extension/track').set('x-api-key', me.apiKey).send(body);
      Activity.findOneAndUpdate = original;
      assert.strictEqual(failedOnce.status, 500);
      const retry = await request(app).post('/api/extension/track').set('x-api-key', me.apiKey).send(body);
      assert.strictEqual(retry.status, 201);
      const [doc] = await Activity.find({}).lean();
      assert.strictEqual(doc.duration, 120);
    }],

    ['anti-cheat: a legitimate offline hour is credited in full across six windows', async () => {
      const me = await h.makeUser();
      const start = Math.floor((Date.now() - 2 * 3600e3) / 600000) * 600000;
      const r = await request(app).post('/api/extension/track').set('x-api-key', me.apiKey)
        .send(flush({ duration: 3600, timestamp: new Date(start).toISOString() }));
      assert.strictEqual(r.status, 201);
      assert.strictEqual(r.body.credited, 3600);
      const docs = await Activity.find({}).sort({ bucketStart: 1 }).lean();
      assert.strictEqual(docs.length, 6);
      assert.ok(docs.every((d) => d.duration === 600));
      assert.strictEqual(docs[0].claimedDuration, 3600);
      // One upload, however many windows it spans (regression: spread docs counted as uploads).
      assert.strictEqual(docs.reduce((n, d) => n + (d.flushCount ?? 1), 0), 1);
    }],

    ['anti-cheat: a scripted client cannot credit more than 600 s per 10-minute window', async () => {
      const me = await h.makeUser();
      const W = Math.floor((Date.now() - 3600e3) / 600000) * 600000;
      let credited = 0;
      for (let i = 0; i < 10; i++) {
        // Each claims a full 10 minutes in the SAME window, with faked focus time,
        // spread over different projects so they land in different buckets.
        const r = await request(app).post('/api/extension/track').set('x-api-key', me.apiKey)
          .send(flush({ duration: 600, projectName: `p${i}`, timestamp: new Date(W).toISOString() }));
        assert.strictEqual(r.status, 201);
        credited += r.body.credited;
      }
      assert.strictEqual(credited, 600);
      const [row] = await Activity.aggregate([{ $group: { _id: null, d: { $sum: '$duration' }, c: { $sum: '$claimedDuration' } } }]);
      assert.strictEqual(row.d, 600);
      assert.strictEqual(row.c, 6000, 'the inflated claim stays visible');

      const lb = await request(app).get('/api/leaderboard').set('Cookie', me.cookie);
      assert.ok(Math.abs(lb.body[0].totalHours - 600 / 3600) < 1e-9);
    }],

    ['anti-cheat: time without focus to vouch for it is credited only the 120 s grace', async () => {
      const me = await h.makeUser();
      const r = await request(app).post('/api/extension/track').set('x-api-key', me.apiKey)
        .send(flush({ duration: 1800, focusAnalytics: undefined }));
      assert.strictEqual(r.body.credited, 120);
    }],

    ['anti-cheat: a batch larger than 100 items is refused', async () => {
      const me = await h.makeUser();
      const activities = Array.from({ length: 101 }, () => flush({ duration: 10 }));
      const r = await request(app).post('/api/extension/track/batch').set('x-api-key', me.apiKey).send({ activities });
      assert.strictEqual(r.status, 400);
      assert.strictEqual(await Activity.countDocuments(), 0);
    }],

    ['userstats: running totals equal a from-scratch rebuild, and both leaderboard paths agree', async () => {
      const UserStats = require('../../models/UserStats');
      const { rebuildAll } = require('../../services/userStats');
      const a = await h.makeUser('Ann');
      const b = await h.makeUser('Ben');
      const ts = (min) => new Date(Date.now() - min * 60000).toISOString();
      await request(app).post('/api/extension/track').set('x-api-key', a.apiKey)
        .send(flush({ duration: 1200, timestamp: ts(200), gitAnalytics: { commits: 2 } }));
      await request(app).post('/api/extension/track').set('x-api-key', a.apiKey)
        .send(flush({ duration: 300, projectName: 'other', timestamp: ts(100), linesAdded: 40, linesRemoved: 5 }));
      await request(app).post('/api/extension/track').set('x-api-key', b.apiKey)
        .send(flush({ duration: 600, timestamp: ts(50), terminalAnalytics: { totalCommands: 4, failedCommands: 3 } }));

      const pick = (d) => ({ s: d.totalSeconds, la: d.linesAdded, lr: d.linesRemoved, c: d.commits, f: d.flushes,
        tc: d.totalCommands, fc: d.failedCommands, p: [...d.projects].sort() });
      const live = (await UserStats.find({}).sort({ totalSeconds: -1 }).lean()).map(pick);
      assert.strictEqual(live[0].s, 1500);
      assert.strictEqual(live[0].c, 2);

      // Pretend the backfill has run, so the all-time board trusts the running totals.
      const Migration = require('../../models/Migration');
      await Migration.create({ _id: 'userstats-backfill', completedAt: new Date() });
      const viaStats = await request(app).get('/api/leaderboard').set('Cookie', a.cookie);
      assert.strictEqual(viaStats.headers['x-leaderboard-source'], 'userstats');

      await UserStats.deleteMany({});
      await Migration.deleteMany({});
      const viaScan = await request(app).get('/api/leaderboard').set('Cookie', a.cookie);
      assert.strictEqual(viaScan.headers['x-leaderboard-source'], 'scan');
      const strip = (rows) => rows.filter((r) => r.totalHours > 0).map(({ userId, profilePictureUrl, ...r }) => r);
      assert.deepStrictEqual(strip(viaStats.body), strip(viaScan.body), JSON.stringify([strip(viaStats.body), strip(viaScan.body)]));

      const dry = await rebuildAll({ apply: false });
      assert.strictEqual(dry.written, 0);
      assert.strictEqual(await UserStats.countDocuments(), 0);
      assert.strictEqual(await Migration.countDocuments(), 0, 'a dry run records nothing');
      await rebuildAll({ apply: true });
      const rebuilt = (await UserStats.find({}).sort({ totalSeconds: -1 }).lean()).map(pick);
      assert.deepStrictEqual(rebuilt, live, JSON.stringify({ rebuilt, live }));
      assert.ok(await Migration.exists({ _id: 'userstats-backfill' }), 'an applied rebuild records that it finished');
    }],

    ['userstats: all-time boards keep scanning until the backfill has run (regression: one new uploader filled the whole board)', async () => {
      const UserStats = require('../../models/UserStats');
      const { rebuildAll } = require('../../services/userStats');
      const old = await h.makeUser('Oldtimer');
      const fresh = await h.makeUser('Newcomer');
      const created = await request(app).post('/api/groups/create').set('Cookie', fresh.cookie)
        .send({ groupName: 'Squad', groupDescription: 'x', visibility: 'public' });
      const id = created.body.group._id;
      await request(app).post(`/api/groups/${id}/join`).set('Cookie', old.cookie).send({});
      // Oldtimer's history predates running totals: activity exists, no userstats row.
      await request(app).post('/api/extension/track').set('x-api-key', old.apiKey).send(flush({ duration: 3600 }));
      await UserStats.deleteMany({ userId: old.user.id });
      // Newcomer uploads after the deploy, which creates a userstats row.
      await request(app).post('/api/extension/track').set('x-api-key', fresh.apiKey).send(flush({ duration: 600 }));

      const before = await request(app).get('/api/leaderboard').set('Cookie', fresh.cookie);
      assert.strictEqual(before.headers['x-leaderboard-source'], 'scan');
      assert.deepStrictEqual(before.body.filter((r) => r.totalHours > 0).map((r) => r.name), ['Oldtimer', 'Newcomer']);
      const groupBefore = await request(app).get(`/api/groups/${id}/details`).set('Cookie', fresh.cookie);
      assert.strictEqual(groupBefore.body.source, 'scan');
      assert.deepStrictEqual(groupBefore.body.leaderboard.map((r) => [r.userName, r.codingHours]), [['Oldtimer', 1], ['Newcomer', 0.17]]);

      await rebuildAll({ apply: true });
      const after = await request(app).get('/api/leaderboard').set('Cookie', fresh.cookie);
      assert.strictEqual(after.headers['x-leaderboard-source'], 'userstats');
      assert.deepStrictEqual(after.body.filter((r) => r.totalHours > 0).map((r) => r.name), ['Oldtimer', 'Newcomer']);
      const groupAfter = await request(app).get(`/api/groups/${id}/details`).set('Cookie', fresh.cookie);
      assert.strictEqual(groupAfter.body.source, 'userstats');
      assert.deepStrictEqual(groupAfter.body.leaderboard.map((r) => [r.userName, r.codingHours]), [['Oldtimer', 1], ['Newcomer', 0.17]]);
    }],

    ['notifications: each goal gets one reminder and one missed notice, even after deleting it or with two sweeps at once (regression)', async () => {
      const Goal = require('../../models/Goal');
      const Notification = require('../../models/Notification');
      const { checkUpcomingDeadlines, checkOverdueGoals } = require('../../services/notificationScheduler');
      const me = await h.makeUser();
      const hour = 3600e3;
      const goal = (title, offset) => Goal.create({ userId: me.user._id, title, techStack: 'js', targetHours: 5, deadline: new Date(Date.now() + offset) });
      const missed = await goal('Missed', -2 * hour);
      const soon = await goal('Soon', 6.5 * hour);
      await goal('Long overdue', -10 * 24 * hour); // its notice was handled long ago

      // The in-process cron and the GitHub Actions call can run at the same minute.
      await Promise.all([checkUpcomingDeadlines(), checkUpcomingDeadlines(), checkOverdueGoals(), checkOverdueGoals()]);
      const rows = await Notification.find({ userId: me.user._id }).lean();
      assert.deepStrictEqual(rows.map((n) => `${n.type}:${String(n.goalId)}`).sort(),
        [`deadline_missed:${missed._id}`, `deadline_reminder:${soon._id}`].sort());

      // Deleting the missed notice must not bring it back on the next sweep.
      const notice = rows.find((n) => n.type === 'deadline_missed');
      const del = await request(app).delete(`/api/notifications/${notice._id}`).set('Cookie', me.cookie);
      assert.strictEqual(del.status, 200);
      await checkOverdueGoals();
      await checkUpcomingDeadlines();
      assert.strictEqual(await Notification.countDocuments({ userId: me.user._id }), 1);
    }],

    ['goals: the owner can delete a goal and its notifications; nobody else can', async () => {
      const Goal = require('../../models/Goal');
      const Notification = require('../../models/Notification');
      const me = await h.makeUser();
      const other = await h.makeUser('Other');
      const goal = await Goal.create({ userId: me.user._id, title: 'Old', techStack: 'js', targetHours: 1, deadline: new Date(Date.now() - 300 * 864e5) });
      await Notification.create({ userId: me.user._id, goalId: goal._id, type: 'deadline_missed', title: 't', message: 'm' });

      const stolen = await request(app).delete(`/api/goals/${goal._id}`).set('Cookie', other.cookie);
      assert.strictEqual(stolen.status, 404);
      assert.ok(await Goal.exists({ _id: goal._id }));

      const del = await request(app).delete(`/api/goals/${goal._id}`).set('Cookie', me.cookie);
      assert.strictEqual(del.status, 200, JSON.stringify(del.body));
      assert.strictEqual(await Goal.countDocuments({ _id: goal._id }), 0);
      assert.strictEqual(await Notification.countDocuments({ goalId: goal._id }), 0);
      const again = await request(app).delete(`/api/goals/${goal._id}`).set('Cookie', me.cookie);
      assert.strictEqual(again.status, 404);
    }],

    ['userstats: a ?days window still answers from the activity scan', async () => {
      const me = await h.makeUser();
      await request(app).post('/api/extension/track').set('x-api-key', me.apiKey).send(flush());
      const res = await request(app).get('/api/leaderboard?days=7').set('Cookie', me.cookie);
      assert.strictEqual(res.headers['x-leaderboard-source'], 'scan');
      assert.strictEqual(res.body[0].rank, 1);
    }],

    ['groups: a contest window counts only activity inside it; all-time reads userstats', async () => {
      const owner = await h.makeUser('Owner');
      const rival = await h.makeUser('Rival');
      const created = await request(app).post('/api/groups/create').set('Cookie', owner.cookie)
        .send({ groupName: 'Week 1', groupDescription: 'contest', visibility: 'public' });
      const id = created.body.group._id;
      await request(app).post(`/api/groups/${id}/join`).set('Cookie', rival.cookie).send({});

      const W = Math.floor((Date.now() - 6 * 3600e3) / 600000) * 600000;
      const at = (minutesAfterW) => new Date(W + minutesAfterW * 60000).toISOString();
      // Before the contest: Owner codes a lot. During it: Rival codes more.
      await request(app).post('/api/extension/track').set('x-api-key', owner.apiKey).send(flush({ duration: 3600, timestamp: at(0) }));
      await request(app).post('/api/extension/track').set('x-api-key', rival.apiKey).send(flush({ duration: 1800, timestamp: at(180) }));
      await request(app).post('/api/extension/track').set('x-api-key', owner.apiKey).send(flush({ duration: 600, timestamp: at(181) }));

      await require('../../services/userStats').rebuildAll({ apply: true }); // the backfill has run
      const allTime = await request(app).get(`/api/groups/${id}/details`).set('Cookie', owner.cookie);
      assert.strictEqual(allTime.body.source, 'userstats');
      assert.strictEqual(allTime.body.window, null);
      assert.strictEqual(allTime.body.leaderboard[0].userName, 'Owner');
      assert.strictEqual(allTime.body.leaderboard[0].codingHours, 1.17);

      // The contest starts 2 minutes into a window; that window must still count (M-31).
      const from = encodeURIComponent(at(122));
      const contest = await request(app).get(`/api/groups/${id}/details?from=${from}`).set('Cookie', owner.cookie);
      assert.strictEqual(contest.status, 200);
      assert.strictEqual(contest.body.source, 'scan');
      assert.strictEqual(contest.body.leaderboard[0].userName, 'Rival');
      assert.strictEqual(contest.body.leaderboard[0].codingHours, 0.5);
      assert.strictEqual(contest.body.leaderboard[1].codingHours, 0.17);

      const bad = await request(app).get(`/api/groups/${id}/details?to=2026-01-01`).set('Cookie', owner.cookie);
      assert.strictEqual(bad.status, 400);
    }],

    ['M-1: the pipeline daily and weekly views equal the old JavaScript aggregation', async () => {
      const { legacyDaily, legacyWeekly } = require('../helpers/legacyAnalytics');
      const me = await h.makeUser();
      const uid = String(me.user._id);
      const tz = -330; // IST
      const offsetMs = tz * 60000;
      const now = Date.now();
      const local = new Date(now - offsetMs);
      const midnight = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()) + offsetMs;
      const weekStart = midnight - 6 * 864e5;
      const langs = ['typescript', 'python', 'java'];
      const docs = [];
      let k = 0;
      // Today: spread across the hours that have already happened.
      for (let t = midnight + 7 * 60000; t < now - 60000 && k < 40; t += Math.max(60000, Math.floor((now - midnight) / 25))) {
        docs.push({ t, i: k++ });
      }
      // The previous six local days, several docs each.
      for (let d = 1; d <= 6; d++) for (let j = 0; j < 4; j++) docs.push({ t: midnight - d * 864e5 + (j * 5 + 1) * 3600e3, i: k++ });
      await Activity.insertMany(docs.map(({ t, i }) => ({
        userId: uid, fileName: `f${i}.ts`, projectName: `proj${i % 3}`, language: langs[i % 3],
        duration: 60 + (i * 37) % 540, linesAdded: i % 7, linesRemoved: i % 3, timestamp: new Date(t),
        terminalAnalytics: {
          totalCommands: i % 5, successfulCommands: i % 4, failedCommands: i % 2, terminalErrorCount: i % 2,
          buildRuns: i % 3, successfulBuilds: i % 2, failedBuilds: (i + 1) % 2, testRuns: i % 2, debuggingSessions: i % 2,
          commandUsage: { git: i % 2, npm: i % 3, python: 1 }, gitActivity: { commits: i % 2, pushes: i % 3, pulls: 1 },
          repeatedFailedCommands: i % 4 === 0 ? [{ command: `cmd-${i % 12}`, count: i + 1 }] : [],
        },
      })));

      // Hours are rounded with toFixed(2). The old code summed per-document
      // fractions, the pipeline divides the exact sum, so a value sitting on a
      // .xx5 tie can round either way: compare hours to within 0.01, all else exactly.
      // alignHours copies the old value into the new result wherever the two
      // 'hours' differ by at most 0.01, so deepStrictEqual still checks the rest exactly.
      const alignHours = (nu, old) => {
        if (Array.isArray(nu) && Array.isArray(old)) { nu.forEach((x, i) => alignHours(x, old[i])); return nu; }
        if (nu && old && typeof nu === 'object') {
          for (const key of Object.keys(nu)) {
            if (key === 'hours' && typeof nu[key] === 'number' && Math.abs(nu[key] - old[key]) <= 0.0100001) nu[key] = old[key];
            else alignHours(nu[key], old[key]);
          }
        }
        return nu;
      };
      const strip = ({ streakDays, ...rest }) => rest;
      const daily = await request(app).get(`/api/analytics/${uid}?timezone=${tz}`).set('Cookie', me.cookie);
      const todayDocs = await Activity.find({ userId: uid, timestamp: { $gte: new Date(midnight), $lt: new Date(midnight + 864e5) } });
      assert.ok(todayDocs.length > 0, 'test needs some docs today');
      const diffKeys = (x, y) => Object.keys({ ...x, ...y }).filter((key) => JSON.stringify(x[key]) !== JSON.stringify(y[key]))
        .map((key) => `${key}: new=${JSON.stringify(x[key])} old=${JSON.stringify(y[key])}`).join(' | ');
      const oldDaily = legacyDaily(todayDocs, tz);
      const newDaily = alignHours(strip(daily.body), oldDaily);
      assert.deepStrictEqual(newDaily, oldDaily, diffKeys(newDaily, oldDaily));

      const weekly = await request(app).get(`/api/analytics/weekly/${uid}?timezone=${tz}`).set('Cookie', me.cookie);
      const weekDocs = await Activity.find({ userId: uid, timestamp: { $gte: new Date(weekStart) } });
      const oldWeekly = legacyWeekly(weekDocs, tz);
      const newWeekly = alignHours(strip(weekly.body), oldWeekly);
      assert.deepStrictEqual(newWeekly, oldWeekly, diffKeys(newWeekly, oldWeekly));
    }],

    ['M-32: weekly totals cover exactly the seven days the chart shows', async () => {
      const me = await h.makeUser();
      const uid = String(me.user._id);
      const now = Date.now();
      const midnight = Date.UTC(new Date(now).getUTCFullYear(), new Date(now).getUTCMonth(), new Date(now).getUTCDate());
      await Activity.insertMany([
        { userId: uid, fileName: 'a', language: 'ts', projectName: 'p', duration: 3600, timestamp: new Date(midnight - 6 * 864e5 - 3600e3) }, // day 8: not shown
        { userId: uid, fileName: 'b', language: 'ts', projectName: 'p', duration: 1800, timestamp: new Date(midnight - 2 * 864e5) },
      ]);
      const weekly = await request(app).get(`/api/analytics/weekly/${uid}?timezone=0`).set('Cookie', me.cookie);
      const shown = weekly.body.dailyActivity.reduce((a, d) => a + d.hours, 0);
      assert.strictEqual(weekly.body.totalHours, 0.5);
      assert.ok(Math.abs(shown - weekly.body.totalHours) < 0.011);
    }],

    ['userId migration: mixed String/ObjectId data reads as one user, before and after migrating', async () => {
      const { migrateActivityUserIds } = require('../../services/activityUserMigration');
      const { rebuildAll } = require('../../services/userStats');
      const UserStats = require('../../models/UserStats');
      const me = await h.makeUser('Mixed');
      const other = await h.makeUser('Other');
      const uid = String(me.user._id);
      const W = Math.floor((Date.now() - 2 * 3600e3) / 600000) * 600000;

      // A NEW upload writes an ObjectId bucket for window W...
      const up = await request(app).post('/api/extension/track').set('x-api-key', me.apiKey)
        .send(flush({ duration: 300, timestamp: new Date(W + 60000).toISOString() }));
      assert.strictEqual(up.status, 201);
      const raw = await Activity.collection.findOne({});
      assert.ok(raw.userId instanceof require('mongoose').Types.ObjectId, 'ingest should write an ObjectId');
      // ...while LEGACY string documents exist: one in the SAME window (a collision) and one an hour earlier.
      await Activity.collection.insertMany([
        { userId: uid, projectName: 'demo', language: 'typescript', bucketStart: new Date(W), timestamp: new Date(W),
          fileName: 'old.ts', duration: 120, linesAdded: 4, flushCount: 2, files: ['old.ts'],
          editorAnalytics: { charsInserted: 50 }, terminalAnalytics: { failedCommands: 1, totalCommands: 3 } },
        { userId: uid, projectName: 'demo', language: 'typescript', bucketStart: new Date(W - 3600e3),
          timestamp: new Date(W - 3600e3), fileName: 'old.ts', duration: 600, linesAdded: 6, flushCount: 1 },
      ]);
      await request(app).post('/api/extension/track').set('x-api-key', other.apiKey).send(flush({ duration: 60 }));

      const views = async () => {
        const weekly = await request(app).get(`/api/analytics/weekly/${uid}?timezone=0`).set('Cookie', me.cookie);
        const lb = await request(app).get('/api/leaderboard?days=7').set('Cookie', me.cookie);
        const metrics = await request(app).get('/api/metrics?days=7').set('Cookie', me.cookie);
        await UserStats.deleteMany({});
        await rebuildAll({ apply: true });
        const stats = await UserStats.findOne({ userId: me.user._id }).lean();
        return {
          weeklyHours: weekly.body.totalHours,
          weeklyFailed: weekly.body.terminalSummary.failedCommands,
          lbRows: lb.body.filter((r) => r.name === 'Mixed').length,
          lbHours: lb.body.find((r) => r.name === 'Mixed').totalHours,
          metricsOk: metrics.status,
          statsSeconds: stats.totalSeconds,
        };
      };

      const before = await views();
      assert.strictEqual(before.weeklyHours, Number((1020 / 3600).toFixed(2)));
      assert.strictEqual(before.weeklyFailed, 1);
      assert.strictEqual(before.lbRows, 1, 'the leaderboard must not split one user into two rows');
      assert.strictEqual(before.statsSeconds, 1020);

      const dry = await migrateActivityUserIds({ apply: false });
      assert.deepStrictEqual([dry.strings, dry.converted], [2, 0]);
      const r = await migrateActivityUserIds({ apply: true });
      assert.deepStrictEqual([r.converted, r.merged, r.remaining], [1, 1, 0]);

      const merged = await Activity.collection.findOne({ bucketStart: new Date(W), userId: me.user._id });
      assert.strictEqual(merged.duration, 420);
      assert.strictEqual(merged.editorAnalytics.charsInserted, 250);
      assert.ok(merged.files.includes('old.ts') && merged.files.includes('index.ts'));
      assert.strictEqual(await Activity.countDocuments({ userId: me.user._id }), 2);

      const after = await views();
      assert.deepStrictEqual(after, before, 'migration must not change any number');
    }],

    ['group admin: only the creator can rename and remove members', async () => {
      const owner = await h.makeUser('Owner');
      const member = await h.makeUser('Member');
      const created = await request(app).post('/api/groups/create').set('Cookie', owner.cookie)
        .send({ groupName: 'Old name', groupDescription: 'd', visibility: 'public' });
      const id = created.body.group._id;
      await request(app).post(`/api/groups/${id}/join`).set('Cookie', member.cookie).send({});

      const notAdmin = await request(app).patch(`/api/groups/${id}`).set('Cookie', member.cookie).send({ groupName: 'Hijacked' });
      assert.strictEqual(notAdmin.status, 403);
      const empty = await request(app).patch(`/api/groups/${id}`).set('Cookie', owner.cookie).send({ groupName: '   ' });
      assert.strictEqual(empty.status, 400);
      const tooLong = await request(app).patch(`/api/groups/${id}`).set('Cookie', owner.cookie).send({ groupName: 'x'.repeat(81) });
      assert.strictEqual(tooLong.status, 400);
      const renamed = await request(app).patch(`/api/groups/${id}`).set('Cookie', owner.cookie)
        .send({ groupName: 'Contest Week 2', groupDescription: 'round two' });
      assert.strictEqual(renamed.status, 200);
      assert.strictEqual(renamed.body.group.name, 'Contest Week 2');
      assert.ok(!('password' in renamed.body.group));

      const kickByMember = await request(app).delete(`/api/groups/${id}/members/${owner.user.id}`).set('Cookie', member.cookie);
      assert.strictEqual(kickByMember.status, 403);
      const kickSelf = await request(app).delete(`/api/groups/${id}/members/${owner.user.id}`).set('Cookie', owner.cookie);
      assert.strictEqual(kickSelf.status, 400);
      const kick = await request(app).delete(`/api/groups/${id}/members/${member.user.id}`).set('Cookie', owner.cookie);
      assert.strictEqual(kick.status, 200);
      const after = await request(app).get(`/api/groups/${id}/details`).set('Cookie', member.cookie);
      assert.strictEqual(after.status, 403, 'a removed member loses access');
      const again = await request(app).delete(`/api/groups/${id}/members/${member.user.id}`).set('Cookie', owner.cookie);
      assert.strictEqual(again.status, 404);
    }],

    ['group admin: when the creator leaves, the longest-standing member becomes admin', async () => {
      const owner = await h.makeUser('Owner');
      const first = await h.makeUser('First');
      const second = await h.makeUser('Second');
      const created = await request(app).post('/api/groups/create').set('Cookie', owner.cookie)
        .send({ groupName: 'G', groupDescription: 'd', visibility: 'public' });
      const id = created.body.group._id;
      await request(app).post(`/api/groups/${id}/join`).set('Cookie', first.cookie).send({});
      await request(app).post(`/api/groups/${id}/join`).set('Cookie', second.cookie).send({});
      const left = await request(app).post(`/api/groups/${id}/leave`).set('Cookie', owner.cookie);
      assert.strictEqual(left.status, 200);
      const renamed = await request(app).patch(`/api/groups/${id}`).set('Cookie', first.cookie).send({ groupName: 'New admin' });
      assert.strictEqual(renamed.status, 200, 'the first remaining member should now be admin');
    }],

    ['CORS: the browser preflight allows every method the frontend sends (H-23)', async () => {
      // supertest sends no preflight, so every other test passed while browsers
      // were blocking PATCH (goal complete/reopen, notifications read, group rename).
      for (const method of ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']) {
        const res = await request(app).options('/api/goals/x/complete')
          .set('Origin', 'http://localhost:5173')
          .set('Access-Control-Request-Method', method);
        assert.strictEqual(res.status, 204);
        assert.ok((res.headers['access-control-allow-methods'] || '').split(',').includes(method),
          `${method} missing from Access-Control-Allow-Methods: ${res.headers['access-control-allow-methods']}`);
        assert.strictEqual(res.headers['access-control-allow-origin'], 'http://localhost:5173');
      }
      const evil = await request(app).options('/api/goals').set('Origin', 'https://evil.example')
        .set('Access-Control-Request-Method', 'GET');
      assert.ok(!evil.headers['access-control-allow-origin'], 'an unknown origin must not be allowed');
    }],

    ['device sign-in: code -> pending -> approve -> one key, usable, single-use', async () => {
      const me = await h.makeUser('Laptop owner');
      const start = await request(app).post('/api/device/code').send({ clientName: 'VS Code (win32)' });
      assert.strictEqual(start.status, 201);
      const { deviceCode, userCode, verificationUriComplete, interval } = start.body;
      assert.match(userCode, /^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
      assert.ok(verificationUriComplete.endsWith(`/device?code=${userCode}`));
      assert.strictEqual(interval, 5);

      const early = await request(app).post('/api/device/token').send({ deviceCode });
      assert.strictEqual(early.status, 428);
      assert.strictEqual(early.body.error, 'authorization_pending');

      const anon = await request(app).post('/api/device/approve').send({ userCode });
      assert.strictEqual(anon.status, 401, 'approving needs a signed-in user');
      const look = await request(app).get(`/api/device/pending/${userCode.toLowerCase().replace('-', '')}`).set('Cookie', me.cookie);
      assert.strictEqual(look.body.clientName, 'VS Code (win32)');
      const ok = await request(app).post('/api/device/approve').set('Cookie', me.cookie).send({ userCode });
      assert.strictEqual(ok.status, 200);

      const token = await request(app).post('/api/device/token').send({ deviceCode });
      assert.strictEqual(token.status, 200);
      assert.match(token.body.apiKey, /^ct_[0-9a-f]{16}_/);
      const verify = await request(app).get('/api/extension/verify').set('x-api-key', token.body.apiKey);
      assert.strictEqual(verify.status, 200);
      assert.strictEqual(verify.body.user.name, 'Laptop owner');
      const tracked = await request(app).post('/api/extension/track').set('x-api-key', token.body.apiKey).send(flush());
      assert.strictEqual(tracked.status, 201);

      const replay = await request(app).post('/api/device/token').send({ deviceCode });
      assert.strictEqual(replay.status, 410, 'a device code gives out exactly one key');
      const reuse = await request(app).post('/api/device/approve').set('Cookie', me.cookie).send({ userCode });
      assert.strictEqual(reuse.status, 404);
    }],

    ['device sign-in: a device key is listed, revocable alone, and expires', async () => {
      const DeviceToken = require('../../models/DeviceToken');
      const me = await h.makeUser();
      const getKey = async (name) => {
        const s = await request(app).post('/api/device/code').send({ clientName: name });
        await request(app).post('/api/device/approve').set('Cookie', me.cookie).send({ userCode: s.body.userCode });
        return (await request(app).post('/api/device/token').send({ deviceCode: s.body.deviceCode })).body.apiKey;
      };
      const laptop = await getKey('Laptop');
      const desktop = await getKey('Desktop');
      const list = await request(app).get('/api/device/tokens').set('Cookie', me.cookie);
      assert.deepStrictEqual(list.body.map((t) => t.clientName).sort(), ['Desktop', 'Laptop']);
      assert.ok(!JSON.stringify(list.body).includes(laptop.split('_')[2]), 'secrets never listed');

      const laptopId = list.body.find((t) => t.clientName === 'Laptop').id;
      const stranger = await h.makeUser();
      assert.strictEqual((await request(app).delete(`/api/device/tokens/${laptopId}`).set('Cookie', stranger.cookie)).status, 404);
      assert.strictEqual((await request(app).delete(`/api/device/tokens/${laptopId}`).set('Cookie', me.cookie)).status, 200);
      assert.strictEqual((await request(app).get('/api/extension/verify').set('x-api-key', laptop)).status, 401);
      assert.strictEqual((await request(app).get('/api/extension/verify').set('x-api-key', desktop)).status, 200);
      assert.strictEqual((await request(app).get('/api/extension/verify').set('x-api-key', me.apiKey)).status, 200, 'the profile key is unaffected');

      await DeviceToken.updateMany({}, { $set: { expiresAt: new Date(Date.now() - 1000) } });
      assert.strictEqual((await request(app).get('/api/extension/verify').set('x-api-key', desktop)).status, 401, 'expired keys stop working');
    }],

    ['device sign-in: an unknown or garbage code is refused', async () => {
      const me = await h.makeUser();
      assert.strictEqual((await request(app).post('/api/device/approve').set('Cookie', me.cookie).send({ userCode: 'WXYZ-2345' })).status, 404);
      assert.strictEqual((await request(app).post('/api/device/approve').set('Cookie', me.cookie).send({ userCode: { $ne: '' } })).status, 400);
      assert.strictEqual((await request(app).post('/api/device/token').send({ deviceCode: 'short' })).status, 400);
      assert.strictEqual((await request(app).post('/api/device/token').send({ deviceCode: 'x'.repeat(43) })).status, 410);
    }],

    ['observability: every response carries X-Request-Id, and an error body quotes the same id', async () => {
      const me = await h.makeUser();
      const ok = await request(app).get('/health');
      assert.match(ok.headers['x-request-id'], /^[0-9a-f]{12}$/);
      const err = await request(app).get('/api/goals/not-an-id/progress').set('Cookie', me.cookie);
      assert.strictEqual(err.body.id, err.headers['x-request-id'], 'the user-visible error id must find the log line');
      const forwarded = await request(app).get('/health').set('X-Request-Id', 'proxy-abc-123456');
      assert.strictEqual(forwarded.headers['x-request-id'], 'proxy-abc-123456');
      // Node's client refuses to send a newline, so use spaces and quotes as the unsafe value.
      const injected = await request(app).get('/health').set('X-Request-Id', 'bad id {"level":"fake"}');
      assert.notStrictEqual(injected.headers['x-request-id'], 'bad id {"level":"fake"}');
      assert.match(injected.headers['x-request-id'], /^[0-9a-f]{12}$/);
    }],

    ['errors: a malformed id is 400 with a correlation id, not 500', async () => {
      const me = await h.makeUser();
      const res = await request(app).get('/api/goals/not-an-id/progress').set('Cookie', me.cookie);
      assert.strictEqual(res.status, 400);
      assert.ok(res.body.id);
    }],

    ['error reporting: a route that catches its own 500 is still reported, with the request id; a 400 is not', async () => {
      const reporter = require('../../services/errorReporter');
      const User = require('../../models/user');
      const sent = [];
      reporter.setClient({
        withScope(cb) { const scope = { tags: {}, setTag(k, v) { this.tags[k] = v; }, setExtra() {} }; cb(scope); sent.push(scope.tags); },
        captureException() {}, captureMessage() {},
      });
      const origFindById = User.findById;
      // Fail only the profile route's own lookup (it selects the legacy key
      // fields), not the auth middleware's, so the route's catch block runs.
      User.findById = function (...args) {
        const q = origFindById.apply(this, args);
        const select = q.select.bind(q);
        q.select = (s) => (String(s).includes('+legacyApiKeyHash')
          ? { then: (_ok, fail) => fail(new Error('db blip')) } : select(s));
        return q;
      };
      try {
        const me = await h.makeUser();
        const res = await request(app).get('/api/user/profile').set('Cookie', me.cookie);
        assert.strictEqual(res.status, 500);
        assert.strictEqual(sent.length, 1, 'the route-level 500 must reach the reporter');
        assert.strictEqual(sent[0].requestId, res.headers['x-request-id']);
        const bad = await request(app).get('/api/goals/not-an-id/progress').set('Cookie', me.cookie);
        assert.strictEqual(bad.status, 400);
        assert.strictEqual(sent.length, 1, 'client errors are not reported');
      } finally {
        User.findById = origFindById;
        reporter.setClient(null);
      }
    }],

    // ---- Redesign API additions (spec 2026-10-04 §6) ------------------------

    ['history: a year of local days, hours of day, top projects and commits, owner only', async () => {
      const me = await h.makeUser('Me');
      const other = await h.makeUser('Other');
      const tz = -330; // IST: local = UTC + 5:30
      const T0 = istMidnightUtc(Date.now()); // today 00:00 IST, as a UTC instant
      const doc = (at, seconds, extra = {}) => ({
        userId: me.user._id, fileName: 'a.ts', language: 'typescript', projectName: 'alpha',
        duration: seconds, timestamp: new Date(at), ...extra,
      });
      await Activity.create([
        // 01:30 IST yesterday = 20:00 UTC the day before: must land on YESTERDAY's IST date, hour 1.
        doc(T0 - 22.5 * 3600e3, 1800, { gitAnalytics: { commits: 2 } }),
        // 21:10 IST two days ago, project beta, counted via the terminal fallback for commits.
        doc(T0 - 2 * 864e5 + 21 * 3600e3 + 600e3, 1200, { projectName: 'beta', terminalAnalytics: { gitActivity: { commits: 3 } } }),
        // 100 days ago: in the year, outside the 7-day views. Legacy String userId must still count.
        doc(T0 - 100 * 864e5 + 10 * 3600e3, 3600, { userId: String(me.user._id), projectName: 'old' }),
        // 400 days ago: outside the year.
        doc(T0 - 400 * 864e5, 600),
        // Another user's activity never leaks in.
        { ...doc(T0 - 3600e3, 999), userId: other.user._id },
      ]);
      const key = (instant) => new Date(instant + 330 * 60000).toISOString().slice(0, 10);

      const res = await request(app).get(`/api/analytics/history/${me.user.id}?timezone=${tz}`).set('Cookie', me.cookie);
      assert.strictEqual(res.status, 200, JSON.stringify(res.body));
      const days = Object.fromEntries(res.body.days.map((d) => [d.date, d.seconds]));
      assert.strictEqual(days[key(T0 - 22.5 * 3600e3)], 1800);
      assert.strictEqual(key(T0 - 22.5 * 3600e3), key(T0 - 1), 'the 01:30 IST upload belongs to yesterday');
      assert.strictEqual(days[key(T0 - 2 * 864e5 + 21 * 3600e3 + 600e3)], 1200);
      assert.strictEqual(days[key(T0 - 100 * 864e5 + 10 * 3600e3)], 3600);
      assert.strictEqual(res.body.days.length, 3, 'no day outside the last 365, no other user');
      assert.ok(res.body.days.every((d, i, a) => i === 0 || a[i - 1].date < d.date), 'days are sorted');

      assert.strictEqual(res.body.hourOfDay.length, 24);
      assert.strictEqual(res.body.hourOfDay[1], 1800);
      assert.strictEqual(res.body.hourOfDay[21], 1200);
      assert.strictEqual(res.body.hourOfDay.reduce((a, b) => a + b, 0), 3000, 'only the last 7 days');

      assert.deepStrictEqual(res.body.projects, [{ name: 'alpha', seconds: 1800 }, { name: 'beta', seconds: 1200 }]);
      assert.strictEqual(res.body.commits7d, 5, 'git tracker first, terminal commits as the fallback');

      const theirs = await request(app).get(`/api/analytics/history/${me.user.id}`).set('Cookie', other.cookie);
      assert.strictEqual(theirs.status, 403);
      assert.strictEqual((await request(app).get(`/api/analytics/history/${me.user.id}`)).status, 401);
    }],

    ['groups: the board carries per-member daily hours in the viewer\'s time zone', async () => {
      const owner = await h.makeUser('Owner');
      const rival = await h.makeUser('Rival');
      const created = await request(app).post('/api/groups/create').set('Cookie', owner.cookie)
        .send({ groupName: 'Race', groupDescription: 'daily cells', visibility: 'public' });
      const id = created.body.group._id;
      await request(app).post(`/api/groups/${id}/join`).set('Cookie', rival.cookie).send({});

      const T0 = istMidnightUtc(Date.now());
      const at = (daysAgo, hour) => new Date(T0 - daysAgo * 864e5 + hour * 3600e3);
      await Activity.create([
        { userId: owner.user._id, fileName: 'a', language: 'ts', projectName: 'p', duration: 1800, timestamp: at(1, 1.5) },
        { userId: owner.user._id, fileName: 'a', language: 'ts', projectName: 'p', duration: 600, timestamp: at(3, 10) },
        { userId: rival.user._id, fileName: 'a', language: 'ts', projectName: 'p', duration: 3000, timestamp: at(3, 23) },
        { userId: rival.user._id, fileName: 'a', language: 'ts', projectName: 'p', duration: 900, timestamp: at(9, 12) },
      ]);
      const key = (instant) => new Date(instant + 330 * 60000).toISOString().slice(0, 10);

      // All-time board: the cells cover the last 7 local days, ending today.
      const all = await request(app).get(`/api/groups/${id}/details?timezone=-330`).set('Cookie', owner.cookie);
      assert.strictEqual(all.status, 200, JSON.stringify(all.body));
      const d = all.body.daily;
      assert.strictEqual(d.dates.length, 7);
      assert.strictEqual(d.dates[6], key(T0));
      assert.strictEqual(d.byUser[owner.user.id][d.dates.indexOf(key(at(1, 1.5).getTime()))], 1800);
      assert.strictEqual(d.byUser[owner.user.id][d.dates.indexOf(key(at(3, 10).getTime()))], 600);
      assert.strictEqual(d.byUser[rival.user.id][d.dates.indexOf(key(at(3, 23).getTime()))], 3000);
      assert.strictEqual(d.byUser[rival.user.id].reduce((a, b) => a + b, 0), 3000, 'nine days ago is outside the 7');

      // A contest window: one cell per local day in it, and the cells add up to the board's hours.
      const from = encodeURIComponent(new Date(T0 - 4 * 864e5).toISOString());
      const to = encodeURIComponent(new Date(T0).toISOString());
      const contest = await request(app).get(`/api/groups/${id}/details?from=${from}&to=${to}&timezone=-330`).set('Cookie', owner.cookie);
      assert.strictEqual(contest.status, 200);
      assert.deepStrictEqual(contest.body.daily.dates, [4, 3, 2, 1].map((n) => key(T0 - n * 864e5)));
      for (const row of contest.body.leaderboard) {
        const sum = contest.body.daily.byUser[row.userId].reduce((a, b) => a + b, 0);
        assert.strictEqual(Math.round((sum / 3600) * 100) / 100, row.codingHours, `${row.userName}: cells must add up to the board`);
      }
    }],

    ['groups: an invite preview shows a group to a non-member without members, emails or the password', async () => {
      const owner = await h.makeUser('Owner');
      const outsider = await h.makeUser('Outsider');
      const created = await request(app).post('/api/groups/create').set('Cookie', owner.cookie)
        .send({ groupName: 'Secret club', groupDescription: 'invite only', visibility: 'private', password: 'hunter2' });
      const id = created.body.group._id;

      const seen = await request(app).get(`/api/groups/${id}/preview`).set('Cookie', outsider.cookie);
      assert.strictEqual(seen.status, 200, JSON.stringify(seen.body));
      assert.strictEqual(seen.body.group.name, 'Secret club');
      assert.strictEqual(seen.body.group.visibility, 'private');
      assert.strictEqual(seen.body.memberCount, 1);
      assert.strictEqual(seen.body.isMember, false);
      const text = JSON.stringify(seen.body);
      assert.ok(!text.includes('hunter2') && !text.includes('password'), 'no password, hashed or not');
      assert.ok(!text.includes('@'), 'no emails');
      assert.ok(!('members' in seen.body) && !('leaderboard' in seen.body));

      const mine = await request(app).get(`/api/groups/${id}/preview`).set('Cookie', owner.cookie);
      assert.strictEqual(mine.body.isMember, true);
      assert.strictEqual((await request(app).get('/api/groups/aaaaaaaaaaaaaaaaaaaaaaaa/preview').set('Cookie', owner.cookie)).status, 404);
      assert.strictEqual((await request(app).get('/api/groups/not-an-id/preview').set('Cookie', owner.cookie)).status, 400);
      assert.strictEqual((await request(app).get(`/api/groups/${id}/preview`)).status, 401);
    }],
  ]);

  await h.stop();
  process.exit(failed ? 1 : 0);
}

main().catch((err) => { console.error(err); process.exit(1); });
