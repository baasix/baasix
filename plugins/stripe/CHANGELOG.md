# @baasix/plugin-stripe

## 0.1.2

### Patch Changes

- Fix package build order and dependencies

  - Add @baasix/types as explicit dependency to @baasix/plugin-stripe
  - Change core's @baasix/types dependency from file:../types to \* for proper workspace resolution
  - Update build script to ensure @baasix/types builds first before dependent packages

- Updated dependencies
  - @baasix/baasix@0.1.5

## 0.1.1

### Patch Changes

- Updated to new monorepo structure.
- Updated dependencies
  - @baasix/baasix@0.1.1
