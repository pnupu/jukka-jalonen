# Jukka Jalonen

Discord bot for organizing League flex ranked games with friends.

## What it does

- `/flexii aika:18:00` posts a poll like `Flexii tänään 18:00?`
- People answer with buttons: `Mukana`, `Ei pääse`, or `Muu aika`
- `Muu aika` opens a modal where they can suggest another time
- `/flex-role` stores the role that gets pinged for future polls
- `/flex-role-get` shows the currently configured ping role
- `/flex-role-create` creates a ping role if it does not exist yet
- Optional Google Calendar event creation when calendar env vars are set

## Setup

```bash
bun install
cp .env.example .env
```

Fill in `.env`:

```env
DISCORD_TOKEN=your_bot_token
DISCORD_GUILD_ID=your_server_id
FLEX_ROLE_ID=optional_role_id
```

Run locally:

```bash
bun run dev
```

Build and run:

```bash
bun run build
bun run start
```

## Raspberry Pi service

There is a systemd template at `deploy/jukka-jalonen.service.example`.

Typical Pi install shape:

```bash
cd /home/pi/JukkaJalonen
bun install --frozen-lockfile
bun run build
sudo cp deploy/jukka-jalonen.service.example /etc/systemd/system/jukka-jalonen.service
sudo systemctl daemon-reload
sudo systemctl enable --now jukka-jalonen
```

## Google Calendar

Use a Google Cloud service account, enable Calendar API, and share the target calendar with the service account email.

Either paste the full service account JSON into:

```env
GOOGLE_SERVICE_ACCOUNT_JSON={"type":"service_account",...}
```

Or point to a credentials file:

```env
GOOGLE_APPLICATION_CREDENTIALS=/home/pi/jukka-jalonen/google-service-account.json
```

Then set:

```env
GOOGLE_CALENDAR_ID=calendar_id_here
```

If these values are missing, the bot still works and simply skips calendar creation.
