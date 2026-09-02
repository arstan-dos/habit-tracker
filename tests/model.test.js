const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('../model.js');

function date(value) { return M.parseKey(value); }
function makeState(days) {
  return M.normalizeState({
    habits: [{ id: 'h1', name: 'Чтение', days, createdAt: '2026-01-01' }],
    days: {}, notes: {}, journal: {}, subState: {}
  }, '2026-01-10');
}

test('all-time totals include scheduled days without marks', () => {
  const state = makeState([true, true, true, true, true, true, true]);
  state.days['2026-01-01'] = { h1: true };
  const stats = M.rangeStats(state, date('2026-01-03'));
  assert.deepEqual(stats, { scheduled: 3, required: 3, done: 1, skip: 0, closed: 1, activeDays: 3 });
});

test('an intentional skip closes a day but leaves it out of the required denominator', () => {
  const state = makeState([true, true, true, true, true, true, true]);
  state.days['2026-01-01'] = { h1: true };
  state.days['2026-01-02'] = { h1: 'skip' };
  const stats = M.rangeStats(state, date('2026-01-03'));
  assert.equal(stats.required, 2);
  assert.equal(stats.done, 1);
  assert.equal(stats.closed, 2);
});

test('changing a schedule preserves dates before the change', () => {
  const state = makeState([true, true, true, true, true, true, true]);
  const habit = state.habits[0];
  M.setSchedule(habit, [true, false, false, false, false, false, false], '2026-01-03');
  assert.equal(M.scheduledOn(habit, date('2026-01-02')), true);
  assert.equal(M.scheduledOn(habit, date('2026-01-03')), false);
  assert.equal(M.scheduledOn(habit, date('2026-01-05')), true);
});

test('a habit cannot be saved without scheduled days', () => {
  const state = makeState([true, false, false, false, false, false, false]);
  assert.throws(() => M.setSchedule(state.habits[0], Array(7).fill(false), '2026-01-03'), /хотя бы один день/);
});

test('current-week totals stop at today', () => {
  const state = M.normalizeState({
    habits: [{ id: 'h1', name: 'Вода', days: Array(7).fill(true), createdAt: '2026-01-05' }], days: {}, notes: {}, journal: {}, subState: {}
  }, '2026-01-07');
  const stats = M.weekStats(state, date('2026-01-05'), date('2026-01-07'));
  assert.equal(stats.required, 3);
});

test('closed-day streak ignores days where nothing was scheduled', () => {
  const state = M.normalizeState({
    habits: [{ id: 'h1', name: 'Спорт', days: [true, false, true, false, false, false, false], createdAt: '2026-01-05' }],
    days: { '2026-01-05': { h1: true } }, notes: {}, journal: {}, subState: {}
  }, '2026-01-07');
  assert.equal(M.closedStreak(state, date('2026-01-07')), 1);
  assert.equal(M.bestClosedStreak(state, date('2026-01-07')), 1);
});

test('backup import accepts the full report format and migrates old data', () => {
  const report = 'Отчёт\n== RAW (резервная копия, не разбирай) ==\n' + JSON.stringify({
    habits: [{ id: 'h1', name: 'Сон', days: [true, false, false, false, false, false, false], createdAt: '2026-01-01' }]
  });
  const restored = M.parseBackup(report, '2026-01-10');
  assert.equal(restored.version, 2);
  assert.equal(restored.habits[0].schedules.length, 1);
});

test('backup import rejects invalid JSON', () => {
  assert.throws(() => M.parseBackup('not json', '2026-01-10'), /JSON/);
});

test('backup validation removes future and orphaned records', () => {
  const restored = M.normalizeState({
    habits: [{ id: 'h1', name: 'Сон', days: Array(7).fill(true), createdAt: '2026-01-01', subitems: [] }],
    days: { '2026-01-02': { h1: true, missing: true }, '2026-02-01': { h1: true } },
    notes: { '2026-01-02': { missing: 'orphan' } },
    subState: { '2026-01-02': { h1: { removed: true } } }
  }, '2026-01-10');
  assert.deepEqual(restored.days, { '2026-01-02': { h1: true } });
  assert.deepEqual(restored.notes, {});
  assert.deepEqual(restored.subState, {});
});

