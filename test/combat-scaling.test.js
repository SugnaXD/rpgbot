'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  NORMAL_MOB_VARIANTS,
  STAGE_GROWTH,
  ascensionPowerMultiplier,
  ascensionRewardMultiplier,
  diminishingDefenseMultiplier,
  enemyScalingDescriptor,
  levelScale,
  recommendedLevel,
  stageIndex,
  stageScale,
} = require('../src/systems/combat-scaling');

test('all fifty world floors form one continuous stage sequence', () => {
  const stages = [];
  for (let world = 1; world <= 5; world += 1) {
    for (let floor = 1; floor <= 10; floor += 1) {
      stages.push(stageIndex(world, floor));
      assert.equal(recommendedLevel(world, floor), stageIndex(world, floor) + 1);
    }
  }
  assert.deepEqual(stages, Array.from({ length: 50 }, (_, index) => index));
  assert.equal(stageScale(1, 1), 1);
  assert.ok(Math.abs(stageScale(2, 1) / stageScale(1, 10) - STAGE_GROWTH) < 1e-12);
});

test('normal baseline stats never decrease across stages or world boundaries', () => {
  for (const level of [1, 50, 250, 1000]) {
    let previous = null;
    for (let stage = 0; stage < 50; stage += 1) {
      const world = Math.floor(stage / 10) + 1;
      const floor = stage % 10 + 1;
      const enemy = enemyScalingDescriptor({ world, floor, level, isBoss: false, variant: 'balanced' });
      if (previous) {
        for (const field of ['hp', 'attack', 'xp', 'gold']) assert.ok(enemy.base[field] >= previous.base[field], `${field} decreased at stage ${stage}`);
      }
      previous = enemy;
    }
  }
});

test('level scaling starts at fifty and is capped at level one thousand', () => {
  assert.equal(levelScale(-100), 1);
  assert.equal(levelScale(1), 1);
  assert.equal(levelScale(50), 1);
  assert.equal(levelScale(250), 5);
  assert.equal(levelScale(1000), 20);
  assert.equal(levelScale(5000), 20);
  assert.equal(levelScale(Infinity), 20);

  const atFifty = enemyScalingDescriptor({ world: 5, floor: 10, level: 50 });
  const atThousand = enemyScalingDescriptor({ world: 5, floor: 10, level: 1000 });
  assert.ok(Math.abs(atThousand.exact.hp / atFifty.exact.hp - 20) < 1e-12);
  assert.ok(Math.abs(atThousand.exact.attack / atFifty.exact.attack - 20) < 1e-12);
  assert.ok(atThousand.exact.xp / atFifty.exact.xp < 6);
  assert.ok(atThousand.exact.gold / atFifty.exact.gold < 4);
});

test('bosses use the specified combat and reward multipliers', () => {
  const normal = enemyScalingDescriptor({ world: 3, floor: 10, level: 50, isBoss: false });
  const boss = enemyScalingDescriptor({ world: 3, floor: 10, level: 50, isBoss: true, variant: 'swift' });
  assert.ok(Math.abs(boss.exact.hp / normal.exact.hp - 2.5) < 1e-12);
  assert.ok(Math.abs(boss.exact.attack / normal.exact.attack - 1.75) < 1e-12);
  assert.ok(Math.abs(boss.exact.xp / normal.exact.xp - 3.5) < 1e-12);
  assert.ok(Math.abs(boss.exact.gold / normal.exact.gold - 3) < 1e-12);
  assert.equal(boss.variant, 'boss');
});

test('the final boss remains a controlled multi-turn fight from level fifty to one thousand', () => {
  for (const level of [50, 100, 250, 500, 1000]) {
    // Baseline Warrior with one of each earned point allocated to every stat.
    const playerAttack = 4 * level + 11;
    const playerHp = 17 * level + 83;
    const playerDefense = 3 * level + 5;
    const criticalChance = Math.min(0.5, 0.12 + level * 0.001);
    const expectedDamage = playerAttack * (1 + criticalChance * 0.75);
    const boss = enemyScalingDescriptor({ world: 5, floor: 10, level, isBoss: true });
    const turnsToKill = boss.exact.hp / expectedDamage;
    const incomingHpRatio = boss.exact.attack / diminishingDefenseMultiplier(playerDefense) / playerHp;
    assert.ok(turnsToKill >= 7 && turnsToKill <= 9, `level ${level} TTK was ${turnsToKill}`);
    assert.ok(incomingHpRatio >= 0.07 && incomingHpRatio <= 0.15, `level ${level} hit ratio was ${incomingHpRatio}`);
  }
});

test('three normal variants stay within an eight-percent stat exchange', () => {
  assert.deepEqual(Object.keys(NORMAL_MOB_VARIANTS), ['swift', 'balanced', 'sturdy']);
  const baseline = enemyScalingDescriptor({ world: 4, floor: 5, level: 250, isBoss: false, variant: 'balanced' });
  for (const variant of Object.keys(NORMAL_MOB_VARIANTS)) {
    const enemy = enemyScalingDescriptor({ world: 4, floor: 5, level: 250, isBoss: false, variant });
    assert.ok(enemy.variantMultipliers.hp >= 0.92 && enemy.variantMultipliers.hp <= 1.08);
    assert.ok(enemy.variantMultipliers.attack >= 0.92 && enemy.variantMultipliers.attack <= 1.08);
    assert.ok(Math.abs(enemy.exact.hp * enemy.exact.attack / (baseline.exact.hp * baseline.exact.attack) - 0.9936) < 0.0065);
    assert.equal(enemy.xp, baseline.xp);
    assert.equal(enemy.gold, baseline.gold);
  }
  assert.equal(enemyScalingDescriptor({ variant: 'invalid' }).variant, 'balanced');
});

test('defense has diminishing returns and asymptotically caps at five times EHP', () => {
  assert.equal(diminishingDefenseMultiplier(-10), 1);
  assert.ok(Math.abs(diminishingDefenseMultiplier(8) - 1.0784313725490196) < 1e-12);
  assert.ok(diminishingDefenseMultiplier(100) < 2);
  assert.ok(diminishingDefenseMultiplier(1000) < 4);
  assert.equal(diminishingDefenseMultiplier(Infinity), 5);
  assert.ok(diminishingDefenseMultiplier(Number.MAX_SAFE_INTEGER) <= 5);
});

test('ascension multipliers preserve early gains and enforce their caps', () => {
  assert.equal(ascensionPowerMultiplier(-1), 1);
  assert.equal(ascensionRewardMultiplier(NaN), 1);
  assert.equal(ascensionPowerMultiplier(1), 1.05);
  assert.equal(ascensionRewardMultiplier(4), 1.05);
  assert.equal(ascensionPowerMultiplier(400), 2);
  assert.equal(ascensionRewardMultiplier(400), 1.5);
  assert.equal(ascensionPowerMultiplier(Infinity), 2);
  assert.equal(ascensionRewardMultiplier(Infinity), 1.5);
});

test('malformed locations and levels are safely clamped', () => {
  const low = enemyScalingDescriptor({ world: -99, floor: NaN, level: null, isBoss: false });
  const high = enemyScalingDescriptor({ world: Infinity, floor: 999, level: Infinity, isBoss: false });
  assert.deepEqual([low.world, low.floor, low.level, low.stage], [1, 1, 1, 0]);
  assert.deepEqual([high.world, high.floor, high.level, high.stage], [5, 10, 1000, 49]);
  for (const enemy of [low, high]) {
    for (const field of ['hp', 'attack', 'xp', 'gold']) assert.ok(Number.isSafeInteger(enemy[field]) && enemy[field] > 0);
  }
});
