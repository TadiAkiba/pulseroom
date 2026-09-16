# PulseRoom

PulseRoom is a live event engagement platform with three experiences:

- attendee join flow with anonymous questions, feedback, polls, ratings, and reactions
- organizer dashboard with moderation and live analytics
- presenter mode for projector-friendly audience visuals

The app ships as a single full-stack service:

- `React + Vite` frontend
- `Express + Socket.IO` backend
- `SQLite` persistence with WAL mode
- optional `Convex` mirror for hosted public realtime snapshots
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

## Convex integration

PulseRoom now includes a deployable Convex backend in `convex/` for mirroring public and admin event snapshots. The existing Express + SQLite stack remains the source of truth, and Convex acts as an optional hosted realtime layer for public attendee and presenter views.

Recommended env values for this project:

```env
CONVEX_URL=https://charming-shrimp-707.convex.cloud
VITE_CONVEX_URL=https://charming-shrimp-707.convex.cloud
CONVEX_HTTP_ACTIONS_URL=https://charming-shrimp-707.convex.site
ENABLE_CONVEX_PUBLIC_SYNC=true
VITE_ENABLE_CONVEX_PUBLIC_SYNC=true
CONVEX_SYNC_SECRET=choose-a-shared-secret
```

Notes:

- the Convex HTTP action endpoint is `/sync-snapshot`
- Express pushes both public and admin snapshots whenever an event changes
- attendee and presenter pages can subscribe to Convex when `VITE_ENABLE_CONVEX_PUBLIC_SYNC=true`
- Socket.IO remains in place as the current fallback transport
- deploying the Convex functions still requires a linked Convex CLI session or deploy key

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

## Vercel deployment

Vercel can host the frontend well, but it is not a good host for the current Node backend because this app still relies on:

- `SQLite` persistent disk writes
- `Socket.IO` long-lived realtime connections
- in-process analysis and session state

Recommended setup:

- host the React frontend on `Vercel`
- host the `Express + Socket.IO + SQLite` backend on a persistent Node host like `Render`, `Fly.io`, or `Railway`
- point the Vercel frontend at that backend with:

```env
VITE_API_URL=https://your-backend.example
VITE_SOCKET_URL=https://your-backend.example
VITE_CONVEX_URL=https://charming-shrimp-707.convex.cloud
VITE_ENABLE_CONVEX_PUBLIC_SYNC=true
```

Backend env example for that split deployment:

```env
APP_URL=https://your-backend.example
FRONTEND_URL=https://your-vercel-app.vercel.app
CORS_ALLOWED_ORIGINS=https://your-vercel-app.vercel.app
ENABLE_CONVEX_PUBLIC_SYNC=true
CONVEX_URL=https://charming-shrimp-707.convex.cloud
CONVEX_HTTP_ACTIONS_URL=https://charming-shrimp-707.convex.site
CONVEX_SYNC_SECRET=your-shared-secret
```

With `FRONTEND_URL` set, organizer auth cookies are issued in cross-site mode so the dashboard can still log in from Vercel.

## Privacy model

PulseRoom does not collect attendee names, emails, attendee accounts, or public identity. It stores:

- anonymous response content
- timestamps
- moderation state
- derived analysis outputs

The app uses short-window rate limiting for spam resistance without attaching attendee identity to responses.
