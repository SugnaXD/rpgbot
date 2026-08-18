'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { RARITIES: CONTENT_RARITIES } = require('../src/content');
const {
  STAGE_GROWTH,
  enemyScalingDescriptor,
  diminishingDefenseMultiplier,
  stageScale,
} = require('../src/systems/combat-scaling');
const {
  MAX_ADMIN_STAT,
  MAX_ADMIN_POWER,
  MAX_LEGACY_POWER,
  MAX_NATURAL_POWER,
  MAX_UPGRADE_LEVEL,
  RARITY_POWER_FACTORS,
  STAT_SCALES,
  naturalPowerDetails,
  naturalItemPower,
  naturalBaseStat,
  upgradedNaturalStat,
  naturalStatCap,
  legacyStatCap,
  rarityFactor,
  recalculateNaturalItem,
  snapshotLegacyItem,
  upgradeMultiplier,
  worldFloorFromStage,
} = require('../src/systems/item-power');

const LEVEL_CHECKPOINTS = Object.freeze([50, 250, 1000]);
const closeTo = (actual, expected, tolerance = 1e-12) => {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} was not within ${tolerance} of ${expected}`);
};

function regularEnemy(stage, level = 50) {
  const { worldId: world, floor } = worldFloorFromStage(stage);
  return enemyScalingDescriptor({ world, floor, level, isBoss: false, variant: 'balanced' });
}

function balancedPlayer(level) {
  const attack = 4 * level + 11;
  const hp = 17 * level + 83;
  const defense = 3 * level + 5;
  const criticalChance = Math.min(0.5, 0.12 + level * 0.001);
  return {
    attack,
    hp,
    defense,
    expectedDamage: attack * (1 + criticalChance * 0.75),
    mitigation: diminishingDefenseMultiplier(defense),
  };
}

test('all 50 regular enemy bases increase monotonically with exact 6.25% stage continuity', () => {
  for (const level of LEVEL_CHECKPOINTS) {
    let previous = regularEnemy(1, level);
    for (let stage = 2; stage <= 50; stage += 1) {
      const current = regularEnemy(stage, level);
      assert.ok(current.base.hp >= previous.base.hp, `base HP regressed at stage ${stage}, level ${level}`);
      assert.ok(current.base.attack >= previous.base.attack, `base attack regressed at stage ${stage}, level ${level}`);
      assert.ok(current.base.hp * current.base.attack > previous.base.hp * previous.base.attack, `base threat did not rise at stage ${stage}, level ${level}`);
      closeTo(current.exact.hp / previous.exact.hp, STAGE_GROWTH);
      closeTo(current.exact.attack / previous.exact.attack, STAGE_GROWTH);
      closeTo(stageScale(current.world, current.floor) / stageScale(previous.world, previous.floor), 1.0625);
      previous = current;
    }
  }
});

test('each world boss has one bounded spike over its immediately prior regular floor', () => {
  const expectedHpSpike = STAGE_GROWTH * 2.5;
  const expectedAttackSpike = STAGE_GROWTH * 1.75;
  for (const level of LEVEL_CHECKPOINTS) {
    for (let world = 1; world <= 5; world += 1) {
      const prior = enemyScalingDescriptor({ world, floor: 9, level, isBoss: false, variant: 'balanced' });
      const boss = enemyScalingDescriptor({ world, floor: 10, level, isBoss: true });
      const hpSpike = boss.exact.hp / prior.exact.hp;
      const attackSpike = boss.exact.attack / prior.exact.attack;
      const threatSpike = boss.exact.hp * boss.exact.attack / (prior.exact.hp * prior.exact.attack);
      closeTo(hpSpike, expectedHpSpike);
      closeTo(attackSpike, expectedAttackSpike);
      closeTo(threatSpike, expectedHpSpike * expectedAttackSpike);
      assert.ok(hpSpike >= 2.6 && hpSpike <= 2.7);
      assert.ok(attackSpike >= 1.8 && attackSpike <= 1.9);
      assert.ok(threatSpike >= 4.8 && threatSpike <= 5.1);
    }
  }
});

test('the level-scaled W5F10 boss tracks balanced player offense and diminishing-defense survival', () => {
  const turnsToKill = [];
  const incomingHitRatios = [];
  for (const level of LEVEL_CHECKPOINTS) {
    const player = balancedPlayer(level);
    const boss = enemyScalingDescriptor({ world: 5, floor: 10, level, isBoss: true });
    const turns = boss.exact.hp / player.expectedDamage;
    const incomingRatio = boss.exact.attack / player.mitigation / player.hp;
    turnsToKill.push(turns);
    incomingHitRatios.push(incomingRatio);
    assert.ok(turns >= 7 && turns <= 9, `level ${level} boss TTK was ${turns}`);
    assert.ok(incomingRatio >= 0.06 && incomingRatio <= 0.15, `level ${level} incoming hit ratio was ${incomingRatio}`);
  }
  assert.ok(Math.max(...turnsToKill) / Math.min(...turnsToKill) <= 1.25, 'boss TTK drifted too far across levels');
  assert.ok(Math.max(...incomingHitRatios) / Math.min(...incomingHitRatios) <= 2, 'survival budget drifted too far across levels');
  assert.ok(diminishingDefenseMultiplier(1000) < diminishingDefenseMultiplier(3000));
  assert.ok(diminishingDefenseMultiplier(3000) < 5);
});

test('matched-level natural item power is monotonic across all 50 stages and every rarity', () => {
  for (const rarity of Object.keys(RARITY_POWER_FACTORS)) {
    let previous = 0;
    for (let stage = 1; stage <= 50; stage += 1) {
      const { worldId, floor } = worldFloorFromStage(stage);
      const power = naturalItemPower({ worldId, floor, itemLevel: stage * 20, rarity });
      assert.ok(Number.isSafeInteger(power) && power > previous, `${rarity} power was not monotonic at stage ${stage}`);
      assert.ok(power <= MAX_NATURAL_POWER);
      previous = power;
    }
  }
});

test('world-one overlevel farming cannot bypass its stage item-level cap', () => {
  for (const floor of [1, 5, 10]) {
    const stage = floor;
    for (const rarity of Object.keys(RARITY_POWER_FACTORS)) {
      const cappedLevel = stage * 20;
      const atCap = naturalPowerDetails({ worldId: 1, floor, itemLevel: cappedLevel, rarity });
      const overlevelled = naturalPowerDetails({ worldId: 1, floor, itemLevel: 1000, rarity });
      assert.equal(overlevelled.scaledLevel, cappedLevel);
      assert.equal(overlevelled.rawPower, atCap.rawPower);
      assert.equal(overlevelled.power, atCap.power);
    }
  }
});

test('rarity power factors stay ordered, incremental, and bounded', () => {
  const factors = Object.values(RARITY_POWER_FACTORS);
  assert.equal(factors[0], 1);
  assert.equal(factors.at(-1), 1.6);
  for (let index = 0; index < factors.length; index += 1) {
    assert.ok(Number.isFinite(factors[index]) && factors[index] >= 1 && factors[index] <= 1.6);
    if (index) {
      assert.ok(factors[index] > factors[index - 1]);
      assert.ok(factors[index] / factors[index - 1] <= 1.1, 'one rarity step exceeded ten percent');
    }
  }
  assert.equal(rarityFactor('unknown-rarity'), 1);
  assert.deepEqual(
    Object.fromEntries(Object.entries(CONTENT_RARITIES).map(([id, rarity]) => [id, rarity.multiplier])),
    RARITY_POWER_FACTORS,
  );
});

test('upgrade scaling is linear and exactly 1.4x at +20', () => {
  for (let level = 0; level <= MAX_UPGRADE_LEVEL; level += 1) {
    closeTo(upgradeMultiplier(level), 1 + level * 0.02);
  }
  assert.equal(upgradeMultiplier(20), 1.4);
  assert.equal(upgradeMultiplier(999), 1.4);
  assert.equal(upgradedNaturalStat({ baseStat: 100, stat: 'attack', upgradeLevel: 20 }), 140);
});

test('natural, legacy, and admin stat values remain finite and inside their model caps', () => {
  const stats = [...Object.keys(STAT_SCALES), 'unknown'];
  for (const stat of stats) {
    const baseCap = naturalStatCap(stat, 0);
    const upgradedCap = naturalStatCap(stat, MAX_UPGRADE_LEVEL);
    assert.ok(Number.isSafeInteger(baseCap) && baseCap > 0);
    assert.ok(Number.isSafeInteger(upgradedCap) && upgradedCap >= baseCap);
    for (const malformed of [Number.NaN, Infinity, -Infinity, -100, 0, 25, 1_000_000]) {
      const base = naturalBaseStat({ power: malformed, percentage: malformed, stat });
      const upgraded = upgradedNaturalStat({ baseStat: malformed, stat, upgradeLevel: malformed });
      assert.ok(Number.isSafeInteger(base) && base >= 1 && base <= baseCap, `${stat} base escaped its cap`);
      assert.ok(Number.isSafeInteger(upgraded) && upgraded >= 0 && upgraded <= upgradedCap, `${stat} upgrade escaped its cap`);
    }
  }

  const statPercentages = Object.fromEntries(stats.map((stat) => [stat, Infinity]));
  const statValues = Object.fromEntries(stats.map((stat) => [stat, Infinity]));
  const natural = recalculateNaturalItem({
    worldId: Infinity, floor: Infinity, itemLevel: Infinity, rarity: 'secret', upgradeLevel: Infinity,
    stats: statValues, statPercentages,
  });
  assert.ok(natural.power <= MAX_NATURAL_POWER);
  for (const [stat, value] of Object.entries(natural.stats)) {
    assert.ok(Number.isSafeInteger(value) && value >= 0 && value <= naturalStatCap(stat, MAX_UPGRADE_LEVEL));
  }

  const legacy = snapshotLegacyItem({ power: Infinity, upgradeLevel: Infinity, stats: statValues });
  assert.ok(Number.isSafeInteger(legacy.power) && legacy.power <= MAX_LEGACY_POWER);
  for (const [stat, value] of Object.entries(legacy.stats)) {
    assert.ok(Number.isSafeInteger(value) && value >= 0 && value <= legacyStatCap(stat));
  }

  const admin = recalculateNaturalItem({ adminCreated: true, power: Infinity, stats: statValues });
  assert.ok(Number.isSafeInteger(admin.power) && admin.power <= MAX_ADMIN_POWER);
  assert.ok(Object.values(admin.stats).every((value) => Number.isSafeInteger(value) && value >= 0 && value <= MAX_ADMIN_STAT));
});
