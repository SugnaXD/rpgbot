const test = require('node:test');
const assert = require('node:assert/strict');
const { MessageFlags } = require('discord.js');
const { createCharacter } = require('../src/game');
const { handleProgressionCommand } = require('../src/features/progression-commands');

function harness(commandName, subcommand, character) {
  const listeners = {};
  const edits = [];
  let replyPayload;
  let live = character;
  let updates = 0;
  let stopped = false;
  const collector = {
    on(event, callback) { listeners[event] = callback; return collector; },
    stop() { stopped = true; },
  };
  const message = {
    createMessageComponentCollector(options) { harness.collectorOptions = options; return collector; },
  };
  const interaction = {
    commandName,
    user: { id: 'owner' },
    options: { getSubcommand: () => subcommand },
    async reply(payload) { replyPayload = payload; return { resource: { message } }; },
    async editReply(payload) { edits.push(payload); },
  };
  const store = {
    get: () => live,
    async update(userId, next) { assert.equal(userId, 'owner'); live = next; updates += 1; },
  };
  return {
    interaction, store, listeners, edits,
    reply: () => replyPayload,
    live: () => live,
    updates: () => updates,
    stopped: () => stopped,
    switchTo: (next) => { live = next; },
  };
}

function firstComponent(payload) {
  return payload.components[0].toJSON().components[0];
}

function jsonComponents(payload) {
  return payload.components.flatMap((row) => row.toJSON().components);
}

function selectContaining(payload, value) {
  return jsonComponents(payload).find((component) => component.type === 3
    && component.options.some((option) => option.value === value));
}

function buttonNamed(payload, label) {
  return jsonComponents(payload).find((component) => component.type === 2 && component.label === label);
}

async function choose(view, payload, value) {
  const select = selectContaining(payload, value);
  assert.ok(select, `expected a select containing ${value}`);
  let next;
  await view.listeners.collect({
    user: { id: 'owner' }, customId: select.custom_id, values: [value],
    async update(updated) { next = updated; }, async reply() {},
  });
  return next;
}

test('ability list is an owner-only ephemeral selector that saves against live state', async () => {
  const hero = createCharacter('owner', 'Menu Mage', 'mage');
  const view = harness('ability', 'list', hero);
  await handleProgressionCommand(view.interaction, hero, view.store);

  const initial = view.reply();
  const menu = firstComponent(initial);
  assert.equal(initial.flags, MessageFlags.Ephemeral);
  assert.equal(initial.withResponse, true);
  assert.equal(menu.type, 3);
  assert.equal(menu.options.length, 2);
  assert.equal(harness.collectorOptions.time, 120000);
  assert.equal(harness.collectorOptions.filter({ user: { id: 'owner' }, customId: menu.custom_id }), true);
  assert.equal(harness.collectorOptions.filter({ user: { id: 'intruder' }, customId: menu.custom_id }), false);

  await view.listeners.collect({
    user: { id: 'owner' }, customId: menu.custom_id, values: ['renewal'],
    async deferUpdate() {}, async update() {},
    async reply() {},
  });
  const updatePayload = view.edits.at(-1);
  assert.equal(view.live().autoAbility, 'renewal');
  assert.equal(view.updates(), 1);
  assert.match(updatePayload.content, /Renewal/);
  assert.equal(firstComponent(updatePayload).options.find((option) => option.value === 'renewal').default, true);

  await view.listeners.end();
  assert.equal(firstComponent(view.edits.at(-1)).disabled, true);
});

test('progression list and status views expose actionable selects and buttons', async () => {
  const questHero = createCharacter('owner', 'Quest Hero', 'warrior');
  questHero.wins = 10;
  const achievementHero = createCharacter('owner', 'Achievement Hero', 'warrior');
  achievementHero.level = 10;
  const cases = [
    ['quests', 'view', questHero, 3, 'daily_battles'],
    ['achievements', 'view', achievementHero, 3, 'level_10'],
    ['dungeon', 'list', createCharacter('owner', 'Dungeon Hero', 'warrior'), 3, 'crypt'],
    ['tower', 'view', createCharacter('owner', 'Tower Hero', 'warrior'), 2, null],
    ['idle', 'status', createCharacter('owner', 'Idle Hero', 'warrior'), 2, null],
  ];

  for (const [command, subcommand, hero, type, expectedValue] of cases) {
    const view = harness(command, subcommand, hero);
    await handleProgressionCommand(view.interaction, hero, view.store);
    const component = firstComponent(view.reply());
    assert.equal(view.reply().flags, MessageFlags.Ephemeral, `${command} should be ephemeral`);
    assert.equal(component.type, type, `${command} should use the expected component type`);
    if (expectedValue) assert.ok(component.options.some((option) => option.value === expectedValue));
  }
});

test('menu mutation closes safely when the active character changes', async () => {
  const hero = createCharacter('owner', 'Original Hero', 'rogue');
  const view = harness('ability', 'list', hero);
  await handleProgressionCommand(view.interaction, hero, view.store);
  const menu = firstComponent(view.reply());
  view.switchTo(createCharacter('owner', 'Other Hero', 'mage'));

  await view.listeners.collect({
    user: { id: 'owner' }, customId: menu.custom_id, values: ['vanish'],
    async deferUpdate() {}, async update() {},
    async reply() {},
  });
  const updatePayload = view.edits.at(-1);
  assert.equal(view.updates(), 0);
  assert.equal(view.stopped(), true);
  assert.match(updatePayload.content, /active character changed/);
  assert.equal(firstComponent(updatePayload).disabled, true);
});

test('craft menu previews selections and spends only after Apply', async () => {
  const hero = createCharacter('owner', 'Crafter', 'warrior');
  hero.materials = { dust: 1000, metal: 1000, hide: 1000, essence: 1000, relicShard: 100 };
  const view = harness('craft', 'menu', hero);
  await handleProgressionCommand(view.interaction, hero, view.store);
  assert.equal(view.reply().flags, MessageFlags.Ephemeral);

  let payload = await choose(view, view.reply(), 'create');
  assert.equal(payload.components.length, 5, 'create wizard should fit Discord’s five-row limit');
  payload = await choose(view, payload, 'weapon');
  payload = await choose(view, payload, 'olympian');
  payload = await choose(view, payload, 'b');
  assert.equal(view.updates(), 0, 'menu selections must not spend or save');
  const apply = buttonNamed(payload, 'Apply Crafting');
  assert.ok(apply && !apply.disabled);

  let completed;
  await view.listeners.collect({
    user: { id: 'owner' }, customId: apply.custom_id,
    async update(updated) { completed = updated; }, async reply() {},
  });
  assert.equal(view.updates(), 1);
  assert.equal(view.live().inventory.length, 1);
  assert.equal(view.live().materials.dust, 940);
  assert.equal(view.live().materials.metal, 970);
  assert.match(completed.content, /updated/);
  assert.equal(completed.components.length, 1, 'successful Apply resets the wizard');
});

test('item manager applies auto-salvage settings only after its Apply button', async () => {
  const hero = createCharacter('owner', 'Manager', 'rogue');
  const view = harness('items', 'manage', hero);
  await handleProgressionCommand(view.interaction, hero, view.store);
  let payload = await choose(view, view.reply(), 'auto');
  payload = await choose(view, payload, 'true');
  payload = await choose(view, payload, 'epic');
  assert.equal(view.updates(), 0);
  const apply = buttonNamed(payload, 'Apply Change');
  assert.ok(apply && !apply.disabled);

  await view.listeners.collect({
    user: { id: 'owner' }, customId: apply.custom_id,
    async update() {}, async reply() {},
  });
  assert.equal(view.updates(), 1);
  assert.deepEqual(view.live().autoSalvage, { enabled: true, maxRarity: 'epic' });
});
