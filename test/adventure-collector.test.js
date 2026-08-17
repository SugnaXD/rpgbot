const test = require('node:test');
const assert = require('node:assert/strict');
const { MessageFlags } = require('discord.js');
const { createCharacter } = require('../src/game');
const { runAdventure } = require('../src/features/adventure');

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
}

function adventureHarness(hero, store) {
  const listeners = {};
  const edits = [];
  let stopReason = null;
  let collectorOptions;
  const activeBattles = new Set();
  const collector = {
    on(event, callback) { listeners[event] = callback; return collector; },
    stop(reason) {
      stopReason = reason;
      listeners.end?.([], reason);
    },
  };
  const message = {
    createMessageComponentCollector(options) {
      collectorOptions = options;
      return collector;
    },
  };
  const interaction = {
    user: { id: 'owner' },
    async reply() { return { resource: { message } }; },
    async editReply(payload) { edits.push(payload); },
  };
  return {
    interaction,
    activeBattles,
    listeners,
    edits,
    collector,
    stopReason: () => stopReason,
    collectorOptions: () => collectorOptions,
    start: () => runAdventure(interaction, structuredClone(hero), store, activeBattles),
  };
}

function battleButton(customId = 'defend') {
  const replies = [];
  const updates = [];
  let deferredUpdates = 0;
  return {
    customId,
    user: { id: 'owner' },
    replied: false,
    deferred: false,
    isStringSelectMenu: () => false,
    async deferUpdate() {
      this.deferred = true;
      deferredUpdates += 1;
    },
    async reply(payload) {
      this.replied = true;
      replies.push(payload);
    },
    async update(payload) {
      this.replied = true;
      updates.push(payload);
    },
    replies,
    updates,
    deferredUpdates: () => deferredUpdates,
  };
}

function allComponentsDisabled(payload) {
  return payload.components.every((row) => row.toJSON().components.every((component) => component.disabled));
}

test('rapid battle clicks serialize turns and tell the second click to wait', async () => {
  const hero = createCharacter('owner', 'Patient Fighter', 'admin');
  let live = structuredClone(hero);
  let writes = 0;
  const writeGate = deferred();
  const writeStarted = deferred();
  const store = {
    get: () => structuredClone(live),
    async set(userId, character) {
      assert.equal(userId, 'owner');
      writes += 1;
      writeStarted.resolve();
      await writeGate.promise;
      live = structuredClone(character);
    },
  };
  const harness = adventureHarness(hero, store);
  await harness.start();
  assert.equal(harness.activeBattles.has('owner'), true);
  assert.equal(harness.collectorOptions().filter({ user: { id: 'owner' } }), true);

  const first = battleButton();
  const second = battleButton('attack');
  const firstTurn = harness.listeners.collect(first);
  await writeStarted.promise;
  await harness.listeners.collect(second);

  assert.equal(writes, 1);
  assert.equal(first.deferredUpdates(), 1);
  assert.equal(second.deferredUpdates(), 0);
  assert.equal(second.replies.length, 1);
  assert.match(second.replies[0].content, /turn is still being saved.*wait/i);
  assert.equal(second.replies[0].flags, MessageFlags.Ephemeral);

  writeGate.resolve();
  await firstTurn;
  assert.equal(harness.edits.length, 1);
  harness.collector.stop('test-complete');
  assert.equal(harness.activeBattles.has('owner'), false);
});

test('a character write conflict acknowledges and safely closes the battle without rejection', async () => {
  const hero = createCharacter('owner', 'Conflicted Fighter', 'admin');
  const durable = structuredClone(hero);
  const conflict = new Error('Character changed after this turn began.');
  conflict.code = 'CHARACTER_CONFLICT';
  const store = {
    get: () => structuredClone(durable),
    async set() { throw conflict; },
  };
  const harness = adventureHarness(hero, store);
  await harness.start();
  const button = battleButton();
  const unhandled = [];
  const onUnhandled = (error) => unhandled.push(error);
  process.on('unhandledRejection', onUnhandled);
  try {
    await assert.doesNotReject(() => harness.listeners.collect(button));
    await new Promise((resolve) => setImmediate(resolve));
  } finally {
    process.removeListener('unhandledRejection', onUnhandled);
  }

  assert.deepEqual(unhandled, []);
  assert.equal(button.deferredUpdates(), 1, 'the component should be acknowledged before persistence');
  assert.equal(button.replies.length, 0);
  assert.equal(button.updates.length, 0);
  assert.equal(harness.stopReason(), 'error');
  assert.equal(harness.activeBattles.has('owner'), false);
  assert.equal(harness.edits.length, 1);
  assert.equal(allComponentsDisabled(harness.edits[0]), true);
  assert.match(harness.edits[0].embeds[0].toJSON().description, /another command changed.*turn was not applied.*closed safely/i);
});

test('travelling after a battle starts cannot turn an old enemy into high-floor rewards', async () => {
  const hero = createCharacter('owner', 'Travelling Fighter', 'admin');
  const live = structuredClone(hero);
  let writes = 0;
  const store = {
    get: () => structuredClone(live),
    async set() { writes += 1; },
  };
  const harness = adventureHarness(hero, store);
  await harness.start();
  live.world = 5;
  live.floor = 10;

  const button = battleButton('attack');
  await harness.listeners.collect(button);

  assert.equal(writes, 0);
  assert.equal(harness.stopReason(), 'travelled');
  assert.equal(harness.activeBattles.has('owner'), false);
  assert.equal(button.updates.length, 1);
  assert.equal(allComponentsDisabled(button.updates[0]), true);
  assert.match(button.updates[0].embeds[0].toJSON().description, /world or floor changed.*old battle was closed/i);
});
