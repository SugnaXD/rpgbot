'use strict';

const { GRADES, ITEM_TRAITS } = require('../content');
const {
  ITEM_SCHEMA_VERSION,
  LEGACY_POWER_MODEL,
  isAdminItem,
  normalizeItemLevel,
  naturalBaseStat,
  recalculateNaturalItem,
  snapshotLegacyItem,
  stageFromWorldFloor,
  upgradedNaturalStat,
  worldFloorFromStage,
} = require('../systems/item-power');

const MATERIAL_CAPS = Object.freeze({
  dust: 250_000,
  metal: 100_000,
  hide: 100_000,
  essence: 25_000,
  relicShard: 2_500,
});

const SALVAGE_YIELD_CAPS = Object.freeze({
  dust: 250,
  metal: 100,
  hide: 100,
  essence: 25,
  relicShard: 3,
});

const GRADE_ORDER = Object.freeze(
  Object.keys(GRADES).sort((left, right) => GRADES[left].rank - GRADES[right].rank),
);
const MAX_CRAFTABLE_GRADE = 'sss';
const MAX_IMPROVABLE_GRADE = 'sss';
const CRAFTABLE_GRADES = Object.freeze(
  GRADE_ORDER.filter((grade) => GRADES[grade].rank <= GRADES[MAX_CRAFTABLE_GRADE].rank),
);

const GRADE_TO_RARITY = Object.freeze({
  f: 'common',
  c: 'uncommon',
  b: 'rare',
  a: 'epic',
  s: 'legendary',
  ss: 'mythic',
  sss: 'mythic',
});

const CRAFT_COSTS = Object.freeze({
  f: Object.freeze({ dust: 20, component: 10 }),
  c: Object.freeze({ dust: 35, component: 18 }),
  b: Object.freeze({ dust: 60, component: 30, essence: 2 }),
  a: Object.freeze({ dust: 100, component: 50, essence: 5 }),
  s: Object.freeze({ dust: 175, component: 90, essence: 12, relicShard: 1 }),
  ss: Object.freeze({ dust: 300, component: 150, essence: 25, relicShard: 3 }),
  sss: Object.freeze({ dust: 500, component: 250, essence: 50, relicShard: 8 }),
});

const STAT_GRADE_COSTS = Object.freeze({
  c: Object.freeze({ dust: 30, component: 10 }),
  b: Object.freeze({ dust: 55, component: 18, essence: 1 }),
  a: Object.freeze({ dust: 90, component: 30, essence: 3 }),
  s: Object.freeze({ dust: 150, component: 50, essence: 7 }),
  ss: Object.freeze({ dust: 250, component: 85, essence: 15, relicShard: 2 }),
  sss: Object.freeze({ dust: 400, component: 140, essence: 30, relicShard: 5 }),
});
const STAT_REROLL_COST = Object.freeze({ dust: 75 });

const CRAFTING_THEMES = Object.freeze({
  olympian: Object.freeze({
    name: 'Olympian',
    weapon: Object.freeze({ name: 'Olympian Thunderblade', traits: Object.freeze(['keen', 'giant_slayer', 'artisan']) }),
    armor: Object.freeze({ name: 'Olympian Aegis', traits: Object.freeze(['bulwark', 'artisan', 'giant_slayer']) }),
  }),
  wild: Object.freeze({
    name: 'Wild Hunt',
    weapon: Object.freeze({ name: 'Wildwood Longbow', traits: Object.freeze(['pathfinder', 'scavenger', 'keen']) }),
    armor: Object.freeze({ name: 'Moon-Hunt Leathers', traits: Object.freeze(['scavenger', 'pathfinder', 'bulwark']) }),
  }),
  chthonic: Object.freeze({
    name: 'Chthonic',
    weapon: Object.freeze({ name: 'Stygian Reaver', traits: Object.freeze(['giant_slayer', 'keen', 'scavenger']) }),
    armor: Object.freeze({ name: 'Underworld Plate', traits: Object.freeze(['bulwark', 'giant_slayer', 'artisan']) }),
  }),
  forge: Object.freeze({
    name: 'Masterwork',
    weapon: Object.freeze({ name: 'Hephaestian Warhammer', traits: Object.freeze(['artisan', 'keen', 'giant_slayer']) }),
    armor: Object.freeze({ name: 'Hephaestian Bulwark', traits: Object.freeze(['artisan', 'bulwark', 'scavenger']) }),
  }),
});

const TRAIT_SLOTS_BY_RARITY = Object.freeze({ common: 0, uncommon: 0, rare: 1, epic: 1, legendary: 2, mythic: 2, secret: 3 });
const WEAPON_STATS = Object.freeze(['attack', 'strength', 'agility']);
const ARMOR_STATS = Object.freeze(['defense', 'hp', 'luck']);

function boundedInteger(value, maximum) {
  const number = Number(value);
  if (!Number.isFinite(number)) return number === Infinity ? maximum : 0;
  return Math.max(0, Math.min(maximum, Math.floor(number)));
}

function normalizeCraftingMaterials(materials = {}) {
  return Object.fromEntries(
    Object.entries(MATERIAL_CAPS).map(([material, cap]) => [material, boundedInteger(materials?.[material], cap)]),
  );
}

function cloneItem(item) {
  return {
    ...item,
    stats: item.stats ? { ...item.stats } : item.stats,
    ...(item.baseStats ? { baseStats: { ...item.baseStats } } : {}),
    statGrades: item.statGrades ? { ...item.statGrades } : item.statGrades,
    statPercentages: item.statPercentages ? { ...item.statPercentages } : item.statPercentages,
    traits: Array.isArray(item.traits) ? [...item.traits] : [],
  };
}

function cloneCharacter(character) {
  const value = character && typeof character === 'object' ? character : {};
  return {
    ...value,
    materials: { ...(value.materials || {}), ...normalizeCraftingMaterials(value.materials) },
    inventory: Array.isArray(value.inventory) ? value.inventory.map(cloneItem) : [],
    equipped: { ...(value.equipped || {}) },
  };
}

function emptyMaterials() {
  return Object.fromEntries(Object.keys(MATERIAL_CAPS).map((key) => [key, 0]));
}

function mergeBoundedMaterials(materials, gains) {
  const current = normalizeCraftingMaterials(materials);
  const added = emptyMaterials();
  const overflow = emptyMaterials();
  const next = { ...(materials || {}), ...current };

  for (const [material, cap] of Object.entries(MATERIAL_CAPS)) {
    const requested = boundedInteger(gains?.[material], Number.MAX_SAFE_INTEGER);
    const room = Math.max(0, cap - current[material]);
    added[material] = Math.min(room, requested);
    overflow[material] = Math.max(0, requested - added[material]);
    next[material] = current[material] + added[material];
  }
  return { materials: next, added, overflow };
}

function canAfford(materials, cost) {
  const wallet = normalizeCraftingMaterials(materials);
  return Object.entries(cost).every(([material, amount]) => wallet[material] >= amount);
}

function missingMaterials(materials, cost) {
  const wallet = normalizeCraftingMaterials(materials);
  return Object.fromEntries(
    Object.entries(cost)
      .map(([material, amount]) => [material, Math.max(0, amount - wallet[material])])
      .filter(([, amount]) => amount > 0),
  );
}

function spendMaterials(materials, cost) {
  const wallet = { ...(materials || {}), ...normalizeCraftingMaterials(materials) };
  for (const [material, amount] of Object.entries(cost)) wallet[material] -= amount;
  return wallet;
}

function itemGradeRank(item) {
  const ranks = Object.values(item?.statGrades || {})
    .map((grade) => GRADES[grade]?.rank)
    .filter(Number.isInteger);
  if (GRADES[item?.grade]) ranks.push(GRADES[item.grade].rank);
  return ranks.length ? Math.max(...ranks) : GRADES.f.rank;
}

function salvageYield(item) {
  if (!item || !['weapon', 'armor'].includes(item.type) || item.adminCreated) return emptyMaterials();
  const rarityRanks = { common: 0, uncommon: 1, rare: 2, epic: 3, legendary: 4, mythic: 5, secret: 6 };
  const rarityRank = rarityRanks[item.rarity] ?? 0;
  const gradeRank = itemGradeRank(item);
  const upgrades = boundedInteger(item.upgradeLevel, 20);
  const component = item.type === 'weapon' ? 'metal' : 'hide';
  const output = emptyMaterials();

  output.dust = Math.min(SALVAGE_YIELD_CAPS.dust, 5 + (rarityRank + 1) * 5 + gradeRank * 3 + upgrades * 2);
  output[component] = Math.min(SALVAGE_YIELD_CAPS[component], 3 + (rarityRank + 1) * 3 + Math.floor(gradeRank / 2) + upgrades);
  output.essence = Math.min(SALVAGE_YIELD_CAPS.essence, Math.max(0, rarityRank - 1) * 2 + Math.floor(gradeRank / 2));
  output.relicShard = Math.min(SALVAGE_YIELD_CAPS.relicShard, rarityRank >= 4 ? 1 + Math.floor((rarityRank - 4) / 2) : 0);
  return output;
}

function salvageInventoryItems(character, itemIds) {
  const next = cloneCharacter(character);
  const requestedIds = [...new Set(Array.isArray(itemIds) ? itemIds.filter(Boolean) : [])];
  if (!requestedIds.length) return { ok: false, message: 'Select at least one item to salvage.', character: next };

  const wanted = new Set(requestedIds);
  const equipped = new Set(Object.values(next.equipped).filter(Boolean));
  const rejected = [];
  const eligible = [];
  const byId = new Map(next.inventory.map((item) => [item.id, item]));

  for (const id of requestedIds) {
    const item = byId.get(id);
    if (!item) rejected.push({ id, reason: 'not_found' });
    else if (item.adminCreated) rejected.push({ id, reason: 'admin_created' });
    else if (equipped.has(id)) rejected.push({ id, reason: 'equipped' });
    else if (item.locked) rejected.push({ id, reason: 'locked' });
    else if (!['weapon', 'armor'].includes(item.type)) rejected.push({ id, reason: 'invalid_type' });
    else eligible.push(item);
  }

  if (!eligible.length) {
    return { ok: false, message: 'No selected items are eligible for salvage.', character: next, rejected };
  }

  const totalYield = eligible.reduce((total, item) => {
    const itemYield = salvageYield(item);
    for (const material of Object.keys(MATERIAL_CAPS)) total[material] += itemYield[material];
    return total;
  }, emptyMaterials());
  const merged = mergeBoundedMaterials(next.materials, totalYield);
  const removed = new Set(eligible.map((item) => item.id));
  next.inventory = next.inventory.filter((item) => !removed.has(item.id) || !wanted.has(item.id));
  next.materials = merged.materials;

  return {
    ok: true,
    character: next,
    count: eligible.length,
    salvaged: eligible,
    materialsGained: merged.added,
    overflow: merged.overflow,
    rejected,
  };
}

function componentForType(type) {
  return type === 'weapon' ? 'metal' : type === 'armor' ? 'hide' : null;
}

function materializeCost(template, type) {
  const component = componentForType(type);
  if (!template || !component) return null;
  const cost = {};
  for (const [key, value] of Object.entries(template)) cost[key === 'component' ? component : key] = value;
  return cost;
}

function getCraftCost(type, grade) {
  if (!CRAFTABLE_GRADES.includes(grade)) return null;
  return materializeCost(CRAFT_COSTS[grade], type);
}

function roundOne(value) {
  return Math.round(value * 10) / 10;
}

function unitRandom(random) {
  const value = Number(random());
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(0.999999999999, value));
}

function craftingSource(character) {
  const currentStage = stageFromWorldFloor(character?.world, character?.floor);
  const highestLocation = worldFloorFromStage(character?.highestStage);
  const highestStage = stageFromWorldFloor(highestLocation.worldId, highestLocation.floor);
  const stage = Math.max(currentStage, highestStage);
  const location = worldFloorFromStage(stage);
  return { ...location, stage, itemLevel: normalizeItemLevel(character?.level) };
}

function createCraftedId(character, themeId, type, random) {
  const owner = String(character.characterId || character.userId || 'hero').replace(/[^a-z0-9]/gi, '').slice(-12) || 'hero';
  const randomPart = Math.floor(unitRandom(random) * Number.MAX_SAFE_INTEGER).toString(36).padStart(8, '0');
  return `crafted-${owner}-${themeId}-${type}-${randomPart}`;
}

function craftThemedItem(character, options = {}) {
  const next = cloneCharacter(character);
  const { themeId, type, grade = 'b' } = options;
  const theme = CRAFTING_THEMES[themeId];
  if (!theme) return { ok: false, message: 'Unknown crafting theme.', character: next };
  if (!['weapon', 'armor'].includes(type)) return { ok: false, message: 'Crafted equipment must be a weapon or armor.', character: next };
  const cost = getCraftCost(type, grade);
  if (!cost) return { ok: false, message: `Crafting is limited to ${MAX_CRAFTABLE_GRADE.toUpperCase()} grade.`, character: next };
  if (!canAfford(next.materials, cost)) {
    return { ok: false, message: 'Not enough crafting materials.', missing: missingMaterials(next.materials, cost), cost, character: next };
  }

  const random = typeof options.random === 'function' ? options.random : Math.random;
  const statKeys = type === 'weapon' ? WEAPON_STATS : ARMOR_STATS;
  const statGrades = Object.fromEntries(statKeys.map((stat) => [stat, grade]));
  const statPercentages = Object.fromEntries(statKeys.map((stat) => {
    const definition = GRADES[grade];
    return [stat, roundOne(definition.minPercent + unitRandom(random) * (definition.maxPercent - definition.minPercent))];
  }));
  const rarity = GRADE_TO_RARITY[grade];
  const traitCount = TRAIT_SLOTS_BY_RARITY[rarity] || 0;
  const traits = theme[type].traits.filter((trait) => ITEM_TRAITS[trait]).slice(0, traitCount);
  const id = String(options.id || createCraftedId(next, themeId, type, random));
  if (next.inventory.some((item) => item.id === id)) return { ok: false, message: 'That crafted item id is already in use.', character: next };

  const source = craftingSource(next);
  const item = recalculateNaturalItem({
    id,
    name: theme[type].name,
    type,
    rarity,
    grade,
    statGrades,
    statPercentages,
    worldId: source.worldId,
    floor: source.floor,
    stage: source.stage,
    itemLevel: source.itemLevel,
    stats: {},
    baseStats: {},
    traits,
    traitSlots: traitCount,
    upgradeLevel: 0,
    traitRerolls: 0,
    crafted: true,
    craftTheme: themeId,
    source: 'craft',
    locked: false,
    schemaVersion: ITEM_SCHEMA_VERSION,
  });
  next.materials = spendMaterials(next.materials, cost);
  next.inventory.push(item);
  return { ok: true, character: next, item, cost };
}

function fixedTraitSlots(item) {
  if (Number.isInteger(item?.traitSlots)) return Math.max(0, Math.min(3, item.traitSlots));
  return Math.max(0, Math.min(3, Array.isArray(item?.traits) ? item.traits.length : 0));
}

function prepareOrdinaryItem(character, itemId) {
  const index = character.inventory.findIndex((entry) => entry.id === itemId);
  if (index < 0) return { ok: false, message: 'Item not found.' };
  const existing = character.inventory[index];
  if (existing.unsupportedItemVersion) return { ok: false, message: 'This item was created by a newer power model and is locked for safety.' };
  if (isAdminItem(existing)) return { ok: false, message: 'Admin-created equipment cannot use ordinary crafting mutations.' };
  const prepared = recalculateNaturalItem(
    existing.powerModel ? existing : snapshotLegacyItem(existing),
  );
  prepared.traitSlots = fixedTraitSlots(existing);
  character.inventory[index] = prepared;
  return { ok: true, item: prepared, index };
}

function recalculateCraftingStat(item, stat) {
  const naturalBase = naturalBaseStat({
    power: item.power,
    percentage: item.statPercentages[stat],
    stat,
  });
  item.baseStats ||= {};
  if (item.powerModel === LEGACY_POWER_MODEL) {
    item.baseStats[stat] = upgradedNaturalStat({
      baseStat: naturalBase,
      stat,
      upgradeLevel: item.baseUpgradeLevel,
    });
  } else {
    item.baseStats[stat] = naturalBase;
  }
  return recalculateNaturalItem(item);
}

function getTraitRerollCost(item) {
  const rerolls = boundedInteger(item?.traitRerolls, 100);
  const gradeRank = itemGradeRank(item);
  const cost = { dust: 50 + gradeRank * 15 + rerolls * 25, essence: 3 + Math.floor(gradeRank / 2) + rerolls };
  if (gradeRank >= GRADES.ss.rank) cost.relicShard = 1 + Math.floor(rerolls / 3);
  return cost;
}

function rerollItemTrait(character, itemId, traitSelector, options = {}) {
  const next = cloneCharacter(character);
  const prepared = prepareOrdinaryItem(next, itemId);
  if (!prepared.ok) return { ...prepared, character: next };
  let item = prepared.item;
  if (!Array.isArray(item.traits) || !item.traits.length) return { ok: false, message: 'That item has no trait to reroll.', character: next };

  const index = Number.isInteger(traitSelector) ? traitSelector : item.traits.indexOf(traitSelector);
  if (index < 0 || index >= item.traits.length) return { ok: false, message: 'Select one existing trait to reroll.', character: next };
  const currentTrait = item.traits[index];
  const candidates = Object.keys(ITEM_TRAITS).filter((trait) => trait !== currentTrait && !item.traits.includes(trait));
  if (!candidates.length) return { ok: false, message: 'No unused traits are available.', character: next };

  let replacement = options.replacementTraitId;
  if (replacement !== undefined && !candidates.includes(replacement)) {
    return { ok: false, message: 'The replacement must be a different, unused item trait.', character: next };
  }
  const random = typeof options.random === 'function' ? options.random : Math.random;
  replacement ||= candidates[Math.floor(unitRandom(random) * candidates.length)];
  const cost = getTraitRerollCost(item);
  if (!canAfford(next.materials, cost)) {
    return { ok: false, message: 'Not enough materials to reroll this trait.', missing: missingMaterials(next.materials, cost), cost, character: next };
  }

  item.traits[index] = replacement;
  item.traitRerolls = boundedInteger(item.traitRerolls, 100) + 1;
  item.traitSlots = fixedTraitSlots(item);
  item = recalculateNaturalItem(item);
  next.inventory[prepared.index] = item;
  next.materials = spendMaterials(next.materials, cost);
  return {
    ok: true,
    character: next,
    item,
    changed: { index, from: currentTrait, to: replacement },
    cost,
  };
}

function rollOrdinaryRerollGrade(random = Math.random, luck = 0) {
  const grades = GRADE_ORDER.filter((grade) => GRADES[grade].rank <= GRADES[MAX_IMPROVABLE_GRADE].rank);
  const totalWeight = grades.reduce((total, grade) => total + GRADES[grade].weight, 0);
  let roll = Math.floor(unitRandom(random) * totalWeight);
  let selectedIndex = 0;
  for (let index = 0; index < grades.length; index += 1) {
    const grade = grades[index];
    if (roll < GRADES[grade].weight) {
      selectedIndex = index;
      break;
    }
    roll -= GRADES[grade].weight;
  }
  const promotionChance = Math.min(0.05, Math.max(0, Number(luck) || 0) / 20000);
  if (selectedIndex < grades.length - 1 && promotionChance > 0 && unitRandom(random) < promotionChance) selectedIndex += 1;
  return grades[selectedIndex] || MAX_IMPROVABLE_GRADE;
}

function rerollItemStatGrade(character, itemId, stat, options = {}) {
  const next = cloneCharacter(character);
  const prepared = prepareOrdinaryItem(next, itemId);
  if (!prepared.ok) return { ...prepared, character: next };
  let item = prepared.item;
  if (!item.stats || !Object.prototype.hasOwnProperty.call(item.stats, stat)) {
    return { ok: false, message: 'That item does not have the selected stat.', character: next };
  }
  if (!canAfford(next.materials, STAT_REROLL_COST)) {
    return {
      ok: false,
      message: 'Not enough materials to reroll this stat.',
      missing: missingMaterials(next.materials, STAT_REROLL_COST),
      cost: { ...STAT_REROLL_COST },
      character: next,
    };
  }

  const settings = typeof options === 'function' ? { random: options } : options;
  const random = typeof settings.random === 'function' ? settings.random : Math.random;
  const grade = rollOrdinaryRerollGrade(random, settings.luck);
  const definition = GRADES[grade];
  const percentage = roundOne(definition.minPercent + unitRandom(random) * (definition.maxPercent - definition.minPercent));
  const from = currentStatGrade(item, stat);
  item.statGrades ||= {};
  item.statPercentages ||= {};
  item.statGrades[stat] = grade;
  item.statPercentages[stat] = percentage;
  const primary = item.type === 'weapon' ? 'attack' : 'defense';
  if (stat === primary) item.grade = grade;
  item.traitSlots = fixedTraitSlots(item);
  item = recalculateCraftingStat(item, stat);
  next.inventory[prepared.index] = item;
  next.materials = spendMaterials(next.materials, STAT_REROLL_COST);
  return {
    ok: true,
    character: next,
    item,
    stat,
    changed: { stat, from, to: grade, percentage },
    grade,
    percentage,
    cost: { ...STAT_REROLL_COST },
  };
}

function currentStatGrade(item, stat) {
  const grade = item?.statGrades?.[stat] || item?.grade;
  return GRADES[grade] ? grade : null;
}

function nextImprovementGrade(item, stat) {
  if (isAdminItem(item)) return null;
  const current = currentStatGrade(item, stat);
  if (!current) return null;
  const currentIndex = GRADE_ORDER.indexOf(current);
  const target = GRADE_ORDER[currentIndex + 1];
  return target && GRADES[target].rank <= GRADES[MAX_IMPROVABLE_GRADE].rank ? target : null;
}

function getStatGradeImprovementCost(item, stat) {
  const target = nextImprovementGrade(item, stat);
  return target ? materializeCost(STAT_GRADE_COSTS[target], item.type) : null;
}

function improveItemStatGrade(character, itemId, stat) {
  const next = cloneCharacter(character);
  const prepared = prepareOrdinaryItem(next, itemId);
  if (!prepared.ok) return { ...prepared, character: next };
  let item = prepared.item;
  if (!item.stats || !Object.prototype.hasOwnProperty.call(item.stats, stat)) {
    return { ok: false, message: 'That item does not have the selected stat.', character: next };
  }
  const from = currentStatGrade(item, stat);
  if (!from) return { ok: false, message: 'That stat has no valid grade.', character: next };
  const to = nextImprovementGrade(item, stat);
  if (!to) return { ok: false, message: `Stat improvement is capped at ${MAX_IMPROVABLE_GRADE.toUpperCase()} grade.`, character: next };
  const cost = getStatGradeImprovementCost(item, stat);
  if (!canAfford(next.materials, cost)) {
    return { ok: false, message: 'Not enough materials to improve this stat grade.', missing: missingMaterials(next.materials, cost), cost, character: next };
  }

  const oldDefinition = GRADES[from];
  const newDefinition = GRADES[to];
  const oldPercentage = Number(item.statPercentages?.[stat]);
  const safeOldPercentage = Number.isFinite(oldPercentage)
    ? Math.max(oldDefinition.minPercent, Math.min(oldDefinition.maxPercent, oldPercentage))
    : (oldDefinition.minPercent + oldDefinition.maxPercent) / 2;
  const oldWidth = oldDefinition.maxPercent - oldDefinition.minPercent;
  const percentile = oldWidth > 0 ? (safeOldPercentage - oldDefinition.minPercent) / oldWidth : 0.5;
  const newPercentage = roundOne(newDefinition.minPercent + percentile * (newDefinition.maxPercent - newDefinition.minPercent));
  item.statGrades ||= {};
  item.statPercentages ||= {};
  item.statGrades[stat] = to;
  item.statPercentages[stat] = newPercentage;
  const primary = item.type === 'weapon' ? 'attack' : 'defense';
  if (stat === primary) item.grade = to;
  item.traitSlots = fixedTraitSlots(item);
  item = recalculateCraftingStat(item, stat);
  next.inventory[prepared.index] = item;
  next.materials = spendMaterials(next.materials, cost);

  return {
    ok: true,
    character: next,
    item,
    changed: { stat, from, to, percentage: newPercentage },
    cost,
  };
}

module.exports = {
  MATERIAL_CAPS,
  SALVAGE_YIELD_CAPS,
  GRADE_ORDER,
  CRAFTABLE_GRADES,
  MAX_CRAFTABLE_GRADE,
  MAX_IMPROVABLE_GRADE,
  CRAFTING_THEMES,
  CRAFT_COSTS,
  STAT_GRADE_COSTS,
  STAT_REROLL_COST,
  normalizeCraftingMaterials,
  mergeBoundedMaterials,
  canAfford,
  missingMaterials,
  salvageYield,
  salvageInventoryItems,
  getCraftCost,
  craftThemedItem,
  getTraitRerollCost,
  rerollItemTrait,
  rollOrdinaryRerollGrade,
  rerollItemStatGrade,
  rerollItemStat: rerollItemStatGrade,
  nextImprovementGrade,
  getStatGradeImprovementCost,
  improveItemStatGrade,
};
