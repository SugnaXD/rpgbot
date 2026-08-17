'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  ITEM_POWER_VERSION,
  NATURAL_POWER_MODEL,
  LEGACY_POWER_MODEL,
  ADMIN_POWER_MODEL,
  MAX_NATURAL_POWER,
  MAX_UPGRADE_LEVEL,
  RARITY_POWER_FACTORS,
  STAT_SCALES,
  stageFromWorldFloor,
  worldFloorFromStage,
  normalizeItemLevel,
  rarityFactor,
  naturalPowerDetails,
  naturalItemPower,
  statScale,
  naturalBaseStat,
  upgradeMultiplier,
  naturalStatCap,
  recalculateNaturalItem,
  snapshotLegacyItem,
} = require('../src/systems/item-power');

test('world and floor normalize to the bounded 1-50 stage map', () => {
  assert.equal(stageFromWorldFloor(1, 1), 1);
  assert.equal(stageFromWorldFloor(1, 10), 10);
  assert.equal(stageFromWorldFloor(2, 1), 11);
  assert.equal(stageFromWorldFloor(5, 10), 50);
  assert.equal(stageFromWorldFloor(-10, -10), 1);
  assert.equal(stageFromWorldFloor(Infinity, Infinity), 50);
  assert.deepEqual(worldFloorFromStage(31), { worldId: 4, floor: 1 });
  assert.deepEqual(worldFloorFromStage(999), { worldId: 5, floor: 10 });
});

test('item levels and rarity factors have safe defaults and caps', () => {
  assert.equal(normalizeItemLevel(-1), 1);
  assert.equal(normalizeItemLevel(125.6), 126);
  assert.equal(normalizeItemLevel(Infinity), 1000);
  assert.equal(rarityFactor('common'), 1);
  assert.equal(rarityFactor('secret'), 1.6);
  assert.equal(rarityFactor('not-real'), 1);
  assert.deepEqual(Object.values(RARITY_POWER_FACTORS), [1, 1.07, 1.15, 1.24, 1.34, 1.46, 1.6]);
});

test('natural-v1 power follows the stage, level gate, rarity curve, and hard cap', () => {
  assert.equal(naturalItemPower({ worldId: 1, floor: 1, itemLevel: 1, rarity: 'common' }), 15);
  assert.equal(naturalItemPower({ worldId: 1, floor: 10, itemLevel: 200, rarity: 'common' }), 100);
  assert.equal(naturalItemPower({ worldId: 2, floor: 10, itemLevel: 400, rarity: 'common' }), 188);
  assert.equal(naturalItemPower({ worldId: 3, floor: 10, itemLevel: 600, rarity: 'common' }), 276);
  assert.equal(naturalItemPower({ worldId: 4, floor: 10, itemLevel: 800, rarity: 'common' }), 364);
  assert.equal(naturalItemPower({ worldId: 5, floor: 10, itemLevel: 1000, rarity: 'common' }), 452);
  assert.equal(naturalItemPower({ worldId: 5, floor: 10, itemLevel: 1000, rarity: 'secret' }), 723);
  assert.equal(naturalItemPower({ worldId: 1, floor: 1, itemLevel: 1000, rarity: 'common' }), 21);
  assert.ok(naturalItemPower({ worldId: Infinity, floor: Infinity, itemLevel: Infinity, rarity: 'secret' }) <= MAX_NATURAL_POWER);

  const details = naturalPowerDetails({ worldId: 1, floor: 1, itemLevel: 1000, rarity: 'secret' });
  assert.equal(details.stage, 1);
  assert.equal(details.itemLevel, 1000);
  assert.equal(details.scaledLevel, 20);
  assert.equal(details.rawPower, 20.8);
  assert.equal(details.power, 33);
});

test('stat budgets use the requested bounded scale table', () => {
  assert.deepEqual(STAT_SCALES, {
    attack: 1, defense: 1, strength: 0.55, intelligence: 0.55,
    agility: 0.35, luck: 0.35, hp: 4, mana: 2,
  });
  assert.equal(statScale('attack'), 1);
  assert.equal(statScale('strength'), 0.55);
  assert.equal(statScale('agility'), 0.35);
  assert.equal(statScale('hp'), 4);
  assert.equal(statScale('mana'), 2);
  assert.equal(naturalBaseStat({ power: 723, percentage: 25, stat: 'attack' }), 181);
  assert.equal(naturalBaseStat({ power: 723, percentage: 25, stat: 'strength' }), 99);
  assert.equal(naturalBaseStat({ power: 723, percentage: 25, stat: 'agility' }), 63);
  assert.equal(naturalBaseStat({ power: 723, percentage: 25, stat: 'hp' }), 723);
  assert.equal(naturalBaseStat({ power: Infinity, percentage: Infinity, stat: 'attack' }), 188);
});

test('upgrade scaling adds exactly two percent per level and stops at +20', () => {
  assert.equal(upgradeMultiplier(-5), 1);
  assert.equal(upgradeMultiplier(1), 1.02);
  assert.equal(upgradeMultiplier(10), 1.2);
  assert.equal(upgradeMultiplier(MAX_UPGRADE_LEVEL), 1.4);
  assert.equal(upgradeMultiplier(999), 1.4);
  assert.equal(upgradeMultiplier(Infinity), 1.4);
  assert.equal(naturalStatCap('attack'), 263);
  assert.equal(naturalStatCap('hp'), 1050);
});

test('natural item recalculation is immutable, deterministic, and idempotent', () => {
  const input = {
    id: 'natural',
    type: 'weapon',
    rarity: 'secret',
    worldId: 5,
    floor: 10,
    itemLevel: 1000,
    power: 1,
    upgradeLevel: 20,
    stats: { attack: 1, strength: 1, agility: 1 },
    statGrades: { attack: 'z', strength: 'sss', agility: 'a' },
    statPercentages: { attack: 25, strength: 20, agility: 14 },
    traits: ['keen'],
  };
  const before = structuredClone(input);
  const result = recalculateNaturalItem(input);

  assert.deepEqual(input, before);
  assert.equal(result.powerModel, NATURAL_POWER_MODEL);
  assert.equal(result.powerVersion, ITEM_POWER_VERSION);
  assert.equal(result.power, 723);
  assert.equal(result.stage, 50);
  assert.deepEqual(result.baseStats, { attack: 181, strength: 80, agility: 35 });
  assert.deepEqual(result.stats, { attack: 253, strength: 112, agility: 49 });
  assert.deepEqual(recalculateNaturalItem(result), result);
});

test('legacy snapshots preserve current strength and scale only from their baseline', () => {
  const legacy = {
    id: 'legacy',
    type: 'weapon',
    rarity: 'secret',
    grade: 'z',
    worldId: 5,
    floor: 10,
    power: 200,
    upgradeLevel: 10,
    stats: { attack: 100, strength: 55 },
    statPercentages: { attack: 25, strength: 25 },
  };
  const before = structuredClone(legacy);
  const snapshot = snapshotLegacyItem(legacy);
  assert.deepEqual(legacy, before);
  assert.equal(snapshot.powerModel, LEGACY_POWER_MODEL);
  assert.equal(snapshot.itemLevel, 1000);
  assert.equal(snapshot.itemLevelEstimated, true);
  assert.equal(snapshot.baseUpgradeLevel, 10);
  assert.deepEqual(snapshot.baseStats, legacy.stats);
  assert.deepEqual(snapshotLegacyItem(snapshot), snapshot);
  assert.deepEqual(recalculateNaturalItem(snapshot).stats, legacy.stats);

  const upgraded = { ...snapshot, upgradeLevel: 11 };
  const recalculated = recalculateNaturalItem(upgraded);
  assert.deepEqual(recalculated.stats, { attack: 102, strength: 56 });
  assert.deepEqual(recalculateNaturalItem(recalculated), recalculated);
});

test('admin items bypass natural caps but malformed values are made finite', () => {
  const admin = {
    id: 'admin-item',
    adminCreated: true,
    type: 'weapon',
    rarity: 'secret',
    worldId: 5,
    floor: 10,
    itemLevel: 1000,
    power: 4_000_000,
    upgradeLevel: 0,
    stats: { attack: 1_000_000, hp: 5_000_000 },
    statPercentages: { attack: 25, hp: 25 },
  };
  const result = recalculateNaturalItem(admin);
  assert.equal(result.powerModel, ADMIN_POWER_MODEL);
  assert.equal(result.power, 4_000_000);
  assert.deepEqual(result.stats, admin.stats);
  assert.equal(result.worldId, 0);
  assert.equal(result.floor, 0);
  assert.deepEqual(recalculateNaturalItem(result), result);
  assert.deepEqual(snapshotLegacyItem(admin), result);

  const malformed = recalculateNaturalItem({
    adminCreated: true,
    power: Infinity,
    upgradeLevel: Infinity,
    stats: { attack: Infinity, hp: Number.NaN },
    baseStats: { attack: Infinity, hp: Number.NaN },
  });
  assert.equal(Number.isFinite(malformed.power), true);
  assert.equal(malformed.upgradeLevel, MAX_UPGRADE_LEVEL);
  assert.equal(Object.values(malformed.stats).every(Number.isFinite), true);
  assert.equal(Object.values(malformed.baseStats).every(Number.isFinite), true);
});
