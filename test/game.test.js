const test = require('node:test');
const assert = require('node:assert/strict');
const { createCharacter, rollEnemy, rollFloorEnemy, rollRarity, generateDrop, advanceFloor, equipItem, gearBonus, playerDamage, enemyDamage, grantRewards, buyItem, claimDaily, healAtInn, xpForLevel } = require('../src/game');

test('creates classes with their unique stats', () => {
  const warrior = createCharacter('1', 'Brakka', 'warrior');
  const mage = createCharacter('2', 'Lyra', 'mage');
  assert.equal(warrior.maxHp, 125);
  assert.ok(mage.attack > warrior.attack);
  assert.equal(warrior.potions, 2);
});

test('enemy selection maps levels onto the first world floors', () => {
  const enemy = rollEnemy(1, () => 0.999);
  assert.equal(enemy.worldId, 1);
  assert.equal(enemy.floor, 1);
  assert.equal(enemy.hp, enemy.maxHp);
});

test('damage has a minimum of one', () => {
  const character = createCharacter('1', 'Tank', 'warrior');
  assert.equal(enemyDamage({ attack: 1 }, character, () => 0, true), 1);
  assert.ok(playerDamage(character, () => 0).amount >= 1);
});

test('rewards can level a character and restore health', () => {
  const character = createCharacter('1', 'Hero', 'rogue');
  character.hp = 1;
  const levels = grantRewards(character, { xp: xpForLevel(character.level), gold: 20 });
  assert.deepEqual(levels, [2]);
  assert.equal(character.level, 2);
  assert.equal(character.hp, character.maxHp);
  assert.equal(character.gold, 70);
});

test('shop applies equipment once and supports repeatable potions', () => {
  const character = createCharacter('1', 'Buyer', 'warrior');
  character.gold = 500;
  const originalAttack = character.attack;
  assert.equal(buyItem(character, 'iron_sword').ok, true);
  assert.equal(character.attack, originalAttack + 4);
  assert.equal(buyItem(character, 'iron_sword').ok, false);
  assert.equal(buyItem(character, 'potion').ok, true);
  assert.equal(character.potions, 3);
});

test('daily reward enforces its cooldown', () => {
  const character = createCharacter('1', 'Daily', 'mage');
  const now = Date.parse('2026-08-17T00:00:00Z');
  assert.equal(claimDaily(character, now).ok, true);
  const retry = claimDaily(character, now + 1000);
  assert.equal(retry.ok, false);
  assert.ok(retry.remaining > 0);
});

test('inn charges and fully heals', () => {
  const character = createCharacter('1', 'Tired', 'warrior');
  character.hp = 100;
  const result = healAtInn(character);
  assert.equal(result.ok, true);
  assert.equal(character.hp, character.maxHp);
  assert.equal(character.gold, 40);
});

test('rarity roll covers common through secret boundaries', () => {
  assert.equal(rollRarity(() => 0), 'common');
  assert.equal(rollRarity(() => 0.55), 'uncommon');
  assert.equal(rollRarity(() => 0.81), 'rare');
  assert.equal(rollRarity(() => 0.93), 'epic');
  assert.equal(rollRarity(() => 0.98), 'legendary');
  assert.equal(rollRarity(() => 0.9999), 'secret');
});

test('floor ten creates a boss and unlocks the next world', () => {
  const boss = rollFloorEnemy(1, 10, () => 0);
  assert.equal(boss.isBoss, true);
  const character = createCharacter('1', 'Climber', 'rogue');
  character.floor = 10;
  const progress = advanceFloor(character);
  assert.equal(progress.worldUnlocked, 2);
  assert.equal(character.world, 2);
  assert.equal(character.worldProgress[2], 1);
});

test('generated loot can be equipped for a combat bonus', () => {
  const character = createCharacter('1', 'Looty', 'mage');
  const drop = generateDrop(1, 1, () => 0);
  drop.type = 'weapon';
  character.inventory.push(drop);
  assert.equal(equipItem(character, 0).ok, true);
  assert.equal(gearBonus(character, 'weapon'), drop.power);
});
