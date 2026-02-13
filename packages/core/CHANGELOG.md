# @baasix/baasix

## 0.1.30

### Patch Changes

- Admin app performance improvements

## 0.1.29

### Patch Changes

- Fixed nested permission checks missing issue.

## 0.1.28

### Patch Changes

- Fixed MCP tool definition more LLM friendly.

## 0.1.27

### Patch Changes

- Added MCP to support all roles.

## 0.1.26

### Patch Changes

- Added zod direct dependency needed for remote MCP

## 0.1.25

### Patch Changes

- Fixed public role having tenant specific enabled by default

## 0.1.24

### Patch Changes

- Fixed non-tenant specific roles access issues.

## 0.1.23

### Patch Changes

- Fixed email templete double header issue

## 0.1.22

### Patch Changes

- Fixed tenant sent in query for csv and json imports.

## 0.1.21

### Patch Changes

- Minor app fixes

## 0.1.20

### Patch Changes

- Added missing tenant selection in import sheets.

## 0.1.19

### Patch Changes

- Fixed sort issue with hasmany fields.

## 0.1.18

### Patch Changes

- Fixed minor bugs and new email template editor.

## 0.1.17

### Patch Changes

- Removed juice

## 0.1.16

### Patch Changes

- Fixed missing accountability fields

## 0.1.15

### Patch Changes

- Added support for custom fields in registeration

## 0.1.14

### Patch Changes

- Fixed date type mismatch issue.

## 0.1.13

### Patch Changes

- Security vulnerability fixed for invalid readone dats

## 0.1.12

### Patch Changes

- Fixed logo issues

## 0.1.11

### Patch Changes

- Fix for multiple body tags in email.

## 0.1.10

### Patch Changes

- Exported more utils and added html wrapper for emails.

## 0.1.9

### Patch Changes

- Fixed mail template adding header and footer by default issue

## 0.1.8

### Patch Changes

- Fixed `/auth/me` response format to return `{ user: ... }` instead of `{ data: ... }` for backwards compatibility with existing code and tests.

## 0.1.7

### Patch Changes

- Added new features and fixes:

  **New Features:**

  - Added `POST /auth/refresh` endpoint for token refresh
  - Added automatic log cleanup service for audit logs and email logs
    - `AUDIT_LOG_CLEANUP_ENABLED` / `AUDIT_LOG_RETENTION_DAYS` env vars
    - `EMAIL_LOG_CLEANUP_ENABLED` / `EMAIL_LOG_RETENTION_DAYS` env vars
    - Manual trigger via `triggerLogCleanup()` utility function

  **Fixes:**

  - Fixed `GET /auth/me` response format to return `{ data: user }` for SDK compatibility

## 0.1.6

### Patch Changes

- Updated documentation

## 0.1.5

### Patch Changes

- Fix package build order and dependencies

  - Add @baasix/types as explicit dependency to @baasix/plugin-stripe
  - Change core's @baasix/types dependency from file:../types to \* for proper workspace resolution
  - Update build script to ensure @baasix/types builds first before dependent packages

## 0.1.4

### Patch Changes

- Remote MCP added
- Easy MCP access

## 0.1.3

### Patch Changes

- Fixed image path in npm package readme.

## 0.1.2

### Patch Changes

- Fixed image path in npm package.

## 0.1.1

### Patch Changes

- Updated to new monorepo structure.
