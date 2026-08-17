'use strict';

const MIN_WORLD = 1;
const MAX_WORLD = 5;
const MIN_FLOOR = 1;
const MAX_FLOOR = 10;
const MIN_LEVEL = 1;
const MAX_LEVEL = 1000;
const STAGE_GROWTH = 1.0625;

const NORMAL_MOB_VARIANTS = Object.freeze({
  swift: Object.freeze({ id: 'swift', hp: 0.92, attack: 1.08 }),
  balanced: Object.freeze({ id: 'balanced', hp: 1, attack: 1 }),
  sturdy: Object.freeze({ id: 'sturdy', hp: 1.08, attack: 0.92 }),
});

function boundedInteger(value, minimum, maximum) {
  const number = Number(value);
  if (number === Infinity) return maximum;
  if (!Number.isFinite(number)) return minimum;
  return Math.max(minimum, Math.min(maximum, Math.floor(number)));
}

function boundedNonNegative(value) {
  const number = Number(value);
  if (number === Infinity) return Number.MAX_SAFE_INTEGER;
  if (!Number.isFinite(number)) return 0;
  return Math.max(0, number);
}

function normalizeLocation(world, floor) {
  return {
    world: boundedInteger(world, MIN_WORLD, MAX_WORLD),
    floor: boundedInteger(floor, MIN_FLOOR, MAX_FLOOR),
  };
}

function stageIndex(world, floor) {
  const location = normalizeLocation(world, floor);
  return (location.world - 1) * MAX_FLOOR + location.floor - 1;
}

function recommendedLevel(world, floor) {
  return stageIndex(world, floor) + 1;
}

function stageScale(world, floor) {
  return Math.pow(STAGE_GROWTH, stageIndex(world, floor));
}

function levelScale(level) {
  const boundedLevel = boundedInteger(level, MIN_LEVEL, MAX_LEVEL);
  return Math.max(1, boundedLevel / 50);
}

function normalVariant(variantId) {
  return NORMAL_MOB_VARIANTS[variantId] || NORMAL_MOB_VARIANTS.balanced;
}

/**
 * Returns the complete, rounded combat budget for a personal floor enemy.
 * Variants exchange at most eight percent HP for attack (or the reverse), so
 * all three retain effectively the same threat budget. Bosses ignore variants.
 */
function enemyScalingDescriptor(options = {}) {
  const location = normalizeLocation(options.world, options.floor);
  const boundedLevel = boundedInteger(options.level, MIN_LEVEL, MAX_LEVEL);
  const stage = stageIndex(location.world, location.floor);
  const stageMultiplier = Math.pow(STAGE_GROWTH, stage);
  const characterLevelMultiplier = levelScale(boundedLevel);
  const isBoss = Boolean(options.isBoss ?? options.boss ?? location.floor === MAX_FLOOR);
  const variant = isBoss ? NORMAL_MOB_VARIANTS.balanced : normalVariant(options.variant);
  const bossHpMultiplier = isBoss ? 2.5 : 1;
  const bossAttackMultiplier = isBoss ? 1.75 : 1;
  const bossXpMultiplier = isBoss ? 3.5 : 1;
  const bossGoldMultiplier = isBoss ? 3 : 1;

  const exactBase = {
    hp: 42 * stageMultiplier * characterLevelMultiplier * bossHpMultiplier,
    attack: 8 * stageMultiplier * characterLevelMultiplier * bossAttackMultiplier,
    xp: 28 * stageMultiplier * Math.pow(characterLevelMultiplier, 0.55) * bossXpMultiplier,
    gold: 18 * stageMultiplier * Math.pow(characterLevelMultiplier, 0.45) * bossGoldMultiplier,
  };
  const exact = {
    hp: exactBase.hp * variant.hp,
    attack: exactBase.attack * variant.attack,
    xp: exactBase.xp,
    gold: exactBase.gold,
  };
  const rounded = Object.fromEntries(
    Object.entries(exact).map(([key, value]) => [key, Math.max(1, Math.round(value))]),
  );

  return Object.freeze({
    world: location.world,
    floor: location.floor,
    stage,
    recommendedLevel: stage + 1,
    level: boundedLevel,
    stageScale: stageMultiplier,
    levelScale: characterLevelMultiplier,
    isBoss,
    variant: isBoss ? 'boss' : variant.id,
    variantMultipliers: Object.freeze({ hp: variant.hp, attack: variant.attack }),
    multipliers: Object.freeze({
      stage: stageMultiplier,
      level: characterLevelMultiplier,
      bossHp: bossHpMultiplier,
      bossAttack: bossAttackMultiplier,
      bossXp: bossXpMultiplier,
      bossGold: bossGoldMultiplier,
    }),
    base: Object.freeze(Object.fromEntries(
      Object.entries(exactBase).map(([key, value]) => [key, Math.max(1, Math.round(value))]),
    )),
    exact: Object.freeze(exact),
    ...rounded,
  });
}

function diminishingDefenseMultiplier(defense) {
  const boundedDefense = boundedNonNegative(defense);
  if (boundedDefense === Number.MAX_SAFE_INTEGER) return 5;
  return 1 + boundedDefense / (100 + boundedDefense / 4);
}

function ascensionPowerMultiplier(points) {
  const boundedPoints = boundedNonNegative(points);
  return 1 + Math.min(1, 0.05 * Math.sqrt(boundedPoints));
}

function ascensionRewardMultiplier(points) {
  const boundedPoints = boundedNonNegative(points);
  return 1 + Math.min(0.5, 0.025 * Math.sqrt(boundedPoints));
}

module.exports = {
  MIN_WORLD,
  MAX_WORLD,
  MIN_FLOOR,
  MAX_FLOOR,
  MIN_LEVEL,
  MAX_LEVEL,
  STAGE_GROWTH,
  NORMAL_MOB_VARIANTS,
  normalizeLocation,
  stageIndex,
  stageFor: stageIndex,
  recommendedLevel,
  stageScale,
  levelScale,
  enemyScalingDescriptor,
  diminishingDefenseMultiplier,
  ascensionPowerMultiplier,
  ascensionRewardMultiplier,
};
