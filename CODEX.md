# Repository map

- `apps/frontend`: React + TypeScript + Vite client.
- `apps/backend`: Node.js + TypeScript + Playwright remote-browser service; `server.ts` owns HTTP/WebSocket lifecycle.
- `packages/protocol`: Zod-backed shared WebSocket schemas and types.
- `compose.yaml`: local FE/BE development environment with Chromium sandboxing.

Use pnpm only. Common checks are `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`, and `pnpm test:integration`.
