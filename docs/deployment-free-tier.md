# Free-Tier Deployment Walkthrough

This is the concrete path to get FieldMaster live for real use, at zero
cost, using: **Supabase** (Postgres + PostGIS + file storage), **Upstash**
(Redis), **Render** (API hosting), **Vercel** (admin web hosting, already
connected), **Twilio** (SMS login, free trial), and **Expo/EAS** (mobile
app distribution via the free Expo Go app).

Every step below requires *your* account (email verification, ToS
acceptance) — that part can't be automated. Where a step produces a value
I need, it's marked **→ send me this**.

## 1. Supabase (database + file storage) — 5 min

1. Go to [supabase.com](https://supabase.com) → Sign up (GitHub login is fastest) → New Project.
   - Name: `fieldmaster`, choose a strong database password, pick the region closest to Israel (e.g. `eu-central-1`).
2. Once created: **Database → Extensions** → search "postgis" → enable it.
3. **Project Settings → Database → Connection string → URI**. Copy it.
   → **send me this** (it looks like `postgresql://postgres:[password]@db.xxxx.supabase.co:5432/postgres`)
4. **Storage** (left sidebar) → **New bucket** → name it `fieldmaster-files` → set to **Private**.
5. **Project Settings → API** → copy the **Project URL** and the **service_role key** (not the `anon` key — the service role key is needed for server-side uploads).
   → **send me both** (Project URL + service_role key)

## 2. Upstash (Redis for background jobs) — 2 min

1. Go to [upstash.com](https://upstash.com) → Sign up → **Create Database**.
   - Name: `fieldmaster`, type: Regional, region close to Israel.
2. On the database page, find **TCP / ioredis connection** (not the REST API) — it looks like `redis://default:[password]@xxxx.upstash.io:6379`, or for TLS `rediss://...`.
   → **send me this**

## 3. Twilio (SMS login) — 5 min

1. Go to [twilio.com/try-twilio](https://www.twilio.com/try-twilio) → Sign up (free trial, no credit card required to start).
2. From the Twilio Console dashboard, copy your **Account SID** and **Auth Token**.
   → **send me both**
3. **Verify → Services** (left sidebar, under "Trusted Activation" or search "Verify") → **Create new Service** → name it `FieldMaster`.
4. Copy the **Service SID** (starts with `VA...`).
   → **send me this**
5. **Important trial limitation**: a trial Twilio account can only send SMS to phone numbers you've manually verified. Go to **Phone Numbers → Verified Caller IDs** and add your brother's number and every worker's number who needs to log in during testing. (Upgrading Twilio later, ~$1/month + ~$0.008/SMS, removes this limit — not required to start.)

## 4. Render (API hosting) — 5 min, mostly automatic

1. Go to [render.com](https://render.com) → Sign up with GitHub (this also grants Render access to your repos).
2. **New +** → **Blueprint** → select the `fieldmaster` repo. Render will read `render.yaml` from the repo root and propose one service (`fieldmaster-api`).
3. Click **Apply** — it will build and deploy automatically (first build takes ~5-10 min, mostly downloading Playwright's Chromium).
4. Once the service exists, go to it → **Environment** tab, and fill in the values marked `sync: false` in `render.yaml`:
   - `DATABASE_URL` → the Supabase connection string from step 1.3 (append `?sslmode=require` if it's not already there)
   - `REDIS_URL` → the Upstash URL from step 2
   - `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_VERIFY_SERVICE_SID` → from step 3
   - `S3_ENDPOINT` → `https://xxxx.supabase.co/storage/v1/s3` (your Supabase Project URL + `/storage/v1/s3`)
   - `S3_ACCESS_KEY_ID` → your Supabase Project URL's ref ID, or generate an S3 access key under **Storage → S3 Access Keys** in Supabase (recommended — creates a scoped key instead of using the service role key here)
   - `S3_SECRET_ACCESS_KEY` → the matching secret from that same S3 Access Keys screen
   - `CORS_ORIGINS` → leave a placeholder for now (`https://placeholder.vercel.app`); I'll update it once the admin-web URL exists (step 5)
5. Save — Render redeploys automatically. Once live, the API is at `https://fieldmaster-api.onrender.com` (confirm the exact URL on the service's page — Render appends a random suffix only if that name is already taken by someone else).
   → **send me the exact URL** if it differs from the above

**Free-tier behavior to expect**: the service sleeps after 15 minutes with no traffic; the next request takes ~30-60 seconds to wake it up. Fine for a small crew's daily use, not instant.

## 5. Vercel (admin web dashboard) — I can do this part

Vercel is already connected on this machine. Once I have the Render API
URL (step 4.5), tell me and I'll deploy `apps/admin-web` directly — no
action needed from you here beyond confirming the URL.

## 6. Expo / EAS (mobile app for your brother's crew) — 3 min

1. Go to [expo.dev](https://expo.dev) → Sign up (free).
2. **Account Settings → Access Tokens** → **Create Token** → name it `fieldmaster-deploy`.
   → **send me this token** (starts with a long random string — treat it like a password; I'll use it only to publish the app, then you can revoke/rotate it anytime from that same page)

Once I have it, I'll run `eas init` + `eas update:configure` + publish an
update. Your brother's crew then installs the free **Expo Go** app
(App Store / Play Store) and opens FieldMaster via a link or QR code I'll
give you — no Apple/Google developer account, no app-store review, updates
go out instantly whenever the app changes.

## What to send me, all at once when ready

```text
1. Supabase DATABASE_URL:
2. Supabase Project URL:
3. Supabase service_role key:
4. Upstash REDIS_URL:
5. Twilio Account SID:
6. Twilio Auth Token:
7. Twilio Verify Service SID:
8. Render API URL (from step 4.5):
9. Expo access token:
```

You can also send them partially / as you go — I'll wire up whatever's
ready and tell you what's still missing.

## Security note

None of these values should ever be pasted into a public place (a public
GitHub issue, a public chat, etc.) — this conversation is fine. After
everything is wired up and working, consider rotating the JWT
secrets/encryption key Render auto-generates (`render.yaml`'s
`generateValue: true` fields) if you ever suspect they leaked, from the
Render dashboard's Environment tab.
