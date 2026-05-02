# Health Signals

MVP health logger for phone-first personal use.

## What Works

- Logs are saved immediately in browser `localStorage`.
- Records view shows every saved entry, with raw text plus extracted structure.
- Exercise and meals are free-text logs.
- Sleep asks for subjective quality in the morning for the previous night. The hidden supplement stack is treated as pre-bed supplements taken before that sleep.
- Meditation asks for minutes and time.
- Social media asks whether you abstained all day, using a configurable definition.
- Meal logs trigger a next-meal timing and rough macro suggestion based on your profile, goals, meals, and exercise.
- Chat lets you ask an LLM questions using profile/settings plus recent logs as context.
- `/api/extract` extracts structured data from new logs when hosted on Vercel.
- `/api/insights` generates insights from the last 7 days when hosted on Vercel.
- Supabase Auth plus the `health_entries` and `health_profiles` tables can sync logs/profile across devices.

## Vercel Setup

1. Create a Vercel project from this folder or a Git repo containing it.
2. Add environment variables in Vercel:
   - `OPENAI_API_KEY`
   - `SUPABASE_URL`
   - `SUPABASE_ANON_KEY`
   - `OPENAI_MODEL` optional, defaults to `gpt-4.1-mini`
3. Deploy.

CLI option if Vercel CLI is installed:

```sh
vercel
vercel --prod
```

## Supabase Setup

1. Create a Supabase project.
2. In the SQL editor, run `supabase-schema.sql`.
3. In the app Settings screen, paste:
   - Project URL
   - Publishable anon key
4. Create an account or log in from the sidebar.

The app saves locally first, then upserts to `public.health_entries` when logged in.

## Current Storage Model

Data is stored in the browser first. With Supabase configured, rows sync to your authenticated account and can be read from your phone or desktop.
