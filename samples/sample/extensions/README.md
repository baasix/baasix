# Sample Extensions

This folder contains example extensions for Baasix.

## Hook Extensions

- `baasix-hook-example/` - Demonstrates hook patterns for CRUD operations

## Endpoint Extensions

- `baasix-endpoint-example/` - Demonstrates custom REST endpoint creation

## Creating Your Own Extensions

### Hook Extension

1. Create a folder: `extensions/baasix-hook-yourname/`
2. Create `index.js` with default export function
3. Register hooks using `hooksService.registerHook()`

### Endpoint Extension

1. Create a folder: `extensions/baasix-endpoint-yourname/`
2. Create `index.js` with default export object containing `id` and `handler`
3. Define routes using Express.js patterns

See the example extensions for detailed implementation patterns.
