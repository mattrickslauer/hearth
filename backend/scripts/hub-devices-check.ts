/**
 * Proves two hubs reporting the SAME node id don't produce duplicate capabilities, and that
 * unpairing a hub actually forgets its devices. Exits non-zero if either regresses.
 *
 *   npm run hub-devices-check
 *
 * Why this matters: node ids are only unique *within* a hub — every hub's camera self-describes
 * as `hub-cam` by default — so the moment an account has two hub snapshots (a re-enrolled hub
 * leaves its old one behind), both claim `hub-cam.cam.frame`. That reached the dashboard as two
 * React children with the same key, and reached Qwen as the same camera listed twice.
 *
 * Runs against the in-memory store: no cloud creds, no cleanup.
 */
import { MemoryStore, type HubDeviceSnapshot } from '../src/store';

const fail = (m: string) => {
  console.error(`FAIL — ${m}`);
  process.exit(1);
};

const snap = (hubId: string, syncedAt: number, label: string): HubDeviceSnapshot => ({
  hubId,
  hubName: label,
  nodes: [
    {
      id: 'hub-cam',
      board: 'hub/obs-camera',
      online: true,
      lastSeen: syncedAt,
      sensors: [{ key: 'cam.frame', kind: 'camera', vision: true }],
      actuators: [],
      readings: { 'cam.frame': null },
    },
  ],
  syncedAt,
});

const store = new MemoryStore();

// The orphan: an older hubId this box enrolled under before, never cleaned up.
await store.putHubDevices(snap('hub-old-1', 1_000, 'ghost'));
// The hub actually plugged in right now, reporting the same default node id.
await store.putHubDevices(snap('hub-new-2', 2_000, 'live'));

// 1. capabilities must be unique by id
const home = await store.describeHome();
const camCaps = home.capabilities.filter((c) => c.id === 'hub-cam.cam.frame');
if (camCaps.length !== 1) fail(`expected 1 capability for hub-cam.cam.frame, got ${camCaps.length} (duplicate React key)`);

// 2. the freshest hub owns the contested id — the ghost must not shadow the live camera
if (!camCaps[0].describes?.includes('live')) fail(`stale hub won the id: ${camCaps[0].describes}`);

// 3. nodes must be unique too
const camNodes = home.nodes.filter((n) => n.id === 'hub-cam');
if (camNodes.length !== 1) fail(`expected 1 node hub-cam, got ${camNodes.length}`);

// 4. listInputs (what Qwen sees when authoring) must not list the camera twice
const inputs = await store.listInputs('sensor');
if (inputs.filter((c) => c.id === 'hub-cam.cam.frame').length !== 1) fail('listInputs returned the camera twice');

// 5. unpairing forgets the devices, rather than haunting the Home Model forever
if (!(await store.deleteHubDevices('hub-old-1'))) fail('deleteHubDevices reported nothing to delete');
if ((await store.listHubDevices()).some((s) => s.hubId === 'hub-old-1')) fail('unpaired hub still has devices');
if (await store.deleteHubDevices('hub-old-1')) fail('deleting an already-deleted hub should report false');

// 6. with the ghost gone the live camera survives, still exactly once
const after = await store.describeHome();
if (after.capabilities.filter((c) => c.id === 'hub-cam.cam.frame').length !== 1) fail('live camera lost or duplicated after unpair');

console.log('PASS — one capability per id across hubs, freshest hub wins, unpair forgets devices.');
