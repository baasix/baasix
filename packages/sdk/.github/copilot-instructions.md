# Baasix SDK

This directory contains the official JavaScript/TypeScript SDK for Baasix.

## Structure

```
sdk/
├── src/
│   ├── index.ts           # Main entry point
│   ├── client.ts          # HTTP client with auth handling
│   ├── types.ts           # TypeScript type definitions
│   ├── storage/           # Storage adapters
│   │   ├── types.ts       # Storage interface
│   │   ├── localStorage.ts
│   │   ├── memoryStorage.ts
│   │   └── asyncStorage.ts
│   └── modules/           # Feature modules
│       ├── auth.ts        # Authentication
│       ├── items.ts       # CRUD operations
│       ├── files.ts       # File management
│       ├── schemas.ts     # Schema management
│       ├── notifications.ts
│       ├── permissions.ts
│       ├── settings.ts
│       ├── reports.ts
│       └── workflows.ts
├── package.json
├── tsconfig.json
├── tsup.config.ts
├── README.md
└── LICENSE
```

## Development

```bash
# Install dependencies
npm install

# Build
npm run build

# Watch mode
npm run dev

# Run tests
npm test

# Type check
npm run typecheck
```

## Publishing

```bash
# Build and publish
npm run prepublishOnly
npm publish
```
