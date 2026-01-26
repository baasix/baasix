# @baasix/sdk

## 0.1.4

### Patch Changes

- Fixed `/auth/me` response format to return `{ user: ... }` instead of `{ data: ... }` for backwards compatibility with existing code and tests.

## 0.1.3

### Patch Changes

- Fixed auth module endpoint URLs to match API routes:
  - `forgotPassword()`: `/auth/forgot-password` → `/auth/password/reset`
  - `resetPassword()`: `/auth/reset-password` → `/auth/password/reset/:token`
  - `changePassword()`: `/auth/change-password` → `/auth/password/change`
  - `requestEmailVerification()`: `/auth/request-verify-email` → `/auth/email/verify`
  - `verifyEmail()`: `/auth/verify-email` → `/auth/email/verify/:token`
  - `verifyInvite()`: Fixed path parameter format
  - `checkSession()`: Fixed response parsing
  - `getTenants()`: Fixed response parsing
  - `acceptInvite()`: Fixed request body field name
  - Removed `updateProfile()` method (no API endpoint)

## 0.1.2

### Patch Changes

- Reorganize types and update documentation

  - @baasix/types: Reorganize types by domain (spatial.ts, cache.ts), move query/file types to appropriate modules
  - @baasix/sdk: Update README with shared types documentation

- Updated dependencies
  - @baasix/types@1.0.1

## 0.1.1

### Patch Changes

- Updated to new monorepo structure.
