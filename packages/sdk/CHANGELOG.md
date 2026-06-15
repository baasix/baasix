# @baasix/sdk

## 0.1.19

### Patch Changes

- Pre-production version of internal app builder added.

## 0.1.18

### Patch Changes

- Security audit and found issues fixed.
- Updated dependencies
  - @baasix/types@1.0.8

## 0.1.17

### Patch Changes

- Added tenant scoping as setting in schema definition itself.
- Updated dependencies
  - @baasix/types@1.0.6

## 0.1.16

### Patch Changes

- Fixed soft deleted related issues and added MCP tool to restore it.

## 0.1.15

### Patch Changes

- Updated types package

## 0.1.14

### Patch Changes

- Added new dynamic variables CURRENT_TENANT and CURRENT_SETTINGS

## 0.1.13

### Patch Changes

- Adding format support to assetservice

## 0.1.12

### Patch Changes

- Fixed distinct function missing groupby passed to it.

## 0.1.11

### Patch Changes

- Add Room listing option

## 0.1.10

### Patch Changes

- REDIS support added for rooms to support multiple instances.

## 0.1.9

### Patch Changes

- Added metadata options for members in room.

## 0.1.8

### Patch Changes

- Added more realtime options - Room host options

## 0.1.7

### Patch Changes

- Added workflow and settings related functions

## 0.1.6

### Patch Changes

- Fixed refresh api not working with cookie mode

## 0.1.5

### Patch Changes

- Added support for authType in SDK.
- Updated dependencies
  - @baasix/types@1.0.3

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
