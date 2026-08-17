const test = require('node:test');
const assert = require('node:assert/strict');
const { createCharacter, setCharacterLevel } = require('../src/game');
const { handleProgressionCommand } = require('../src/features/progression-commands');

function equipment({ id, type = 'weapon', grade = 'f', locked = false }) {
  const primary = type === 'weapon' ? 'attack' : 'defense';
  return {
    id,
    name: `Test ${type} ${id}`,
    type,
    rarity: 'common',
    grade,
    power: 100,
    stats: { [primary]: 10 },
    statGrades: { [primary]: grade },
    statPercentages: { [primary]: 5 },
    schemaVersion: 3,
    traits: [],
    upgradeLevel: 0,
    locked,
  };
}

function profileStore(characters, activeId = characters[0].characterId) {
  let profile = { activeId, characters: structuredClone(characters) };
  let transactions = 0;
  let commits = 0;
  return {
    get(userId) {
      assert.equal(userId, 'owner');
      const character = profile.characters.find((entry) => entry.characterId === profile.activeId);
      return character ? structuredClone(character) : undefined;
    },
    async transaction(mutator) {
      transactions += 1;
      const draftProfile = structuredClone(profile);
      const draft = new Map([['owner', draftProfile]]);
      const result = await mutator(draft);
      profile = structuredClone(draft.get('owner'));
      commits += 1;
      return result;
    },
    mutateCharacter(characterId, mutator) {
      const character = profile.characters.find((entry) => entry.characterId === characterId);
      assert.ok(character);
      mutator(character);
    },
    setActive(characterId) { profile.activeId = characterId; },
    character(characterId) {
      return structuredClone(profile.characters.find((entry) => entry.characterId === characterId));
    },
    transactions: () => transactions,
    commits: () => commits,
  };
}

function confirmationHarness({ commandName, subcommand = null, rarity = null, stat = null, slot = 1, decision, beforeDecision = null }) {
  const listeners = {};
  const updates = [];
  const edits = [];
  let initialPayload;
  const collector = {
    on(event, callback) {
      listeners[event] = callback;
      if (event === 'end') {
        queueMicrotask(async () => {
          await beforeDecision?.();
          const buttons = initialPayload.components[0].toJSON().components;
          const customId = buttons[decision === 'confirm' ? 0 : 1].custom_id;
          await listeners.collect({
            customId,
            user: { id: 'owner' },
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
    commandName,
    user: { id: 'owner' },
    replied: false,
    deferred: false,
    options: {
      getSubcommand: () => subcommand,
      getString: (name) => (name === 'rarity' ? rarity : name === 'stat' ? stat : null),
      getInteger: (name) => (name === 'slot' ? slot : null),
    },
    async reply(payload) {
      initialPayload = payload;
      return { resource: { message } };
    },
  };
  return {
    interaction,
    updates,
    edits,
    initial: () => initialPayload,
  };
}

function confirmationField(harness) {
  return harness.initial().embeds[0].toJSON().fields.find((field) => field.name === 'What will happen').value;
}

function editDescription(harness) {
  return harness.edits.at(-1)?.embeds?.[0]?.toJSON().description;
}

function salvageHero() {
  const hero = createCharacter('owner', 'Recycler', 'warrior');
  hero.materials = { dust: 100, metal: 2, hide: 3, essence: 4, relicShard: 0 };
  hero.inventory.push(
    equipment({ id: 'blade' }),
    equipment({ id: 'plate', type: 'armor', grade: 'b' }),
    equipment({ id: 'locked', locked: true }),
  );
  return hero;
}

test('/items salvage cancellation leaves inventory and materials untouched', async () => {
  const hero = salvageHero();
  const store = profileStore([hero]);
  const before = store.character(hero.characterId);
  const harness = confirmationHarness({ commandName: 'items', subcommand: 'salvage', rarity: 'common', decision: 'cancel' });

  await handleProgressionCommand(harness.interaction, store.get('owner'), store);

  assert.deepEqual(store.character(hero.characterId), before);
  assert.equal(store.transactions(), 0);
  assert.equal(harness.updates.at(-1).embeds[0].toJSON().title, '✖️ Cancelled');
});

test('/items salvage confirmation applies exactly the displayed preview', async () => {
  const hero = salvageHero();
  const store = profileStore([hero]);
  const harness = confirmationHarness({ commandName: 'items', subcommand: 'salvage', rarity: 'common', decision: 'confirm' });

  await handleProgressionCommand(harness.interaction, store.get('owner'), store);

  assert.match(confirmationField(harness), /2 item\(s\) will be permanently removed/);
  assert.match(confirmationField(harness), /\*\*26 dust\*\*, \*\*6 metal\*\*, \*\*7 hide\*\*, \*\*1 essence\*\*/);
  const saved = store.character(hero.characterId);
  assert.deepEqual(saved.inventory.map((item) => item.id), ['locked']);
  assert.deepEqual(saved.materials, { dust: 126, metal: 8, hide: 10, essence: 5, relicShard: 0 });
  assert.equal(store.commits(), 1);
  assert.match(editDescription(harness), /Salvaged \*\*2 items\*\*/);
});

test('/items salvage confirmation aborts atomically when inventory changed after preview', async () => {
  const hero = salvageHero();
  const store = profileStore([hero]);
  const harness = confirmationHarness({
    commandName: 'items', subcommand: 'salvage', rarity: 'common', decision: 'confirm',
    beforeDecision: () => store.mutateCharacter(hero.characterId, (live) => {
      live.inventory = live.inventory.filter((item) => item.id !== 'blade');
    }),
  });

  await handleProgressionCommand(harness.interaction, store.get('owner'), store);

  const saved = store.character(hero.characterId);
  assert.deepEqual(saved.inventory.map((item) => item.id), ['plate', 'locked']);
  assert.deepEqual(saved.materials, hero.materials);
  assert.equal(store.transactions(), 1);
  assert.equal(store.commits(), 0);
  assert.match(editDescription(harness), /inventory\/materials changed|selected items.*changed/i);
});

test('/items salvage confirmation aborts atomically when material caps changed after preview', async () => {
  const hero = salvageHero();
  const store = profileStore([hero]);
  const harness = confirmationHarness({
    commandName: 'items', subcommand: 'salvage', rarity: 'common', decision: 'confirm',
    beforeDecision: () => store.mutateCharacter(hero.characterId, (live) => { live.materials.dust = 250_000; }),
  });

  await handleProgressionCommand(harness.interaction, store.get('owner'), store);

  const saved = store.character(hero.characterId);
  assert.deepEqual(saved.inventory.map((item) => item.id), ['blade', 'plate', 'locked']);
  assert.equal(saved.materials.dust, 250_000);
  assert.equal(saved.materials.metal, 2);
  assert.equal(store.transactions(), 1);
  assert.equal(store.commits(), 0);
  assert.match(editDescription(harness), /inventory\/materials changed|material storage changed/i);
});

test('/craft reroll cancellation keeps the reviewed stat and dust', async () => {
  const hero = salvageHero();
  const store = profileStore([hero]);
  const before = store.character(hero.characterId);
  const harness = confirmationHarness({ commandName: 'craft', subcommand: 'reroll', stat: 'attack', decision: 'cancel' });

  await handleProgressionCommand(harness.interaction, store.get('owner'), store);

  assert.deepEqual(store.character(hero.characterId), before);
  assert.equal(store.transactions(), 0);
  assert.match(confirmationField(harness), /may be lower/i);
});

test('/craft reroll confirmation spends dust only after the button is pressed', async () => {
  const hero = salvageHero();
  const store = profileStore([hero]);
  const harness = confirmationHarness({ commandName: 'craft', subcommand: 'reroll', stat: 'attack', decision: 'confirm' });

  await handleProgressionCommand(harness.interaction, store.get('owner'), store);

  const saved = store.character(hero.characterId);
  assert.equal(saved.materials.dust, 25);
  assert.equal(store.commits(), 1);
  assert.ok(saved.inventory[0].statGrades.attack);
  assert.match(editDescription(harness), /now has/i);
});

function ascensionHero(name = 'Ascendant') {
  const hero = createCharacter('owner', name, 'mage');
  assert.equal(setCharacterLevel(hero, 1000).ok, true);
  hero.achievementPoints = 200;
  return hero;
}

test('/ascend cancellation preserves the level-1000 character', async () => {
  const hero = ascensionHero();
  const store = profileStore([hero]);
  const before = store.character(hero.characterId);
  const harness = confirmationHarness({ commandName: 'ascend', decision: 'cancel' });

  await handleProgressionCommand(harness.interaction, store.get('owner'), store, new Set());

  assert.deepEqual(store.character(hero.characterId), before);
  assert.equal(store.transactions(), 0);
});

test('/ascend confirmation revalidates and persists the reviewed reward', async () => {
  const hero = ascensionHero();
  const store = profileStore([hero]);
  const activeBattles = new Set();
  const harness = confirmationHarness({ commandName: 'ascend', decision: 'confirm' });

  await handleProgressionCommand(harness.interaction, store.get('owner'), store, activeBattles);

  const saved = store.character(hero.characterId);
  assert.equal(saved.level, 1);
  assert.equal(saved.ascensions, 1);
  assert.equal(saved.ascensionPoints, 3);
  assert.equal(store.commits(), 1);
  assert.equal(activeBattles.has('owner'), false);
  assert.match(editDescription(harness), /Gained 3 permanent points/);
});

test('/ascend confirmation cannot mutate a character after the active slot changes', async () => {
  const hero = ascensionHero('Original');
  const other = createCharacter('owner', 'Other', 'warrior');
  const store = profileStore([hero, other], hero.characterId);
  const harness = confirmationHarness({
    commandName: 'ascend', decision: 'confirm',
    beforeDecision: () => store.setActive(other.characterId),
  });

  await handleProgressionCommand(harness.interaction, store.get('owner'), store, new Set());

  assert.equal(store.character(hero.characterId).level, 1000);
  assert.equal(store.character(hero.characterId).ascensions, 0);
  assert.equal(store.character(other.characterId).level, 1);
  assert.equal(store.commits(), 0);
  assert.match(editDescription(harness), /active character changed/i);
});
