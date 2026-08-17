const { STATS } = require('../content');
const { normalizeWorld } = require('../systems');

function addCharacterStat(character, stat, amount) {
  if (!STATS[stat]) return { ok: false, message: 'Unknown stat.' };
  const value = Number(amount);
  if (!Number.isInteger(value) || value < 1 || value > 1_000_000) return { ok: false, message: 'Stat amount must be a whole number from 1 to 1,000,000.' };
  character.stats ||= {};
  character.adminGrantedStats ||= {};
  character.stats[stat] = (character.stats[stat] || 1) + value;
  character.adminGrantedStats[stat] = (character.adminGrantedStats[stat] || 0) + value;
  if (stat === 'hp') { character.maxHp += value * 5; character.hp += value * 5; }
  if (stat === 'mana') {
    character.baseMaxMana = 100 + character.stats.mana * 5;
    character.maxMana = (character.maxMana || 100) + value * 5;
    character.mana = (character.mana || 0) + value * 5;
  }
  return { ok: true, stat, amount: value, total: character.stats[stat] };
}

function addCharacterAscensions(character, amount) {
  const value = Number(amount);
  if (!Number.isInteger(value) || value < 1 || value > 10_000) return { ok: false, message: 'Ascension amount must be a whole number from 1 to 10,000.' };
  character.ascensions = (character.ascensions || 0) + value;
  character.ascensionPoints = (character.ascensionPoints || 0) + value;
  return { ok: true, amount: value, ascensions: character.ascensions, points: character.ascensionPoints };
}

function forceGuildJoin(world, userId, guildId) {
  normalizeWorld(world);
  const destination = world.guilds[guildId];
  if (!destination) return { ok: false, message: 'Guild not found.' };
  const previousId = world.memberships[userId] || null;
  if (previousId === guildId) return { ok: false, message: 'That player is already in this guild.' };
  const previous = previousId ? world.guilds[previousId] : null;
  if (previous) {
    previous.members = previous.members.filter((id) => id !== userId);
    if (previous.leaderId === userId) {
      if (previous.members.length) previous.leaderId = previous.members[0];
      else {
        for (const territory of Object.values(world.territories)) {
          if (territory.owner === previousId) {
            territory.owner = null;
            territory.defense = 100;
            territory.contestedAt = null;
          }
        }
        delete world.guilds[previousId];
      }
    }
  }
  if (!destination.members.includes(userId)) destination.members.push(userId);
  world.memberships[userId] = guildId;
  return { ok: true, guild: destination, previousId };
}

module.exports = { addCharacterStat, addCharacterAscensions, forceGuildJoin };
