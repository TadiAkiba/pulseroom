# PulseRoom

PulseRoom is a live event engagement platform with three experiences:

- attendee join flow with anonymous questions, feedback, polls, ratings, and reactions
- organizer dashboard with moderation and live analytics
- presenter mode for projector-friendly audience visuals

The app ships as a single full-stack service:

- `React + Vite` frontend
- `Express + Socket.IO` backend
- `SQLite` persistence with WAL mode
- provider-isolated text analysis service using the current heuristic analyzer

## Production-ready changes included

- persistent organizer accounts instead of a shared demo passcode
- database-backed organizer sessions that survive server restarts
- organizer event ownership checks on admin routes
- separated public and admin realtime channels so public clients do not receive admin snapshots
- env-driven demo seeding and organizer bootstrap behavior
- configurable database path and production-safe cookie handling

## Local development

1. Install dependencies:

   ```bash
   npm install
   ```

2. Create an env file:

   ```bash
   cp .env.example .env
   ```

3. Start the app:

   ```bash
   npm run dev
   ```

4. Open:

   - attendee join: `http://localhost:5173/join`
   - organizer dashboard: `http://localhost:5173/dashboard`

## First organizer login

You now have two supported ways to create organizer access:

- allow self-service organizer signup with `ALLOW_ORGANIZER_SIGNUP=true`
- pre-create a bootstrap organizer with:
  - `BOOTSTRAP_ORGANIZER_EMAIL`
  - `BOOTSTRAP_ORGANIZER_PASSWORD`

If no organizer exists yet, the first organizer account can be created through the dashboard even when public signup is disabled.

## Production environment

Recommended production values:

```env
APP_URL=https://your-domain.example
DATABASE_PATH=/persistent-volume/engagement.sqlite
ENABLE_DEMO_SEED=false
ALLOW_ORGANIZER_SIGNUP=false
BOOTSTRAP_ORGANIZER_EMAIL=owner@your-company.com
BOOTSTRAP_ORGANIZER_PASSWORD=use-a-strong-secret
SESSION_TTL_HOURS=8
ANALYSIS_PROVIDER=heuristic
```

## Build and run

```bash
npm run build
npm start
```

`npm start` serves the built frontend from `dist/` and runs the backend from `server/index.ts`.

## Deployment notes

- mount `DATABASE_PATH` to persistent storage
- terminate TLS at your platform or reverse proxy
- run the app behind a single public origin that matches `APP_URL`
- disable demo seeding for production
- keep organizer bootstrap credentials in secrets, never in source control

## Privacy model

PulseRoom does not collect attendee names, emails, attendee accounts, or public identity. It stores:

- anonymous response content
- timestamps
- moderation state
- derived analysis outputs

The app uses short-window rate limiting for spam resistance without attaching attendee identity to responses.
