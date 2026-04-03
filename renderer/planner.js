/* =========================================================
   Week Planner — planner.js
   Adapted from handoff for Electron desktop app
   ========================================================= */

const DAYS_LONG  = ['Monday','Tuesday','Wednesday','Thursday','Friday'];
const DAYS_SHORT = ['Mon','Tue','Wed','Thu','Fri'];
const STORAGE_KEY = 'weekplanner_events_v1';

let events     = [];
let weekOffset = 0;
let editIndex  = -1;

/* ---- Persistence ---------------------------------------- */

function saveToStorage() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(events)); } catch(e) {}
}

function loadFromStorage() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) events = JSON.parse(raw);
  } catch(e) { events = []; }
}

/* ---- Date helpers --------------------------------------- */

function getMondayOf(offset) {
  const now  = new Date();
  const dow  = now.getDay();
  const diff = dow === 0 ? -6 : 1 - dow;
  const mon  = new Date(now);
  mon.setDate(now.getDate() + diff + offset * 7);
  mon.setHours(0, 0, 0, 0);
  return mon;
}

function getWeekDates(offset) {
  const mon = getMondayOf(offset);
  return Array.from({ length: 5 }, (_, i) => {
    const d = new Date(mon);
    d.setDate(mon.getDate() + i);
    return d;
  });
}

function isToday(date) {
  const n = new Date();
  return date.getFullYear() === n.getFullYear()
      && date.getMonth()    === n.getMonth()
      && date.getDate()     === n.getDate();
}

function fmtShort(d) {
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function pad2(n) { return String(n).padStart(2, '0'); }

function toICSStamp(date, timeStr) {
  const [h, m]  = timeStr.split(':').map(Number);
  const d       = new Date(date);
  d.setHours(h, m, 0, 0);
  return `${d.getFullYear()}${pad2(d.getMonth()+1)}${pad2(d.getDate())}`
       + `T${pad2(d.getHours())}${pad2(d.getMinutes())}00`;
}

function nowStamp() {
  const d = new Date();
  return `${d.getUTCFullYear()}${pad2(d.getUTCMonth()+1)}${pad2(d.getUTCDate())}`
       + `T${pad2(d.getUTCHours())}${pad2(d.getUTCMinutes())}${pad2(d.getUTCSeconds())}Z`;
}

function makeUID() {
  return `${Date.now()}-${Math.random().toString(36).slice(2)}@weekplanner`;
}

/* ---- ICS generation ------------------------------------ */

function escapeICS(str) {
  return (str || '').replace(/[\\;,]/g, c => '\\' + c).replace(/\n/g, '\\n');
}

function buildICS() {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Week Planner//weekplanner//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'X-WR-CALNAME:My Week',
  ];

  events.forEach(ev => {
    const dates = getWeekDates(ev.weekOffset);
    const date  = dates[ev.day];
    lines.push(
      'BEGIN:VEVENT',
      `UID:${ev.uid}`,
      `DTSTAMP:${nowStamp()}`,
      `DTSTART:${toICSStamp(date, ev.start)}`,
      `DTEND:${toICSStamp(date, ev.end)}`,
      `SUMMARY:${escapeICS(ev.title)}`,
    );
    if (ev.loc)   lines.push(`LOCATION:${escapeICS(ev.loc)}`);
    if (ev.notes) lines.push(`DESCRIPTION:${escapeICS(ev.notes)}`);
    // X-MICROSOFT-CDO-BUSYSTATUS: FREE, TENTATIVE, BUSY, OOF
    if (ev.busyStatus === 'tentative') lines.push('X-MICROSOFT-CDO-BUSYSTATUS:TENTATIVE');
    else if (ev.busyStatus === 'free') lines.push('X-MICROSOFT-CDO-BUSYSTATUS:FREE');
    else lines.push('X-MICROSOFT-CDO-BUSYSTATUS:BUSY');
    lines.push('END:VEVENT');
  });

  lines.push('END:VCALENDAR');
  return lines.join('\r\n');
}

/* ---- Render -------------------------------------------- */

function render() {
  const dates = getWeekDates(weekOffset);

  // Week label
  document.getElementById('week-label').textContent =
    `${fmtShort(dates[0])} – ${fmtShort(dates[4])}, ${dates[4].getFullYear()}`;

  // Day grid
  const grid = document.getElementById('day-grid');
  grid.innerHTML = '';

  dates.forEach((date, i) => {
    const col = document.createElement('div');
    col.className = 'day-col' + (isToday(date) ? ' is-today' : '');

    const header = document.createElement('div');
    header.className = 'day-header';
    header.innerHTML =
      `<div class="day-header-name">${DAYS_SHORT[i]}</div>`
    + `<div class="day-header-date">${date.getDate()}</div>`;
    col.appendChild(header);

    const dayEvs = events
      .filter(e => e.weekOffset === weekOffset && e.day === i)
      .sort((a, b) => a.start.localeCompare(b.start));

    dayEvs.forEach(ev => {
      const idx  = events.indexOf(ev);
      const chip = document.createElement('div');
      chip.className = 'event-chip';
      const statusTag = ev.busyStatus === 'tentative' ? ' <span class="chip-tentative">tentative</span>'
                      : ev.busyStatus === 'free' ? ' <span class="chip-free">free</span>' : '';
      chip.innerHTML =
        `<button class="event-chip-del" data-idx="${idx}" title="Delete event" aria-label="Delete ${ev.title}">&times;</button>`
      + `<div class="event-chip-title">${ev.title}${statusTag}</div>`
      + `<div class="event-chip-time">${ev.start}–${ev.end}${ev.loc ? ' · ' + ev.loc : ''}</div>`;
      chip.addEventListener('click', e => {
        if (e.target.classList.contains('event-chip-del')) return;
        startEdit(idx);
      });
      chip.querySelector('.event-chip-del').addEventListener('click', e => {
        e.stopPropagation();
        deleteEvent(idx);
      });
      col.appendChild(chip);
    });

    const addBtn = document.createElement('button');
    addBtn.className = 'add-event-btn';
    addBtn.textContent = '+ add';
    addBtn.addEventListener('click', () => {
      document.getElementById('ev-day').value = i;
      document.getElementById('ev-title').focus();
    });
    col.appendChild(addBtn);
    grid.appendChild(col);
  });

  // Export count
  const weekEvCount = events.filter(e => e.weekOffset === weekOffset).length;
  const totalCount  = events.length;
  document.getElementById('export-count').textContent =
    weekEvCount === 0
      ? 'No events this week'
      : `${weekEvCount} event${weekEvCount !== 1 ? 's' : ''} this week`
      + (totalCount > weekEvCount ? ` (${totalCount} total)` : '');

  const exportBtn = document.getElementById('export-btn');
  exportBtn.disabled = totalCount === 0;
}

/* ---- Event CRUD ---------------------------------------- */

function saveEvent() {
  const title = document.getElementById('ev-title').value.trim();
  if (!title) {
    document.getElementById('ev-title').focus();
    return;
  }

  const start = document.getElementById('ev-start').value;
  const end   = document.getElementById('ev-end').value;
  if (start >= end) {
    showHint('End time must be after start time.');
    return;
  }

  const ev = {
    uid:        editIndex >= 0 ? events[editIndex].uid : makeUID(),
    title,
    day:        parseInt(document.getElementById('ev-day').value, 10),
    start,
    end,
    loc:        document.getElementById('ev-loc').value.trim(),
    notes:      document.getElementById('ev-notes').value.trim(),
    weekOffset,
  };

  if (editIndex >= 0) {
    events[editIndex] = ev;
    editIndex = -1;
  } else {
    events.push(ev);
  }

  saveToStorage();
  resetForm();
  showHint('Event saved.');
  render();
}

function startEdit(idx) {
  const ev = events[idx];
  editIndex = idx;
  document.getElementById('ev-title').value  = ev.title;
  document.getElementById('ev-day').value    = ev.day;
  document.getElementById('ev-start').value  = ev.start;
  document.getElementById('ev-end').value    = ev.end;
  document.getElementById('ev-loc').value    = ev.loc;
  document.getElementById('ev-notes').value  = ev.notes;
  document.getElementById('form-title').textContent = 'Edit event';
  document.getElementById('cancel-btn').style.display = '';
  document.getElementById('ev-title').focus();
  document.querySelector('.form-section').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function deleteEvent(idx) {
  if (editIndex === idx) resetForm();
  events.splice(idx, 1);
  if (editIndex > idx) editIndex--;
  saveToStorage();
  render();
}

function resetForm() {
  editIndex = -1;
  document.getElementById('ev-title').value  = '';
  document.getElementById('ev-start').value  = '09:00';
  document.getElementById('ev-end').value    = '10:00';
  document.getElementById('ev-loc').value    = '';
  document.getElementById('ev-notes').value  = '';
  document.getElementById('form-title').textContent = 'Add an event';
  document.getElementById('cancel-btn').style.display = 'none';
}

function showHint(msg) {
  const hint = document.getElementById('form-hint');
  hint.textContent = msg;
  hint.classList.add('visible');
  clearTimeout(hint._timer);
  hint._timer = setTimeout(() => hint.classList.remove('visible'), 2500);
}

/* ---- AI Bridge ----------------------------------------- */

function addEventsFromAI(newEvents) {
  events.push(...newEvents);
  saveToStorage();
  render();
}

function removeEventsFromAI(removeSpecs) {
  let removed = 0;
  // Process removals in reverse to avoid index shifting issues
  for (const spec of removeSpecs) {
    const targetOffset = spec.weekOffset;
    const titleMatch = (spec.title || '').toLowerCase();

    for (let i = events.length - 1; i >= 0; i--) {
      const ev = events[i];
      if (ev.weekOffset !== targetOffset) continue;
      if (titleMatch && !ev.title.toLowerCase().includes(titleMatch)) continue;
      if (spec.day !== undefined && spec.day !== null && ev.day !== spec.day) continue;
      if (spec.start && ev.start !== spec.start) continue;

      events.splice(i, 1);
      removed++;
      if (editIndex === i) resetForm();
      if (editIndex > i) editIndex--;
    }
  }
  if (removed > 0) {
    saveToStorage();
    render();
  }
  return removed;
}

function getWeekContext() {
  const now = new Date();
  const dates = getWeekDates(weekOffset);
  const weekLabel = `${fmtShort(dates[0])} – ${fmtShort(dates[4])}, ${dates[4].getFullYear()}`;

  // Current date/time info
  const dayNames = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  const todayName = dayNames[now.getDay()];
  const timeStr = now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
  const dateStr = now.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

  let ctx = `Right now it is ${todayName}, ${dateStr}, ${timeStr}.\n`;
  ctx += `The user is viewing: ${weekLabel} (weekOffset=${weekOffset}).\n`;
  ctx += `"this week" = weekOffset ${weekOffset}, "next week" = weekOffset ${weekOffset + 1}.\n`;

  // Map today to a day index if it falls within the viewed week
  const todayDow = now.getDay(); // 0=Sun, 1=Mon...6=Sat
  if (weekOffset === 0 && todayDow >= 1 && todayDow <= 5) {
    ctx += `"Today" is ${todayName} (day index ${todayDow - 1}). "Tomorrow" is ${dayNames[(todayDow + 1) % 7]} (day index ${todayDow <= 4 ? todayDow : 'weekend'}).\n`;
  } else {
    ctx += `The user is NOT viewing the current week, so "today" (${todayName}) may not apply to the viewed week.\n`;
  }

  const thisWeekEvents = events.filter(e => e.weekOffset === weekOffset);
  if (thisWeekEvents.length > 0) {
    ctx += `\nExisting events this week:\n`;
    thisWeekEvents
      .sort((a, b) => a.day - b.day || a.start.localeCompare(b.start))
      .forEach(ev => {
        ctx += `- ${DAYS_SHORT[ev.day]}: "${ev.title}" ${ev.start}–${ev.end}${ev.loc ? ' @ ' + ev.loc : ''}\n`;
      });
  } else {
    ctx += `\nNo events this week yet.\n`;
  }

  const nextWeekEvents = events.filter(e => e.weekOffset === weekOffset + 1);
  if (nextWeekEvents.length > 0) {
    ctx += `\nExisting events next week:\n`;
    nextWeekEvents
      .sort((a, b) => a.day - b.day || a.start.localeCompare(b.start))
      .forEach(ev => {
        ctx += `- ${DAYS_SHORT[ev.day]}: "${ev.title}" ${ev.start}–${ev.end}${ev.loc ? ' @ ' + ev.loc : ''}\n`;
      });
  }

  return ctx;
}

/* ---- Export (Electron native save dialog) -------------- */

async function exportICS() {
  if (!events.length) return;
  const ics = buildICS();
  if (window.electronAPI) {
    const result = await window.electronAPI.saveICS(ics);
    if (result.success) {
      showHint('Saved to ' + result.path);
    }
  } else {
    // Fallback for browser testing
    const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = 'my-week.ics';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }
}

/* ---- Expose for chat.js ------------------------------- */

function getEventsWithDates() {
  return events.map(ev => {
    const dates = getWeekDates(ev.weekOffset);
    const date = dates[ev.day];
    const dateStr = `${date.getFullYear()}-${pad2(date.getMonth()+1)}-${pad2(date.getDate())}`;
    return { ...ev, dateStr };
  });
}

function getDateRangeForWeek(offset) {
  const dates = getWeekDates(offset);
  const mon = dates[0];
  const fri = dates[4];
  const sat = new Date(fri);
  sat.setDate(fri.getDate() + 1);
  const fmt = d => `${d.getMonth()+1}/${d.getDate()}/${d.getFullYear()} 12:00 AM`;
  return { start: fmt(mon), end: fmt(sat) };
}

window.plannerState = {
  get events() { return events; },
  get weekOffset() { return weekOffset; },
  addEventsFromAI,
  removeEventsFromAI,
  getWeekContext,
  getEventsWithDates,
  getDateRangeForWeek,
  makeUID,
  DAYS_SHORT,
};

/* ---- Init ---------------------------------------------- */

function init() {
  loadFromStorage();
  render();

  document.getElementById('prev-week').addEventListener('click', () => { weekOffset--; render(); });
  document.getElementById('next-week').addEventListener('click', () => { weekOffset++; render(); });
  document.getElementById('go-today').addEventListener('click', () => { weekOffset = 0; render(); });

  document.getElementById('add-btn').addEventListener('click', saveEvent);
  document.getElementById('cancel-btn').addEventListener('click', () => { resetForm(); render(); });
  document.getElementById('export-btn').addEventListener('click', exportICS);

  document.getElementById('ev-title').addEventListener('keydown', e => {
    if (e.key === 'Enter') saveEvent();
  });
}

document.addEventListener('DOMContentLoaded', init);
