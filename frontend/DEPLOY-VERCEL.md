# Deploying the Hearth frontend to Vercel

The app is an **Expo Router** web app with **server output** (`app.json` → `web.output: "server"`),
so it needs Vercel **Functions**, not just static hosting — pages are server-rendered.

Vercel holds **no secrets**. The Qwen key lives only on Function Compute
(`backend/src/qwen.ts`); the browser reaches the brain through the backend's `/qwen`, which
requires a session. Vercel just serves the app.

`vercel.json` + `api/index.ts` (both in this `frontend/` dir) wire that up per Expo's
[official Vercel recipe](https://docs.expo.dev/router/web/api-routes/#vercel) for SDK 54+:

- **build** `expo export -p web` → emits `dist/client` (static, served automatically)
  and `dist/server` (the route/SSR bundle).
- **`api/index.ts`** wraps `dist/server` with `expo-server/adapter/vercel` (ships with
  Expo Router as `expo-server@57`; no extra install). `vercel.json` packages `dist/server/**`
  into that function and rewrites every request to it.

## Why the current `hearth-ag-farms.vercel.app` 404s

This repo is a **monorepo** (`backend/` + `frontend/` + `hub/` + `firmware/`). If the
Vercel project's **Root Directory** is the repo root, there's no app there to build or
serve → `NOT_FOUND`. The fix is one project setting plus these committed config files.

## Go-live checklist (Vercel dashboard — needs account access)

1. **Project → Settings → General → Root Directory = `frontend`.** (The single most
   likely cause of the 404.)
2. **Framework Preset:** Other / None — `vercel.json` drives the build; don't let the
   Expo preset override it.
3. **Settings → Environment Variables:**
   | Var | Scope | Value |
   |-----|-------|-------|
   | `EXPO_PUBLIC_USE_QWEN` | Build | `1` to route the demo brain at the backend's `/qwen` (else in-browser mock) |
   | `EXPO_PUBLIC_BACKEND_URL` | Build | optional — defaults to the deployed FC backend |
   `EXPO_PUBLIC_*` are inlined at build time. **No `QWEN_API_KEY` here** — the key belongs to
   Function Compute only (`backend/s.yaml`). If one is still set on Vercel from an older
   deploy, delete it: nothing reads it now.
4. **Redeploy** (push to the connected branch, or `vercel --prod`).

## Verifying

- `GET /` → the app loads (sign-in / dashboard).
- Signed in with `EXPO_PUBLIC_USE_QWEN=1`, a `/demo` wish returns `engine: "qwen"`; signed out
  it returns `engine: "mock"`. Both come from the backend's `/qwen` on Function Compute.
- Sign-in flow hits the FC backend at `EXPO_PUBLIC_BACKEND_URL` (default: the deployed
  Function Compute URL) for OTP.
