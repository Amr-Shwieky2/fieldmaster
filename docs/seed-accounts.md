# Seed accounts and how to log in

`pnpm db:seed` wipes the development database and recreates one fictional
organization, **شركة الميدان للمقاولات وأعمال الطرق**, with the 16 accounts
below. Re-run it any time an account ends up in an odd state from manual
testing.

All data is fictional. The phone numbers are not real subscribers. Names,
projects, sites, shift titles and other human-readable seed text are in Arabic
to match the Arabic-only UI; project codes, enum values and notification
title/body text stay in English.

## Accounts

### Owners (full access, including payroll, compensation and the audit log)

| Name | Phone |
|---|---|
| سلمى منصور | `+972500000001` |
| إلياس رمضان | `+972500000002` |

### Field Managers (operations only — every financial route returns 403)

| Name | Phone | Notes |
|---|---|---|
| يوسف الخطيب | `+972500000011` | Also time-trackable (has a worker profile, can clock in) |
| رنا عودة | `+972500000012` | |

### Workers (mobile app: clock in/out, own shifts and history)

| Name | Phone | Pay | Notable seed data |
|---|---|---|---|
| خالد ناصر | `+972500010001` | Hourly | Day Turan assignment |
| محمود جبارين | `+972500010002` | Daily | Night Turan assignment + a completed emergency call-out |
| أنس دراوشة | `+972500010003` | Daily | Backup on the Night Turan |
| باسل عازر | `+972500010004` | Hourly | Temporary Supervisor (opened an expired temporary check-in point) |
| كريم حمدان | `+972500010005` | Daily | |
| وسيم عيسى | `+972500010006` | Daily | |
| فادي النجار | `+972500010007` | Hourly | Short day credited as a full day |
| مهند صالح | `+972500010008` | Daily | A time entry pending approval |
| زياد يونس | `+972500010009` | Daily | A rejected time entry |
| نادر مصالحة | `+972500010010` | Hourly | Three forgotten-stamp infractions (the third deducts ₪10) |
| رامي طه | `+972500010011` | Daily | Included in the finalized payroll period |
| إياد سعدي | `+972500010012` | Daily | |

Hourly workers are seeded at ₪55/hour, daily workers at ₪450/day.

## Two ways to log in

### 1. Test login (development / staging only)

When the API runs with `DEV_LOGIN_ENABLED=true` and `APP_ENV` set to
`development` or `staging` (the defaults in `apps/api/.env.example`):

- **Quick test login:** the web login page (`http://localhost:3001/login`) and
  the mobile login screen show a yellow **"TEST MODE — login without SMS"**
  banner and a list of every seeded user grouped into Owners, Field Managers
  and Workers. One click/tap signs you in. Behind the scenes this calls
  `GET /api/v1/auth/dev/users` and `POST /api/v1/auth/dev/login`
  (`{ "membershipId": "..." }`), which return exactly the same session as a
  normal OTP login and record a `DEV_LOGIN` audit event.
- **Fixed code:** the normal phone + code form also works with the code
  **`123456`** for every seeded phone number. No SMS is sent and you don't
  need to read the API console.

Workers are meant to use the mobile app. If you quick-login as a worker on
the web, you get a notice telling you to use the mobile app.

### 2. Real OTP (always available)

With dev login off (`DEV_LOGIN_ENABLED=false`, which is what production uses),
the login screens show only the phone + code form and the `/auth/dev/*`
endpoints answer 404:

- Locally, without Twilio credentials, the code is random and printed in the
  **API's console log** (look for `[DEV] OTP for *********0001: 123987`).
- With Twilio configured (`TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`,
  `TWILIO_VERIFY_SERVICE_SID`), a real SMS is sent through Twilio Verify.

`OTP_PROVIDER` (`console` | `twilio` | `dev-fixed`) can pin the provider
explicitly. `dev-fixed` is refused unless dev login mode is on, and while dev
login is on only `dev-fixed` is accepted, so the `123456` hint on the login
screens is always true.

## Safety rules

- `APP_ENV=production` together with `DEV_LOGIN_ENABLED=true` is refused at
  startup: the API exits with a configuration error.
- Dev login never changes permissions. A Field Manager signed in through
  quick login still gets 403 on every payroll, compensation and financial
  dashboard route (covered by an automated test).
- Turning dev login off ends every session that started through quick login or
  the fixed code: its access tokens are rejected immediately and its refresh
  token is revoked. Real OTP sessions keep working.
- Switching users on the web (sign out, then quick login as someone else)
  clears all cached data, so a Field Manager never sees an Owner's cached
  responses.
- Never enable dev login on a deployment that holds real data. Anyone who can
  reach that URL could sign in as any member.
