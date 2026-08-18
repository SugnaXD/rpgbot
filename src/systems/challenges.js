const { DUNGEONS } = require('../content/progression');
const { derivedStats, normalizeCharacter } = require('../game');

const dayKey = (now = Date.now()) => new Date(now).toISOString().slice(0, 10);

function normalizeChallenges(character, now = Date.now()) {
  character.dungeons ||= { date: dayKey(now), attempts: 3 };
  if (character.dungeons.date !== dayKey(now)) character.dungeons = { date: dayKey(now), attempts: 3 };
  character.towerFloor ??= 0;
  return character;
}

function combatRating(character) {
  const stats = derivedStats(character);
  return Math.round(stats.attack * 5 + stats.effectiveHp / 20);
}

function runDungeon(character, dungeonId, random = Math.random, now = Date.now()) {
  normalizeCharacter(character); normalizeChallenges(character, now);
  const dungeon = DUNGEONS[dungeonId];
  if (!dungeon) return { ok: false, message: 'Dungeon not found.' };
  if (!character.dungeons.attempts) return { ok: false, message: 'No dungeon attempts remain today.' };
  character.dungeons.attempts -= 1;
  const rating = combatRating(character); const won = rating * (0.9 + random() * 0.2) >= dungeon.requirement;
  if (!won) return { ok: true, won: false, dungeon, rating };
  character.gold += dungeon.gold; character.materials ||= { dust: 0 }; character.materials.dust += dungeon.dust;
  return { ok: true, won: true, dungeon, rating, gold: dungeon.gold, dust: dungeon.dust };
}

function challengeTower(character, random = Math.random) {
  normalizeCharacter(character); normalizeChallenges(character);
  const nextFloor = character.towerFloor + 1; const requirement = Math.round(45 * Math.pow(1.12, nextFloor - 1));
  const rating = combatRating(character); const won = rating * (0.9 + random() * 0.2) >= requirement;
  if (!won) return { ok: true, won: false, floor: nextFloor, requirement, rating };
  character.towerFloor = nextFloor; const gold = 50 + nextFloor * 15; character.gold += gold;
  if (nextFloor % 5 === 0) { character.materials ||= { dust: 0 }; character.materials.dust += 25 + nextFloor; }
  return { ok: true, won: true, floor: nextFloor, requirement, rating, gold };
}

module.exports = { normalizeChallenges, combatRating, runDungeon, challengeTower };
