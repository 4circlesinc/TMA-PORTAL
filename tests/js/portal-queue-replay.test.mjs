/**
 * Replay of a queued filing.
 *
 * Run: node tests/js/portal-queue-replay.test.mjs
 *
 * A blob read back from the queue used to be handed straight to fetch. That
 * sends an empty body (the server then says every field is missing) or a
 * request that never finishes, and a send that never finishes leaves the
 * next Try now doing nothing. These checks fail if either comes back.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const source = readFileSync(join(root, 'public/js/portal-queue.js'), 'utf8');

function memoryDb() {
  const rows = [];
  let nextId = 1;

  function store() {
    return {
      put(entry) {
        const req = {};
        queueMicrotask(() => {
          if (entry.id == null) {
            entry.id = nextId++;
            rows.push(entry);
          } else {
            const at = rows.findIndex((row) => row.id === entry.id);
            if (at >= 0) rows[at] = entry;
            else rows.push(entry);
          }
          req.result = entry.id;
          req.onsuccess && req.onsuccess();
        });
        return req;
      },
      delete(id) {
        const req = {};
        queueMicrotask(() => {
          const at = rows.findIndex((row) => row.id === id);
          if (at >= 0) rows.splice(at, 1);
          req.onsuccess && req.onsuccess();
        });
        return req;
      },
      openCursor() {
        const req = { transaction: {} };
        const order = rows.slice().sort((a, b) => a.id - b.id);
        let index = 0;
        let updatePending = false;

        const fire = () => {
          if (index >= order.length) {
            req.result = null;
            req.onsuccess && req.onsuccess();
            queueMicrotask(() => {
              req.transaction.oncomplete && req.transaction.oncomplete();
            });
            return;
          }
          const id = order[index].id;
          const cursor = {
            get value() {
              return rows.find((row) => row.id === id);
            },
            continue() {
              if (updatePending) {
                throw new Error('InvalidStateError');
              }
              index += 1;
              queueMicrotask(fire);
            },
            update(entry) {
              updatePending = true;
              const update = {};
              queueMicrotask(() => {
                const at = rows.findIndex((row) => row.id === entry.id);
                if (at >= 0) rows[at] = entry;
                updatePending = false;
                update.onsuccess && update.onsuccess();
              });
              return update;
            },
          };
          req.result = cursor;
          req.onsuccess && req.onsuccess();
        };

        queueMicrotask(fire);
        return req;
      },
    };
  }

  return {
    transaction() {
      return { objectStore: store };
    },
    objectStoreNames: { contains: () => true },
  };
}

function boot(opts) {
  opts = opts || {};
  const calls = [];
  const timers = [];
  let seq = 1;
  const db = memoryDb();
  const context = {
    console,
    Promise,
    queueMicrotask,
    FormData,
    Blob,
    AbortController,
    CustomEvent: class CustomEvent {
      constructor(type, init) {
        this.type = type;
        this.detail = init && init.detail;
      }
    },
    indexedDB: {
      open() {
        const req = { result: db };
        queueMicrotask(() => req.onsuccess && req.onsuccess());
        return req;
      },
    },
    navigator: { onLine: opts.onLine !== false },
    addEventListener() {},
    document: {
      cookie: 'XSRF-TOKEN=test',
      visibilityState: 'visible',
      addEventListener() {},
      dispatchEvent() {},
    },
    fetch(url, init) {
      calls.push({ url, body: init && init.body });
      if (opts.fail) return Promise.reject(new TypeError('Failed to fetch'));
      return Promise.resolve({
        status: 200,
        ok: true,
        json: () => Promise.resolve({ ok: true }),
      });
    },
    setTimeout(fn, ms) {
      const id = seq++;
      timers.push({ id, fn, ms, cleared: false });
      return id;
    },
    clearTimeout(id) {
      const timer = timers.find((item) => item.id === id);
      if (timer) timer.cleared = true;
    },
  };
  const sandbox = createContext(context);
  sandbox.window = sandbox;
  runInContext(source, sandbox);

  return {
    queue: sandbox.TMAQueue,
    calls,
    timers,
    async fire(ms) {
      const due = timers.filter((timer) => !timer.cleared && timer.ms === ms);
      due.forEach((timer) => {
        timer.cleared = true;
      });
      due.forEach((timer) => timer.fn());
      await new Promise((resolve) => setTimeout(resolve, 0));
    },
  };
}

function settle(promise) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error('the queue promise never settled')), 1000);
  });

  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

const bytes = new Uint8Array([9, 8, 7, 6, 5]);
const original = new Blob([bytes], { type: 'application/pdf' });

const replay = boot();
const saved = await settle(replay.queue.add({
  kind: 'cip.application',
  label: 'A new application for VERNO FRAN',
  method: 'POST',
  url: '/portal/cip/applications',
  parts: [
    { name: 'providerId', value: '42' },
    { name: 'principal[firstName]', value: 'VERNO' },
    { name: 'scan', file: original, filename: 'passport.pdf' },
  ],
}));
await replay.fire(0);

assert.equal(replay.calls.length, 1, 'a waiting filing is sent when the queue runs');
const body = replay.calls[0].body;
assert.ok(body instanceof FormData, 'the replay is a form, not an empty body');
assert.equal(body.get('providerId'), '42');
assert.equal(body.get('principal[firstName]'), 'VERNO');
assert.equal(body.get('uploadCount'), null, 'no file count is sent');
const sentFile = body.get('scan');
assert.equal(sentFile.size, original.size);
assert.notEqual(sentFile, original, 'the stored blob is copied before it is sent');
const sentBytes = new Uint8Array(await sentFile.arrayBuffer());
assert.deepEqual(sentBytes, bytes);
assert.equal(saved.id > 0, true);

let hang = true;
const stuck = boot();
const parked = await settle(stuck.queue.add({
  kind: 'cip.application',
  label: 'A new application for VERNON TESTING AGAIN',
  method: 'POST',
  url: '/portal/cip/applications',
  parts: [
    { name: 'providerId', value: '7' },
    {
      name: 'scan',
      filename: 'scan.pdf',
      file: {
        name: 'scan.pdf',
        type: 'application/pdf',
        size: bytes.byteLength,
        arrayBuffer() {
          if (hang) return new Promise(() => {});
          return Promise.resolve(bytes.buffer.slice(0));
        },
      },
    },
  ],
}));
await stuck.fire(0);
assert.equal(stuck.queue.state().syncing, true, 'the hung read is in flight');
assert.equal(stuck.calls.length, 0, 'fetch has not started while the blob read is hung');

await stuck.fire(30 * 1000);
assert.equal(stuck.queue.state().syncing, false, 'a hung read must release the queue');

hang = false;
const retried = await settle(stuck.queue.retry(parked.id));
assert.equal(retried, true);
assert.equal(stuck.calls.length, 1, 'Try now sends after a hung attempt');
assert.equal(stuck.calls[0].body.get('providerId'), '7');

const claim = boot();
await settle(claim.queue.add({
  kind: 'cip.application',
  label: 'A new application for VERNO FRAN',
  method: 'POST',
  url: '/portal/cip/applications',
  parts: [{ name: 'providerId', value: '3' }],
}));
await settle(claim.queue.setAccount('9'));
const sentOnSignIn = claim.calls.some((call) => call.body && call.body.get('providerId') === '3');
assert.equal(sentOnSignIn, true, 'signing in replays a filing that had no account yet');

const dropped = boot({ fail: true });
await settle(dropped.queue.add({
  kind: 'cip.application',
  label: 'A new application for VERNO FRAN',
  method: 'POST',
  url: '/portal/cip/applications',
  parts: [{ name: 'providerId', value: '42' }],
}));
await dropped.fire(0);
assert.equal(dropped.queue.state().online, true, 'a failed send is not the same as having no connection');

const stuckLine = boot({ onLine: false });
const waiting = await settle(stuckLine.queue.add({
  kind: 'cip.application',
  label: 'A new application for VERNO FRAN',
  method: 'POST',
  url: '/portal/cip/applications',
  parts: [{ name: 'providerId', value: '42' }],
}));
await stuckLine.fire(0);
assert.equal(stuckLine.calls.length, 0, 'an automatic run waits when the browser says there is no network');
assert.equal(stuckLine.queue.state().online, false);
const forced = await settle(stuckLine.queue.retry(waiting.id));
assert.equal(forced, true);
assert.equal(stuckLine.calls.length, 1, 'Try now sends even when the browser still says offline');
assert.equal(stuckLine.queue.state().online, true, 'an answer from the firm clears the offline sentence');

console.log('portal queue replay: ok');
