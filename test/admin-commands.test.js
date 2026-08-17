const test = require('node:test');
const assert = require('node:assert/strict');
const { createCharacter } = require('../src/game');
const { handleAdminCommand } = require('../src/features/admin-commands');
const { createWorldState, createGuild } = require('../src/systems');
const { commandData } = require('../src/commands');
const { STATS } = require('../src/content');

function characterStore(character) {
  let profile = { activeId: character.characterId, characters: [structuredClone(character)] };
  let transactions = 0;
  let commits = 0;
  return {
    get(userId) {
      assert.equal(userId, 'target');
      const active = profile.characters.find((entry) => entry.characterId === profile.activeId);
      return active ? structuredClone(active) : undefined;
    },
    getProfile(userId) {
      assert.equal(userId, 'target');
      return structuredClone(profile);
    },
    async transaction(mutator) {
      transactions += 1;
      const draft = new Map([['target', structuredClone(profile)]]);
      const result = await mutator(draft);
      profile = structuredClone(draft.get('target'));
      commits += 1;
      return result;
    },
    character: () => structuredClone(profile.characters[0]),
    transactions: () => transactions,
    commits: () => commits,
  };
}

function transactionalWorld(state = createWorldState()) {
  let transactions = 0;
  let commits = 0;
  return {
    state,
    async transaction(mutator) {
      transactions += 1;
      const draft = structuredClone(this.state);
      const result = await mutator(draft);
      this.state = draft;
      commits += 1;
      return result;
    },
    transactions: () => transactions,
    commits: () => commits,
  };
}

function confirmationInteraction(action, decision, values = {}) {
  const listeners = {};
  const updates = [];
  const edits = [];
  let initialPayload;
  const collector = {
    on(event, callback) {
      listeners[event] = callback;
      if (event === 'end') {
        queueMicrotask(async () => {
          const buttons = initialPayload.components[0].toJSON().components;
          const customId = buttons[decision === 'confirm' ? 0 : 1].custom_id;
          await listeners.collect({
            customId,
            user: { id: 'admin' },
            async update(payload) { updates.push(payload); },
          });
          await listeners.end('limit');
        });
      }
      return collector;
    },
  };
  const message = {
    createMessageComponentCollector: () => collector,
    async edit(payload) { edits.push(payload); return message; },
  };
  const interaction = {
    user: { id: 'admin' },
    replied: false,
    deferred: false,
    options: {
      getSubcommand: () => action,
      getUser: (name) => (name === 'player' ? { id: 'target', username: 'Target' } : null),
      getString: (name) => values[name] ?? null,
      getInteger: (name) => values[name] ?? null,
    },
    async reply(payload) {
      initialPayload = payload;
      return { resource: { message } };
    },
  };
  return {
    interaction,
    initial: () => initialPayload,
    updates,
    edits,
  };
}

function finalEmbed(harness) {
  return harness.edits.at(-1)?.embeds?.[0]?.toJSON();
}

test('admin forge grants at most one item when the grant button is clicked rapidly', async () => {
  const hero = createCharacter('target', 'Target Hero', 'warrior');
  let saved = structuredClone(hero);
  let updates = 0;
  let stoppedReason = null;
  const listeners = {};
  const collector = {
    on(event, callback) { listeners[event] = callback; return collector; },
    stop(reason) { stoppedReason = reason; },
  };
  const message = { createMessageComponentCollector: () => collector };
  const interaction = {
    user: { id: 'admin' },
    options: {
      getSubcommand: () => 'make-equipment',
      getUser: () => ({ id: 'target' }),
      getString: () => null,
    },
    reply: async () => ({ resource: { message } }),
    editReply: async () => {},
  };
  const store = {
    get: () => structuredClone(saved),
    getProfile: () => ({ activeId: saved.characterId, characters: [structuredClone(saved)] }),
    update: async (_userId, character) => { updates += 1; saved = structuredClone(character); },
  };

  await handleAdminCommand(interaction, store, { state: { guilds: {}, memberships: {} } });
  const component = () => ({
    customId: 'admin_item_grant',
    deferUpdate: async () => {},
    update: async () => {},
  });
  const first = listeners.collect(component());
  const second = listeners.collect(component());
  await Promise.all([first, second]);

  assert.equal(updates, 1);
  assert.equal(saved.inventory.length, 1);
  assert.equal(saved.inventory[0].adminCreated, true);
  assert.equal(stoppedReason, 'granted');
});

test('/admin add-stats cancellation does not mutate the target character', async () => {
  const hero = createCharacter('target', 'Target Hero', 'warrior');
  const store = characterStore(hero);
  const worldStore = transactionalWorld();
  const harness = confirmationInteraction('add-stats', 'cancel', { stat: 'hp', amount: 5 });

  await handleAdminCommand(harness.interaction, store, worldStore);

  assert.deepEqual(store.character(), hero);
  assert.equal(store.transactions(), 0);
  assert.equal(harness.updates.at(-1).embeds[0].toJSON().title, '✖️ Cancelled');
});

test('/admin add-stats confirmation persists the stat and resource-pool grant', async () => {
  const hero = createCharacter('target', 'Target Hero', 'warrior');
  const store = characterStore(hero);
  const worldStore = transactionalWorld();
  const harness = confirmationInteraction('add-stats', 'confirm', { stat: 'hp', amount: 5 });

  await handleAdminCommand(harness.interaction, store, worldStore);

  const saved = store.character();
  assert.equal(saved.stats.hp, 6);
  assert.equal(saved.adminGrantedStats.hp, 5);
  assert.equal(saved.maxHp, hero.maxHp + 25);
  assert.equal(saved.hp, hero.hp + 25);
  assert.equal(store.transactions(), 1);
  assert.equal(store.commits(), 1);
  assert.match(finalEmbed(harness).description, /Added \*\*5 HP\*\*/);
});

test('/admin add-ascensions cancellation preserves ascension totals', async () => {
  const hero = createCharacter('target', 'Target Hero', 'mage');
  const store = characterStore(hero);
  const harness = confirmationInteraction('add-ascensions', 'cancel', { amount: 3 });

  await handleAdminCommand(harness.interaction, store, transactionalWorld());

  assert.equal(store.character().ascensions, 0);
  assert.equal(store.character().ascensionPoints, 0);
  assert.equal(store.transactions(), 0);
});

test('/admin add-ascensions confirmation persists count and permanent points', async () => {
  const hero = createCharacter('target', 'Target Hero', 'mage');
  const store = characterStore(hero);
  const harness = confirmationInteraction('add-ascensions', 'confirm', { amount: 3 });

  await handleAdminCommand(harness.interaction, store, transactionalWorld());

  assert.equal(store.character().ascensions, 3);
  assert.equal(store.character().ascensionPoints, 3);
  assert.equal(store.commits(), 1);
  assert.match(finalEmbed(harness).description, /3 ascensions.*3 points/i);
});

test('/admin guild-join cancellation leaves account-wide membership unchanged', async () => {
  const hero = createCharacter('target', 'Target Hero', 'rogue');
  const store = characterStore(hero);
  const world = createWorldState();
  const destination = createGuild(world, 'leader', 'Destination').guild;
  const worldStore = transactionalWorld(world);
  const harness = confirmationInteraction('guild-join', 'cancel', { guild_id: destination.id });

  await handleAdminCommand(harness.interaction, store, worldStore);

  assert.equal(worldStore.state.memberships.target, undefined);
  assert.deepEqual(worldStore.state.guilds[destination.id].members, ['leader']);
  assert.equal(worldStore.transactions(), 0);
  assert.equal(store.transactions(), 0);
});

test('/admin guild-join confirmation persists account-wide membership', async () => {
  const hero = createCharacter('target', 'Target Hero', 'rogue');
  const store = characterStore(hero);
  const world = createWorldState();
  const destination = createGuild(world, 'leader', 'Destination').guild;
  const worldStore = transactionalWorld(world);
  const harness = confirmationInteraction('guild-join', 'confirm', { guild_id: destination.id });

  await handleAdminCommand(harness.interaction, store, worldStore);

  assert.equal(worldStore.state.memberships.target, destination.id);
  assert.deepEqual(worldStore.state.guilds[destination.id].members, ['leader', 'target']);
  assert.equal(worldStore.transactions(), 1);
  assert.equal(worldStore.commits(), 1);
  assert.equal(store.transactions(), 0);
  assert.match(finalEmbed(harness).description, /joined \*\*Destination\*\*/);
});

test('admin command schema exposes complete confirmation-backed operations', () => {
  const admin = commandData.find((command) => command.name === 'admin');
  assert.ok(admin);
  const subcommands = Object.fromEntries(admin.options.map((option) => [option.name, option]));
  assert.deepEqual(
    ['make-equipment', 'add-stats', 'add-ascensions', 'guild-join'].filter((name) => !subcommands[name]),
    [],
  );

  const options = (name) => Object.fromEntries(subcommands[name].options.map((option) => [option.name, option]));
  assert.equal(options('make-equipment').player.required, true);
  assert.equal(options('make-equipment').name.max_length, 60);
  assert.equal(options('add-stats').player.required, true);
  assert.equal(options('add-stats').amount.min_value, 1);
  assert.equal(options('add-stats').amount.max_value, 1_000_000);
  assert.deepEqual(options('add-stats').stat.choices.map((choice) => choice.value).sort(), Object.keys(STATS).sort());
  assert.equal(options('add-ascensions').amount.max_value, 10_000);
  assert.equal(options('guild-join').guild_id.required, true);
});
