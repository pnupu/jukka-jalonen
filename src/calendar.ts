import { readFile } from 'node:fs/promises';
import { google } from 'googleapis';
import { timezone } from './env';
import type { FlexEvent } from './types';

const CALENDAR_SCOPE = 'https://www.googleapis.com/auth/calendar.events';

export async function createCalendarEvent(event: FlexEvent): Promise<string | undefined> {
  const calendarId = process.env.GOOGLE_CALENDAR_ID?.trim();
  if (!calendarId) return undefined;

  const credentials = await loadCredentials();
  if (!credentials) {
    console.warn('GOOGLE_CALENDAR_ID is set, but Google credentials are missing.');
    return undefined;
  }

  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: [CALENDAR_SCOPE],
  });
  const calendar = google.calendar({ version: 'v3', auth });
  const startsAt = new Date(event.startsAt);
  const endsAt = new Date(startsAt.getTime() + event.durationMinutes * 60_000);

  const response = await calendar.events.insert({
    calendarId,
    requestBody: {
      summary: event.question,
      description: `Discord flex poll: ${event.id}`,
      start: {
        dateTime: startsAt.toISOString(),
        timeZone: timezone(),
      },
      end: {
        dateTime: endsAt.toISOString(),
        timeZone: timezone(),
      },
    },
  });

  return response.data.id || undefined;
}

async function loadCredentials(): Promise<Record<string, unknown> | undefined> {
  const inlineJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON?.trim();
  if (inlineJson) {
    return JSON.parse(inlineJson);
  }

  const path = process.env.GOOGLE_APPLICATION_CREDENTIALS?.trim();
  if (path) {
    return JSON.parse(await readFile(path, 'utf8'));
  }

  return undefined;
}
