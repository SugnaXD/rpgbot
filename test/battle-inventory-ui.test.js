const test = require('node:test');
const assert = require('node:assert/strict');
const { ABILITIES } = require('../src/content/abilities');
const { createCharacter } = require('../src/game');
const { battleAbilitySelect } = require('../src/ui/battle');
const { equipmentMenu, parseEquipmentMenuId } = require('../src/ui/equipment');
const { handleInventory } = require('../src/features/inventory');

function weapon(id) {
  return {
    id, name: `Test Weapon ${id}`, type: 'weapon', rarity: 'common', grade: 'f', power: 1,
    stats: { attack: 1, strength: 1, agility: 1 },
    statGrades: { attack: 'f', strength: 'f', agility: 'f' },
    statPercentages: { attack: 10, strength: 10, agility: 10 }, traits: [],
  };
}

function menuFromRow(row) {
  return row.toJSON().components[0];
}

function assertSelectLimits(menu) {
  assert.equal(menu.type, 3);
  assert.ok(menu.custom_id.length >= 1 && menu.custom_id.length <= 100);
  assert.ok(menu.options.length >= 1 && menu.options.length <= 25);
  for (const option of menu.options) {
    assert.ok(option.label.length >= 1 && option.label.length <= 100);
    assert.ok(option.value.length >= 1 && option.value.length <= 100);
    if (option.description) assert.ok(option.description.length <= 100);
  }
}

test('battle ability select exposes only the active class abilities within Discord limits', () => {
  for (const classId of Object.keys(ABILITIES)) {
    const hero = createCharacter(`${classId}-owner`, `${classId} hero`, classId);
    hero.abilityCooldowns = Object.fromEntries(ABILITIES[classId].map((ability, index) => [ability.id, index + 1]));
    const menu = menuFromRow(battleAbilitySelect(hero));
    assertSelectLimits(menu);
    assert.equal(menu.custom_id, 'battle_ability');
    assert.deepEqual(menu.options.map((option) => option.value), ABILITIES[classId].map((ability) => ability.id));
    const foreignIds = Object.entries(ABILITIES)
      .filter(([otherClass]) => otherClass !== classId)
      .flatMap(([, abilities]) => abilities.map((ability) => ability.id));
    assert.equal(menu.options.some((option) => foreignIds.includes(option.value)), false);
    assert.match(menu.options[0].description, /turn cooldown$/);
  }
});

test('equipment menus paginate every item and encode the destination page in route IDs', () => {
  const hero = createCharacter('owner', 'Collector', 'warrior');
  hero.inventory = Array.from({ length: 61 }, (_, index) => weapon(`weapon-${index}`));
  const pages = [0, 1, 2].map((page) => equipmentMenu(hero, 'weapon', page));
  assert.deepEqual(pages.map((page) => page.page), [0, 1, 2]);
  assert.deepEqual(pages.map((page) => menuFromRow(page.rows[0]).options.length), [25, 25, 11]);
  const values = pages.flatMap((page) => menuFromRow(page.rows[0]).options.map((option) => option.value));
  assert.deepEqual(values, hero.inventory.map((item) => item.id));
  assert.equal(new Set(values).size, 61);

  for (const page of pages) {
    assert.ok(page.rows.length <= 2);
    assertSelectLimits(menuFromRow(page.rows[0]));
    const selectRoute = parseEquipmentMenuId(page.selectId);
    assert.deepEqual({ kind: selectRoute.kind, page: selectRoute.page, context: selectRoute.context }, { kind: 'select', page: page.page, context: 'weapon' });
    if (page.previousId) assert.equal(parseEquipmentMenuId(page.previousId).page, Math.max(0, page.page - 1));
    if (page.nextId) assert.equal(parseEquipmentMenuId(page.nextId).page, Math.min(2, page.page + 1));
  }
});

test('inventory pagination routes against live state and refuses a switched active character', async () => {
  const opened = createCharacter('owner', 'Collector', 'warrior');
  opened.inventory = Array.from({ length: 30 }, (_, index) => weapon(`weapon-${index}`));
  let live = structuredClone(opened);
  const updates = []; const replies = []; const saved = [];
  const listeners = {}; let collectorOptions;
  const collector = { on(event, callback) { listeners[event] = callback; return collector; } };
  const message = { createMessageComponentCollector(options) { collectorOptions = options; return collector; } };
  const interaction = {
    user: { id: 'owner' },
    reply: async () => ({ resource: { message } }),
    editReply: async () => {},
  };
  const store = {
    get: () => live,
    update: async (userId, character) => saved.push({ userId, character }),
    set: async () => { throw new Error('store.update should be preferred when available'); },
  };
  await handleInventory(interaction, opened, store);
  assert.equal(collectorOptions.filter({ user: { id: 'owner' } }), true);
  assert.equal(collectorOptions.filter({ user: { id: 'intruder' } }), false);

  const component = (properties) => ({
    user: { id: 'owner' },
    isButton: () => false,
    isStringSelectMenu: () => false,
    update: async (payload) => updates.push(payload),
    reply: async (payload) => replies.push(payload),
    ...properties,
  });
  await listeners.collect(component({ customId: 'inventory_weapon', isButton: () => true }));
  const firstPage = updates.at(-1);
  assert.equal(firstPage.components.length, 3);
  assert.equal(menuFromRow(firstPage.components[1]).options.length, 25);
  const nextId = firstPage.components[2].toJSON().components[1].custom_id;
  assert.deepEqual(
    { kind: parseEquipmentMenuId(nextId).kind, page: parseEquipmentMenuId(nextId).page, context: parseEquipmentMenuId(nextId).context },
    { kind: 'page', page: 1, context: 'weapon' },
  );

  await listeners.collect(component({ customId: nextId, isButton: () => true }));
  const secondPage = updates.at(-1);
  const secondMenu = menuFromRow(secondPage.components[1]);
  assert.equal(secondMenu.options.length, 5);
  assert.equal(secondMenu.options[0].value, 'weapon-25');

  const selectId = secondMenu.custom_id;
  await listeners.collect(component({ customId: selectId, values: ['weapon-29'], isStringSelectMenu: () => true }));
  assert.equal(saved.length, 1);
  assert.equal(saved[0].userId, 'owner');
  assert.equal(saved[0].character, live);
  assert.equal(live.equipped.weapon, 'weapon-29');

  live = createCharacter('owner', 'Different Active Hero', 'mage');
  await listeners.collect(component({ customId: nextId, isButton: () => true }));
  assert.match(replies.at(-1).content, /active character changed/i);
  assert.equal(saved.length, 1);
});
