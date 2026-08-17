const test = require('node:test');
const assert = require('node:assert/strict');
const { createCharacter, generateDrop, derivedStats } = require('../src/game');
const { MAX_GUILD_LEVEL, divineBonuses, addMastery, specialize, createAdminItem, startExpedition, claimExpedition, createWorldState, createGuild, guildXpForLevel, guildRewardBonuses, grantGuildXp, donate, upgradeStation, attackTerritory, raidAttack } = require('../src/systems');

test('advanced classes require 75 mastery', () => {
  const hero = createCharacter('u1', 'Master', 'warrior');
  assert.equal(specialize(hero, 'vanguard').ok, false);
  addMastery(hero, 75);
  assert.equal(specialize(hero, 'vanguard').ok, true);
  assert.equal(hero.specialization, 'vanguard');
});

test('high-grade items gain unique traits', () => {
  const item = generateDrop(5, 10, () => 0.9999);
  assert.equal(item.grade, 'z');
  assert.equal(item.traits.length, 3);
  assert.equal(new Set(item.traits).size, 3);
});

test('offline expeditions create resources and mastery', () => {
  const hero = createCharacter('u1', 'Scout', 'rogue');
  assert.equal(startExpedition(hero, 'forage', 'balanced', 0).ok, true);
  const result = claimExpedition(hero, 3600001, () => 0.5);
  assert.equal(result.ok, true);
  assert.ok(hero.resources.food > 0);
  assert.ok(hero.mastery > 0);
});

test('guild donations feed hall upgrades', () => {
  const world = createWorldState(); const hero = createCharacter('u1', 'Builder', 'warrior');
  const guild = createGuild(world, 'u1', 'Wardens').guild;
  hero.resources.ore = 100;
  assert.equal(donate(world, hero, 'ore', 100).ok, true);
  assert.equal(upgradeStation(world, 'u1', 'forge').ok, true);
  assert.equal(guild.stations.forge, 1);
  assert.ok(hero.mastery > 0);
});

test('territories connect guild power, resources, and conquest', () => {
  const world = createWorldState(); const guild = createGuild(world, 'u1', 'Conquerors').guild;
  const result = attackTerritory(world, 'u1', 'greenwatch', 200);
  assert.equal(result.captured, true);
  assert.deepEqual(guild.territories, ['greenwatch']);
  assert.equal(world.territories.greenwatch.owner, guild.id);
});

test('raids reward mastery, faction score, and guild influence', () => {
  const world = createWorldState(); const hero = createCharacter('u1', 'Raider', 'mage');
  const guild = createGuild(world, 'u1', 'Raiders').guild; hero.god = 'zeus';
  const result = raidAttack(world, hero, derivedStats(hero).attack);
  assert.equal(result.ok, true);
  assert.ok(result.damage > 0);
  assert.ok(hero.mastery > 0);
  assert.ok(world.factionScores.olympian > 0);
  assert.ok(guild.influence > 0);
});

test('Greek god bonuses scale with favour and cap at ten thousand', () => {
  const hero = createCharacter('u1', 'Chosen', 'mage'); hero.god = 'zeus';
  hero.favour = 2500;
  const halfway = divineBonuses(hero);
  assert.equal(halfway.stats.strength, 0.05);
  assert.equal(halfway.stats.intelligence, 0.05);
  assert.equal(halfway.luck, 1.04);
  hero.favour = 50000;
  const capped = divineBonuses(hero);
  assert.equal(capped.stats.strength, 0.1);
  assert.equal(capped.stats.intelligence, 0.1);
  assert.equal(capped.luck, 1.08);
});

test('guild progression reaches 500 and reward bonuses remain capped', () => {
  const world = createWorldState(); const guild = createGuild(world, 'u1', 'Veterans').guild;
  assert.deepEqual(guildRewardBonuses(guild), { xp: 0, gold: 0 });
  grantGuildXp(world, 'u1', 1_000_000_000);
  const bonuses = guildRewardBonuses(guild);
  assert.equal(guild.level, MAX_GUILD_LEVEL);
  assert.equal(guild.xp, 0);
  assert.equal(bonuses.xp, 0.25);
  assert.equal(bonuses.gold, 0.15);
});

test('guild reward curve grows gradually at representative levels', () => {
  const expected = [[10, 0.018], [50, 0.055], [100, 0.087], [250, 0.159], [500, 0.25]];
  for (const [level, approximateXp] of expected) {
    const bonuses = guildRewardBonuses({ level, xp: 0 });
    assert.ok(Math.abs(bonuses.xp - approximateXp) < 0.004);
    assert.ok(bonuses.gold <= 0.15);
  }
  assert.ok(guildXpForLevel(499) > guildXpForLevel(50));
});

test('admin forge creates bounded customized overpowered items', () => {
  const item = createAdminItem({ name: 'World Ender', type: 'weapon', grade: 'z', magnitude: 1000000, stats: ['attack', 'hp', 'luck'], traits: ['keen', 'giant_slayer'] });
  assert.equal(item.name, 'World Ender');
  assert.equal(item.stats.attack, 1000000);
  assert.equal(item.stats.hp, 5000000);
  assert.equal(item.stats.luck, 1000000);
  assert.deepEqual(item.traits, ['keen', 'giant_slayer']);
  assert.equal(item.adminCreated, true);
  assert.equal(item.statGrades.attack, 'z');
  assert.equal(item.statPercentages.attack, 25);
  assert.equal(item.schemaVersion, 4);
  assert.equal(item.powerModel, 'admin');
  assert.equal(item.locked, false);

  const fGrade = createAdminItem({ grade: 'f', magnitude: 1000, stats: ['attack'] });
  assert.equal(fGrade.stats.attack, 1000);
  assert.equal(fGrade.statGrades.attack, 'f');
  assert.equal(fGrade.statPercentages.attack, 7.4);
});
