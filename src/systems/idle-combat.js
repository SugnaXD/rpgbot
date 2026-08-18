const { derivedStats, rollFloorEnemy, generateDrop, grantRewards, advanceFloor, lootLuck, normalizeCharacter } = require('../game');
const { normalizeAbilities, availableAbilities } = require('./abilities');
const { receiveDrop } = require('./items');
const { ascensionRewardMultiplier } = require('./combat-scaling');
const { traitMultiplier } = require('../systems');

const MAX_IDLE_MS = 12 * 60 * 60 * 1000;
const BATTLE_INTERVAL_MS = 60 * 1000;
const MAX_STORED_DROPS = 25;

function normalizeIdle(character) {
  character.idleCombat ??= null;
  return character;
}

function startIdle(character, now = Date.now()) {
  normalizeCharacter(character); normalizeAbilities(character); normalizeIdle(character);
  if (character.idleCombat) return { ok: false, message: 'Idle combat is already running.' };
  if (character.hp <= 0) return { ok: false, message: 'Heal before starting idle combat.' };
  character.idleCombat = { startedAt: now, world: character.world, floor: character.floor };
  return { ok: true };
}

function claimIdle(character, now = Date.now(), random = Math.random) {
  normalizeCharacter(character); normalizeAbilities(character); normalizeIdle(character);
  if (!character.idleCombat) return { ok: false, message: 'Idle combat is not running.' };
  const startedAt = character.idleCombat.startedAt;
  const elapsed = Math.max(0, Math.min(MAX_IDLE_MS, now - startedAt));
  const attempts = Math.floor(elapsed / BATTLE_INTERVAL_MS);
  if (!attempts) return { ok: false, message: 'No idle battle has completed yet.' };
  let victories = 0; let defeats = 0; let xp = 0; let gold = 0; const drops = [];
  for (let index = 0; index < attempts; index += 1) {
    const enemy = rollFloorEnemy(character.world, character.floor, random, character.level);
    const stats = derivedStats(character);
    const ability = availableAbilities(character).find((entry) => entry.id === character.autoAbility);
    const abilityFactor = ability?.multiplier ? 1 + (ability.multiplier - 1) * 0.2 : 1;
    const playerPower = stats.attack * abilityFactor * traitMultiplier(character, 'combat') * stats.effectiveHp;
    const enemyPower = enemy.attack * enemy.maxHp;
    if (playerPower * (0.85 + random() * 0.3) < enemyPower) { defeats += 1; character.losses += 1; break; }
    const multiplier = ascensionRewardMultiplier(character.ascensionPoints);
    xp += Math.round(enemy.xp * multiplier); gold += Math.round(enemy.gold * multiplier);
    grantRewards(character, enemy); advanceFloor(character);
    victories += 1;
    if (drops.length < MAX_STORED_DROPS) drops.push(generateDrop(enemy.worldId, enemy.floor, random, lootLuck(character), null, character.level));
  }
  let salvaged = 0; let dust = 0;
  for (const drop of drops) { const received = receiveDrop(character, drop); if (!received.kept) { salvaged += 1; dust += received.dust; } }
  character.idleCombat = null;
  character.mana = character.maxMana;
  return { ok: true, elapsed, attempts, victories, defeats, xp, gold, drops: drops.filter((item) => character.inventory.includes(item)), salvaged, dust, capped: now - startedAt > MAX_IDLE_MS };
}

module.exports = { MAX_IDLE_MS, BATTLE_INTERVAL_MS, MAX_STORED_DROPS, normalizeIdle, startIdle, claimIdle };
