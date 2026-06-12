# @baasix/mcp

## 0.2.0

### Minor Changes

- **Page-builder tools (9 new tools):** `baasix_list_pages`, `baasix_get_page`, `baasix_create_page`, `baasix_update_page`, `baasix_delete_page`, `baasix_create_block`, `baasix_update_block`, `baasix_delete_block`, `baasix_validate_block_config`. Block create/update configs are validated server-side by `BlockConfigService`. Total tools: 69.
- **MCP resources capability:** exposes `baasix://docs/block-config` — live-fetched from the connected server's `GET /pages/block-config-doc`; covers block types, per-type config schemas, position grid, and filter DSL. Requires a Baasix core server that exposes that endpoint.
- **Improved API error messages:** nested `{error:{message}}` response bodies are now surfaced in tool error output instead of a generic failure.
- **Allowlisted page/block payloads:** page create/update and block create/update fields are explicitly allowlisted before forwarding to the API.

## 0.1.11

### Patch Changes

- Security audit and found issues fixed.

## 0.1.10

### Patch Changes

- Added tenant scoping as setting in schema definition itself.

## 0.1.9

### Patch Changes

- Fixed soft deleted related issues and added MCP tool to restore it.

## 0.1.8

### Patch Changes

- Added new MCP tools and Optimised permission import time.

## 0.1.7

### Patch Changes

- Added new dynamic variables CURRENT_TENANT and CURRENT_SETTINGS

## 0.1.6

### Patch Changes

- MCP: Add clear tool explanation for schema updation.

## 0.1.5

### Patch Changes

- Fixed MCP tool definition more LLM friendly.

## 0.1.4

### Patch Changes

- Fixed minor bugs and new email template editor.

## 0.1.3

### Patch Changes

- Updated documentation

## 0.1.2

### Patch Changes

- Remote MCP added
- Easy MCP access

## 0.1.1

### Patch Changes

- Updated to new monorepo structure.
