# PacifiQuant

PacifiQuant is a Pacifica-first perpetual trading app built for the Pacifica
Hackathon.

The repo is intentionally trimmed to two surfaces:

- `/strategies` for funding spread discovery, sizing, and strategy execution
- `/perp` for direct perpetual trading across Pacifica, Hyperliquid, Lighter,
  and Aster

The root route redirects to `/strategies`.

## Scope

- Pacifica is the anchor venue for both scanning and execution
- Funding history is surfaced in `24H`, `7D`, and `30D` windows
- Arb sizing is capped by live exchange balances
- Delta-neutral flow is modeled as Hyperliquid spot + Pacifica perp

## Repo Layout

```text
apps/web            Next.js frontend
packages/core       Perp adapters, strategy logic, shared runtime types
packages/react      Shared React auth and store layer
packages/wasm-crypto Local WASM helper used by the frontend
```

There is no active backend app in this trimmed repo.

## Stack

- Next.js 13.5
- TypeScript
- Tailwind CSS
- TanStack Query
- Zustand
- Privy
- RainbowKit / Wagmi / Viem
- `@hq/core` and `@hq/react`

## Development

- Node.js 20+
- `pnpm` 10+

```bash
pnpm install
pnpm dev
pnpm build
pnpm typecheck
```

Default frontend port is `3002`.

To run the frontend on `3003`:

```bash
pnpm --dir apps/web exec next dev -p 3003
```
