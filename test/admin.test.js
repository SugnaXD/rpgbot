const test = require('node:test');
const assert = require('node:assert/strict');
const { createCharacter, setCharacterLevel, normalizeCharacter } = require('../src/game');
const { createWorldState, createGuild } = require('../src/systems');
const { ascend } = require('../src/systems/progression');
const { addCharacterStat, addCharacterAscensions, forceGuildJoin } = require('../src/systems/admin');

test('admin stat grants update derived resource pools', () => {
  const hero = createCharacter('u1', 'Boosted', 'warrior'); const hp = hero.maxHp; const mana = hero.maxMana;
  assert.equal(addCharacterStat(hero, 'hp', 10).ok, true); assert.equal(hero.maxHp, hp + 50);
  assert.equal(addCharacterStat(hero, 'mana', 5).ok, true); assert.equal(hero.maxMana, mana + 25);
  normalizeCharacter(hero);
  assert.equal(hero.maxMana, mana + 25);
});

test('admin stat grants do not block level changes and survive ascension', () => {
  const hero = createCharacter('u1', 'Permanent', 'warrior');
  addCharacterStat(hero, 'strength', 100);
  addCharacterStat(hero, 'hp', 20);
  assert.equal(setCharacterLevel(hero, 1).ok, true);
  hero.level = 1000;
  assert.equal(ascend(hero).ok, true);
  assert.equal(hero.stats.strength, 101);
  assert.equal(hero.stats.hp, 21);
  assert.equal(hero.adminGrantedStats.strength, 100);
});

test('normalization repairs missing item economy fields on legacy admin gear', () => {
  const hero = createCharacter('u1', 'Legacy Admin', 'admin');
  hero.inventory.push({ id: 'old-admin', name: 'Old Relic', type: 'weapon', rarity: 'secret', grade: 'z', power: 100, stats: { attack: 100 }, adminCreated: true });
  normalizeCharacter(hero);
  const item = hero.inventory[0];
  assert.equal(item.statGrades.attack, 'z');
  assert.equal(item.statPercentages.attack, 23.8);
  assert.equal(item.upgradeLevel, 0);
  assert.equal(item.locked, false);
});

test('admin ascension grants add count and permanent points', () => {
  const hero = createCharacter('u1', 'Ascended', 'mage'); const result = addCharacterAscensions(hero, 3);
  assert.equal(result.ok, true); assert.equal(hero.ascensions, 3); assert.equal(hero.ascensionPoints, 3);
});

test('admin grants reject malformed or out-of-range amounts', () => {
  const hero = createCharacter('u1', 'Validated', 'mage');
  assert.equal(addCharacterStat(hero, 'strength', 0).ok, false);
  assert.equal(addCharacterStat(hero, 'strength', 1.5).ok, false);
  assert.equal(addCharacterAscensions(hero, 10001).ok, false);
});

test('admin guild join moves a player between guilds safely', () => {
  const world = createWorldState(); const first = createGuild(world, 'u1', 'First').guild; const second = createGuild(world, 'u2', 'Second').guild;
  const result = forceGuildJoin(world, 'u1', second.id);
  assert.equal(result.ok, true); assert.equal(world.memberships.u1, second.id);
  assert.equal(first.members.includes('u1'), false); assert.equal(second.members.includes('u1'), true);
});

test('moving a guild leader transfers leadership or disbands an empty guild', () => {
  const world = createWorldState();
  const first = createGuild(world, 'leader', 'First').guild;
  const second = createGuild(world, 'destination', 'Second').guild;
  first.members.push('member'); world.memberships.member = first.id;
  forceGuildJoin(world, 'leader', second.id);
  assert.equal(first.leaderId, 'member');

  const solo = createGuild(world, 'solo', 'Solo').guild;
  forceGuildJoin(world, 'solo', second.id);
  assert.equal(world.guilds[solo.id], undefined);
});
