# Email Verification Flow Fix — Design

**Date:** 2026-07-18
**Status:** Approved (conversational approval; approach chosen by user)

## Problem

With `REQUIRE_EMAIL_VERIFICATION=true`:

- `POST /auth/register` returns `requiresEmailVerification: true` with an **empty token** — no session.
- `POST /auth/login` rejects unverified users.
- The only endpoint that sends the verification email, `POST /auth/email/verify`, **requires an authenticated user**.

Result: a freshly registered user has no token, cannot log in, and cannot request the
verification email — a chicken-and-egg deadlock. The only workarounds today are magic
link (which auto-verifies) or admin intervention.

## Design

Two changes in `packages/core/baasix/auth/routes.ts`, following the existing
`POST /auth/magiclink` patterns (rate limiting, link validation, anti-enumeration).

### 1. Auto-send verification email on register

In the `POST /auth/register` handler, when `result.requiresEmailVerification` is true
and `options.mailService` is available:

- Resolve the app link: use `req.body.link` if it passes `isValidAppUrl()`, otherwise
  fall back to the first allowed app URL (`AUTH_APP_URL` first entry). If neither is
  available, skip sending and log a warning.
- Create a token via `auth.createEmailVerification(email)`.
- Send the built-in `emailVerification` template with
  `verifyUrl = ${link}/auth/verify-email/${token}`.
- Wrap send in try/catch: a mail failure is logged but does **not** fail registration
  (the user can use the resend endpoint). Same resilience philosophy as
  `sendWelcomeEmail`.
- **Fix:** destructure `link` out of `req.body` in the register handler — today it
  would flow into `...customFields` and be passed to `auth.signUp()` as a user field.

Response shape unchanged.

### 2. Unauthenticated resend endpoint

`POST /auth/email/verify/resend` — body `{ email, link }`:

- Guarded by the existing `authLimiter` (keyed by IP + email — brute-force safe).
- `400` if `email` missing or `link` fails `isValidAppUrl()`.
- Look up user by email. Send the verification email **only** if the user exists,
  has an email, and is not already verified.
- Always return the same generic `200` response:
  `"If an account exists for this email, a verification email has been sent."`
  — no account enumeration, mirroring the magiclink endpoint.

Existing endpoints unchanged: authenticated `POST /auth/email/verify` (in-app resend)
and `GET /auth/email/verify/:token` (consume token).

## Error handling

- Register: mail-send failure → log, registration still succeeds.
- Resend: mail-send failure inside the guarded block → bubbles to the route's catch →
  `next(error)` (consistent with magiclink; rate limiter bounds abuse).

## Testing

New `packages/core/test/emailVerificationFlow.test.js` (own jest invocation, per test
DB rules):

- Env set before import-time server start: `REQUIRE_EMAIL_VERIFICATION=true`,
  `AUTH_APP_URL=http://localhost:3000`.
- Spy on the MailService singleton's `sendMail` (the routes' `options.mailService`
  wrapper delegates to it) to capture the `verifyUrl`/token without SMTP.
- Cases:
  1. Register → `requiresEmailVerification: true`, no token, `sendMail` called with
     `emailVerification` template and a valid `verifyUrl`.
  2. Login before verification → rejected.
  3. `GET /auth/email/verify/:token` with captured token → verified; login now works.
  4. Resend for unknown email → generic 200, no `sendMail` call.
  5. Resend for unverified user → generic 200, `sendMail` called.
  6. Resend with non-allow-listed `link` → 400.
  7. Register still succeeds (200) when `sendMail` rejects.

## Addendum (same day): unification, cooldown, seeded admin, OpenAPI

- **Unified endpoint:** `POST /auth/email/verify/resend` now serves both auth states.
  Authenticated: session user's email is used (body `email` ignored), responses are
  specific ("Email already verified", 429 on cooldown). Unauthenticated: unchanged
  generic response. `POST /auth/email/verify` is kept as a legacy authenticated
  alias sharing the same send helper.
- **Per-email cooldown:** `EMAIL_VERIFICATION_RESEND_COOLDOWN` (seconds, default 60,
  0 disables), enforced in `sendVerificationEmail` via the system cache. Set only
  after a successful send (a mail failure doesn't lock out retry). Counts the
  register auto-send. Unauthenticated callers in cooldown still get the generic 200
  (a distinct response would confirm account existence); authenticated callers get
  429. Rationale: the IP-keyed authLimiter can't stop distributed inbox flooding.
- **Seeded admin fix:** `admin@baasix.com` is now seeded with `emailVerified: true` —
  previously `REQUIRE_EMAIL_VERIFICATION=true` locked the admin out of a fresh
  install (no mail sender configured yet to verify with).
- **OpenAPI:** the three email-verification endpoints added to the spec
  (`OPENAPI_INCLUDE_AUTH=true`), with `EmailVerifyRequest` / `EmailVerifyResendRequest`
  schemas.

## Out of scope / follow-ups

- SDK helper for the resend endpoint (`@baasix/sdk` publishes separately — add before
  next publish).
- Admin UI surface for resending verification emails.
