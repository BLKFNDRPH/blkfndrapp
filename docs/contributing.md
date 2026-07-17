# Contributing to blkfndr

## Development Setup

### Prerequisites

- **Node.js** 20+
- **npm** 10+
- **Stellar Freighter** browser extension
- **MongoDB** (local or Atlas)
- **Git**

### Getting Started

```bash
# 1. Fork the repository
# https://github.com/tmdc-it-solutions/blkfndr/fork

# 2. Clone your fork
git clone https://github.com/YOUR_USERNAME/blkfndr.git
cd blkfndr

# 3. Add upstream remote
git remote add upstream https://github.com/tmdc-it-solutions/blkfndr.git

# 4. Install dependencies
npm install

# 5. Set up environment variables
cp .env.example .env.local
# Edit .env.local with your configuration

# 6. Start development server
npm run dev
```

The app runs on **http://localhost:9002**.

### Environment Setup

See the [README](../README.md#environment-variables) for a complete list of required environment variables.

For local development, you'll need:
- A Stellar Testnet account (funded via [Friendbot](https://laboratory.stellar.org/#account-creator?network=test))
- A Pinata account for IPFS uploads
- A Google AI API key for Genkit features
- A MongoDB instance (local or Atlas free tier)

---

## Code Style

### TypeScript

- **Strict mode** enabled (`tsconfig.json`)
- All new code must pass `npm run typecheck`
- Prefer explicit types over inference for function signatures
- Use the shared types from `src/lib/types.ts`

### Linting & Formatting

```bash
# Run ESLint
npm run lint

# Run TypeScript type checking
npm run typecheck
```

Both must pass before submitting a PR.

### Component Patterns

- Use **shadcn/ui** components from `src/components/ui/`
- Follow the existing pattern of separating server and client components
- Server actions should be in `src/actions/` or co-located with their page
- Use React Context providers for global state (auth, blockchain data, currency)

### File Naming

| Type | Convention | Example |
|---|---|---|
| Components | PascalCase | `ProjectList.tsx` |
| Utilities | kebab-case | `pinata-client.ts` |
| Types | kebab-case | `graphql-types.ts` |
| Pages | kebab-case directories | `create-listing/` |

### Imports

- Use `@/` path alias for all internal imports
- Group imports: React/Next → Third-party → Internal → Types
- Example:
  ```typescript
  import { useState, useEffect } from 'react';
  import { useRouter } from 'next/navigation';
  import { SorobanRpc } from '@stellar/stellar-sdk';
  import { ProjectList } from '@/components/project/ProjectList';
  import type { Project } from '@/lib/types';
  ```

---

## Project Architecture

Before contributing, read the [Architecture](architecture.md) document to understand:
- System design and data flow
- Layer responsibilities (frontend, contracts, data, AI)
- Directory structure

Key areas:
- **`src/lib/contract.ts`** — Soroban contract interactions
- **`src/lib/data.ts`** — Server-side data layer
- **`src/ai/flows/`** — Genkit AI flow definitions
- **`src/context/`** — React Context providers
- **`blkfndr/sources/`** — Soroban smart contracts (Rust)

---

## Pull Request Process

### 1. Create a Feature Branch

```bash
git checkout -b feat/my-feature
# or
git checkout -b fix/my-bugfix
```

Branch naming conventions:
- `feat/` — New features
- `fix/` — Bug fixes
- `docs/` — Documentation changes
- `refactor/` — Code restructuring
- `chore/` — Maintenance tasks

### 2. Make Your Changes

- Keep changes focused and atomic
- Write clear, descriptive commit messages
- Follow the code style guidelines above

### 3. Test Your Changes

```bash
# Type checking
npm run typecheck

# Linting
npm run lint

# Build check
npm run build
```

### 4. Submit a Pull Request

1. Push your branch to your fork
2. Open a PR against `tmdc-it-solutions/blkfndr:main`
3. Fill out the PR template completely
4. Link any related issues
5. Request review from a maintainer

### 5. Code Review

- At least one approving review is required
- Address all review comments
- Keep the PR updated with `main` if there are conflicts

---

## Commit Convention

We follow a simplified conventional commits format:

```
<type>: <description>
```

| Type | Usage |
|---|---|
| `feat` | New feature |
| `fix` | Bug fix |
| `docs` | Documentation only |
| `refactor` | Code change that neither fixes a bug nor adds a feature |
| `chore` | Maintenance, dependencies, build config |
| `style` | Formatting, missing semicolons, etc. |
| `test` | Adding or updating tests |

**Examples:**
```
feat: add multi-sig withdrawal approval flow
fix: prevent double-funding of expired projects
docs: update API reference with Horizon endpoints
refactor: extract transaction building to shared utility
```

---

## Smart Contract Development

### Prerequisites

- Rust toolchain with `wasm32-unknown-unknown` target
- Soroban CLI

### Building Contracts

```bash
cd blkfndr
soroban contract build
```

### Testing Contracts

```bash
cargo test
```

### Contract Guidelines

- Follow Rust best practices and idioms
- Document all public functions with doc comments
- Include error handling for all edge cases
- Test both success and failure paths
- Keep contract storage minimal — store only essential data on-chain

---

## AI Flow Development

### Adding a New Flow

1. Create a new file in `src/ai/flows/`
2. Define input/output schemas using Zod
3. Define the prompt using `ai.definePrompt()`
4. Define the flow using `ai.defineFlow()`
5. Export a convenience function

See [AI Features](ai-features.md) for detailed examples and the existing `improveListingQuality` flow as a reference.

### Testing Flows

```bash
# Start Genkit developer UI
npm run genkit:dev
```

Use the Genkit UI to test flows with custom inputs before integrating them into the application.

---

## Getting Help

- **Documentation**: Start with the [docs/](../) directory
- **Architecture questions**: Refer to [architecture.md](architecture.md)
- **Contract questions**: Refer to [smart-contracts.md](smart-contracts.md)
- **Issues**: Check existing [GitHub Issues](https://github.com/tmdc-it-solutions/blkfndr/issues)
- **Discussions**: Use [GitHub Discussions](https://github.com/tmdc-it-solutions/blkfndr/discussions) for questions

---

## Code of Conduct

- Be respectful and inclusive in all interactions
- Provide constructive feedback in code reviews
- Focus on the code, not the person
- Help others learn and grow