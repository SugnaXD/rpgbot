const { CLASSES, SHOP, RARITIES, WORLDS, WEAPON_NAMES, ARMOR_NAMES } = require('./content');

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const xpForLevel = (level) => 100 + (level - 1) * 60;

function createCharacter(userId, name, classId) {
  const role = CLASSES[classId];
  if (!role) throw new Error('Unknown character class.');
  return {
    userId, name, classId, level: 1, xp: 0, gold: 50,
    hp: role.maxHp, maxHp: role.maxHp, attack: role.attack, defense: role.defense,
    potions: 2, equipment: [], inventory: [], equipped: { weapon: null, armor: null },
    world: 1, floor: 1, unlockedWorld: 1, worldProgress: { 1: 1 }, wins: 0, losses: 0, lastDaily: null,
    createdAt: new Date().toISOString(),
  };
}

function rollEnemy(level, random = Math.random) {
  return rollFloorEnemy(1, Math.max(1, Math.min(10, level)), random);
}

function rollFloorEnemy(worldId, floor, random = Math.random) {
  const world = WORLDS[worldId - 1] || WORLDS[0];
  const isBoss = floor === 10;
  const name = isBoss ? world.boss : world.enemies[Math.floor(random() * world.enemies.length)];
  const scale = world.power * (1 + (floor - 1) * 0.13);
  const maxHp = Math.round((isBoss ? 105 : 42) * scale);
  return {
    name, emoji: isBoss ? '👑' : world.emoji, worldId, floor, isBoss, maxHp, hp: maxHp,
    attack: Math.round((isBoss ? 16 : 8) * scale),
    xp: Math.round((isBoss ? 100 : 28) * scale), gold: Math.round((isBoss ? 75 : 18) * scale),
  };
}

function rollRarity(random = Math.random) {
  let roll = Math.floor(random() * 10000);
  for (const [id, rarity] of Object.entries(RARITIES)) {
    if (roll < rarity.weight) return id;
    roll -= rarity.weight;
  }
  return 'common';
}

function generateDrop(worldId, floor, random = Math.random) {
  const rarityId = rollRarity(random);
  const rarity = RARITIES[rarityId];
  const type = random() < 0.5 ? 'weapon' : 'armor';
  const names = type === 'weapon' ? WEAPON_NAMES : ARMOR_NAMES;
  const world = WORLDS[worldId - 1];
  const base = worldId * 3 + floor;
  const power = Math.max(1, Math.round(base * rarity.multiplier));
  return {
    id: `${Date.now().toString(36)}${Math.floor(random() * 1e6).toString(36)}`,
    name: `${rarity.name} ${world.name.split(' ')[0]} ${names[Math.floor(random() * names.length)]}`,
    type, rarity: rarityId, power, worldId, floor,
  };
}

function normalizeCharacter(character) {
  character.inventory ||= [];
  character.equipped ||= { weapon: null, armor: null };
  character.world ||= 1; character.floor ||= 1; character.unlockedWorld ||= 1;
  character.worldProgress ||= { [character.world]: character.floor };
  character.worldProgress[character.world] = Math.max(character.worldProgress[character.world] || 1, character.floor);
  return character;
}

function advanceFloor(character) {
  normalizeCharacter(character);
  if (character.floor < 10) {
    character.floor += 1;
    character.worldProgress[character.world] = Math.max(character.worldProgress[character.world] || 1, character.floor);
    return { worldUnlocked: null };
  }
  if (character.world < WORLDS.length) {
    character.unlockedWorld = Math.max(character.unlockedWorld, character.world + 1);
    const unlocked = character.world + 1;
    character.world = unlocked; character.floor = 1;
    character.worldProgress[unlocked] ||= 1;
    return { worldUnlocked: unlocked };
  }
  return { worldUnlocked: null };
}

function equipItem(character, inventoryIndex) {
  normalizeCharacter(character);
  const item = character.inventory[inventoryIndex];
  if (!item) return { ok: false, message: 'No item exists in that inventory slot.' };
  character.equipped[item.type] = item.id;
  return { ok: true, item };
}

function gearBonus(character, type) {
  normalizeCharacter(character);
  const id = character.equipped[type];
  return character.inventory.find((item) => item.id === id)?.power || 0;
}

function playerDamage(character, random = Math.random, defending = false) {
  const variance = 0.8 + random() * 0.4;
  const critical = random() < 0.12;
  const amount = Math.max(1, Math.round((character.attack + gearBonus(character, 'weapon')) * variance * (critical ? 1.75 : 1)));
  return { amount, critical, defending };
}

function enemyDamage(enemy, character, random = Math.random, defending = false) {
  const raw = enemy.attack * (0.8 + random() * 0.4) - (character.defense + gearBonus(character, 'armor')) * 0.45;
  return Math.max(1, Math.round(raw * (defending ? 0.45 : 1)));
}

function grantRewards(character, enemy) {
  character.xp += enemy.xp;
  character.gold += enemy.gold;
  character.wins += 1;
  const levels = [];
  while (character.xp >= xpForLevel(character.level)) {
    character.xp -= xpForLevel(character.level);
    character.level += 1;
    character.maxHp += 12;
    character.attack += 3;
    character.defense += 2;
    character.hp = character.maxHp;
    levels.push(character.level);
  }
  return levels;
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
  if (character.hp >= character.maxHp) return { ok: false, message: 'You are already at full health.' };
  const cost = Math.max(10, Math.ceil((character.maxHp - character.hp) * 0.35));
  if (character.gold < cost) return { ok: false, message: `A full rest costs ${cost} gold.` };
  character.gold -= cost;
  character.hp = character.maxHp;
  return { ok: true, cost };
}

module.exports = { clamp, xpForLevel, createCharacter, rollEnemy, rollFloorEnemy, rollRarity, generateDrop, normalizeCharacter, advanceFloor, equipItem, gearBonus, playerDamage, enemyDamage, grantRewards, buyItem, claimDaily, healAtInn };
