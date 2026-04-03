/* =========================================================
   ai-events.js — Extract and validate events from Claude response
   Handles add + remove actions with week awareness
   ========================================================= */

function extractActionsFromResponse(text) {
  const match = text.match(/```json\s*([\s\S]*?)```/);
  if (!match) return null;

  try {
    const parsed = JSON.parse(match[1].trim());

    // Support old array format (just adds) for backwards compat
    if (Array.isArray(parsed)) {
      return { add: parsed, remove: [] };
    }

    // New object format with add/remove
    if (typeof parsed === 'object' && parsed !== null) {
      return {
        add: Array.isArray(parsed.add) ? parsed.add : [],
        remove: Array.isArray(parsed.remove) ? parsed.remove : [],
      };
    }

    return null;
  } catch (e) {
    return null;
  }
}

function extractDisplayText(text) {
  return text.replace(/```json\s*[\s\S]*?```/g, '').trim();
}

function resolveWeekOffset(weekField, currentWeekOffset) {
  if (weekField === 'next') return currentWeekOffset + 1;
  return currentWeekOffset; // "this" or default
}

function validateAddEvents(rawArray, currentWeekOffset) {
  const valid = [];
  const errors = [];

  rawArray.forEach((item, i) => {
    const label = `Event ${i + 1}`;

    if (!item.title || typeof item.title !== 'string' || !item.title.trim()) {
      errors.push(`${label}: missing title`);
      return;
    }

    const day = typeof item.day === 'number' ? item.day : parseInt(item.day, 10);
    if (isNaN(day) || day < 0 || day > 4) {
      errors.push(`${label} ("${item.title}"): invalid day (must be 0-4)`);
      return;
    }

    if (!item.start || !/^\d{2}:\d{2}$/.test(item.start)) {
      errors.push(`${label} ("${item.title}"): invalid start time`);
      return;
    }

    let end = item.end;
    if (!end || !/^\d{2}:\d{2}$/.test(end)) {
      const [h, m] = item.start.split(':').map(Number);
      const endH = Math.min(h + 1, 23);
      end = `${String(endH).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
    }

    if (end <= item.start) {
      const [h, m] = item.start.split(':').map(Number);
      const endH = Math.min(h + 1, 23);
      end = `${String(endH).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
    }

    // Validate busyStatus
    const validStatuses = ['busy', 'tentative', 'free'];
    const busyStatus = validStatuses.includes(item.busyStatus) ? item.busyStatus : 'busy';

    valid.push({
      uid: window.plannerState.makeUID(),
      title: item.title.trim().slice(0, 200),
      day: day,
      start: item.start,
      end: end,
      loc: (item.loc || '').trim(),
      notes: (item.notes || '').trim(),
      weekOffset: resolveWeekOffset(item.week, currentWeekOffset),
      busyStatus: busyStatus,
    });
  });

  return { valid, errors };
}

function validateRemoveSpecs(rawArray, currentWeekOffset) {
  const valid = [];

  rawArray.forEach(item => {
    if (!item.title) return;

    const spec = {
      title: item.title.trim(),
      weekOffset: resolveWeekOffset(item.week, currentWeekOffset),
    };

    if (item.day !== undefined && item.day !== null) {
      const day = typeof item.day === 'number' ? item.day : parseInt(item.day, 10);
      if (!isNaN(day) && day >= 0 && day <= 4) {
        spec.day = day;
      }
    }

    if (item.start && /^\d{2}:\d{2}$/.test(item.start)) {
      spec.start = item.start;
    }

    valid.push(spec);
  });

  return valid;
}
