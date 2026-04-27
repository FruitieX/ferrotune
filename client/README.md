# Ferrotune web client

The Ferrotune web client is a Vite 8 + React 19 application using React Router, Tailwind CSS, Jotai, and TanStack Query.

## Development

```bash
pnpm install
pnpm run dev
```

The development server runs on [http://localhost:3000](http://localhost:3000) and proxies `/ferrotune` and `/rest` requests to the backend on port 4040.

## Build

```bash
pnpm run build
pnpm run start
```

Production assets are emitted to `out/`, which is also the directory embedded by the Tauri and backend static UI builds.
