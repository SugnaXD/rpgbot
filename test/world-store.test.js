const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs/promises');
const { WorldStore } = require('../src/world-store');

function fsWithTransientWriteFailure(count = 1) {
  let failuresRemaining = count;
  return {
    mkdir: (...args) => fs.mkdir(...args),
    readFile: (...args) => fs.readFile(...args),
    rename: (...args) => fs.rename(...args),
    unlink: (...args) => fs.unlink(...args),
    writeFile: (...args) => {
      if (failuresRemaining > 0) {
        failuresRemaining -= 1;
        return Promise.reject(Object.assign(new Error('simulated write failure'), { code: 'EIO' }));
      }
      return fs.writeFile(...args);
    },
  };
}

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

test('a rejected world save does not poison the following save', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'rpg-world-retry-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const file = path.join(directory, 'world.json');
  const store = new WorldStore(file, { fs: fsWithTransientWriteFailure() });
  await store.load();

  store.state.memberships.user = 'first';
  await assert.rejects(store.save(), /simulated write failure/);
  assert.equal(store.state.memberships.user, undefined, 'the latest failed edit should roll back to durable state');
  store.state.memberships.user = 'second';
  await store.save();

  const saved = JSON.parse(await fs.readFile(file, 'utf8'));
  assert.equal(saved.memberships.user, 'second');
});

test('world save captures an immutable snapshot at invocation time', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'rpg-world-snapshot-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const file = path.join(directory, 'world.json');
  const store = new WorldStore(file);
  await store.load();

  store.state.memberships.user = 'captured';
  const save = store.save();
  store.state.memberships.user = 'later-change';
  await save;

  const saved = JSON.parse(await fs.readFile(file, 'utf8'));
  assert.equal(saved.memberships.user, 'captured');
  assert.equal(store.state.memberships.user, 'later-change');
});

test('world transactions publish only after persistence and recover after failure', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'rpg-world-transaction-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const file = path.join(directory, 'world.json');
  const store = new WorldStore(file, { fs: fsWithTransientWriteFailure() });
  await store.load();

  await assert.rejects(store.transaction((draft) => {
    draft.memberships.user = 'failed-guild';
  }), /simulated write failure/);
  assert.equal(store.state.memberships.user, undefined);

  await store.transaction((draft) => {
    draft.memberships.user = 'saved-guild';
  });
  assert.equal(store.state.memberships.user, 'saved-guild');
  const saved = JSON.parse(await fs.readFile(file, 'utf8'));
  assert.equal(saved.memberships.user, 'saved-guild');
});

test('direct state saves rebase over an in-flight transaction without losing either edit', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'rpg-world-mixed-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const file = path.join(directory, 'world.json');
  const store = new WorldStore(file);
  await store.load();
  const worldReference = store.state;
  const membershipReference = store.state.memberships;
  const faction = Object.keys(store.state.factionScores)[0];
  const entered = deferred();
  const release = deferred();

  const transaction = store.transaction(async (draft) => {
    draft.factionScores[faction] += 5;
    entered.resolve();
    await release.promise;
  });
  await entered.promise;

  // This is the legacy calling style used throughout the command handlers.
  store.state.memberships.user = 'guild-from-direct-save';
  const directSave = store.save();
  release.resolve();
  await Promise.all([transaction, directSave]);

  assert.equal(store.state, worldReference, 'commits keep existing top-level state references usable');
  assert.equal(store.state.memberships, membershipReference, 'commits reconcile nested records in place');
  assert.equal(store.state.memberships.user, 'guild-from-direct-save');
  assert.equal(store.state.factionScores[faction], 5);
  const saved = JSON.parse(await fs.readFile(file, 'utf8'));
  assert.equal(saved.memberships.user, 'guild-from-direct-save');
  assert.equal(saved.factionScores[faction], 5);
});

test('overlapping transaction and direct world edits reject instead of overwriting', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'rpg-world-conflict-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const file = path.join(directory, 'world.json');
  const store = new WorldStore(file);
  await store.load();
  const faction = Object.keys(store.state.factionScores)[0];
  const entered = deferred();
  const release = deferred();

  const transaction = store.transaction(async (draft) => {
    draft.factionScores[faction] = 5;
    entered.resolve();
    await release.promise;
  });
  await entered.promise;
  store.state.factionScores[faction] = 7;
  const conflictingSave = store.save();
  release.resolve();

  await transaction;
  await assert.rejects(conflictingSave, (error) => {
    assert.equal(error.code, 'WORLD_CONFLICT');
    assert.deepEqual(error.paths, [`$.factionScores.${faction}`]);
    return true;
  });
  assert.equal(store.state.factionScores[faction], 5);
  const saved = JSON.parse(await fs.readFile(file, 'utf8'));
  assert.equal(saved.factionScores[faction], 5);
});
