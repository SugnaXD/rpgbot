const test = require('node:test');
const assert = require('node:assert/strict');
const { createCharacter, generateDrop, setCharacterLevel, buyItem } = require('../src/game');
const { specialize } = require('../src/systems');
const { normalizeAbilities, availableAbilities, useAbility, restoreMana, tickAbilityCooldowns } = require('../src/systems/abilities');
const { startIdle, claimIdle, MAX_IDLE_MS } = require('../src/systems/idle-combat');
const { toggleItemLock, salvageItems, configureAutoSalvage, receiveDrop, upgradeItem, rerollItemStat } = require('../src/systems/items');
const { questStatus, claimQuest, achievementStatus, claimAchievement, ascend } = require('../src/systems/progression');
const { runDungeon, challengeTower } = require('../src/systems/challenges');

test('mana abilities spend mana and produce class effects', () => {
  const hero = createCharacter('u1', 'Caster', 'mage'); normalizeAbilities(hero);
  const ability = availableAbilities(hero)[0]; const before = hero.mana;
  const result = useAbility(hero, ability.id, 100);
  assert.equal(result.ok, true); assert.equal(result.damage, 240); assert.equal(hero.mana, before - ability.mana);
  assert.equal(useAbility(hero, ability.id, 100).ok, false);
  tickAbilityCooldowns(hero); tickAbilityCooldowns(hero);
  assert.equal(useAbility(hero, ability.id, 100).ok, true);
  restoreMana(hero, 999); assert.equal(hero.mana, hero.maxMana);
});

test('idle combat simulates capped offline battles and returns rewards', () => {
  const hero = createCharacter('u1', 'Idle', 'admin');
  assert.equal(startIdle(hero, 0).ok, true);
  const result = claimIdle(hero, MAX_IDLE_MS + 1000, () => 0.5);
  assert.equal(result.ok, true); assert.equal(result.capped, true); assert.ok(result.victories > 0);
  assert.ok(result.drops.length <= 25); assert.equal(hero.idleCombat, null);
});

test('locks protect items while salvage creates crafting dust', () => {
  const hero = createCharacter('u1', 'Smith', 'warrior');
  const first = generateDrop(1, 1, () => 0); const second = generateDrop(1, 1, () => 0);
  hero.inventory.push(first, second); toggleItemLock(hero, first.id);
  const result = salvageItems(hero, [first.id, second.id]);
  assert.equal(result.ok, true); assert.equal(result.count, 1); assert.ok(hero.materials.dust > 0);
  assert.ok(hero.inventory.includes(first));
});

test('auto-salvage converts configured low rarity drops immediately', () => {
  const hero = createCharacter('u1', 'Auto', 'rogue'); configureAutoSalvage(hero, true, 'common');
  const drop = generateDrop(1, 1, () => 0); const result = receiveDrop(hero, drop);
  assert.equal(result.kept, false); assert.ok(result.dust > 0); assert.equal(hero.inventory.length, 0);
});

test('equipment can be upgraded and a stat can be rerolled', () => {
  const hero = createCharacter('u1', 'Crafter', 'warrior'); const item = generateDrop(5, 10, () => 0);
  hero.inventory.push(item); hero.materials.dust = 1000;
  assert.equal(upgradeItem(hero, item.id).ok, true); assert.equal(item.upgradeLevel, 1);
  const reroll = rerollItemStat(hero, item.id, 'attack', () => 0.9999);
  assert.equal(reroll.ok, true); assert.equal(item.statGrades.attack, 'sss'); assert.equal(item.statPercentages.attack, 22.4);
});

test('Loot Luck can promote an equipment stat reroll by one tier', () => {
  const hero = createCharacter('u1', 'Lucky Crafter', 'warrior');
  const item = generateDrop(1, 1, () => 0, 0, 'weapon');
  hero.inventory.push(item); hero.materials.dust = 1000; hero.stats.luck = 1000;
  const rolls = [0.2, 0, 0]; let index = 0;
  const reroll = rerollItemStat(hero, item.id, 'attack', () => rolls[index++] ?? 0);
  assert.equal(reroll.ok, true);
  assert.equal(reroll.grade, 'c');
  assert.equal(reroll.percentage, 7.5);
});

test('quests and achievements expose progress and grant rewards', () => {
  const hero = createCharacter('u1', 'Questor', 'warrior'); hero.wins = 100; hero.level = 10;
  const quest = questStatus(hero).find((entry) => entry.id === 'daily_battles');
  assert.equal(quest.progress, quest.goal); assert.equal(claimQuest(hero, quest.id).ok, true);
  const achievement = achievementStatus(hero).find((entry) => entry.id === 'level_10');
  assert.equal(claimAchievement(hero, achievement.id).ok, true); assert.ok(hero.achievementPoints > 0);
});

test('ascension resets level progression and grants permanent points', () => {
  const hero = createCharacter('u1', 'Ascendant', 'mage'); setCharacterLevel(hero, 1000);
  const result = ascend(hero);
  assert.equal(result.ok, true); assert.equal(hero.level, 1); assert.equal(hero.ascensions, 1); assert.ok(hero.ascensionPoints > 0);
});

test('ascension reapplies specialization and owned shop equipment bonuses', () => {
  const hero = createCharacter('u1', 'Bulwark', 'warrior');
  hero.gold = 1000;
  buyItem(hero, 'iron_sword');
  buyItem(hero, 'iron_armor');
  hero.mastery = 75;
  assert.equal(specialize(hero, 'vanguard').ok, true);
  setCharacterLevel(hero, 1000);

  assert.equal(ascend(hero).ok, true);
  assert.equal(hero.specialization, 'vanguard');
  assert.equal(hero.attack, 14 + 4);
  assert.equal(hero.defense, 7 + 4 + 12);
  assert.equal(hero.maxHp, 100 + 80);
});

test('dungeons consume daily attempts and tower advances sequentially', () => {
  const hero = createCharacter('u1', 'Challenger', 'admin');
  const dungeon = runDungeon(hero, 'crypt', () => 0.5, 0);
  assert.equal(dungeon.ok, true); assert.equal(dungeon.won, true); assert.equal(hero.dungeons.attempts, 2);
  const tower = challengeTower(hero, () => 0.5);
  assert.equal(tower.won, true); assert.equal(hero.towerFloor, 1);
});
