const { CLASSES, SHOP, RARITIES, WORLDS, WEAPON_NAMES, ARMOR_NAMES, STATS, GRADES, ITEM_TRAITS, MASTER_CLASSES } = require('./content');
const { normalizeSystems, divineBonuses, addItemTraits, traitMultiplier } = require('./systems');
const {
  normalizeLocation,
  recommendedLevel,
  enemyScalingDescriptor,
  diminishingDefenseMultiplier,
  ascensionPowerMultiplier,
  ascensionRewardMultiplier,
} = require('./systems/combat-scaling');
const {
  ITEM_POWER_VERSION,
  ITEM_SCHEMA_VERSION,
  NATURAL_POWER_MODEL,
  naturalItemMetadata,
  naturalBaseStat,
  snapshotLegacyItem,
  recalculateNaturalItem,
} = require('./systems/item-power');
const { randomUUID } = require('node:crypto');

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const xpForLevel = (level) => 100 + (level - 1) * 60;
const MAX_LEVEL = 1000;
const STAT_KEYS = Object.keys(STATS);
const HEALTH_SCALING_VERSION = 2;
const LEGACY_STARTING_HP = Object.freeze({ warrior: 130, rogue: 100, mage: 90, admin: 1005 });
const MOB_VARIANTS = Object.freeze(['swift', 'balanced', 'sturdy']);
const RARITY_TRAIT_SLOTS = Object.freeze({ common: 0, uncommon: 0, rare: 1, epic: 1, legendary: 2, mythic: 2, secret: 3 });
const DEFAULT_GRADE_BY_RARITY = Object.freeze({ common: 'f', uncommon: 'c', rare: 'b', epic: 'a', legendary: 's', mythic: 'ss', secret: 'z' });

function randomUnit(random = Math.random) {
  const value = Number(random());
  return clamp(Number.isFinite(value) ? value : 0, 0, 1 - Number.EPSILON);
}

function deterministicItemRandom(item) {
  const seedText = `${item.id || ''}|${item.name || ''}|${item.rarity || ''}|${item.worldId || 0}|${item.floor || 0}`;
  let state = 2166136261;
  for (const character of seedText) {
    state ^= character.charCodeAt(0);
    state = Math.imul(state, 16777619);
  }
  return () => {
    state += 0x6D2B79F5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function createCharacter(userId, name, classId) {
  const role = CLASSES[classId];
  if (!role) throw new Error('Unknown character class.');
  return {
    userId, characterId: `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`,
    name, classId, level: 1, xp: 0, gold: 50, stats: Object.fromEntries(STAT_KEYS.map((key) => [key, 1])), statPoints: 0,
    hp: role.maxHp, maxHp: role.maxHp, healthScalingVersion: HEALTH_SCALING_VERSION,
    mana: 105, maxMana: 105, baseMaxMana: 105, attack: role.attack, defense: role.defense,
    potions: 2, equipment: [], inventory: [], equipped: { weapon: null, armor: null },
    mastery: 0, specialization: null, god: null, favour: 0,
    resources: { wood: 0, ore: 0, food: 0, crystal: 0, relic: 0 }, expedition: null,
    materials: { dust: 0 }, autoSalvage: { enabled: false, maxRarity: 'common' }, idleCombat: null,
    ascensions: 0, ascensionPoints: 0, achievementPoints: 0, claimedAchievements: [], towerFloor: 0,
    questState: { date: new Date().toISOString().slice(0, 10), claimed: [], baseline: { wins: 0, highestStage: 1, itemsFound: 0 } },
    world: 1, floor: 1, unlockedWorld: 1, worldProgress: { 1: 1 }, highestStage: 1, itemsFound: 0, wins: 0, losses: 0, lastDaily: null,
    createdAt: new Date().toISOString(),
  };
}

function rollEnemy(level, random = Math.random) {
  return rollFloorEnemy(1, Math.max(1, Math.min(10, level)), random, level);
}

function rollFloorEnemy(worldId, floor, random = Math.random, characterLevel = 1) {
  const location = normalizeLocation(worldId, floor);
  const world = WORLDS[location.world - 1] || WORLDS[0];
  const isBoss = location.floor === 10;
  const enemyIndex = isBoss ? -1 : Math.min(world.enemies.length - 1, Math.floor(randomUnit(random) * world.enemies.length));
  const variant = isBoss ? 'boss' : MOB_VARIANTS[enemyIndex % MOB_VARIANTS.length];
  const scaling = enemyScalingDescriptor({
    world: location.world,
    floor: location.floor,
    level: characterLevel,
    isBoss,
    variant,
  });
  const name = isBoss ? world.boss : world.enemies[enemyIndex];
  return {
    name, emoji: isBoss ? '👑' : world.emoji, worldId: scaling.world, floor: scaling.floor, isBoss,
    variant: scaling.variant, stage: scaling.stage, recommendedLevel: scaling.recommendedLevel,
    level: scaling.level, characterLevel: scaling.level, stageScale: scaling.stageScale, levelScale: scaling.levelScale,
    maxHp: scaling.hp, hp: scaling.hp, attack: scaling.attack, xp: scaling.xp, gold: scaling.gold,
  };
}

function rollRarity(random = Math.random, luck = 0) {
  const safeLuck = Math.max(0, Number.isFinite(Number(luck)) ? Number(luck) : Number(luck) === Infinity ? Number.MAX_SAFE_INTEGER : 0);
  const luckBias = 0.35 * (1 - Math.exp(-safeLuck / 500));
  const sample = randomUnit(random);
  const biasedSample = 1 - Math.pow(1 - sample, 1 + luckBias);
  let roll = Math.floor(biasedSample * 10000);
  for (const [id, rarity] of Object.entries(RARITIES)) {
    if (roll < rarity.weight) return id;
    roll -= rarity.weight;
  }
  return 'common';
}

function gradePromotionChance(luck = 0) {
  return Math.min(0.05, Math.max(0, Number(luck) || 0) / 20000);
}

function rollGrade(random = Math.random, luck = 0) {
  const randomValue = Number(random());
  let roll = Math.floor(clamp(Number.isFinite(randomValue) ? randomValue : 0, 0, 1 - Number.EPSILON) * 10000);
  const grades = Object.entries(GRADES);
  let gradeIndex = 0;
  for (let index = 0; index < grades.length; index += 1) {
    const [, grade] = grades[index];
    if (roll < grade.weight) {
      gradeIndex = index;
      break;
    }
    roll -= grade.weight;
  }
  const promotionChance = gradePromotionChance(luck);
  if (gradeIndex < grades.length - 1 && promotionChance > 0 && random() < promotionChance) gradeIndex += 1;
  return grades[gradeIndex][0];
}

function generateDrop(worldId, floor, random = Math.random, luck = 0, forcedType = null, itemLevel = recommendedLevel(worldId, floor)) {
  const rarityId = rollRarity(random, luck);
  const metadata = naturalItemMetadata({ worldId, floor, itemLevel, rarity: rarityId });
  const world = WORLDS[metadata.worldId - 1] || WORLDS[0];
  const type = ['weapon', 'armor'].includes(forcedType) ? forcedType : (randomUnit(random) < 0.5 ? 'weapon' : 'armor');
  const names = type === 'weapon' ? WEAPON_NAMES : ARMOR_NAMES;
  const power = metadata.power;
  const statKeys = type === 'weapon' ? ['attack', 'strength', 'agility'] : ['defense', 'hp', 'luck'];
  const statGrades = Object.fromEntries(statKeys.map((key) => [key, rollGrade(random, luck)]));
  const statPercentages = Object.fromEntries(statKeys.map((key) => {
    const grade = GRADES[statGrades[key]];
    return [key, Math.round((grade.minPercent + randomUnit(random) * (grade.maxPercent - grade.minPercent)) * 10) / 10];
  }));
  const stats = Object.fromEntries(statKeys.map((stat) => [stat, naturalBaseStat({ power, percentage: statPercentages[stat], stat })]));
  const primary = type === 'weapon' ? 'attack' : 'defense';
  return addItemTraits({
    id: randomUUID(),
    name: `${world.name.split(' ')[0]} ${names[Math.min(names.length - 1, Math.floor(randomUnit(random) * names.length))]}`,
    type, rarity: rarityId, grade: statGrades[primary], statGrades, statPercentages,
    ...metadata, source: 'drop', stats, baseStats: { ...stats }, traitSlots: RARITY_TRAIT_SLOTS[rarityId],
    powerVersion: ITEM_POWER_VERSION, schemaVersion: ITEM_SCHEMA_VERSION, upgradeLevel: 0, locked: false,
  }, random);
}

function normalizeCharacter(character) {
  normalizeSystems(character);
  character.inventory = Array.isArray(character.inventory)
    ? character.inventory.filter((item) => item && typeof item === 'object')
    : [];
  for (let index = 0; index < character.inventory.length; index += 1) {
    const item = character.inventory[index];
    const schemaVersion = Number(item.schemaVersion);
    const powerVersion = Number(item.powerVersion);
    const futureVersion = (Number.isFinite(schemaVersion) && schemaVersion > ITEM_SCHEMA_VERSION)
      || (Number.isFinite(powerVersion) && powerVersion > ITEM_POWER_VERSION);
    const legacySchema = schemaVersion !== ITEM_SCHEMA_VERSION;
    item.rarity = RARITIES[item.rarity] ? item.rarity : 'common';
    item.grade = GRADES[item.grade] ? item.grade : DEFAULT_GRADE_BY_RARITY[item.rarity];
    if (!item.stats || typeof item.stats !== 'object' || !Object.keys(item.stats).length) {
      const keys = item.type === 'weapon' ? ['attack', 'strength', 'agility'] : ['defense', 'hp', 'luck'];
      const grade = GRADES[item.grade] || GRADES.f;
      const percentage = Math.round((grade.minPercent + grade.maxPercent) * 5) / 10;
      item.stats = Object.fromEntries(keys.map((stat) => [stat, naturalBaseStat({
        power: item.power,
        percentage,
        stat,
      })]));
    }
    item.statGrades = {
      ...Object.fromEntries(Object.keys(item.stats).map((key) => [key, item.grade])),
      ...(item.statGrades || {}),
    };
    item.statPercentages = {
      ...Object.fromEntries(Object.keys(item.stats).map((key) => {
        const grade = GRADES[item.statGrades[key]] || GRADES.f;
        return [key, Math.round((grade.minPercent + grade.maxPercent) * 5) / 10];
      })),
      ...(item.statPercentages || {}),
    };
    item.upgradeLevel ??= 0;
    item.locked ??= false;
    const existingTraits = [...new Set((Array.isArray(item.traits) ? item.traits : []).filter((id) => ITEM_TRAITS[id]))];
    if (futureVersion) {
      item.unsupportedItemVersion = true;
      item.locked = true;
      item.traits = existingTraits;
      continue;
    }
    delete item.unsupportedItemVersion;
    const currentNaturalVersion = item.powerModel === NATURAL_POWER_MODEL
      && !legacySchema
      && powerVersion === ITEM_POWER_VERSION;
    const migrated = currentNaturalVersion
      ? recalculateNaturalItem(item)
      : snapshotLegacyItem(item);
    Object.assign(item, migrated);
    item.schemaVersion = ITEM_SCHEMA_VERSION;
    if (legacySchema && item.powerModel !== NATURAL_POWER_MODEL) item.traitSlots = Math.min(3, existingTraits.length);
    else if (!Number.isInteger(item.traitSlots)) item.traitSlots = RARITY_TRAIT_SLOTS[item.rarity];
    item.traits = existingTraits;
    addItemTraits(item, deterministicItemRandom(item));
  }
  const equipped = character.equipped && typeof character.equipped === 'object' ? character.equipped : {};
  character.equipped = Object.fromEntries(['weapon', 'armor'].map((slot) => {
    const match = character.inventory.find((item) => item.id === equipped[slot] && item.type === slot && !item.unsupportedItemVersion);
    return [slot, match ? match.id : null];
  }));
  character.world ||= 1; character.floor ||= 1; character.unlockedWorld ||= 1;
  character.worldProgress ||= { [character.world]: character.floor };
  character.highestStage ??= (character.world - 1) * 10 + character.floor;
  character.itemsFound ??= character.inventory.length;
  character.stats ||= Object.fromEntries(STAT_KEYS.map((key) => [key, 1]));
  if (character.stats.vitality !== undefined && character.stats.hp === undefined) {
    character.stats.hp = character.stats.vitality;
    delete character.stats.vitality;
  }
  for (const key of STAT_KEYS) character.stats[key] ||= 1;
  character.statPoints ??= Math.max(0, (character.level - 1) * STAT_KEYS.length);
  character.worldProgress[character.world] = Math.max(character.worldProgress[character.world] || 1, character.floor);
  if ((character.healthScalingVersion || 1) < HEALTH_SCALING_VERSION) {
    const legacyBase = LEGACY_STARTING_HP[character.classId];
    if (legacyBase && Number.isFinite(character.maxHp)) {
      const previousPermanentMax = Math.max(1, character.maxHp);
      const nextPermanentMax = Math.max(1, Math.round(previousPermanentMax + (100 - legacyBase)));
      const equippedHp = directEquipmentStat(character, 'hp');
      const divineHpMultiplier = 1 + (divineBonuses(character).stats.hp || 0);
      const previousPlayableMax = Math.max(1, Math.round((previousPermanentMax + equippedHp) * divineHpMultiplier));
      const nextPlayableMax = Math.max(1, Math.round((nextPermanentMax + equippedHp) * divineHpMultiplier));
      const previousHp = Number(character.hp) || 0;

      character.maxHp = nextPermanentMax;
      if (previousHp <= 0) character.hp = 0;
      else if (previousHp >= previousPlayableMax) character.hp = nextPlayableMax;
      else character.hp = Math.max(1, Math.round(nextPlayableMax * previousHp / previousPlayableMax));
    }
    character.healthScalingVersion = HEALTH_SCALING_VERSION;
  }
  character.baseMaxMana = 100 + character.stats.mana * 5;
  syncEquipmentMana(character);
  return character;
}

function directEquipmentStat(character, stat) {
  const equippedIds = new Set(Object.values(character.equipped || {}).filter(Boolean));
  return (character.inventory || []).reduce((total, item) => (
    equippedIds.has(item.id) ? total + (Number(item.stats?.[stat]) || 0) : total
  ), 0);
}

function syncEquipmentMana(character, restoreIncrease = false) {
  const previousMax = Number(character.maxMana) || Number(character.baseMaxMana) || 0;
  const nextMax = Math.max(0, (Number(character.baseMaxMana) || 0) + directEquipmentStat(character, 'mana'));
  character.maxMana = nextMax;
  if (character.mana === undefined || character.mana === null) character.mana = nextMax;
  else if (restoreIncrease && nextMax > previousMax) character.mana += nextMax - previousMax;
  character.mana = Math.max(0, Math.min(nextMax, character.mana));
  return nextMax;
}

function specializationChoice(character) {
  return (MASTER_CLASSES[character.classId] || []).find((choice) => choice.id === character.specialization) || null;
}

function permanentBaseBonus(character, stat) {
  const shopBonus = (character.equipment || []).reduce((total, itemId) => total + (SHOP[itemId]?.[stat] || 0), 0);
  return shopBonus + (specializationChoice(character)?.bonus?.[stat] || 0);
}

function specializationAllocatedStatBonus(character, stat) {
  if (!['agility', 'luck'].includes(stat)) return 0;
  return specializationChoice(character)?.bonus?.[stat] || 0;
}

function advanceFloor(character) {
  normalizeCharacter(character);
  if (character.floor < 10) {
    character.floor += 1;
    character.worldProgress[character.world] = Math.max(character.worldProgress[character.world] || 1, character.floor);
    character.highestStage = Math.max(character.highestStage || 1, (character.world - 1) * 10 + character.floor);
    return { worldUnlocked: null };
  }
  if (character.world < WORLDS.length) {
    character.unlockedWorld = Math.max(character.unlockedWorld, character.world + 1);
    const unlocked = character.world + 1;
    character.world = unlocked; character.floor = 1;
    character.worldProgress[unlocked] ||= 1;
    character.highestStage = Math.max(character.highestStage || 1, (unlocked - 1) * 10 + 1);
    return { worldUnlocked: unlocked };
  }
  return { worldUnlocked: null };
}

function equipItem(character, inventoryIndex) {
  normalizeCharacter(character);
  const item = character.inventory[inventoryIndex];
  if (!item) return { ok: false, message: 'No item exists in that inventory slot.' };
  if (!['weapon', 'armor'].includes(item.type) || item.id === undefined || item.id === null || item.unsupportedItemVersion) {
    return { ok: false, message: 'That item cannot be equipped in a weapon or armor slot.' };
  }
  character.equipped[item.type] = item.id;
  syncEquipmentMana(character, true);
  character.hp = Math.min(character.hp, derivedStats(character).maxHp);
  return { ok: true, item };
}

function gearBonus(character, type) {
  normalizeCharacter(character);
  const id = character.equipped[type];
  const item = character.inventory.find((entry) => entry.id === id);
  return Number(item?.stats?.[type === 'weapon' ? 'attack' : 'defense']) || 0;
}

function equippedItems(character) {
  normalizeCharacter(character);
  return Object.values(character.equipped).map((id) => character.inventory.find((item) => item.id === id)).filter(Boolean);
}

function equipmentStat(character, stat) {
  return equippedItems(character).reduce((total, item) => total + (item.stats?.[stat] || 0), 0);
}

function itemStatsText(item) {
  if (item.unsupportedItemVersion) return `Unsupported item schema/power version • Locked for safety`;
  const stats = item.stats && typeof item.stats === 'object' ? item.stats : {};
  const labels = { attack: 'ATK', defense: 'DEF', hp: 'HP', strength: 'STR', agility: 'AGI', luck: 'LCK', intelligence: 'INT', mana: 'MANA' };
  const base = Object.entries(stats).map(([key, value]) => {
    const grade = GRADES[item.statGrades?.[key] || item.grade || 'f'] || GRADES.f;
    const percentage = item.statPercentages?.[key];
    return `[${grade.name}${percentage !== undefined ? ` ${percentage}%` : ''}] +${value} ${labels[key] || key.toUpperCase()}`;
  }).join(' • ') || 'Stats unavailable';
  const traits = (item.traits || []).map((id) => ITEM_TRAITS[id]?.name || id).join(', ');
  const metadata = [];
  if (Number(item.itemLevel) > 0) metadata.push(`Lv ${Math.round(Number(item.itemLevel))}`);
  if (Number(item.worldId) > 0 && Number(item.floor) > 0) metadata.push(`W${Math.round(Number(item.worldId))} F${Math.round(Number(item.floor))}`);
  if (item.source) metadata.push(`Source: ${String(item.source).replace(/(^|-)([a-z])/g, (_, prefix, letter) => `${prefix ? ' ' : ''}${letter.toUpperCase()}`)}`);
  return [metadata.join(' • '), base, traits ? `Traits: ${traits}` : ''].filter(Boolean).join(' • ');
}

function derivedStats(character) {
  normalizeCharacter(character);
  const divine = divineBonuses(character);
  const rawStat = (stat) => character.stats[stat] + equipmentStat(character, stat);
  const statTotal = (stat) => rawStat(stat) * (1 + (divine.stats[stat] || 0));
  const defense = (character.defense + rawStat('defense')) * (1 + (divine.stats.defense || 0));
  const maxHp = (character.maxHp + equipmentStat(character, 'hp')) * (1 + (divine.stats.hp || 0));
  const magicAttack = character.classId === 'mage' ? statTotal('intelligence') : 0;
  const ascensionMultiplier = ascensionPowerMultiplier(character.ascensionPoints);
  const effectiveHpMultiplier = diminishingDefenseMultiplier(defense);
  return {
    maxHp: Math.round(maxHp),
    maxMana: character.maxMana,
    attack: Math.round((character.attack + statTotal('strength') + magicAttack + equipmentStat(character, 'attack')) * ascensionMultiplier),
    defense,
    effectiveHpMultiplier,
    effectiveHp: Math.round(maxHp * effectiveHpMultiplier),
    criticalChance: Math.min(0.5, 0.12 + statTotal('agility') * 0.001),
    divineLuck: divine.luck * (1 + (divine.stats.luck || 0)),
    divineDevotion: divine.devotion,
    ascensionMultiplier,
  };
}

function lootLuck(character) {
  const derived = derivedStats(character);
  const divineLuckPoints = Math.round((derived.divineLuck - 1) * 200);
  return Math.max(0, Math.round(character.stats.luck + equipmentStat(character, 'luck') + divineLuckPoints));
}

function allocateStats(character, stat, amount) {
  normalizeCharacter(character);
  if (!STAT_KEYS.includes(stat)) return { ok: false, message: 'That stat does not exist.' };
  if (!Number.isInteger(amount) || amount < 1) return { ok: false, message: 'Amount must be at least one.' };
  if (character.statPoints < amount) return { ok: false, message: `You only have ${character.statPoints} unspent stat points.` };
  character.stats[stat] += amount; character.statPoints -= amount;
  if (stat === 'hp') {
    character.maxHp += amount * 5;
    character.hp += amount * 5;
  }
  if (stat === 'mana') {
    character.baseMaxMana = (character.baseMaxMana || 100) + amount * 5;
    character.maxMana += amount * 5;
    character.mana = (character.mana || 0) + amount * 5;
  }
  return { ok: true };
}

function playerDamage(character, random = Math.random, defending = false) {
  const variance = 0.8 + random() * 0.4;
  const derived = derivedStats(character);
  const critical = random() < derived.criticalChance;
  const amount = Math.max(1, Math.round(derived.attack * variance * (critical ? 1.75 : 1) * traitMultiplier(character, 'combat')));
  return { amount, critical, defending };
}

function enemyDamage(enemy, character, random = Math.random, defending = false) {
  const mitigation = derivedStats(character).effectiveHpMultiplier;
  const raw = enemy.attack * (0.8 + random() * 0.4) / mitigation;
  return Math.max(1, Math.round(raw * (defending ? 0.45 : 1)));
}

function grantXp(character, amount) {
  normalizeCharacter(character);
  character.xp += amount;
  const levels = [];
  while (character.level < MAX_LEVEL && character.xp >= xpForLevel(character.level)) {
    character.xp -= xpForLevel(character.level);
    character.level += 1;
    character.maxHp += 12;
    character.attack += 3;
    character.defense += 2;
    character.statPoints += STAT_KEYS.length;
    character.hp = derivedStats(character).maxHp;
    levels.push(character.level);
  }
  if (character.level >= MAX_LEVEL) character.xp = 0;
  return levels;
}

function grantRewards(character, enemy) {
  const multiplier = ascensionRewardMultiplier(character.ascensionPoints);
  const gold = Math.round(enemy.gold * multiplier); const xp = Math.round(enemy.xp * multiplier);
  character.gold += gold;
  character.wins += 1;
  return grantXp(character, xp);
}

function setCharacterLevel(character, level) {
  normalizeCharacter(character);
  const target = clamp(level, 1, MAX_LEVEL);
  const allocated = STAT_KEYS.reduce((total, key) => total + character.stats[key] - 1
    - (character.adminGrantedStats?.[key] || 0) - specializationAllocatedStatBonus(character, key), 0);
  const earned = (target - 1) * STAT_KEYS.length;
  if (allocated > earned) return { ok: false, message: `Cannot lower this character below level ${Math.ceil(allocated / STAT_KEYS.length) + 1} because allocated stats would exceed earned points.` };
  const role = CLASSES[character.classId];
  character.level = target; character.xp = 0; character.statPoints = earned - allocated;
  character.maxHp = role.maxHp + (target - 1) * 12 + (character.stats.hp - 1) * 5 + permanentBaseBonus(character, 'hp');
  character.attack = role.attack + (target - 1) * 3 + permanentBaseBonus(character, 'attack');
  character.defense = role.defense + (target - 1) * 2 + permanentBaseBonus(character, 'defense');
  character.hp = character.maxHp;
  character.baseMaxMana = 100 + character.stats.mana * 5;
  syncEquipmentMana(character);
  character.mana = character.maxMana;
  return { ok: true };
}

function buyItem(character, itemId) {
  const item = SHOP[itemId];
  if (!item) return { ok: false, message: 'That item does not exist.' };
  if (item.unique && character.equipment.includes(itemId)) return { ok: false, message: 'You already own that item.' };
  if (character.gold < item.price) return { ok: false, message: `You need ${item.price - character.gold} more gold.` };
  character.gold -= item.price;
  if (itemId === 'potion') character.potions += 1;
  else {
    character.equipment.push(itemId);
    character.attack += item.attack || 0;
    character.defense += item.defense || 0;
  }
  return { ok: true, item };
}

function claimDaily(character, now = Date.now()) {
  const cooldown = 20 * 60 * 60 * 1000;
  const elapsed = character.lastDaily ? now - new Date(character.lastDaily).getTime() : cooldown;
  if (elapsed < cooldown) return { ok: false, remaining: cooldown - elapsed };
  const gold = 75 + character.level * 10;
  character.gold += gold;
  character.potions += 1;
  character.lastDaily = new Date(now).toISOString();
  return { ok: true, gold };
}

function healAtInn(character) {
  const maximum = derivedStats(character).maxHp;
  const missingMana = Math.max(0, (character.maxMana || 0) - (character.mana || 0));
  if (character.hp >= maximum && !missingMana) return { ok: false, message: 'You are already fully restored.' };
  const cost = Math.max(10, Math.ceil((maximum - character.hp) * 0.35 + missingMana * 0.1));
  if (character.gold < cost) return { ok: false, message: `A full rest costs ${cost} gold.` };
  character.gold -= cost;
  character.hp = maximum;
  character.mana = character.maxMana;
  return { ok: true, cost };
}

module.exports = { MAX_LEVEL, STAT_KEYS, ITEM_SCHEMA_VERSION, clamp, xpForLevel, createCharacter, rollEnemy, rollFloorEnemy, rollRarity, gradePromotionChance, rollGrade, generateDrop, normalizeCharacter, advanceFloor, equipItem, gearBonus, equippedItems, equipmentStat, itemStatsText, derivedStats, lootLuck, allocateStats, playerDamage, enemyDamage, grantXp, grantRewards, setCharacterLevel, buyItem, claimDaily, healAtInn };
