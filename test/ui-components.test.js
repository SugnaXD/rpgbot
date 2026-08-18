const test = require('node:test');
const assert = require('node:assert/strict');
const { commandData } = require('../src/commands');
const { createCharacter } = require('../src/game');
const { handleInventory } = require('../src/features/inventory');
const { adminForgeComponents } = require('../src/ui/admin-forge');
const { confirmationComponents, requestConfirmation } = require('../src/ui/confirmation');
const { inventoryButtons, equipmentSelect } = require('../src/ui/equipment');
const { createMenuCustomIdCodec } = require('../src/ui/select-menus');

function assertDiscordComponentLimits(rows) {
  assert.ok(rows.length >= 1 && rows.length <= 5, 'messages support one to five action rows');
  for (const builder of rows) {
    const row = typeof builder.toJSON === 'function' ? builder.toJSON() : builder;
    assert.equal(row.type, 1);
    assert.ok(row.components.length >= 1 && row.components.length <= 5, 'action rows support one to five components');
    const selects = row.components.filter((component) => component.type === 3);
    if (selects.length) assert.equal(row.components.length, 1, 'a select menu must be the only component in its row');
    for (const component of row.components) {
      assert.ok(component.custom_id.length >= 1 && component.custom_id.length <= 100, 'custom_id must fit Discord limits');
      if (component.type === 2) {
        if (component.label) assert.ok(component.label.length <= 80, 'button labels must be at most 80 characters');
        continue;
      }
      assert.equal(component.type, 3, 'only buttons and string select menus are expected');
      assert.ok(component.options.length >= 1 && component.options.length <= 25, 'select menus support one to 25 options');
      assert.ok((component.min_values ?? 1) >= 0);
      assert.ok((component.max_values ?? 1) <= component.options.length, 'max_values cannot exceed the option count');
      for (const option of component.options) {
        assert.ok(option.label.length >= 1 && option.label.length <= 100, 'select labels must fit Discord limits');
        assert.ok(option.value.length >= 1 && option.value.length <= 100, 'select values must fit Discord limits');
        if (option.description) assert.ok(option.description.length <= 100, 'select descriptions must fit Discord limits');
      }
    }
  }
}

function weapon(id, name = `Weapon ${id}`) {
  return {
    id, name, type: 'weapon', rarity: 'common', grade: 'f', power: 1,
    stats: { attack: 1, strength: 1, agility: 1 },
    statGrades: { attack: 'f', strength: 'f', agility: 'f' },
    statPercentages: { attack: 10, strength: 10, agility: 10 }, traits: [],
  };
}

test('interactive component builders stay within Discord API limits', () => {
  const hero = createCharacter('owner', 'Menu Hero', 'warrior');
  hero.inventory = Array.from({ length: 30 }, (_, index) => weapon(`item-${index}`, `${'Very Long '.repeat(15)}${index}`));
  const equipment = equipmentSelect(hero, 'weapon');
  assert.equal(equipment.toJSON().components[0].options.length, 25, 'equipment menus paginate/truncate at Discord’s 25-option ceiling');

  const config = { type: 'weapon', grade: 'z', magnitude: 10000, stats: ['attack', 'strength'], traits: ['keen'] };
  const forge = adminForgeComponents(config);
  assert.equal(forge.length, 5, 'the forge uses Discord’s maximum of five action rows');

  assertDiscordComponentLimits([inventoryButtons(), equipment]);
  assertDiscordComponentLimits(forge);
  assertDiscordComponentLimits([confirmationComponents('12345678')]);
});

test('registered slash commands remain inside Discord command and choice limits', () => {
  assert.ok(commandData.length >= 1 && commandData.length <= 100);
  const inspectOption = (option) => {
    assert.ok(option.name.length >= 1 && option.name.length <= 32);
    assert.ok(option.description.length >= 1 && option.description.length <= 100);
    assert.ok((option.options || []).length <= 25, `${option.name} has too many nested options`);
    assert.ok((option.choices || []).length <= 25, `${option.name} has too many choices`);
    for (const choice of option.choices || []) {
      assert.ok(choice.name.length >= 1 && choice.name.length <= 100);
      if (typeof choice.value === 'string') assert.ok(choice.value.length >= 1 && choice.value.length <= 100);
    }
    for (const nested of option.options || []) inspectOption(nested);
  };
  for (const command of commandData) {
    assert.match(command.name, /^[-_\p{L}\p{N}]{1,32}$/u);
    assert.ok(command.description.length >= 1 && command.description.length <= 100);
    assert.ok((command.options || []).length <= 25, `${command.name} has too many options`);
    for (const option of command.options || []) inspectOption(option);
  }
});

test('inventory component collector accepts only the character owner', async () => {
  let collectorOptions;
  const collector = { on() { return collector; } };
  const message = {
    createMessageComponentCollector(options) { collectorOptions = options; return collector; },
  };
  const interaction = {
    user: { id: 'owner' },
    reply: async () => ({ resource: { message } }),
    editReply: async () => {},
  };
  await handleInventory(interaction, createCharacter('owner', 'Menu Hero', 'warrior'), { set: async () => {} });
  assert.equal(collectorOptions.filter({ user: { id: 'owner' } }), true);
  assert.equal(collectorOptions.filter({ user: { id: 'intruder' } }), false);
  assert.equal(collectorOptions.time, 120000);
});

test('confirmation collector requires both its owner and per-message token', async () => {
  let replyPayload; let collectorOptions;
  const listeners = {};
  const collector = {
    on(event, callback) {
      listeners[event] = callback;
      if (event === 'end') queueMicrotask(callback);
      return collector;
    },
  };
  const message = {
    createMessageComponentCollector(options) { collectorOptions = options; return collector; },
    edit: async () => {},
  };
  const interaction = {
    user: { id: 'owner' }, replied: false, deferred: false,
    reply: async (payload) => { replyPayload = payload; return { resource: { message } }; },
  };
  const result = await requestConfirmation(interaction, { title: 'Confirm', description: 'Test ownership.' });
  const id = replyPayload.components[0].toJSON().components[0].custom_id;
  assert.equal(result.confirmed, false);
  assert.equal(collectorOptions.filter({ user: { id: 'owner' }, customId: id }), true);
  assert.equal(collectorOptions.filter({ user: { id: 'intruder' }, customId: id }), false);
  assert.equal(collectorOptions.filter({ user: { id: 'owner' }, customId: 'confirm:wrong' }), false);
  assert.equal(collectorOptions.max, 1);
});

test('signed menu routes can bind component state to one Discord user', () => {
  const codec = createMenuCustomIdCodec({ prefix: 'rpg', secret: 'test secret long enough to sign' });
  const ownerId = '1234567890123456789';
  const id = codec.encode({ scope: 'contracts', action: 'claim', context: ownerId });
  assert.ok(id.length <= 100);
  assert.equal(codec.parse(id, { scope: 'contracts', action: 'claim', context: ownerId }).context, ownerId);
  assert.equal(codec.parse(id, { context: '9876543210987654321' }), null);
});
