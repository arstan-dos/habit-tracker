(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.RhythmModel = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var VALID_STATES = { done: true, skip: true, none: true };

  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function key(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function parseKey(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return null;
    var parts = value.split('-').map(Number);
    var date = new Date(parts[0], parts[1] - 1, parts[2]);
    return key(date) === value ? date : null;
  }
  function addDays(d, amount) {
    var copy = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    copy.setDate(copy.getDate() + amount);
    return copy;
  }
  function wdIdx(d) { return (d.getDay() + 6) % 7; }
  function normalizeDays(days) {
    return Array.from({ length: 7 }, function (_, i) { return !!(Array.isArray(days) && days[i]); });
  }
  function sameDays(a, b) { return normalizeDays(a).every(function (v, i) { return v === normalizeDays(b)[i]; }); }
  function isObject(value) { return !!value && typeof value === 'object' && !Array.isArray(value); }
  function cleanMap(value) { return isObject(value) ? value : {}; }

  function normalizeHabit(raw, todayKey, index) {
    if (!isObject(raw) || typeof raw.name !== 'string' || !raw.name.trim()) return null;
    var createdAt = parseKey(raw.createdAt) && raw.createdAt <= todayKey ? raw.createdAt : todayKey;
    var currentDays = normalizeDays(raw.days);
    var schedules = Array.isArray(raw.schedules) ? raw.schedules.filter(function (item) {
      return isObject(item) && parseKey(item.from) && item.from <= todayKey && Array.isArray(item.days);
    }).map(function (item) {
      return { from: item.from, days: normalizeDays(item.days) };
    }) : [];
    if (!schedules.length) schedules = [{ from: createdAt, days: currentDays }];
    schedules.sort(function (a, b) { return a.from.localeCompare(b.from); });
    var deduped = [];
    schedules.forEach(function (entry) {
      if (entry.from < createdAt) entry.from = createdAt;
      var last = deduped[deduped.length - 1];
      if (last && last.from === entry.from) deduped[deduped.length - 1] = entry;
      else deduped.push(entry);
    });
    currentDays = deduped[deduped.length - 1].days.slice();
    var subitems = Array.isArray(raw.subitems) ? raw.subitems.filter(function (s) {
      return isObject(s) && typeof s.text === 'string' && s.text.trim();
    }).map(function (s, subIndex) {
      return { id: String(s.id || ('s_migrated_' + index + '_' + subIndex)), text: s.text.trim().slice(0, 40) };
    }) : [];
    var subIds = {};
    subitems = subitems.filter(function (s) { if (subIds[s.id]) return false; subIds[s.id] = true; return true; });
    return {
      id: String(raw.id || ('h_migrated_' + index)),
      name: raw.name.trim().slice(0, 40),
      subtitle: typeof raw.subtitle === 'string' ? raw.subtitle.trim().slice(0, 60) : '',
      color: typeof raw.color === 'string' && /^#[0-9a-f]{6}$/i.test(raw.color) ? raw.color : '#2B6491',
      days: currentDays,
      schedules: deduped,
      subitems: subitems,
      createdAt: createdAt
    };
  }

  function normalizeState(raw, todayKey) {
    if (!parseKey(todayKey)) throw new Error('Некорректная текущая дата.');
    if (!isObject(raw)) throw new Error('Резервная копия должна содержать объект JSON.');
    var habits = Array.isArray(raw.habits) ? raw.habits.map(function (h, i) {
      return normalizeHabit(h, todayKey, i);
    }).filter(Boolean) : [];
    var ids = {};
    habits = habits.filter(function (h) { if (ids[h.id]) return false; ids[h.id] = true; return true; });
    var subIds = {};
    habits.forEach(function (h) { subIds[h.id] = {}; h.subitems.forEach(function (s) { subIds[h.id][s.id] = true; }); });
    var days = {}, notes = {}, journal = {}, subState = {};
    Object.keys(cleanMap(raw.days)).forEach(function (dateKey) {
      if (!parseKey(dateKey) || dateKey > todayKey || !isObject(raw.days[dateKey])) return;
      var row = {};
      Object.keys(raw.days[dateKey]).forEach(function (habitId) {
        if (!ids[habitId]) return;
        var value = raw.days[dateKey][habitId];
        if (value === true || value === 'done') row[habitId] = true;
        else if (value === 'skip') row[habitId] = 'skip';
      });
      if (Object.keys(row).length) days[dateKey] = row;
    });
    Object.keys(cleanMap(raw.notes)).forEach(function (dateKey) {
      if (!parseKey(dateKey) || dateKey > todayKey || !isObject(raw.notes[dateKey])) return;
      var row = {};
      Object.keys(raw.notes[dateKey]).forEach(function (habitId) {
        var value = raw.notes[dateKey][habitId];
        if (ids[habitId] && typeof value === 'string' && value) row[habitId] = value;
      });
      if (Object.keys(row).length) notes[dateKey] = row;
    });
    Object.keys(cleanMap(raw.journal)).forEach(function (dateKey) {
      var value = raw.journal[dateKey];
      if (parseKey(dateKey) && dateKey <= todayKey && typeof value === 'string' && value) journal[dateKey] = value;
    });
    Object.keys(cleanMap(raw.subState)).forEach(function (dateKey) {
      if (!parseKey(dateKey) || dateKey > todayKey || !isObject(raw.subState[dateKey])) return;
      var dateRow = {};
      Object.keys(raw.subState[dateKey]).forEach(function (habitId) {
        if (!ids[habitId] || !isObject(raw.subState[dateKey][habitId])) return;
        var habitRow = {};
        Object.keys(raw.subState[dateKey][habitId]).forEach(function (subId) {
          if (subIds[habitId][subId] && raw.subState[dateKey][habitId][subId] === true) habitRow[subId] = true;
        });
        if (Object.keys(habitRow).length) dateRow[habitId] = habitRow;
      });
      if (Object.keys(dateRow).length) subState[dateKey] = dateRow;
    });
    return {
      version: 2,
      habits: habits,
      days: days,
      notes: notes,
      journal: journal,
      subState: subState
    };
  }

  function scheduleFor(habit, dateKey) {
    var schedules = Array.isArray(habit.schedules) && habit.schedules.length
      ? habit.schedules
      : [{ from: habit.createdAt, days: normalizeDays(habit.days) }];
    var selected = null;
    schedules.forEach(function (entry) { if (entry.from <= dateKey) selected = entry; });
    return selected;
  }
  function scheduledOn(habit, date) {
    var dateKey = key(date);
    if (dateKey < habit.createdAt) return false;
    var schedule = scheduleFor(habit, dateKey);
    return !!(schedule && schedule.days[wdIdx(date)]);
  }
  function stateOf(state, dateKey, habitId) {
    var value = state.days[dateKey] && state.days[dateKey][habitId];
    return value === true || value === 'done' ? 'done' : (value === 'skip' ? 'skip' : 'none');
  }
  function dayStats(state, date) {
    var dateKey = key(date), yes = 0, done = 0, skip = 0, pending = 0;
    state.habits.forEach(function (habit) {
      if (!scheduledOn(habit, date)) return;
      yes++;
      var status = stateOf(state, dateKey, habit.id);
      if (status === 'done') done++;
      else if (status === 'skip') skip++;
      else pending++;
    });
    return { yes: yes, done: done, skip: skip, pending: pending, required: yes - skip, closed: yes > 0 && pending === 0 };
  }
  function earliestHabitDate(state) {
    var keys = state.habits.map(function (h) { return h.createdAt; }).filter(parseKey).sort();
    return keys.length ? parseKey(keys[0]) : null;
  }
  function rangeStats(state, endDate) {
    var start = earliestHabitDate(state);
    var total = { scheduled: 0, required: 0, done: 0, skip: 0, closed: 0, activeDays: 0 };
    if (!start) return total;
    for (var date = start; date <= endDate; date = addDays(date, 1)) {
      var stats = dayStats(state, date);
      total.scheduled += stats.yes;
      total.required += stats.required;
      total.done += stats.done;
      total.skip += stats.skip;
      if (stats.yes) total.activeDays++;
      if (stats.closed) total.closed++;
    }
    return total;
  }
  function weekStats(state, monday, today) {
    var end = addDays(monday, 6);
    if (end > today) end = today;
    var total = { required: 0, done: 0, skip: 0 };
    for (var date = monday; date <= end; date = addDays(date, 1)) {
      var stats = dayStats(state, date);
      total.required += stats.required;
      total.done += stats.done;
      total.skip += stats.skip;
    }
    return total;
  }
  function closedStreak(state, today) {
    var start = earliestHabitDate(state), count = 0, skippedToday = false;
    if (!start) return 0;
    for (var date = new Date(today); date >= start; date = addDays(date, -1)) {
      var stats = dayStats(state, date);
      if (!stats.yes) continue;
      if (!skippedToday && key(date) === key(today) && !stats.closed) { skippedToday = true; continue; }
      if (!stats.closed) break;
      count++;
    }
    return count;
  }
  function bestClosedStreak(state, today) {
    var start = earliestHabitDate(state), best = 0, run = 0;
    if (!start) return 0;
    for (var date = start; date <= today; date = addDays(date, 1)) {
      var stats = dayStats(state, date);
      if (!stats.yes) continue;
      if (stats.closed) { run++; best = Math.max(best, run); }
      else run = 0;
    }
    return best;
  }
  function habitStreak(state, habitId, today) {
    var habit = state.habits.find(function (h) { return h.id === habitId; });
    if (!habit) return 0;
    var count = 0;
    for (var date = new Date(today); key(date) >= habit.createdAt; date = addDays(date, -1)) {
      if (!scheduledOn(habit, date)) continue;
      var status = stateOf(state, key(date), habitId);
      if (status === 'skip') continue;
      if (status === 'done') count++;
      else if (key(date) !== key(today)) break;
    }
    return count;
  }
  function setSchedule(habit, days, effectiveFrom) {
    days = normalizeDays(days);
    if (!days.some(Boolean)) throw new Error('Выберите хотя бы один день недели.');
    if (!Array.isArray(habit.schedules) || !habit.schedules.length) {
      habit.schedules = [{ from: habit.createdAt, days: normalizeDays(habit.days) }];
    }
    var current = scheduleFor(habit, effectiveFrom);
    if (!current || !sameDays(current.days, days)) {
      habit.schedules = habit.schedules.filter(function (s) { return s.from !== effectiveFrom; });
      habit.schedules.push({ from: effectiveFrom, days: days.slice() });
      habit.schedules.sort(function (a, b) { return a.from.localeCompare(b.from); });
    }
    habit.days = days.slice();
  }
  function parseBackup(text, todayKey) {
    var source = String(text || '').trim();
    var marker = '== RAW (резервная копия, не разбирай) ==';
    if (source.indexOf(marker) >= 0) source = source.slice(source.indexOf(marker) + marker.length).trim();
    var parsed;
    try { parsed = JSON.parse(source); }
    catch (error) { throw new Error('Не удалось прочитать JSON резервной копии.'); }
    return normalizeState(parsed, todayKey);
  }

  return {
    key: key, parseKey: parseKey, addDays: addDays, wdIdx: wdIdx,
    normalizeDays: normalizeDays, normalizeState: normalizeState,
    scheduledOn: scheduledOn, stateOf: stateOf, dayStats: dayStats,
    rangeStats: rangeStats, weekStats: weekStats,
    closedStreak: closedStreak, bestClosedStreak: bestClosedStreak,
    habitStreak: habitStreak, setSchedule: setSchedule, parseBackup: parseBackup,
    validStates: VALID_STATES
  };
});

