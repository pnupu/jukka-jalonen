const FINNISH_WEEKDAYS = ['su', 'ma', 'ti', 'ke', 'to', 'pe', 'la'];

export function parseFlexDateTime(dayInput: string | null, timeInput: string, now = new Date()): Date {
  const timeMatch = timeInput.trim().match(/^(\d{1,2})(?::|\.)(\d{2})$/);
  if (!timeMatch) {
    throw new Error('Ajan pitää olla muodossa 18:00.');
  }

  const hours = Number(timeMatch[1]);
  const minutes = Number(timeMatch[2]);
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
    throw new Error('Ajan pitää olla kelvollinen kellonaika, esimerkiksi 18:00.');
  }

  const date = resolveDay(dayInput, now);
  date.setHours(hours, minutes, 0, 0);
  return date;
}

export function formatFinnishQuestionTime(startsAt: Date, now = new Date()): string {
  const day = dayLabel(startsAt, now);
  const time = startsAt.toLocaleTimeString('fi-FI', {
    hour: '2-digit',
    minute: '2-digit',
  });
  return `${day} ${time}`;
}

function resolveDay(dayInput: string | null, now: Date): Date {
  const value = dayInput?.trim().toLowerCase();
  const date = new Date(now);

  if (!value || value === 'tänään' || value === 'tanaan' || value === 'today') {
    return date;
  }

  if (value === 'huomenna' || value === 'tomorrow') {
    date.setDate(date.getDate() + 1);
    return date;
  }

  const weekdayIndex = FINNISH_WEEKDAYS.indexOf(value.slice(0, 2));
  if (weekdayIndex >= 0) {
    const delta = (weekdayIndex - date.getDay() + 7) % 7 || 7;
    date.setDate(date.getDate() + delta);
    return date;
  }

  const finnishDate = value.match(/^(\d{1,2})\.(\d{1,2})\.?(\d{4})?$/);
  if (finnishDate) {
    const year = finnishDate[3] ? Number(finnishDate[3]) : date.getFullYear();
    return new Date(year, Number(finnishDate[2]) - 1, Number(finnishDate[1]));
  }

  const isoDate = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoDate) {
    return new Date(Number(isoDate[1]), Number(isoDate[2]) - 1, Number(isoDate[3]));
  }

  throw new Error('Päivän pitää olla esimerkiksi tänään, huomenna, pe, 3.6. tai 2026-06-03.');
}

function dayLabel(date: Date, now: Date): string {
  const start = startOfDay(date).getTime();
  const today = startOfDay(now).getTime();
  const dayMs = 24 * 60 * 60 * 1000;

  if (start === today) return 'tänään';
  if (start === today + dayMs) return 'huomenna';

  return date.toLocaleDateString('fi-FI', {
    weekday: 'short',
    day: 'numeric',
    month: 'numeric',
  });
}

function startOfDay(date: Date): Date {
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);
  return copy;
}
