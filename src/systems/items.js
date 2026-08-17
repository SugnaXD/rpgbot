const { RARITIES, GRADES } = require('../content');
const { generateDrop, lootLuck, normalizeCharacter } = require('../game');
const { normalizeCraftingMaterials, salvageInventoryItems, rerollItemStatGrade } = require('../features/crafting-system');
const {
  ADMIN_POWER_MODEL,
  isAdminItem,
  normalizeUpgradeLevel,
  recalculateNaturalItem,
} = require('./item-power');

function normalizeItemEconomy(character) {
  character.materials = { ...(character.materials || {}), ...normalizeCraftingMaterials(character.materials) };
  character.autoSalvage ||= { enabled: false, maxRarity: 'common' };
  for (const item of character.inventory || []) item.locked ??= false;
  return character;
}

function salvageValue(item) {
  const rarity = RARITIES[item.rarity] || RARITIES.common;
  const grade = GRADES[item.grade] || GRADES.f;
  return Math.max(1, (rarity.rank + 1) * 5 + grade.rank * 2 + (item.upgradeLevel || 0) * 3);
}

function toggleItemLock(character, itemId) {
  normalizeCharacter(character); normalizeItemEconomy(character);
  const item = character.inventory.find((entry) => entry.id === itemId);
  if (!item) return { ok: false, message: 'Item not found.' };
  if (item.unsupportedItemVersion) return { ok: false, message: 'This item was created by a newer power model and is locked for safety.' };
  item.locked = !item.locked;
  return { ok: true, item };
}

function salvageItems(character, itemIds) {
  normalizeCharacter(character); normalizeItemEconomy(character);
  const result = salvageInventoryItems(character, itemIds);
  if (!result.ok) return result;
  const removedIds = new Set(result.salvaged.map((item) => item.id));
  character.inventory = character.inventory.filter((item) => !removedIds.has(item.id));
  character.materials = result.character.materials;
  return { ...result, dust: result.materialsGained.dust };
}

function salvageByRarity(character, maxRarity) {
  normalizeCharacter(character); normalizeItemEconomy(character);
  if (!RARITIES[maxRarity]) return { ok: false, message: 'Unknown rarity.' };
  const rank = RARITIES[maxRarity].rank;
  return salvageItems(character, character.inventory.filter((item) => RARITIES[item.rarity].rank <= rank).map((item) => item.id));
}

function configureAutoSalvage(character, enabled, maxRarity = 'common') {
  normalizeItemEconomy(character);
  if (!RARITIES[maxRarity]) return { ok: false, message: 'Unknown rarity.' };
  character.autoSalvage = { enabled, maxRarity };
  return { ok: true, config: character.autoSalvage };
}

function receiveDrop(character, item) {
  normalizeCharacter(character); normalizeItemEconomy(character);
  character.itemsFound = (character.itemsFound || 0) + 1;
  const threshold = RARITIES[character.autoSalvage.maxRarity]?.rank ?? 0;
  if (character.autoSalvage.enabled && RARITIES[item.rarity].rank <= threshold && !item.locked) {
    const dust = salvageValue(item); character.materials.dust += dust;
    return { kept: false, dust, item };
  }
  character.inventory.push(item);
  return { kept: true, dust: 0, item };
}

function craftItem(character, type, random = Math.random) {
  normalizeCharacter(character); normalizeItemEconomy(character);
  const cost = 100;
  if (character.materials.dust < cost) return { ok: false, message: `Crafting costs ${cost} dust.` };
  character.materials.dust -= cost;
  const item = generateDrop(character.world, character.floor, random, lootLuck(character), type, character.level);
  character.inventory.push(item);
  return { ok: true, item, cost };
}

function upgradeItem(character, itemId) {
  normalizeCharacter(character); normalizeItemEconomy(character);
  const item = character.inventory.find((entry) => entry.id === itemId);
  if (!item) return { ok: false, message: 'Item not found.' };
  if (item.unsupportedItemVersion) return { ok: false, message: 'This item was created by a newer power model and cannot be upgraded here.' };
  if (isAdminItem(item) || item.powerModel === ADMIN_POWER_MODEL) return { ok: false, message: 'Admin-forged items cannot be upgraded through normal crafting.' };
  item.upgradeLevel ||= 0;
  if (item.upgradeLevel >= 20) return { ok: false, message: 'That item is already +20.' };
  const cost = 25 * (item.upgradeLevel + 1);
  if (character.materials.dust < cost) return { ok: false, message: `This upgrade costs ${cost} dust.` };
  character.materials.dust -= cost;
  item.upgradeLevel = normalizeUpgradeLevel(item.upgradeLevel + 1);
  Object.assign(item, recalculateNaturalItem(item));
  return { ok: true, item, cost };
}

function rerollItemStat(character, itemId, stat, random = Math.random) {
  normalizeCharacter(character); normalizeItemEconomy(character);
  const original = character.inventory.find((entry) => entry.id === itemId);
  const result = rerollItemStatGrade(character, itemId, stat, { random, luck: lootLuck(character) });
  if (!result.ok) return result;
  Object.assign(original, result.item);
  Object.assign(character, result.character);
  const index = character.inventory.findIndex((entry) => entry.id === itemId);
  if (index >= 0) character.inventory[index] = original;
  return { ...result, character, item: original };
}

module.exports = { normalizeItemEconomy, salvageValue, toggleItemLock, salvageItems, salvageByRarity, configureAutoSalvage, receiveDrop, craftItem, upgradeItem, rerollItemStat };
