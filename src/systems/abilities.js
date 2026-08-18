const { ABILITIES } = require('../content/abilities');

function normalizeAbilities(character) {
  character.maxMana ??= 100 + (character.stats?.intelligence || 1) * 5;
  character.mana ??= character.maxMana;
  character.autoAbility ??= ABILITIES[character.classId]?.[0]?.id || null;
  character.abilityCooldowns ||= {};
  return character;
}

function availableAbilities(character) {
  normalizeAbilities(character);
  return ABILITIES[character.classId] || [];
}

function useAbility(character, abilityId, baseDamage = 0) {
  normalizeAbilities(character);
  const ability = availableAbilities(character).find((entry) => entry.id === abilityId);
  if (!ability) return { ok: false, message: 'That ability is unavailable to your class.' };
  if ((character.abilityCooldowns[ability.id] || 0) > 0) return { ok: false, message: `${ability.name} has ${character.abilityCooldowns[ability.id]} turn(s) remaining.` };
  if (character.mana < ability.mana) return { ok: false, message: `You need ${ability.mana} mana.` };
  character.mana -= ability.mana;
  character.abilityCooldowns[ability.id] = ability.cooldown || 0;
  const result = { ok: true, ability, damage: Math.max(0, Math.round(baseDamage * (ability.multiplier || 0))), healed: 0, shield: ability.shield || 0 };
  if (ability.healPercent) {
    result.healed = Math.min(character.maxHp - character.hp, Math.round(character.maxHp * ability.healPercent));
    character.hp += result.healed;
  }
  return result;
}

function tickAbilityCooldowns(character) {
  normalizeAbilities(character);
  for (const id of Object.keys(character.abilityCooldowns)) character.abilityCooldowns[id] = Math.max(0, character.abilityCooldowns[id] - 1);
  return character.abilityCooldowns;
}

function restoreMana(character, amount) {
  normalizeAbilities(character);
  character.mana = Math.min(character.maxMana, character.mana + Math.max(0, amount));
  return character.mana;
}

module.exports = { normalizeAbilities, availableAbilities, useAbility, restoreMana, tickAbilityCooldowns };
