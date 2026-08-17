'use strict';

const ITEM_POWER_VERSION = 1;
const ITEM_SCHEMA_VERSION = 4;
const NATURAL_POWER_MODEL = 'natural-v1';
const LEGACY_POWER_MODEL = 'legacy-snapshot';
const ADMIN_POWER_MODEL = 'admin';

const MIN_WORLD = 1;
const MAX_WORLD = 5;
const MIN_FLOOR = 1;
const MAX_FLOOR = 10;
const MIN_STAGE = 1;
const MAX_STAGE = MAX_WORLD * MAX_FLOOR;
const MIN_ITEM_LEVEL = 1;
const MAX_ITEM_LEVEL = 1_000;
const MAX_NATURAL_POWER = 750;
const MAX_LEGACY_POWER = 5_000;
const MAX_ADMIN_POWER = 20_000_000;
const MAX_ADMIN_STAT = 5_000_000;
const MAX_UPGRADE_LEVEL = 20;
const UPGRADE_PER_LEVEL = 0.02;
const MIN_STAT_PERCENTAGE = 0;
const MAX_STAT_PERCENTAGE = 25;

const RARITY_POWER_FACTORS = Object.freeze({
  common: 1,
  uncommon: 1.07,
  rare: 1.15,
  epic: 1.24,
  legendary: 1.34,
  mythic: 1.46,
  secret: 1.6,
});

const STAT_SCALES = Object.freeze({
  attack: 1,
  defense: 1,
  strength: 0.55,
  intelligence: 0.55,
  agility: 0.35,
  luck: 0.35,
  hp: 4,
  mana: 2,
});

function boundedInteger(value, minimum, maximum, fallback = minimum) {
  const number = Number(value);
  if (number === Infinity) return maximum;
  if (number === -Infinity) return minimum;
  if (!Number.isFinite(number)) return fallback;
  return Math.max(minimum, Math.min(maximum, Math.round(number)));
}

function boundedNumber(value, minimum, maximum, fallback = minimum) {
  const number = Number(value);
  if (number === Infinity) return maximum;
  if (number === -Infinity) return minimum;
  if (!Number.isFinite(number)) return fallback;
  return Math.max(minimum, Math.min(maximum, number));
}

function normalizeWorldId(worldId) {
  return boundedInteger(worldId, MIN_WORLD, MAX_WORLD);
}

function normalizeFloor(floor) {
  return boundedInteger(floor, MIN_FLOOR, MAX_FLOOR);
}

function stageFromWorldFloor(worldId, floor) {
  return boundedInteger(
    (normalizeWorldId(worldId) - 1) * MAX_FLOOR + normalizeFloor(floor),
    MIN_STAGE,
    MAX_STAGE,
  );
}

function worldFloorFromStage(stage) {
  const normalized = boundedInteger(stage, MIN_STAGE, MAX_STAGE);
  return {
    worldId: Math.floor((normalized - 1) / MAX_FLOOR) + 1,
    floor: ((normalized - 1) % MAX_FLOOR) + 1,
  };
}

function normalizeItemLevel(itemLevel) {
  return boundedInteger(itemLevel, MIN_ITEM_LEVEL, MAX_ITEM_LEVEL);
}

function rarityFactor(rarity) {
  return RARITY_POWER_FACTORS[rarity] || RARITY_POWER_FACTORS.common;
}

function naturalPowerDetails({ worldId, floor, itemLevel, rarity } = {}) {
  const normalizedWorld = normalizeWorldId(worldId);
  const normalizedFloor = normalizeFloor(floor);
  const stage = stageFromWorldFloor(normalizedWorld, normalizedFloor);
  const normalizedLevel = normalizeItemLevel(itemLevel);
  const scaledLevel = Math.min(normalizedLevel, stage * 20);
  const rawPower = 12 + 2.4 * stage + 0.32 * scaledLevel;
  const factor = rarityFactor(rarity);
  const power = boundedInteger(Math.round(rawPower * factor), 1, MAX_NATURAL_POWER);
  return {
    worldId: normalizedWorld,
    floor: normalizedFloor,
    stage,
    itemLevel: normalizedLevel,
    scaledLevel,
    rarityFactor: factor,
    rawPower,
    power,
  };
}

function naturalItemPower(input = {}) {
  return naturalPowerDetails(input).power;
}

function statScale(stat) {
  return STAT_SCALES[stat] || 1;
}

function normalizeStatPercentage(percentage) {
  return boundedNumber(percentage, MIN_STAT_PERCENTAGE, MAX_STAT_PERCENTAGE);
}

function normalizeUpgradeLevel(upgradeLevel) {
  return boundedInteger(upgradeLevel, 0, MAX_UPGRADE_LEVEL);
}

function upgradeMultiplier(upgradeLevel) {
  return Math.round((1 + normalizeUpgradeLevel(upgradeLevel) * UPGRADE_PER_LEVEL) * 100) / 100;
}

function naturalStatCap(stat, upgradeLevel = MAX_UPGRADE_LEVEL) {
  return Math.ceil(
    MAX_NATURAL_POWER
      * (MAX_STAT_PERCENTAGE / 100)
      * statScale(stat)
      * upgradeMultiplier(upgradeLevel),
  );
}

function legacyStatCap(stat) {
  return naturalStatCap(stat) * 8;
}

function naturalBaseStat({ power, percentage, stat } = {}) {
  const safePower = boundedInteger(power, 1, MAX_NATURAL_POWER);
  const safePercentage = normalizeStatPercentage(percentage);
  const rolled = Math.round(safePower * safePercentage / 100 * statScale(stat));
  return boundedInteger(Math.max(1, rolled), 1, naturalStatCap(stat, 0));
}

function upgradedNaturalStat({ baseStat, stat, upgradeLevel } = {}) {
  const safeBase = boundedInteger(baseStat, 0, naturalStatCap(stat, 0), 0);
  const upgraded = Math.round(safeBase * upgradeMultiplier(upgradeLevel));
  return boundedInteger(upgraded, 0, naturalStatCap(stat, upgradeLevel), 0);
}

function naturalItemMetadata(input = {}) {
  const details = naturalPowerDetails(input);
  return {
    powerModel: NATURAL_POWER_MODEL,
    powerVersion: ITEM_POWER_VERSION,
    worldId: details.worldId,
    floor: details.floor,
    stage: details.stage,
    itemLevel: details.itemLevel,
    power: details.power,
  };
}

function cloneItem(item = {}) {
  return {
    ...item,
    stats: item.stats && typeof item.stats === 'object' ? { ...item.stats } : {},
    baseStats: item.baseStats && typeof item.baseStats === 'object' ? { ...item.baseStats } : {},
    statGrades: item.statGrades && typeof item.statGrades === 'object' ? { ...item.statGrades } : item.statGrades,
    statPercentages: item.statPercentages && typeof item.statPercentages === 'object' ? { ...item.statPercentages } : {},
    traits: Array.isArray(item.traits) ? [...item.traits] : item.traits,
  };
}

function itemStatKeys(item) {
  return [...new Set([
    ...Object.keys(item.stats || {}),
    ...Object.keys(item.baseStats || {}),
    ...Object.keys(item.statPercentages || {}),
  ])];
}

function isAdminItem(item) {
  return Boolean(item?.adminCreated) || item?.powerModel === ADMIN_POWER_MODEL;
}

function normalizeAdminItem(item) {
  const next = cloneItem(item);
  next.powerModel = ADMIN_POWER_MODEL;
  next.powerVersion = ITEM_POWER_VERSION;
  next.source ||= 'admin';
  next.worldId = 0;
  next.floor = 0;
  next.stage = 0;
  next.itemLevel = 0;
  next.power = boundedInteger(next.power, 0, MAX_ADMIN_POWER, 0);
  next.upgradeLevel = normalizeUpgradeLevel(next.upgradeLevel);
  next.stats = Object.fromEntries(itemStatKeys(next).map((stat) => [
    stat,
    boundedInteger(next.stats[stat], 0, MAX_ADMIN_STAT, 0),
  ]));
  next.baseStats = Object.fromEntries(itemStatKeys(next).map((stat) => [
    stat,
    boundedInteger(next.baseStats?.[stat], 0, MAX_ADMIN_STAT, next.stats[stat] || 0),
  ]));
  return next;
}

function snapshotLegacyItem(item = {}) {
  if (isAdminItem(item)) return normalizeAdminItem(item);

  const next = cloneItem(item);
  const alreadySnapshotted = next.powerModel === LEGACY_POWER_MODEL
    && next.baseStats
    && typeof next.baseStats === 'object'
    && Number.isFinite(Number(next.baseUpgradeLevel));
  const originalHadItemLevel = Number.isFinite(Number(item.itemLevel));
  const worldId = normalizeWorldId(next.worldId);
  const floor = normalizeFloor(next.floor);
  const stage = stageFromWorldFloor(worldId, floor);

  next.powerModel = LEGACY_POWER_MODEL;
  next.powerVersion = ITEM_POWER_VERSION;
  next.source ||= 'legacy';
  next.worldId = worldId;
  next.floor = floor;
  next.stage = stage;
  next.itemLevel = originalHadItemLevel ? normalizeItemLevel(next.itemLevel) : Math.min(MAX_ITEM_LEVEL, stage * 20);
  if (typeof next.itemLevelEstimated !== 'boolean') next.itemLevelEstimated = !originalHadItemLevel;
  next.power = boundedInteger(next.power, 1, MAX_LEGACY_POWER);
  next.upgradeLevel = normalizeUpgradeLevel(next.upgradeLevel);

  if (alreadySnapshotted) {
    next.baseUpgradeLevel = normalizeUpgradeLevel(next.baseUpgradeLevel);
    next.baseStats = Object.fromEntries(Object.entries(next.baseStats).map(([stat, value]) => [
      stat,
      boundedInteger(value, 0, legacyStatCap(stat), 0),
    ]));
  } else {
    next.baseUpgradeLevel = next.upgradeLevel;
    next.baseStats = Object.fromEntries(Object.entries(next.stats).map(([stat, value]) => [
      stat,
      boundedInteger(value, 0, legacyStatCap(stat), 0),
    ]));
  }
  next.stats = Object.fromEntries(Object.entries(next.stats).map(([stat, value]) => [
    stat,
    boundedInteger(value, 0, legacyStatCap(stat), 0),
  ]));
  return next;
}

function recalculateLegacySnapshot(item) {
  const next = snapshotLegacyItem(item);
  if (isAdminItem(next)) return next;
  const baselineMultiplier = upgradeMultiplier(next.baseUpgradeLevel);
  const currentMultiplier = upgradeMultiplier(next.upgradeLevel);
  const ratio = currentMultiplier / baselineMultiplier;
  next.stats = Object.fromEntries(Object.entries(next.baseStats).map(([stat, value]) => [
    stat,
    boundedInteger(Math.round(value * ratio), 0, legacyStatCap(stat), 0),
  ]));
  return next;
}

function hasCompleteNaturalSource(item) {
  return Number.isFinite(Number(item.worldId))
    && Number.isFinite(Number(item.floor))
    && Number.isFinite(Number(item.itemLevel));
}

function recalculateNaturalItem(item = {}) {
  if (isAdminItem(item)) return normalizeAdminItem(item);
  if (item.powerModel === LEGACY_POWER_MODEL) return recalculateLegacySnapshot(item);

  const next = cloneItem(item);
  const hasSource = hasCompleteNaturalSource(next);
  const details = naturalPowerDetails(next);
  next.powerModel = NATURAL_POWER_MODEL;
  next.powerVersion = ITEM_POWER_VERSION;
  next.worldId = details.worldId;
  next.floor = details.floor;
  next.stage = details.stage;
  next.itemLevel = details.itemLevel;
  next.power = hasSource
    ? details.power
    : boundedInteger(next.power, 1, MAX_NATURAL_POWER);
  next.upgradeLevel = normalizeUpgradeLevel(next.upgradeLevel);

  const baseStats = {};
  const stats = {};
  for (const stat of itemStatKeys(next)) {
    const hasPercentage = Object.prototype.hasOwnProperty.call(next.statPercentages, stat);
    let baseStat;
    if (hasPercentage) {
      next.statPercentages[stat] = normalizeStatPercentage(next.statPercentages[stat]);
      baseStat = naturalBaseStat({ power: next.power, percentage: next.statPercentages[stat], stat });
    } else if (Object.prototype.hasOwnProperty.call(next.baseStats, stat)) {
      baseStat = boundedInteger(next.baseStats[stat], 0, naturalStatCap(stat, 0), 0);
    } else {
      baseStat = boundedInteger(
        Math.round((Number(next.stats[stat]) || 0) / upgradeMultiplier(next.upgradeLevel)),
        0,
        naturalStatCap(stat, 0),
        0,
      );
    }
    baseStats[stat] = baseStat;
    stats[stat] = upgradedNaturalStat({ baseStat, stat, upgradeLevel: next.upgradeLevel });
  }
  next.baseStats = baseStats;
  next.stats = stats;
  return next;
}

module.exports = {
  ITEM_POWER_VERSION,
  ITEM_SCHEMA_VERSION,
  NATURAL_POWER_MODEL,
  LEGACY_POWER_MODEL,
  ADMIN_POWER_MODEL,
  MIN_WORLD,
  MAX_WORLD,
  MIN_FLOOR,
  MAX_FLOOR,
  MIN_STAGE,
  MAX_STAGE,
  MIN_ITEM_LEVEL,
  MAX_ITEM_LEVEL,
  MAX_NATURAL_POWER,
  MAX_LEGACY_POWER,
  MAX_ADMIN_POWER,
  MAX_ADMIN_STAT,
  MAX_UPGRADE_LEVEL,
  UPGRADE_PER_LEVEL,
  MIN_STAT_PERCENTAGE,
  MAX_STAT_PERCENTAGE,
  RARITY_POWER_FACTORS,
  STAT_SCALES,
  normalizeWorldId,
  normalizeFloor,
  stageFromWorldFloor,
  worldFloorFromStage,
  normalizeItemLevel,
  rarityFactor,
  rarityPowerFactor: rarityFactor,
  naturalPowerDetails,
  naturalItemPower,
  statScale,
  normalizeStatPercentage,
  normalizeUpgradeLevel,
  upgradeMultiplier,
  naturalStatCap,
  legacyStatCap,
  naturalBaseStat,
  upgradedNaturalStat,
  naturalItemMetadata,
  isAdminItem,
  snapshotLegacyItem,
  recalculateNaturalItem,
};
