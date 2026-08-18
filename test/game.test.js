const test = require('node:test');
const assert = require('node:assert/strict');
const { MAX_LEVEL, ITEM_SCHEMA_VERSION, createCharacter, rollEnemy, rollFloorEnemy, rollRarity, gradePromotionChance, rollGrade, generateDrop, normalizeCharacter, advanceFloor, equipItem, gearBonus, itemStatsText, derivedStats, lootLuck, allocateStats, playerDamage, enemyDamage, grantXp, grantRewards, setCharacterLevel, buyItem, claimDaily, healAtInn, xpForLevel } = require('../src/game');
const { specialize } = require('../src/systems');

test('every class starts with exactly 100 HP and retains its unique combat stats', () => {
  const warrior = createCharacter('1', 'Brakka', 'warrior');
  const rogue = createCharacter('3', 'Shade', 'rogue');
  const mage = createCharacter('2', 'Lyra', 'mage');
  const admin = createCharacter('4', 'Operator', 'admin');
  for (const character of [warrior, rogue, mage, admin]) {
    assert.equal(character.hp, 100);
    assert.equal(character.maxHp, 100);
  }
  assert.ok(mage.attack > warrior.attack);
  assert.ok(admin.attack > mage.attack);
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

test('level resets preserve shop and specialization bonuses', () => {
  const character = createCharacter('1', 'Veteran', 'rogue');
  character.gold = 1000;
  buyItem(character, 'iron_sword');
  buyItem(character, 'iron_armor');
  character.mastery = 75;
  assert.equal(specialize(character, 'shadow').ok, true);

  assert.equal(setCharacterLevel(character, 100).ok, true);
  assert.equal(setCharacterLevel(character, 1).ok, true);
  assert.equal(character.attack, 18 + 4 + 12);
  assert.equal(character.defense, 4 + 4);
  assert.equal(character.stats.agility, 19);
  assert.equal(character.specialization, 'shadow');
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
  character.hp = 95;
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
  assert.equal(boss.variant, 'boss');
  assert.equal(boss.maxHp, 181);
  assert.equal(boss.attack, 24);
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
  assert.equal(gearBonus(character, 'weapon'), drop.stats.attack);
  assert.equal(drop.grade, 'f');
  assert.ok(drop.stats.attack > 0);
  assert.ok(drop.stats.strength > 0);
  assert.equal(drop.powerModel, 'natural-v1');
  assert.equal(drop.source, 'drop');
  assert.equal(drop.schemaVersion, 4);
  assert.deepEqual(drop.baseStats, drop.stats);
});

test('floor enemies use continuous scaling and name-indexed mob variants', () => {
  const swift = rollFloorEnemy(1, 1, () => 0, 1);
  const balanced = rollFloorEnemy(1, 1, () => 0.34, 1);
  const sturdy = rollFloorEnemy(1, 1, () => 0.999, 1);
  assert.deepEqual(
    [swift.variant, balanced.variant, sturdy.variant],
    ['swift', 'balanced', 'sturdy'],
  );
  assert.deepEqual([swift.name, balanced.name, sturdy.name], ['Slime', 'Goblin', 'Wild Boar']);
  assert.deepEqual([swift.maxHp, balanced.maxHp, sturdy.maxHp], [39, 42, 45]);
  assert.deepEqual([swift.attack, balanced.attack, sturdy.attack], [9, 8, 7]);

  const endOfWorld = rollFloorEnemy(1, 10, () => 0, 50);
  const nextWorld = rollFloorEnemy(2, 1, () => 0, 50);
  assert.equal(endOfWorld.stage, 9);
  assert.equal(nextWorld.stage, 10);
  assert.equal(nextWorld.stageScale / endOfWorld.stageScale, 1.0625);
  assert.equal(nextWorld.levelScale, 1);

  const levelScaled = rollFloorEnemy(2, 1, () => 0, 250);
  assert.equal(levelScaled.levelScale, 5);
  assert.equal(levelScaled.level, 250);
  assert.equal(levelScaled.maxHp, Math.round(42 * Math.pow(1.0625, 10) * 5 * 0.92));
});

test('natural drops record bounded level and source metadata with rarity trait slots', () => {
  const common = generateDrop(2, 3, () => 0, 0, 'weapon', 123);
  assert.equal(common.worldId, 2);
  assert.equal(common.floor, 3);
  assert.equal(common.stage, 13);
  assert.equal(common.itemLevel, 123);
  assert.equal(common.traitSlots, 0);
  assert.equal(common.traits.length, 0);
  assert.match(itemStatsText(common), /Lv 123 • W2 F3 • Source: Drop/);

  const rare = generateDrop(2, 3, () => 0.81, 0, 'armor', 123);
  assert.equal(rare.rarity, 'rare');
  assert.equal(rare.traitSlots, 1);
  assert.equal(rare.traits.length, 1);

  const secret = generateDrop(5, 10, () => 0.9999, 0, 'weapon', Infinity);
  assert.equal(secret.itemLevel, 1000);
  assert.equal(secret.traitSlots, 3);
  assert.equal(secret.traits.length, 3);
});

test('schema-four natural items are recalculated instead of trusting tampered values', () => {
  assert.equal(ITEM_SCHEMA_VERSION, 4);
  const character = createCharacter('1', 'Auditor', 'mage');
  const drop = generateDrop(5, 10, () => 0.9999, 0, 'weapon', 1000);
  drop.power = 99_999_999;
  drop.stats.attack = 99_999_999;
  drop.baseStats.attack = 99_999_999;
  character.inventory.push(drop);

  normalizeCharacter(character);
  assert.equal(drop.power, 723);
  assert.equal(drop.baseStats.attack, 181);
  assert.equal(drop.stats.attack, 181);
  const once = structuredClone(character);
  normalizeCharacter(character);
  assert.deepEqual(character, once);
});

test('equipped combat traits apply their capped multiplier to player damage', () => {
  const character = createCharacter('1', 'Keen', 'warrior');
  character.inventory.push({
    id: 'keen-blade', name: 'Keen Blade', type: 'weapon', rarity: 'rare', grade: 'b', power: 10,
    stats: { attack: 0 }, traits: ['keen'], schemaVersion: 3,
  });
  assert.equal(equipItem(character, 0).ok, true);
  const baseAttack = derivedStats(character).attack;
  const rolls = [0.5, 1];
  let index = 0;
  assert.equal(playerDamage(character, () => rolls[index++] ?? 1).amount, Math.round(baseAttack * 1.08));
});

test('equipped primary stats are counted once and never fall back to item power', () => {
  const character = createCharacter('1', 'Exact', 'warrior');
  character.inventory.push(
    { id: 'weapon', name: 'Exact Blade', type: 'weapon', rarity: 'rare', grade: 'b', power: 999, stats: { attack: 10 }, schemaVersion: 3, traits: [] },
    { id: 'armor', name: 'Exact Plate', type: 'armor', rarity: 'rare', grade: 'b', power: 999, stats: { defense: 20 }, schemaVersion: 3, traits: [] },
  );
  equipItem(character, 0);
  equipItem(character, 1);
  const totals = derivedStats(character);
  assert.equal(totals.attack, character.attack + character.stats.strength + 10);
  assert.equal(totals.defense, character.defense + character.stats.defense + 20);

  character.inventory.push({ id: 'mana-only', name: 'Focus Wand', type: 'weapon', rarity: 'epic', grade: 'a', power: 5000, stats: { mana: 40 }, schemaVersion: 3, traits: [] });
  equipItem(character, 2);
  assert.equal(gearBonus(character, 'weapon'), 0);
  assert.equal(derivedStats(character).attack, character.attack + character.stats.strength);
});

test('custom attack stats work from either equipment slot', () => {
  const character = createCharacter('u1', 'Flexible', 'warrior');
  character.inventory.push({
    id: 'attack-armor', name: 'War Plate', type: 'armor', rarity: 'secret', grade: 'z', power: 1000,
    stats: { attack: 75 }, statGrades: { attack: 'z' }, statPercentages: { attack: 25 }, traits: [],
  });
  const before = derivedStats(character).attack;
  equipItem(character, 0);
  assert.equal(derivedStats(character).attack, before + 75);
});

test('mana equipment increases the effective pool and is reversible when swapped', () => {
  const character = createCharacter('1', 'Channeler', 'mage');
  character.inventory.push(
    { id: 'focus', name: 'Deep Focus', type: 'weapon', rarity: 'epic', grade: 'a', power: 100, stats: { mana: 40 }, schemaVersion: 3, traits: [] },
    { id: 'plain', name: 'Plain Staff', type: 'weapon', rarity: 'common', grade: 'f', power: 100, stats: { attack: 2 }, schemaVersion: 3, traits: [] },
  );
  equipItem(character, 0);
  assert.equal(character.maxMana, 145);
  assert.equal(character.mana, 145);
  assert.equal(derivedStats(character).maxMana, 145);

  equipItem(character, 1);
  assert.equal(character.maxMana, 105);
  assert.equal(character.mana, 105);
  assert.equal(derivedStats(character).maxMana, 105);
});

test('secret drops receive the rarest Z equipment grade', () => {
  const drop = generateDrop(5, 10, () => 0.9999);
  assert.equal(drop.rarity, 'secret');
  assert.equal(drop.grade, 'z');
  assert.ok(drop.stats.defense > 0);
  assert.ok(drop.stats.hp > 0);
  assert.equal(drop.stats.defense, Math.round(drop.power * 0.25));
  assert.equal(drop.statPercentages.defense, 25);
});

test('stat grades roll continuously from F at 5–7.4% to Z at 22.5–25%', () => {
  assert.equal(rollGrade(() => 0), 'f');
  assert.equal(rollGrade(() => 0.9999), 'z');
  const fItem = generateDrop(5, 10, () => 0);
  assert.equal(fItem.grade, 'f');
  assert.equal(fItem.stats.attack, Math.max(1, Math.round(fItem.power * 0.05)));
  assert.equal(fItem.statPercentages.attack, 5);
});

test('higher stat grades are progressively rarer and Z is the top 0.1%', () => {
  const chances = [45, 27, 15, 7, 3.5, 1.5, 0.9, 0.1];
  assert.equal(chances.reduce((total, chance) => total + chance, 0), 100);
  for (let index = 1; index < chances.length; index += 1) assert.ok(chances[index] < chances[index - 1]);
  assert.equal(rollGrade(() => 0.9989), 'sss');
  assert.equal(rollGrade(() => 0.999), 'z');
  assert.equal(rollGrade(() => 0.9999), 'z');
  assert.equal(rollGrade(() => 1), 'z');
  assert.equal(rollGrade(() => Number.NaN), 'f');
});

test('luck can promote a rolled stat by exactly one grade', () => {
  const rolls = (...values) => {
    let index = 0;
    return () => values[index++] ?? 1;
  };
  assert.equal(rollGrade(rolls(0.2, 0.0099), 200), 'c');
  assert.equal(rollGrade(rolls(0.5, 0.0099), 200), 'b');
  assert.equal(rollGrade(rolls(0.995, 0), 1000), 'z');
  assert.equal(rollGrade(rolls(0.999, 0), 1000), 'z');
  assert.equal(rollGrade(rolls(0.2, 0.01), 200), 'f');
  assert.equal(rollGrade(() => 0.2, -100), 'f');
  assert.equal(rollGrade(() => 0.2, Number.NaN), 'f');
});

test('stat-grade Luck grants 1% per 200 points and caps at 5%', () => {
  assert.equal(gradePromotionChance(0), 0);
  assert.equal(gradePromotionChance(200), 0.01);
  assert.equal(gradePromotionChance(1000), 0.05);
  assert.equal(gradePromotionChance(1_000_000), 0.05);
});

test('generated weapon and armor stats all receive the supplied Luck promotion', () => {
  for (const [type, expected] of [
    ['weapon', { attack: 'c', strength: 'b', agility: 'a' }],
    ['armor', { defense: 'c', hp: 'b', luck: 'a' }],
  ]) {
    const rolls = [0, 0.2, 0, 0.5, 0, 0.8, 0, 0, 0, 0, 0];
    let index = 0;
    const drop = generateDrop(1, 1, () => rolls[index++] ?? 0, 1000, type);
    assert.deepEqual(drop.statGrades, expected);
  }
});

test('Loot Luck combines character, equipped, and Divine Luck bonuses', () => {
  const character = createCharacter('1', 'Fortunate', 'rogue');
  character.god = 'artemis';
  character.favour = 10000;
  character.inventory.push({
    id: 'lucky-armor', name: 'Lucky Armor', type: 'armor', rarity: 'rare', grade: 'b',
    stats: { defense: 1, hp: 1, luck: 20 }, schemaVersion: 3,
  });
  character.equipped.armor = 'lucky-armor';
  assert.equal(lootLuck(character), 63);
});

test('each level grants one point for every allocatable stat', () => {
  const character = createCharacter('1', 'Stats', 'warrior');
  grantXp(character, xpForLevel(1));
  assert.equal(character.level, 2);
  assert.equal(character.statPoints, 7);
  assert.equal(allocateStats(character, 'strength', 3).ok, true);
  assert.equal(character.stats.strength, 4);
  assert.equal(character.statPoints, 4);
  assert.equal(derivedStats(character).attack, character.attack + 4);
});

test('level is capped at 1000', () => {
  const character = createCharacter('1', 'Max', 'admin');
  assert.equal(setCharacterLevel(character, MAX_LEVEL).ok, true);
  grantXp(character, 999999999);
  assert.equal(character.level, 1000);
  assert.equal(character.xp, 0);
});

test('rarity Luck has a bounded, diminishing bias toward rarer tiers', () => {
  assert.equal(rollRarity(() => 0.549, 0), 'common');
  assert.equal(rollRarity(() => 0.549, 500), 'uncommon');
  assert.equal(rollRarity(() => 0.549, 1_000_000), 'uncommon');
  assert.equal(rollRarity(() => 0.9, 0), 'rare');
  assert.equal(rollRarity(() => 0.9, 1_000_000), 'epic');
  assert.equal(rollRarity(() => 0.9, Infinity), 'epic');
  assert.equal(rollRarity(() => 0.549, -100), 'common');
  assert.equal(rollRarity(() => 0.549, Number.NaN), 'common');
});

test('effective HP and enemy damage use diminishing defense', () => {
  const character = createCharacter('1', 'Tank', 'warrior');
  character.maxHp = 1000;
  character.hp = 1000;
  character.defense = 0;
  character.stats.defense = 500;
  const totals = derivedStats(character);
  assert.equal(totals.effectiveHpMultiplier, 1 + 500 / 225);
  assert.equal(totals.effectiveHp, 3222);
  assert.equal(enemyDamage({ attack: 1000 }, character, () => 0.5), 310);
});

test('ascension combat and reward multipliers diminish and remain capped', () => {
  const character = createCharacter('1', 'Ascended', 'warrior');
  character.ascensionPoints = 400;
  const capped = derivedStats(character);
  assert.equal(capped.ascensionMultiplier, 2);
  assert.equal(capped.attack, (character.attack + character.stats.strength) * 2);

  grantRewards(character, { xp: 0, gold: 100 });
  assert.equal(character.gold, 200);
  character.ascensionPoints = 1_000_000;
  assert.equal(derivedStats(character).ascensionMultiplier, 2);
  grantRewards(character, { xp: 0, gold: 100 });
  assert.equal(character.gold, 350);
});

test('legacy and admin items migrate to schema four without changing effective stats', () => {
  const character = createCharacter('1', 'Curator', 'warrior');
  character.inventory.push(
    {
      id: 'legacy-blade', name: 'Legacy Blade', type: 'weapon', rarity: 'rare', grade: 'b',
      power: 999, worldId: 2, floor: 4, upgradeLevel: 7,
      stats: { attack: 37, strength: 11, mana: 5 }, traits: ['keen'], schemaVersion: 3,
    },
    {
      id: 'admin-plate', name: 'Admin Plate', type: 'armor', rarity: 'secret', grade: 'z',
      power: 4_000_000, stats: { defense: 1_000_000, hp: 5_000_000 }, traits: [],
      adminCreated: true, schemaVersion: 3,
    },
  );
  character.equipped = { weapon: 'legacy-blade', armor: 'legacy-blade', ring: 'legacy-blade' };
  const legacyStats = structuredClone(character.inventory[0].stats);
  const adminStats = structuredClone(character.inventory[1].stats);

  normalizeCharacter(character);
  const [legacy, admin] = character.inventory;
  assert.equal(legacy.schemaVersion, 4);
  assert.equal(legacy.powerModel, 'legacy-snapshot');
  assert.equal(legacy.source, 'legacy');
  assert.deepEqual(legacy.stats, legacyStats);
  assert.deepEqual(legacy.baseStats, legacyStats);
  assert.equal(legacy.baseUpgradeLevel, 7);
  assert.equal(legacy.traitSlots, 1);
  assert.equal(admin.schemaVersion, 4);
  assert.equal(admin.powerModel, 'admin');
  assert.equal(admin.source, 'admin');
  assert.deepEqual(admin.stats, adminStats);
  assert.deepEqual(character.equipped, { weapon: 'legacy-blade', armor: null });

  const once = structuredClone(character);
  normalizeCharacter(character);
  assert.deepEqual(character, once);
});

test('malformed legacy items never reinterpret a power budget as a direct combat stat', () => {
  const character = createCharacter('1', 'Quarantine', 'warrior');
  character.inventory.push({
    id: 'missing-stats', name: 'Missing Stats', type: 'weapon', rarity: 'secret', grade: 'z',
    power: 1_000_000, worldId: 5, floor: 10, schemaVersion: 3,
  });
  normalizeCharacter(character);
  assert.ok(character.inventory[0].stats.attack <= 188);
  assert.notEqual(character.inventory[0].stats.attack, character.inventory[0].power);
  assert.match(itemStatsText({ type: 'weapon', power: 1_000_000 }), /stats unavailable/i);
  assert.doesNotMatch(itemStatsText({ type: 'weapon', power: 1_000_000 }), /1,?000,?000 ATK/i);
});

test('newer item schemas are preserved, locked, and unequipped instead of downgraded', () => {
  const character = createCharacter('1', 'Rollback Safe', 'warrior');
  character.inventory.push({
    id: 'future-blade', name: 'Future Blade', type: 'weapon', rarity: 'secret', grade: 'z',
    schemaVersion: ITEM_SCHEMA_VERSION + 1, powerVersion: 99, powerModel: 'natural-v99',
    power: 900, stats: { attack: 250 }, traits: ['keen'], locked: false,
  });
  character.equipped.weapon = 'future-blade';
  normalizeCharacter(character);
  const item = character.inventory[0];
  assert.equal(item.schemaVersion, ITEM_SCHEMA_VERSION + 1);
  assert.equal(item.powerVersion, 99);
  assert.equal(item.powerModel, 'natural-v99');
  assert.equal(item.unsupportedItemVersion, true);
  assert.equal(item.locked, true);
  assert.equal(character.equipped.weapon, null);
  assert.equal(equipItem(character, 0).ok, false);
  assert.match(itemStatsText(item), /unsupported item schema/i);
});

test('equipment mutations reject invalid item types and clear stale slot IDs', () => {
  const character = createCharacter('1', 'Slots', 'rogue');
  character.inventory.push({
    id: 'ring', name: 'Wrong Slot', type: 'ring', rarity: 'epic', grade: 'a', power: 10,
    stats: { luck: 5 }, schemaVersion: 3,
  });
  character.equipped = { weapon: 'missing', armor: 'ring', ring: 'ring' };
  normalizeCharacter(character);
  assert.deepEqual(character.equipped, { weapon: null, armor: null });
  assert.equal(equipItem(character, 0).ok, false);
});

test('legacy class HP is migrated once while preserving current health percentage', () => {
  for (const [classId, legacyMaxHp] of Object.entries({ warrior: 130, rogue: 100, mage: 90, admin: 1005 })) {
    const fullCharacter = createCharacter('1', `Legacy ${classId}`, classId);
    fullCharacter.maxHp = legacyMaxHp;
    fullCharacter.hp = legacyMaxHp;
    delete fullCharacter.healthScalingVersion;
    normalizeCharacter(fullCharacter);
    assert.equal(fullCharacter.maxHp, 100);
    assert.equal(fullCharacter.hp, 100);
  }

  const character = createCharacter('1', 'Legacy Tank', 'warrior');
  character.maxHp = 130;
  character.hp = 65;
  delete character.healthScalingVersion;

  normalizeCharacter(character);
  assert.equal(character.maxHp, 100);
  assert.equal(character.hp, 50);
  assert.equal(character.healthScalingVersion, 2);

  normalizeCharacter(character);
  assert.equal(character.maxHp, 100);
  assert.equal(character.hp, 50);
});

test('legacy HP migration includes equipped and divine HP in the health percentage', () => {
  const legacyGuardian = (hp) => {
    const character = createCharacter('1', 'Legacy Guardian', 'warrior');
    character.maxHp = 130;
    character.god = 'poseidon';
    character.favour = 10000;
    character.inventory.push({
      id: 'legacy-hp-armor', name: 'Legacy Plate', type: 'armor', rarity: 'rare', grade: 'b',
      stats: { defense: 1, hp: 50, luck: 1 }, schemaVersion: 3,
    });
    character.equipped.armor = 'legacy-hp-armor';
    character.hp = hp;
    delete character.healthScalingVersion;
    return character;
  };

  const full = legacyGuardian(198);
  normalizeCharacter(full);
  assert.equal(full.maxHp, 100);
  assert.equal(derivedStats(full).maxHp, 165);
  assert.equal(full.hp, 165);

  const half = legacyGuardian(99);
  normalizeCharacter(half);
  assert.equal(half.hp, 83);
});

test('legacy vitality is migrated to HP', () => {
  const character = createCharacter('1', 'Legacy', 'mage');
  character.stats.vitality = 12;
  delete character.stats.hp;
  derivedStats(character);
  assert.equal(character.stats.hp, 12);
  assert.equal(character.stats.vitality, undefined);
});
