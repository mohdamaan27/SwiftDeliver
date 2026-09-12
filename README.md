# SwiftDeliver

A delivery-tracking platform: sender/receiver/agent/admin roles, live status
tracking, disputes, notifications, analytics, and more — built with React
(Vite) and a Supabase backend (Auth + Postgres).

## 1. Install dependencies

```bash
npm install
```

## 2. Set up Supabase

1. Create a free project at [supabase.com](https://supabase.com).
2. Open the **SQL Editor** in your project and run the contents of
   `supabase_schema.sql` (in this repo) once. This creates the `profiles`,
   `deliveries`, `disputes`, and `agents` tables, their security policies,
   and the trigger that auto-creates a profile on signup.
3. In **Project Settings → API**, copy your **Project URL** and
   **anon public key**.
4. Copy `.env.example` to `.env` and paste those two values in:

   ```bash
   cp .env.example .env
   ```

## 3. Run it

```bash
npm run dev
```

Open the printed local URL (usually `http://localhost:5173`).

## 4. Build for production

```bash
npm run build
```

Output goes to `dist/` — deploy that folder to Vercel, Netlify, or any
static host.

## Creating an admin/agent test account

The public sign-up form only creates regular (sender/receiver) accounts,
by design. To test the admin or agent views:

1. Sign up normally through the app.
2. In Supabase → **Table Editor → profiles**, find your row and change its
   `role` column to `admin` or `agent`.
3. Log out and back in.

## Project structure

```
index.html          Vite entry HTML
src/main.jsx         Mounts the React app
src/App.jsx          The whole app (all pages/components) — being split
                      into smaller files incrementally
src/index.css         Global styles
supabase_schema.sql   Database schema — run once in Supabase SQL Editor
```
