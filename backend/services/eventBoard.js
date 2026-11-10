'use strict';

/**
 * Hackathon events (plan slice 4, D-71). Pure: validation and the event board.
 *
 * Same rule as the group board: only counts a source reports. GitHub pushes (verified accounts)
 * and VS Code time, inside the event's start and end. No scores, no ranks: activity is not quality,
 * so teams are listed by pushes and the page says it is not judging.
 */

const MAX_DAYS = 7;
const QUIET_MS = 60 * 60 * 1000;
const RULES = ['any', 'vscode'];

function parseEvent(body, now = Date.now(), { partial = false } = {}) {
  const b = body || {};
  const out = {};
  const has = (k) => b[k] !== undefined;
  if (!partial || has('name')) {
    const name = typeof b.name === 'string' ? b.name.trim() : '';
    if (name.length < 3 || name.length > 80) return { ok: false, error: 'Name must be 3 to 80 characters' };
    out.name = name;
  }
  if (!partial || has('description')) {
    const d = typeof b.description === 'string' ? b.description.trim() : '';
    if (d.length > 500) return { ok: false, error: 'Description can be at most 500 characters' };
    out.description = d;
  }
  if (!partial || has('startsAt') || has('endsAt')) {
    const s = new Date(b.startsAt);
    const e = new Date(b.endsAt);
    if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime())) return { ok: false, error: 'Start and end must be dates' };
    if (e <= s) return { ok: false, error: 'The end must be after the start' };
    if (e - s > MAX_DAYS * 864e5) return { ok: false, error: `An event can last at most ${MAX_DAYS} days` };
    if (e.getTime() <= now) return { ok: false, error: 'The end must be in the future' };
    out.startsAt = s;
    out.endsAt = e;
  }
  if (!partial || has('editorRule')) {
    const rule = b.editorRule === undefined ? 'any' : b.editorRule;
    if (!RULES.includes(rule)) return { ok: false, error: 'editorRule must be any or vscode' };
    out.editorRule = rule;
  }
  if (!partial || has('maxTeamSize')) {
    const size = b.maxTeamSize === undefined ? 4 : b.maxTeamSize;
    if (!Number.isInteger(size) || size < 1 || size > 10) return { ok: false, error: 'Team size must be a whole number from 1 to 10' };
    out.maxTeamSize = size;
  }
  return { ok: true, value: out };
}

function statusOf(event, now) {
  if (now < new Date(event.startsAt).getTime()) return 'upcoming';
  return now >= new Date(event.endsAt).getTime() ? 'ended' : 'live';
}

/**
 * teams: [{ id, name, members: [{ id, name }] }]
 * pushes: [{ userId, at }] from verified GitHub accounts only
 * vscodeSeconds: Map userId → credited seconds inside the event
 * githubVerified, vscodeConnected: Sets of userIds
 */
function buildEventBoard({ event, teams, pushes, vscodeSeconds, githubVerified, vscodeConnected, now, forOrganizer }) {
  const start = new Date(event.startsAt).getTime();
  const end = Math.min(new Date(event.endsAt).getTime(), now);
  const status = statusOf(event, now);
  const byUser = new Map();
  for (const p of pushes) {
    const t = new Date(p.at).getTime();
    if (t < start || t >= end) continue;
    const id = String(p.userId);
    if (!githubVerified.has(id)) continue; // only verified GitHub accounts count
    if (!byUser.has(id)) byUser.set(id, []);
    byUser.get(id).push(t);
  }

  const rows = teams.map((team) => {
    const members = team.members.map((m) => {
      const times = byUser.get(m.id) || [];
      return {
        id: m.id,
        name: m.name,
        pushes: times.length,
        vscodeSeconds: Math.round(vscodeSeconds.get(m.id) || 0),
        github: githubVerified.has(m.id),
        vscode: vscodeConnected.has(m.id),
      };
    });
    const all = team.members.flatMap((m) => byUser.get(m.id) || []);
    return {
      id: team.id,
      name: team.name,
      size: members.length,
      pushes: all.length,
      vscodeSeconds: members.reduce((n, m) => n + m.vscodeSeconds, 0),
      firstPushAt: all.length ? new Date(Math.min(...all)).toISOString() : null,
      lastPushAt: all.length ? new Date(Math.max(...all)).toISOString() : null,
      members,
    };
  }).sort((a, b) => b.pushes - a.pushes || b.vscodeSeconds - a.vscodeSeconds || a.name.localeCompare(b.name));

  // Things for the organiser to look at. Facts only, never a penalty.
  const checks = [];
  if (forOrganizer) {
    for (const t of rows) {
      for (const m of t.members) {
        if (!m.github) checks.push({ kind: 'no-github', team: t.name, member: m.name, text: `${m.name} (${t.name}) has no verified GitHub account, so their pushes are not counted.` });
        if (event.editorRule === 'vscode' && !m.vscode) checks.push({ kind: 'no-vscode', team: t.name, member: m.name, text: `${m.name} (${t.name}) has not connected the VS Code extension.` });
        if (event.editorRule === 'vscode' && status !== 'upcoming' && m.pushes > 0 && m.vscodeSeconds === 0) {
          checks.push({ kind: 'no-vscode-time', team: t.name, member: m.name, text: `${m.name} (${t.name}) pushed ${m.pushes === 1 ? 'once' : `${m.pushes} times`} with no VS Code time recorded.` });
        }
      }
      if (status === 'live' && now - start >= QUIET_MS) {
        const last = t.lastPushAt ? new Date(t.lastPushAt).getTime() : null;
        if (last === null || now - last >= QUIET_MS) {
          checks.push({ kind: 'quiet', team: t.name, member: null, text: last === null ? `${t.name} has not pushed yet.` : `${t.name} has not pushed for ${Math.floor((now - last) / 60000)} minutes.` });
        }
      }
    }
  }
  return { status, teams: rows, checks: forOrganizer ? checks : null };
}

module.exports = { parseEvent, statusOf, buildEventBoard, MAX_DAYS };
