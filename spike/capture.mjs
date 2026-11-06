#!/usr/bin/env node
// Capture spike (2026-11-04): drive a React Native on-device Storybook running in an iOS simulator and
// screenshot every story.
//
// Run from the consumer project's root (the Storybook index builder reads process.cwd()):
//   cd ../the pilot app && node ../targus/spike/capture.mjs --udid <UDID> --app <path.app> --out <dir>
//
// What it proves: the Storybook RN websocket channel can select stories from the host, the
// app reports when each story has rendered, and `simctl io screenshot` captures it. It also
// measures seconds per story and flags stories whose two back-to-back captures differ.

import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { promisify } from 'node:util';
import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';

const execFileAsync = promisify(execFile);
const projectRoot = process.cwd();
// Resolve Storybook and ws from the consumer project so the server speaks the same protocol
// version as the app bundle.
const projectRequire = createRequire(path.join(projectRoot, 'package.json'));
const { createChannelServer, buildIndex } = projectRequire('@storybook/react-native/node');

const args = parseArgs(process.argv.slice(2));
const udid = required(args, 'udid');
const outDir = path.resolve(required(args, 'out'));
const configPath = path.resolve(args.config ?? '.rnstorybook');
const appPath = args.app ? path.resolve(args.app) : null;
const port = Number(args.port ?? 7007);
const settleMs = Number(args.settle ?? 300);
const stabilityGapMs = Number(args['stability-gap'] ?? 150);
const renderTimeoutMs = Number(args['render-timeout'] ?? 10000);
const limit = args.limit ? Number(args.limit) : Infinity;
const filter = args.filter ?? null;
const maxAttempts = Number(args.attempts ?? 3);

await mkdir(outDir, { recursive: true });

const log = (...parts) => console.log(`[targus] ${parts.join(' ')}`);
const simctl = (...cmd) => execFileAsync('xcrun', ['simctl', ...cmd], { maxBuffer: 64 * 1024 * 1024 });

// ---------------------------------------------------------------------------------------------
// 1. Simulator
// ---------------------------------------------------------------------------------------------
log(`booting ${udid}`);
await simctl('boot', udid).catch((error) => {
  if (!String(error.stderr ?? error.message).includes('Unable to boot device in current state: Booted')) throw error;
});
await simctl('bootstatus', udid, '-b');
await simctl(
  'status_bar',
  udid,
  'override',
  '--time',
  '9:41',
  '--dataNetwork',
  'wifi',
  '--wifiMode',
  'active',
  '--wifiBars',
  '3',
  '--cellularMode',
  'active',
  '--cellularBars',
  '4',
  '--batteryState',
  'charged',
  '--batteryLevel',
  '100',
);

let bundleId = args['bundle-id'] ?? null;
if (appPath) {
  const { stdout } = await execFileAsync('plutil', [
    '-extract',
    'CFBundleIdentifier',
    'raw',
    '-o',
    '-',
    path.join(appPath, 'Info.plist'),
  ]);
  bundleId = stdout.trim();
  log(`installing ${appPath} (${bundleId})`);
  await simctl('terminate', udid, bundleId).catch(() => {});
  await simctl('install', udid, appPath);
}
if (!bundleId) throw new Error('Pass --app <path.app> or --bundle-id <id>');

// ---------------------------------------------------------------------------------------------
// 2. Channel server. The app connects to ws://localhost:<port>; every message from any client
//    is relayed to the others, so this process listens on each incoming socket directly.
// ---------------------------------------------------------------------------------------------
const wss = createChannelServer({ port, configPath, websockets: true, keepNodeProcessAlive: true });
const appSockets = new Set();
const listeners = new Set();
wss.on('connection', (socket) => {
  appSockets.add(socket);
  socket.on('close', () => appSockets.delete(socket));
  socket.on('message', (data) => {
    let event;
    try {
      event = JSON.parse(data.toString());
    } catch {
      return;
    }
    for (const listener of listeners) listener(event);
  });
});

const send = (type, ...eventArgs) => {
  const payload = JSON.stringify({ type, args: eventArgs });
  for (const socket of appSockets) if (socket.readyState === 1) socket.send(payload);
};

const waitForEvent = (predicate, timeoutMs, label) =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      listeners.delete(listener);
      reject(new Error(`timeout after ${timeoutMs}ms waiting for ${label}`));
    }, timeoutMs);
    const listener = (event) => {
      const value = predicate(event);
      if (value === undefined) return;
      clearTimeout(timer);
      listeners.delete(listener);
      resolve(value);
    };
    listeners.add(listener);
  });

const waitForConnection = () =>
  new Promise((resolve, reject) => {
    if (appSockets.size > 0) return resolve();
    const timer = setTimeout(() => reject(new Error('app never connected to the channel server')), 60000);
    wss.once('connection', () => {
      clearTimeout(timer);
      resolve();
    });
  });

// ---------------------------------------------------------------------------------------------
// 3. Launch and wait for the app to connect
// ---------------------------------------------------------------------------------------------
await simctl('terminate', udid, bundleId).catch(() => {});
const tLaunch = performance.now();
log(`launching ${bundleId}`);
await simctl('launch', udid, bundleId);
await waitForConnection();
log(`app connected after ${Math.round(performance.now() - tLaunch)}ms`);

// ---------------------------------------------------------------------------------------------
// 4. Story index. Prefer the app's own view of its index; fall back to parsing story files.
// ---------------------------------------------------------------------------------------------
let index;
try {
  const indexPromise = waitForEvent(
    (event) => (event.type === 'RN_GET_INDEX_RESPONSE' ? event.args?.[0]?.index : undefined),
    5000,
    'RN_GET_INDEX_RESPONSE',
  );
  send('RN_GET_INDEX');
  index = await indexPromise;
  log('story index received from app');
} catch (error) {
  log(`index from app failed (${error.message}); building from story files`);
  index = await buildIndex({ configPath });
}

let stories = Object.values(index.entries).filter((entry) => entry.type === 'story');
if (filter) stories = stories.filter((entry) => entry.id.includes(filter) || entry.title.includes(filter));
stories = stories.slice(0, limit);
log(`${stories.length} stories to capture`);

// ---------------------------------------------------------------------------------------------
// 5. Capture loop
// ---------------------------------------------------------------------------------------------
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const screenshot = async (file) => {
  await simctl('io', udid, 'screenshot', '--type=png', file);
  return readFile(file);
};

const comparePngs = (bufferA, bufferB) => {
  const a = PNG.sync.read(bufferA);
  const b = PNG.sync.read(bufferB);
  if (a.width !== b.width || a.height !== b.height) return { differing: Infinity, total: a.width * a.height };
  const differing = pixelmatch(a.data, b.data, null, a.width, a.height, { threshold: 0.1 });
  return { differing, total: a.width * a.height };
};

let lastRequested = null;
const results = [];
const tStart = performance.now();
for (const [i, story] of stories.entries()) {
  const t0 = performance.now();
  const record = { id: story.id, title: story.title, name: story.name, attempts: 0 };
  try {
    // Storybook emits `storyRendered` after a fresh render and `storyUnchanged` when the
    // requested story is already on screen with the same args (e.g. the initial selection).
    const rendered = waitForEvent(
      (event) => {
        const id = renderedStoryId(event);
        if ((event.type === 'storyRendered' || event.type === 'storyUnchanged') && id === story.id) return event.type;
        if ((event.type === 'storyErrored' || event.type === 'storyThrewException') && lastRequested === story.id) {
          return { error: JSON.stringify(event.args?.[0]).slice(0, 500) };
        }
        return undefined;
      },
      renderTimeoutMs,
      `storyRendered ${story.id}`,
    );
    lastRequested = story.id;
    send('setCurrentStory', { storyId: story.id });
    const outcome = await rendered;
    record.renderMs = Math.round(performance.now() - t0);
    if (outcome?.error) {
      record.error = outcome.error;
      results.push(record);
      log(`${i + 1}/${stories.length} ${story.id} ERROR ${record.error.slice(0, 120)}`);
      continue;
    }

    const file = path.join(outDir, `${story.id}.png`);
    let settle = settleMs;
    let stable = false;
    let first;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      record.attempts = attempt;
      await sleep(settle);
      first = await screenshot(file);
      await sleep(stabilityGapMs);
      const second = await screenshot(path.join(outDir, `${story.id}.check.png`));
      const { differing, total } = comparePngs(first, second);
      record.stabilityDiffPixels = differing;
      record.stabilityDiffRatio = differing / total;
      if (differing === 0) {
        stable = true;
        break;
      }
      settle *= 2;
    }
    record.stable = stable;
    record.hash = createHash('sha256').update(first).digest('hex');
    record.file = path.relative(outDir, file);
    record.captureMs = Math.round(performance.now() - t0);
    log(
      `${i + 1}/${stories.length} ${story.id} render=${record.renderMs}ms total=${record.captureMs}ms` +
        (stable ? '' : ` UNSTABLE (${record.stabilityDiffPixels}px after ${record.attempts} attempts)`),
    );
  } catch (error) {
    record.error = error.message;
    record.captureMs = Math.round(performance.now() - t0);
    log(`${i + 1}/${stories.length} ${story.id} FAILED ${error.message}`);
  }
  results.push(record);
}
const totalMs = Math.round(performance.now() - tStart);

// ---------------------------------------------------------------------------------------------
// 6. Report
// ---------------------------------------------------------------------------------------------
const { stdout: runtimeJson } = await simctl('list', 'devices', '-j');
const device = Object.entries(JSON.parse(runtimeJson).devices)
  .flatMap(([runtime, devices]) => devices.map((d) => ({ ...d, runtime })))
  .find((d) => d.udid === udid);

const captured = results.filter((r) => r.hash);
const times = captured.map((r) => r.captureMs).sort((a, b) => a - b);
const summary = {
  device: { name: device?.name, runtime: device?.runtime, udid },
  app: { bundleId, path: appPath },
  settleMs,
  storyCount: stories.length,
  captured: captured.length,
  failed: results.filter((r) => r.error).length,
  unstable: captured.filter((r) => !r.stable).map((r) => r.id),
  totalMs,
  perStoryMs: times.length
    ? { mean: Math.round(times.reduce((a, b) => a + b, 0) / times.length), median: times[Math.floor(times.length / 2)], max: times.at(-1) }
    : null,
};
await writeFile(path.join(outDir, 'manifest.json'), JSON.stringify({ summary, stories: results }, null, 2));
log(JSON.stringify(summary, null, 2));

await simctl('status_bar', udid, 'clear').catch(() => {});
wss.close();
process.exit(0);

// ---------------------------------------------------------------------------------------------
function renderedStoryId(event) {
  const first = event.args?.[0];
  if (typeof first === 'string') return first;
  if (first && typeof first === 'object' && typeof first.storyId === 'string') return first.storyId;
  return null;
}

function parseArgs(argv) {
  const parsed = {};
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) parsed[key] = true;
    else {
      parsed[key] = next;
      i++;
    }
  }
  return parsed;
}

function required(parsed, key) {
  if (parsed[key] === undefined || parsed[key] === true) throw new Error(`--${key} is required`);
  return parsed[key];
}
