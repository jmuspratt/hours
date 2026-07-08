// Shared parsing helpers for Google Places (New) opening-hours responses.
// Used by both scripts/build.js and scripts/api-server.js.

export const DAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

export function pad(n) {
  return String(n).padStart(2, "0");
}

export function formatTime(hour, minute) {
  return `${pad(hour)}:${pad(minute)}`;
}

// Maps Google's regularOpeningHours.periods → { mon: {open,close}|null, ... }
export function parseRegularHours(regularOpeningHours) {
  const result = {
    sun: null,
    mon: null,
    tue: null,
    wed: null,
    thu: null,
    fri: null,
    sat: null,
  };
  if (!regularOpeningHours?.periods) return result;

  for (const period of regularOpeningHours.periods) {
    const dayKey = DAYS[period.open?.day];
    if (!dayKey || !period.close) continue;
    result[dayKey] = {
      open: formatTime(period.open.hour ?? 0, period.open.minute ?? 0),
      close: formatTime(period.close.hour ?? 0, period.close.minute ?? 0),
    };
  }
  return result;
}

// Maps currentOpeningHours specialDays + periods → override array
export function parseOverrides(currentOpeningHours) {
  if (!currentOpeningHours?.specialDays?.length) return [];

  const periods = currentOpeningHours.periods ?? [];
  const overrides = [];

  for (const specialDay of currentOpeningHours.specialDays) {
    const { year, month, day } = specialDay.date;
    const dateStr = `${year}-${pad(month)}-${pad(day)}`;

    // Find periods whose open.date matches this special day
    const match = periods.find((p) => {
      const d = p.open?.date;
      return d && d.year === year && d.month === month && d.day === day;
    });

    if (!match) {
      // Special day with no open period = closed
      overrides.push({ date: dateStr, hours: null });
    } else {
      overrides.push({
        date: dateStr,
        hours: {
          open: formatTime(match.open.hour ?? 0, match.open.minute ?? 0),
          close: formatTime(match.close.hour ?? 0, match.close.minute ?? 0),
        },
      });
    }
  }

  return overrides;
}
