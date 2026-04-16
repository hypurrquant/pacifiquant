# PacifiQuant Workspace

## Scope

PacifiQuant is a Pacifica-first perpetual trading app built for the Pacifica
Hackathon.

The active product surface is intentionally narrow:

- `/strategies` for funding spread discovery, arb execution, and monitoring
- `/perp` for direct perpetual trading with Pacifica-centered execution flows

The root route redirects to `/strategies`.

## Active Workspace

Only these workspace packages are active:

```text
/ (pnpm workspace)
├── apps/
│   └── web/
└── packages/
    ├── core/
    └── react/
```

Legacy directories can remain in the repo, but they are not part of the active
hackathon build unless explicitly reintroduced.

## Commands

```bash
pnpm install
pnpm dev
pnpm build
pnpm typecheck
```

- `pnpm dev` runs the web app
- `pnpm typecheck` must stay `tsc --noEmit`

## Guardrails

- Use `pnpm`
- User-facing UI text must be English
- User-facing errors and notifications must be English
- Do not run `tsc` without `--noEmit`
- Do not commit `.env.local`
- Do not expose secrets with `NEXT_PUBLIC_*`
- Do not kill existing processes on ports `3002` or `3003`
- Do not commit or push unless explicitly asked

## Product Notes

- Pacifica is the primary venue in both app surfaces
- Strategy sizing should respect real exchange balances and execution limits
- Delta Neutral uses a Pacifica perp leg, not a Pacifica spot leg
- Funding history should prioritize meaningful real spread history over empty
  placeholder windows

## Key Paths

- `apps/web/src/app/strategies/page.tsx`
- `apps/web/src/app/perp/page.tsx`
- `packages/core/defi/perp`
- `README.md`
