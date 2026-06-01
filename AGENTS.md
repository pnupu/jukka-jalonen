# Project Agent Instructions

## Runtime

- Use Bun as the runtime and package manager.
- Prefer `bun install`, `bun run dev`, and `bun run typecheck`.

## Validation

- Run `bun run typecheck` after TypeScript edits.
- Do not commit `.env`, calendar credentials, Discord tokens, or generated runtime state under `data/*.json`.

## Deployment

- This bot is intended to run on the same Raspberry Pi as Eppu Normaali, but it should stay a separate service with its own Discord token and environment file.
