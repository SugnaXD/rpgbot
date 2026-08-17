'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { ITEM_TRAITS } = require('../src/content');
const {
  MATERIAL_CAPS,
  MAX_CRAFTABLE_GRADE,
  normalizeCraftingMaterials,
  salvageYield,
  salvageInventoryItems,
  getCraftCost,
  craftThemedItem,
  rerollItemTrait,
  rollOrdinaryRerollGrade,
  rerollItemStatGrade,
  improveItemStatGrade,
} = require('../src/features/crafting-system');
const { NATURAL_POWER_MODEL } = require('../src/systems/item-power');

function equipment(overrides = {}) {
  return {
    id: 'item-1',
    name: 'Test Blade',
    type: 'weapon',
    rarity: 'rare',
    grade: 'b',
    power: 100,
    stats: { attack: 11, strength: 10, agility: 10 },
    statGrades: { attack: 'b', strength: 'b', agility: 'b' },
    statPercentages: { attack: 11, strength: 10.5, agility: 10.5 },
    traits: ['keen'],
    ...overrides,
  };
}

function hero(overrides = {}) {
  return {
    userId: 'u1',
    characterId: 'c1',
    level: 540,
    world: 3,
    floor: 7,
    highestStage: 27,
    materials: { dust: 10_000, metal: 10_000, hide: 10_000, essence: 10_000, relicShard: 1_000 },
    inventory: [],
    equipped: { weapon: null, armor: null },
    ...overrides,
  };
}

test('crafting material balances are integer-clamped to finite caps', () => {
  assert.deepEqual(normalizeCraftingMaterials({
    dust: MATERIAL_CAPS.dust + 50,
    metal: -4,
    hide: 12.9,
    essence: Infinity,
    relicShard: Number.NaN,
  }), {
    dust: MATERIAL_CAPS.dust,
    metal: 0,
    hide: 12,
    essence: MATERIAL_CAPS.essence,
    relicShard: 0,
  });
});

test('salvage removes only eligible items and never admin-created or equipped gear', () => {
  const salvageable = equipment({ id: 'salvage-me', upgradeLevel: 2 });
  const equipped = equipment({ id: 'equipped' });
  const admin = equipment({ id: 'admin', adminCreated: true, grade: 'z', rarity: 'secret' });
  const locked = equipment({ id: 'locked', locked: true });
  const original = hero({
    materials: { dust: MATERIAL_CAPS.dust - 1 },
    inventory: [salvageable, equipped, admin, locked],
    equipped: { weapon: equipped.id, armor: null },
  });
  const result = salvageInventoryItems(original, ['salvage-me', 'equipped', 'admin', 'locked']);

  assert.equal(result.ok, true);
  assert.equal(result.count, 1);
  assert.deepEqual(result.character.inventory.map((item) => item.id), ['equipped', 'admin', 'locked']);
  assert.equal(result.character.materials.dust, MATERIAL_CAPS.dust);
  assert.ok(result.overflow.dust > 0);
  assert.ok(result.character.materials.metal > 0);
  assert.deepEqual(result.rejected.map(({ reason }) => reason), ['equipped', 'admin_created', 'locked']);
  assert.equal(original.inventory.length, 4, 'the original character must not be mutated');
  assert.equal(salvageYield(admin).dust, 0);
});

test('thematic crafting spends multiple materials and creates a compatible item shape', () => {
  const original = hero();
  const cost = getCraftCost('weapon', 'a');
  const result = craftThemedItem(original, {
    themeId: 'olympian',
    type: 'weapon',
    grade: 'a',
    id: 'crafted-olympian-1',
    random: () => 0.5,
  });

  assert.equal(result.ok, true);
  assert.equal(result.item.name, 'Olympian Thunderblade');
  assert.equal(result.item.type, 'weapon');
  assert.equal(result.item.grade, 'a');
  assert.equal(result.item.rarity, 'epic');
  assert.deepEqual(Object.keys(result.item.stats), ['attack', 'strength', 'agility']);
  assert.deepEqual(Object.keys(result.item.statGrades), ['attack', 'strength', 'agility']);
  assert.ok(result.item.traits.every((trait) => ITEM_TRAITS[trait]));
  assert.equal(result.item.crafted, true);
  assert.equal(result.item.craftTheme, 'olympian');
  assert.equal(result.item.schemaVersion, 4);
  assert.equal(result.item.source, 'craft');
  assert.equal(result.item.powerModel, NATURAL_POWER_MODEL);
  assert.equal(result.item.worldId, 3);
  assert.equal(result.item.floor, 7);
  assert.equal(result.item.stage, 27);
  assert.equal(result.item.itemLevel, 540);
  assert.equal(result.item.power, 310);
  assert.equal(result.item.traitSlots, 1);
  assert.deepEqual(result.item.baseStats, { attack: 42, strength: 23, agility: 15 });
  assert.deepEqual(result.item.stats, result.item.baseStats);
  assert.equal(result.character.materials.dust, original.materials.dust - cost.dust);
  assert.equal(result.character.materials.metal, original.materials.metal - cost.metal);
  assert.equal(original.inventory.length, 0, 'crafting must not mutate the original character');
});

test('direct crafting cannot create Z gear and reports missing materials', () => {
  const poor = hero({ materials: {} });
  const zResult = craftThemedItem(poor, { themeId: 'wild', type: 'armor', grade: 'z', id: 'z' });
  assert.equal(zResult.ok, false);
  assert.match(zResult.message, new RegExp(MAX_CRAFTABLE_GRADE, 'i'));

  const costly = craftThemedItem(poor, { themeId: 'wild', type: 'armor', grade: 'sss', id: 'sss' });
  assert.equal(costly.ok, false);
  assert.ok(costly.missing.dust > 0);
  assert.ok(costly.missing.hide > 0);
  assert.equal(poor.inventory.length, 0);

  const sss = craftThemedItem(hero(), { themeId: 'wild', type: 'armor', grade: 'sss', id: 'sss-valid', random: () => 0.5 });
  assert.equal(sss.ok, true);
  assert.equal(sss.item.rarity, 'mythic');
  assert.equal(sss.item.traitSlots, 2);
  assert.equal(sss.item.traits.length, 2);
});

test('trait reroll replaces exactly one selected trait without duplicates', () => {
  const item = equipment({
    id: 'reroll', traits: ['keen', 'bulwark'], traitSlots: 2,
    powerModel: NATURAL_POWER_MODEL, worldId: 3, floor: 7, itemLevel: 540,
    upgradeLevel: 10,
  });
  const original = hero({ inventory: [item] });
  const result = rerollItemTrait(original, item.id, 0, { replacementTraitId: 'scavenger' });

  assert.equal(result.ok, true);
  assert.deepEqual(result.changed, { index: 0, from: 'keen', to: 'scavenger' });
  assert.deepEqual(result.item.traits, ['scavenger', 'bulwark']);
  assert.equal(result.item.traitSlots, 2);
  assert.equal(result.item.stats.attack, 38, 'trait mutations recalculate natural stats with the +2% curve');
  assert.equal(new Set(result.item.traits).size, result.item.traits.length);
  assert.deepEqual(original.inventory[0].traits, ['keen', 'bulwark']);

  const duplicate = rerollItemTrait(original, item.id, 'keen', { replacementTraitId: 'bulwark' });
  assert.equal(duplicate.ok, false);
});

test('ordinary stat rerolls use base stats, preserve trait slots, and can never roll Z', () => {
  assert.equal(rollOrdinaryRerollGrade(() => 0.999999), 'sss');
  const item = equipment({
    id: 'stat-reroll', grade: 'a', traits: ['keen'], traitSlots: 1, upgradeLevel: 10,
  });
  const original = hero({ inventory: [item] });
  const result = rerollItemStatGrade(original, item.id, 'attack', { random: () => 0.999999 });

  assert.equal(result.ok, true);
  assert.equal(result.grade, 'sss');
  assert.equal(result.percentage, 22.4);
  assert.equal(result.item.grade, 'sss');
  assert.equal(result.item.statGrades.attack, 'sss');
  assert.equal(result.item.stats.attack, 26);
  assert.equal(result.item.traitSlots, 1);
  assert.deepEqual(result.item.traits, ['keen']);
  assert.equal(result.character.materials.dust, original.materials.dust - 75);
  assert.equal(original.inventory[0].grade, 'a');
});

test('stat improvement raises one grade, recalculates its value, and stops at SSS', () => {
  const item = equipment({
    id: 'improve',
    grade: 'f',
    stats: { attack: 7, strength: 6, agility: 6 },
    statGrades: { attack: 'f', strength: 'f', agility: 'f' },
    statPercentages: { attack: 7.4, strength: 6, agility: 6 },
  });
  const original = hero({ inventory: [item] });
  const result = improveItemStatGrade(original, item.id, 'attack');

  assert.equal(result.ok, true);
  assert.deepEqual(result.changed, { stat: 'attack', from: 'f', to: 'c', percentage: 9.9 });
  assert.equal(result.item.grade, 'c');
  assert.equal(result.item.statGrades.attack, 'c');
  assert.equal(result.item.statGrades.strength, 'f');
  assert.equal(result.item.stats.attack, 10);
  assert.equal(original.inventory[0].grade, 'f');

  const cappedItem = equipment({ id: 'capped', grade: 'sss', statGrades: { attack: 'sss' } });
  const capped = improveItemStatGrade(hero({ inventory: [cappedItem] }), cappedItem.id, 'attack');
  assert.equal(capped.ok, false);
  assert.match(capped.message, /capped at SSS/i);
});

test('natural-v1 refinement applies the two-percent upgrade curve from base stats', () => {
  const item = equipment({
    id: 'natural-refine', rarity: 'common', grade: 'f',
    powerModel: NATURAL_POWER_MODEL, worldId: 3, floor: 7, itemLevel: 540,
    upgradeLevel: 10, traitSlots: 1,
    stats: { attack: 1, strength: 1, agility: 1 },
    baseStats: { attack: 1, strength: 1, agility: 1 },
    statGrades: { attack: 'f', strength: 'f', agility: 'f' },
    statPercentages: { attack: 7.4, strength: 6, agility: 6 },
  });
  const result = improveItemStatGrade(hero({ inventory: [item] }), item.id, 'attack');

  assert.equal(result.ok, true);
  assert.equal(result.item.power, 250);
  assert.equal(result.item.baseStats.attack, 25);
  assert.equal(result.item.stats.attack, 30);
  assert.equal(result.item.upgradeLevel, 10);
  assert.equal(result.item.traitSlots, 1);
});

test('ordinary trait, stat reroll, and refinement paths reject admin gear without spending', () => {
  const admin = equipment({
    id: 'admin-mutation', adminCreated: true, traits: ['keen'], traitSlots: 1,
    grade: 'f', statGrades: { attack: 'f', strength: 'f', agility: 'f' },
  });
  const original = hero({ inventory: [admin] });
  const attempts = [
    rerollItemTrait(original, admin.id, 0, { replacementTraitId: 'bulwark' }),
    rerollItemStatGrade(original, admin.id, 'attack', { random: () => 0 }),
    improveItemStatGrade(original, admin.id, 'attack'),
  ];

  for (const result of attempts) {
    assert.equal(result.ok, false);
    assert.match(result.message, /admin-created/i);
    assert.deepEqual(result.character.materials, original.materials);
    assert.deepEqual(result.character.inventory[0], original.inventory[0]);
  }
});
