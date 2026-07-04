#!/usr/bin/env node
/**
 * Hearth hub — the edge-agent client you run on your always-on machine.
 *
 * This is the software the on-prem hub (a Raspberry Pi, a spare laptop, a mini PC)
 * runs to pair with your Hearth account and stay online. It:
 *   1. On first run, mints a secret enrollment token and POSTs /hub/enroll.
 *   2. Prints a CLAIM CODE for you to type into the dashboard's "Connect a hub" card.
 *   3. Polls /hub/poll until you claim it, then stores the returned hub token.
 *   4. Heartbeats /hub/heartbeat every 30s so the dashboard shows it online.
 *
 * Identity (the enroll token + hub id + hub token) persists to ~/.hearth/hub-state.json
 * so the hub keeps its identity across restarts — re-running does NOT re-enroll an
 * already-paired hub. It runs forever in the foreground; wrap it in a service manager
 * (systemd, launchd, pm2, `nohup … &`) to keep it alive as a daemon.
 *
 * Zero dependencies (Node 18+ global fetch). Usage:
 *   node hearth-hub.mjs                                   # pair with Hearth Cloud
 *   HUB_NAME="Kitchen Pi" node hearth-hub.mjs             # custom display name
 *   BACKEND_URL=http://localhost:9000 node hearth-hub.mjs # point at a local backend (dev)
 *   node hearth-hub.mjs --reset                           # forget identity and enroll fresh
 */

import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { homedir, hostname } from 'node:os';
import { dirname, join } from 'node:path';

// Hearth Cloud (the platform backend on Alibaba Function Compute). Override for local dev.
const DEFAULT_BACKEND = 'https://hearth-mcp-gqfuhlkzpo.ap-southeast-1.fcapp.run';
const BACKEND_URL = (process.env.BACKEND_URL || DEFAULT_BACKEND).replace(/\/$/, '');
const HUB_NAME = process.env.HUB_NAME || hostname() || 'Hearth hub';
const FW = process.env.HUB_FW || 'hearth-hub/0.1.0';
const STATE_DIR = process.env.HEARTH_HOME || join(homedir(), '.hearth');
const STATE_FILE = process.env.HUB_STATE_FILE || join(STATE_DIR, 'hub-state.json');
const POLL_MS = 3000;
const HEARTBEAT_MS = 30_000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function loadState() {
  if (process.argv.includes('--reset')) return {};
  if (existsSync(STATE_FILE)) {
    try {
      return JSON.parse(readFileSync(STATE_FILE, 'utf8'));
    } catch {
      /* corrupt → fresh */
    }
  }
  return {};
}

function saveState(state) {
  mkdirSync(dirname(STATE_FILE), { recursive: true });
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

async function api(path, body, token) {
  const res = await fetch(`${BACKEND_URL}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

async function enroll(state) {
  state.enrollToken = randomBytes(32).toString('hex');
  const { ok, data } = await api('/hub/enroll', { enrollToken: state.enrollToken, name: HUB_NAME, fw: FW });
  if (!ok) throw new Error(`enroll failed: ${data.error || 'unknown error'}`);
  state.hubId = data.hubId;
  saveState(state);
  console.log('\n  ┌─────────────────────────────────────────────┐');
  console.log('  │  Enter this code in the dashboard to pair:    │');
  console.log(`  │                                               │`);
  console.log(`  │            >>>   ${data.claimCode}   <<<            │`);
  console.log('  │                                               │');
  console.log('  └─────────────────────────────────────────────┘\n');
  console.log('  Open your Hearth dashboard → "Connect a hub" and enter the code above.');
  console.log(`  (code expires in ~15 min; hub id ${data.hubId})\n`);
}

async function waitForClaim(state) {
  console.log('  Waiting to be claimed…');
  for (;;) {
    const { ok, data } = await api('/hub/poll', { hubId: state.hubId, enrollToken: state.enrollToken });
    if (ok && data.status === 'claimed' && data.hubToken) {
      state.hubToken = data.hubToken;
      state.accountId = data.accountId;
      saveState(state);
      console.log(`\n  ✓ Paired to account ${data.accountId}. Now heartbeating.\n`);
      return;
    }
    if (!ok) {
      // enrollment token rejected → our identity is stale; re-enroll.
      console.log(`  Poll rejected (${data.error || 'unknown'}) — re-enrolling.`);
      await enroll(state);
    }
    await sleep(POLL_MS);
  }
}

async function heartbeatLoop(state) {
  for (;;) {
    const { ok, data } = await api('/hub/heartbeat', { fw: FW }, state.hubToken);
    if (ok) {
      console.log(`  ♥ heartbeat ok  ${new Date().toISOString()}`);
    } else {
      // Unpaired or token invalid → drop identity and re-pair from scratch.
      console.log(`  heartbeat rejected (${data.error || 'unknown'}) — this hub was unpaired. Re-enrolling.\n`);
      delete state.hubToken;
      delete state.accountId;
      saveState(state);
      await enroll(state);
      await waitForClaim(state);
    }
    await sleep(HEARTBEAT_MS);
  }
}

async function main() {
  console.log(`[hearth-hub] backend ${BACKEND_URL}  name "${HUB_NAME}"  state ${STATE_FILE}`);
  const state = loadState();
  if (!state.hubId || !state.enrollToken) await enroll(state);
  if (!state.hubToken) await waitForClaim(state);
  else console.log(`  Already paired (hub ${state.hubId}). Heartbeating.\n`);
  await heartbeatLoop(state);
}

main().catch((e) => {
  console.error(`[hearth-hub] fatal: ${e.message}`);
  process.exit(1);
});
