# Offline Attendance Sync

Implements spec section 20 end-to-end: backend (`apps/api/src/modules/devices`,
`apps/api/src/modules/offline-sync`) and mobile
(`apps/mobile/src/lib/device-key.ts`, `offline-queue.ts`,
`offline-sync-context.tsx`). Verified by 5 integration tests against a real
Postgres database with genuine Ed25519 cryptography
(`apps/api/test/offline-sync.e2e-spec.ts`) and by a real Metro/webpack
bundle of the mobile app resolving every new dependency (tweetnacl,
expo-crypto, netinfo) for the web target — see the verification note at the
end of this document for exactly what was and wasn't checked.

## Why signing, not just "trust the client"

A clock event captured offline might not reach the server for hours. By
the time it syncs, the server can no longer distinguish "this really
happened at 06:00 on this worker's phone" from "this was fabricated at
14:00 to look like it happened at 06:00" using server-received time alone
— the server-authoritative-time rule (spec 19.1) that protects *online*
events doesn't apply the same way here. The fix is a device-bound
signature: the phone signs the event with a private key that never leaves
its Keychain/Keystore, the server verifies against a public key registered
in advance, and a forged or replayed event fails verification regardless
of when it arrives.

## Cryptography

Ed25519 via `tweetnacl` (a compact, audited, pure-JavaScript
implementation with no native-module dependency, chosen so the *exact same
code path* runs on the API, in the mobile app, and in tests — see
"Canonicalization" below for why that matters). Key generation on-device
uses `expo-crypto`'s synchronous `getRandomBytes` as the entropy source
(tweetnacl has no ambient RNG on React Native, unlike Node or a browser, so
this must be threaded through explicitly via `nacl.setPRNG`-equivalent
seeding — see `generateOfflineSigningKeyPair` in
`packages/shared-validation/src/offline-sync.ts`).

The private key is generated once per device and stored via
`expo-secure-store` (Keychain/Keystore on native builds; falls back to
AsyncStorage on the web target only, for the same reason the session token
does — see `technical-decisions.md`). It never leaves the device and is
never transmitted.

## Canonicalization — the part that's easy to get subtly wrong

Both sides must sign/verify byte-identical data for the same logical
event. `canonicalizeOfflineEvent()`
(`packages/shared-validation/src/offline-sync.ts`) produces a
sorted-key JSON string of the event's signable fields, **dropping any key
whose value is `undefined`** but keeping explicit `null`/`false`.

This distinction mattered in practice: an early version of
`OfflineSyncService.processEvent` reconstructed the signable payload
server-side using `event.shiftId ?? null` (defaulting every optional field
to an explicit `null`/`false`), while the mobile signing code simply
omitted absent fields (leaving them genuinely `undefined`). Both objects
represented "the same event" logically, but produced different canonical
strings — `{"shiftId":null}` vs. no `shiftId` key at all — so **every
signature failed verification**. This was caught by the integration test
suite (not inspection) and fixed by making the server reconstruct the
payload the same way the client does: pass fields through as-is,
`undefined` and all, rather than defaulting them. See the comment block in
`offline-sync.service.ts` at the point of construction.

**Rule for any future field added to the signable payload**: never default
an absent optional field with `??` on either side. If a field wasn't sent,
leave it `undefined` on both the signing and verifying side.

## Protocol

1. **Registration** (once per device, idempotent, best-effort): mobile
   generates a keypair on first use, calls
   `POST /devices/public-key { deviceId, publicKey }`. Safe to call
   repeatedly — it's an upsert keyed on `(userId, deviceId)`. If the
   device is offline the first time this would run, key generation still
   succeeds locally (pure, no network call); registration is retried
   automatically the next time the sync engine runs while online.

2. **Local capture**: `ClockInScreen`/`ClockOutScreen` try the normal
   online request first. If the underlying `fetch` fails (a new
   `NetworkError` class in `@fieldmaster/api-client`, distinct from an
   `ApiRequestError`, which means the server *was* reached), the screen
   falls back to `queueOfflineEvent()`: sign the event with the device's
   private key, append it to the local queue, and show the worker a
   "queued — will sync automatically" receipt instead of a hard failure.

3. **Local queue** (`offline-queue.ts`): AsyncStorage-backed array of
   signed events, each carrying a `localStatus`
   (`PENDING`/`SYNCING`/`VERIFIED`/`FLAGGED`/`REJECTED`/`DUPLICATE`). Not
   SQLCipher-encrypted SQLite as the spec names — see
   `technical-decisions.md` for why, and note that the tamper-evidence
   property the spec actually cares about (a verifiable, unforgeable
   record) comes from the signature, not the local storage engine.

4. **Sync trigger**: `OfflineSyncProvider` watches `NetInfo` connectivity
   changes, retries on a 60-second interval as a fallback, and re-syncs on
   app foreground — a worker never has to remember to do anything.

5. **Batch submission**: `POST /offline-sync/batches { deviceId, events[]
   }` with an `Idempotency-Key` header. The server:
   - Sorts events by `deviceTimestamp` (not submission order) before
     processing, so a clock-in captured before a clock-out is always
     applied first even if the client happened to queue them differently.
   - For each event: confirms the device has a live (non-revoked)
     registered key → verifies the signature → checks
     `clock_events (device_id, client_event_id)` for a pre-existing match
     (→ `DUPLICATE`) → dispatches to the *same* `ClockEventsService.clockInCore`/
     `clockOutCore` the online endpoint uses, with `origin: OFFLINE`.
   - Returns a per-event outcome, never a single pass/fail for the batch.

6. **Authoritative timestamp**: for an `OFFLINE` event, the TimeEntry's
   `clockInAt`/`clockOutAt` is the **device's own timestamp**, not the
   server's receipt time — otherwise a worker who clocks in at 06:00 with
   no signal and syncs at 18:00 would be recorded as starting at 18:00,
   silently destroying their actual worked duration. `serverReceivedAt` is
   still stored on the `ClockEvent` row as a separate evidence field.
   Online events are unaffected (they still use server-received time as
   authoritative, per spec 19.1).

7. **Time-deviation handling**: `LocationValidationService` already
   distinguished `ONLINE` (rejects outright beyond 120s deviation) from
   `OFFLINE` (flags, never rejects) before this feature existed. In
   practice this means most offline events will show as `FLAGGED` for
   manager review once synced, since the gap between capture and sync
   routinely exceeds 120 seconds by design — that's expected, not a bug;
   the spec explicitly calls for flagging-for-review rather than blocking.

## Statuses

| Status | Meaning |
|---|---|
| `VERIFIED` | Signature valid, business rules passed, real `TimeEntry`/`ClockEvent` created |
| `FLAGGED` | Same as `VERIFIED`, but the location-validation status was `FLAGGED` (e.g. large device-time deviation) — needs manager review |
| `REJECTED` | Signature invalid, device key not registered/revoked, or the underlying business rule failed (e.g. shift already closed, no active entry to close) |
| `DUPLICATE` | This `(deviceId, clientEventId)` pair was already processed — safe retry, not double-applied |

## Conflict handling (spec 20.4)

Because offline events are dispatched through the exact same
`clockInCore`/`clockOutCore` logic as online ones, every conflict case
resolves deterministically using rules that already exist and are already
tested, rather than a parallel implementation:

- **Online clock-in after an offline one already synced** (or vice versa):
  the second one hits the existing "you already have an open clock-in"
  check → `REJECTED` with `ACTIVE_TIME_ENTRY_EXISTS`.
- **Two offline clock-outs for the same entry**: the second finds no
  `ACTIVE` entry left to close → `REJECTED` with `NO_ACTIVE_TIME_ENTRY`.
- **Worker deactivated / shift cancelled before sync**: a deactivated
  worker's request never reaches the offline-sync endpoint at all
  (`JwtAuthGuard` rejects it); a cancelled shift is rejected inside
  `clockInCore` (added specifically to close this gap — see
  `technical-decisions.md`/the shift-status check in
  `clock-events.service.ts`).
- **Clock-out timestamp earlier than clock-in**: rejected with
  `VALIDATION_FAILED`, same check the online path uses.
- **Device key revoked mid-flight**: an Owner-revoked key
  (`POST /devices/:userId/:deviceId/revoke-key`) makes every subsequent
  event from that device `REJECTED` with `DEVICE_KEY_NOT_REGISTERED`,
  tested explicitly.

All of this is preserved as evidence — an `OfflineSyncEvent` row is
persisted for every outcome, `REJECTED` included, never silently dropped.

## Verification performed this session

- 5 integration tests against a real Postgres database
  (`offline-sync.e2e-spec.ts`): full clock-in/out round trip using device
  timestamps as authoritative time; invalid-signature rejection creating
  no attendance record; unregistered-device rejection; duplicate
  detection on retry; Owner-revoked-key rejection.
- 4 unit tests of the crypto primitives themselves
  (`offline-sync-crypto.test.ts`): genuine keypair generation and
  signature verification, tamper detection (payload changed after
  signing), wrong-key rejection, malformed-input handling.
- `tsc --noEmit` and ESLint clean across `apps/mobile` with the new
  dependencies.
- A real Metro/webpack production-mode bundle of the mobile app for the
  web target succeeded (545 modules, no resolution errors), proving
  `tweetnacl`, `expo-crypto`'s web module, `@react-native-community/netinfo`'s
  web module, and the shared `@fieldmaster/shared-validation` package all
  resolve and bundle correctly.
- **Not verified**: an actual interactive offline→online transition on a
  real device or simulator (this environment has no browser-automation
  tool and no iOS Simulator — see `technical-decisions.md`). The backend
  protocol and crypto are proven correct by the integration tests above;
  what remains unverified is purely the on-device UX wiring (does
  `NetInfo` correctly report connectivity changes on a real phone, does
  the AsyncStorage-backed queue survive an app restart) — code that reads
  as straightforward but hasn't been exercised end-to-end on hardware.
