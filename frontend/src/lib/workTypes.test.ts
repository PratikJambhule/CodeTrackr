import { describe, expect, it } from 'vitest';
import type { WorkSession } from '../types';
import { biggestGroup, groupMinutes, groupOf, knownType, sessionState, toLabel } from './workTypes';

const base: WorkSession = {
  startAt: '2026-10-21T09:00:00.000Z', endAt: '2026-10-21T10:00:00.000Z', minutes: 60,
  writingSec: 0, readingSec: 0, runningSec: 0, projects: ['app'], languages: ['ts'],
  workType: { type: 'project', group: 'project_work', reason: 'steady writing', by: 'rules' },
  prompt: 'guess', pickerLabel: null, userLabel: null,
};
const s = (over: Partial<WorkSession>): WorkSession => ({ ...base, ...over });

describe('work types (3 groups shown, 5 kept)', () => {
  it('groups the five types into three', () => {
    expect(groupOf('dsa')).toBe('dsa');
    expect(groupOf('debugging')).toBe('project_work');
    expect(groupOf('setup')).toBe('learning_setup');
    expect(groupOf('not_sure')).toBeNull();
  });

  it('decides what each session shows, answers first', () => {
    expect(sessionState(s({ userLabel: { type: 'dsa', group: 'dsa', source: 'shown' } }))).toBe('answered');
    expect(sessionState(s({ pickerLabel: { type: 'setup', group: 'learning_setup', share: 0.8 } }))).toBe('picker');
    expect(sessionState(s({ prompt: 'blind', workType: null }))).toBe('blind');
    expect(sessionState(s({}))).toBe('guess');
    expect(sessionState(s({ prompt: 'none' }))).toBe('none');
  });

  it('uses what the user said over the guess', () => {
    expect(knownType(s({ userLabel: { type: 'learning', group: 'learning_setup', source: 'blind' } }))).toBe('learning');
    expect(knownType(s({}))).toBe('project');
    expect(knownType(s({ workType: null, prompt: 'blind' }))).toBeNull();
  });

  it('adds minutes per group; too-short sessions are left out', () => {
    const mix = groupMinutes([
      s({ minutes: 30 }),
      s({ minutes: 20, workType: { type: 'debugging', group: 'project_work', reason: '', by: 'rules' } }),
      s({ minutes: 45, userLabel: { type: 'dsa', group: 'dsa', source: 'shown' } }),
      s({ minutes: 10, prompt: 'none' }),
      s({ minutes: 5, prompt: 'blind', workType: null }),
    ]);
    expect(mix).toEqual([
      { id: 'project_work', label: 'Project work', minutes: 50 },
      { id: 'dsa', label: 'DSA', minutes: 45 },
      { id: null, label: 'Not sure', minutes: 5 },
    ]);
  });

  it('"label your past week" lists only unanswered sessions from the last 7 days', () => {
    const now = Date.parse('2026-10-22T12:00:00Z');
    const list = toLabel([
      s({ startAt: '2026-10-21T09:00:00Z' }),
      s({ startAt: '2026-10-20T09:00:00Z', prompt: 'blind', workType: null }),
      s({ startAt: '2026-10-19T09:00:00Z', userLabel: { type: 'dsa', group: 'dsa', source: 'shown' } }),
      s({ startAt: '2026-10-10T09:00:00Z' }),
      s({ startAt: '2026-10-21T15:00:00Z', prompt: 'none' }),
    ], 7, now);
    expect(list.map((x) => x.startAt)).toEqual(['2026-10-21T09:00:00Z', '2026-10-20T09:00:00Z']);
  });

  it('opens the tab with the most minutes, DSA when tied or empty', () => {
    const m = (dsa: number, project_work: number, learning_setup: number) =>
      ({ dsa: { minutes: dsa }, project_work: { minutes: project_work }, learning_setup: { minutes: learning_setup } });
    expect(biggestGroup(m(10, 90, 30))).toBe('project_work');
    expect(biggestGroup(m(0, 0, 5))).toBe('learning_setup');
    expect(biggestGroup(m(0, 0, 0))).toBe('dsa');
    expect(biggestGroup(m(40, 40, 0))).toBe('dsa');
  });
});
