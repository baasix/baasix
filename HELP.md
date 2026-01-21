# Baasix Monorepo - Development Guide

This document contains information about the monorepo structure, development workflow, versioning, and publishing.

## Monorepo Structure

```
baasix-packages/
├── package.json              # Root workspace configuration
├── README.md                 # Main documentation (Baasix core)
├── HELP.md                   # This file - development guide
├── .gitignore                # Git ignore rules
├── .changeset/               # Changeset configuration
│   └── config.json
└── packages/
    ├── core/                 # @baasix/baasix - Main server
    ├── cli/                  # baasix - CLI tool
    ├── mcp/                  # @baasix/mcp
    └── sdk/                  # @baasix/sdk
└── plugins/
    └── stripe/               # @baasix/plugin-stripe
└── samples/
    └── sample/               # Sample project
```

## Packages Overview

| Package | npm Name | Description |
|---------|----------|-------------|
| [core](./packages/core) | `@baasix/baasix` | Main Baasix backend server |
| [cli](./packages/cli) | `baasix` | Command-line interface tool |
| [mcp](./packages/mcp) | `@baasix/mcp` | MCP server for AI assistants |
| [sdk](./packages/sdk) | `@baasix/sdk` | JavaScript/TypeScript SDK |
| [stripe](./plugins/stripe) | `@baasix/plugin-stripe` | Stripe payments plugin |

---

## Getting Started

### Prerequisites

- Node.js >= 18.0.0
- npm >= 7.0.0 (workspaces support required)

### Initial Setup

```bash
# Clone the repository
git clone https://github.com/baasix/baasix.git
cd baasix/baasix-packages

# Install all dependencies (hoisted to root)
npm install
```

### Build All Packages

```bash
npm run build
```

---

## Development

### Available Scripts

| Command | Description |
|---------|-------------|
| `npm run build` | Build all packages |
| `npm run build:core` | Build core server only |
| `npm run build:cli` | Build CLI only |
| `npm run build:mcp` | Build MCP server only |
| `npm run build:sdk` | Build SDK only |
| `npm run build:plugin-stripe` | Build Stripe plugin only |
| `npm run dev` | Run core server in dev mode |
| `npm run dev:core` | Run core server in dev mode |
| `npm run dev:cli` | Run CLI in dev mode |
| `npm run dev:mcp` | Run MCP server in dev mode |
| `npm run dev:sdk` | Run SDK in watch mode |
| `npm run test` | Run tests for core |
| `npm run test:core` | Run tests for core |
| `npm run typecheck` | Type check all packages |
| `npm run clean` | Clean all build outputs |
| `npm run clean:all` | Clean node_modules and dist |

### Working with Individual Packages

```bash
# Run any script in a specific package
npm run <script> -w <package-name>

# Examples
npm run build -w @baasix/baasix
npm run dev -w baasix
npm test -w @baasix/sdk
npm run build -w @baasix/plugin-stripe

# Install a dependency in a specific package
npm install <package> -w @baasix/baasix
npm install <package> --save-dev -w baasix
```

### Adding a New Package

1. Create package directory:
   ```bash
   mkdir packages/new-package
   cd packages/new-package
   ```

2. Create `package.json`:
   ```json
   {
     "name": "@baasix/baasix-new-package",
     "version": "0.1.0",
     "type": "module",
     "repository": {
       "type": "git",
       "url": "git+https://github.com/baasix/baasix.git",
       "directory": "packages/new-package"
     },
     "publishConfig": {
       "access": "public"
     }
   }
   ```

3. Run `npm install` from root to link the package

---

## Versioning with Changesets

We use [Changesets](https://github.com/changesets/changesets) for version management.

### Creating a Changeset

When you make changes that should be published:

```bash
npm run changeset
```

This will prompt you to:
1. **Select packages** - Choose which packages have changed
2. **Select bump type** - major, minor, or patch
3. **Write summary** - Describe the changes

### Bump Types

| Type | When to Use | Example |
|------|-------------|---------|
| **major** | Breaking changes | 1.0.0 → 2.0.0 |
| **minor** | New features (backwards compatible) | 1.0.0 → 1.1.0 |
| **patch** | Bug fixes (backwards compatible) | 1.0.0 → 1.0.1 |

### Applying Changesets (Version Bump)

Before publishing, apply all pending changesets:

```bash
npm run version:packages
```

This will:
- Update package versions in `package.json` files
- Update `CHANGELOG.md` in each package
- Remove processed changeset files

### Example Workflow

```bash
# 1. Make your changes to packages/sdk/src/...

# 2. Create a changeset
npm run changeset
# Select: @baasix/sdk
# Select: patch (bug fix)
# Summary: "Fixed auth token refresh logic"

# 3. Commit the changeset
git add .changeset/
git commit -m "chore: add changeset for SDK fix"

# 4. When ready to release, apply versions
npm run version:packages
git add .
git commit -m "chore: version packages"

# 5. Publish
npm run publish:all
```

---

## Publishing

### Prerequisites

1. Ensure you're logged in to npm:
   ```bash
   npm login
   ```

2. Ensure you have publish rights to all packages

### Publishing All Packages

```bash
# Build and publish all packages with pending changes
npm run publish:all
```

This runs `npm run build && changeset publish`, which:
1. Builds all packages
2. Publishes packages that have version changes
3. Creates git tags for each published version

### Publishing Individual Package

```bash
# Build specific package
npm run build:sdk

# Publish from package directory
cd packages/sdk
npm publish --access public
```

### Pre-release Versions

For alpha/beta releases:

```bash
# Enter pre-release mode
npx changeset pre enter alpha

# Create changesets as normal
npm run changeset

# Version (will create alpha versions)
npm run version:packages

# Publish
npm run publish:all

# Exit pre-release mode when done
npx changeset pre exit
```

---

## CI/CD Integration

### GitHub Actions Example

```yaml
name: Release

on:
  push:
    branches: [main]

jobs:
  release:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          registry-url: 'https://registry.npmjs.org'
      
      - run: npm ci
      
      - name: Create Release Pull Request or Publish
        uses: changesets/action@v1
        with:
          publish: npm run publish:all
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          NPM_TOKEN: ${{ secrets.NPM_TOKEN }}
```

---

## Troubleshooting

### Common Issues

**Dependencies not found after adding to a package:**
```bash
# Run from root to reinstall all
npm install
```

**Build errors in dependent package:**
```bash
# Build dependencies first
npm run build:core
npm run build:sdk
```

**Changeset not detecting changes:**
```bash
# Check git status
git status

# Ensure changes are committed or staged
git add .
npm run changeset
```

### Useful Commands

```bash
# List all workspaces
npm ls --workspaces

# Check what will be published
npm pack --dry-run -w @baasix/sdk

# View dependency tree
npm ls --all -w @baasix/baasix

# Clean and fresh install
npm run clean:all
npm install
```

---

## Package Dependencies

```
@baasix/baasix (core)
    └── (standalone - no internal deps)

baasix (cli)
    └── (standalone - no internal deps)

@baasix/mcp
    └── (standalone - connects to running baasix server)

@baasix/sdk
    └── (standalone - connects to running baasix server)

@baasix/plugin-stripe
    └── @baasix/baasix (peer dependency)
```

---

## Links

- **Documentation:** https://baasix.com/docs
- **GitHub:** https://github.com/baasix/baasix
- **npm:** https://www.npmjs.com/org/baasix
- **Issues:** https://github.com/baasix/baasix/issues
