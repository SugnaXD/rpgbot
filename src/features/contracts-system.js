const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;
const CONTRACT_SCHEMA_VERSION = 1;
const CONTRACT_COUNTS = Object.freeze({ daily: 3, weekly: 4 });

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const nested of Object.values(value)) deepFreeze(nested);
  return value;
}

const CONTRACT_DEFINITIONS = deepFreeze({
  daily: [
    { id: 'daily_combat', cadence: 'daily', event: 'combat', name: 'Front-Line Duty', description: 'Win 4 combats.', goal: 4, unit: 'victories', reward: { gold: 70, materials: { dust: 4 }, mastery: 1 } },
    { id: 'daily_expedition', cadence: 'daily', event: 'expedition', name: 'Field Report', description: 'Complete 1 expedition.', goal: 1, unit: 'expeditions', reward: { gold: 60, materials: { dust: 5 }, favour: 3 } },
    { id: 'daily_guild_donation', cadence: 'daily', event: 'guild_donation', name: 'Stock the Hall', description: 'Donate 50 resources to your guild.', goal: 50, unit: 'resources', reward: { gold: 50, materials: { dust: 5 }, guildXp: 25 } },
    { id: 'daily_territory', cadence: 'daily', event: 'territory', name: 'Border Patrol', description: 'Complete 1 successful territory action.', goal: 1, unit: 'actions', reward: { gold: 75, mastery: 1, guildXp: 30 } },
    { id: 'daily_raid', cadence: 'daily', event: 'raid', name: 'Break the Colossus', description: 'Contribute 500 damage to a world boss.', goal: 500, unit: 'damage', reward: { gold: 60, materials: { dust: 6 }, favour: 3, guildXp: 25 } },
    { id: 'daily_favour', cadence: 'daily', event: 'favour', name: 'Divine Service', description: 'Earn 20 divine favour.', goal: 20, unit: 'favour', reward: { gold: 55, materials: { dust: 4 }, mastery: 1 } },
    { id: 'daily_crafting', cadence: 'daily', event: 'crafting', name: 'Workshop Orders', description: 'Complete 2 crafting actions.', goal: 2, unit: 'actions', reward: { gold: 50, materials: { dust: 5 }, favour: 3 } },
  ],
  weekly: [
    { id: 'weekly_combat', cadence: 'weekly', event: 'combat', name: 'Campaign Veteran', description: 'Win 25 combats.', goal: 25, unit: 'victories', reward: { gold: 350, materials: { dust: 20 }, mastery: 3 } },
    { id: 'weekly_expedition', cadence: 'weekly', event: 'expedition', name: 'Chart the Unknown', description: 'Complete 5 expeditions.', goal: 5, unit: 'expeditions', reward: { gold: 300, materials: { dust: 22 }, favour: 10 } },
    { id: 'weekly_guild_donation', cadence: 'weekly', event: 'guild_donation', name: 'Guild Provisioner', description: 'Donate 300 resources to your guild.', goal: 300, unit: 'resources', reward: { gold: 250, materials: { dust: 25 }, guildXp: 150 } },
    { id: 'weekly_territory', cadence: 'weekly', event: 'territory', name: 'Hold the Line', description: 'Complete 5 successful territory actions.', goal: 5, unit: 'actions', reward: { gold: 350, mastery: 3, guildXp: 175 } },
    { id: 'weekly_raid', cadence: 'weekly', event: 'raid', name: 'Titan Hunter', description: 'Contribute 5,000 damage to world bosses.', goal: 5000, unit: 'damage', reward: { gold: 300, materials: { dust: 30 }, favour: 15, guildXp: 150 } },
    { id: 'weekly_favour', cadence: 'weekly', event: 'favour', name: 'Voice of Olympus', description: 'Earn 150 divine favour.', goal: 150, unit: 'favour', reward: { gold: 275, materials: { dust: 20 }, mastery: 3 } },
    { id: 'weekly_crafting', cadence: 'weekly', event: 'crafting', name: 'Master Artisan', description: 'Complete 12 crafting actions.', goal: 12, unit: 'actions', reward: { gold: 250, materials: { dust: 30 }, favour: 10, guildXp: 100 } },
  ],
});

const DEFINITION_BY_ID = new Map(
  Object.values(CONTRACT_DEFINITIONS).flat().map((definition) => [definition.id, definition]),
);

const EVENT_ALIASES = Object.freeze({
  combat: 'combat',
  combat_win: 'combat',
  combat_victory: 'combat',
  expedition: 'expedition',
  expedition_complete: 'expedition',
  guild_donation: 'guild_donation',
  donation: 'guild_donation',
  territory: 'territory',
  territory_action: 'territory',
  territory_attack: 'territory',
  territory_defense: 'territory',
  territory_battle: 'territory',
  raid: 'raid',
  raid_damage: 'raid',
  raid_contribution: 'raid',
  favour: 'favour',
  favor: 'favour',
  favour_gain: 'favour',
  favor_gain: 'favour',
  crafting: 'crafting',
  craft: 'crafting',
  crafted: 'crafting',
  craft_complete: 'crafting',
  crafting_action: 'crafting',
  item_crafted: 'crafting',
  item_upgraded: 'crafting',
  item_rerolled: 'crafting',
});

function timestamp(now = Date.now()) {
  const value = now instanceof Date ? now.getTime() : typeof now === 'string' ? Date.parse(now) : Number(now);
  if (!Number.isFinite(value)) throw new TypeError('now must be a valid date or timestamp.');
  return value;
}

function periodWindow(cadence, now = Date.now()) {
  const value = timestamp(now);
  const date = new Date(value);
  let startsAt = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  if (cadence === 'weekly') startsAt -= ((date.getUTCDay() + 6) % 7) * DAY_MS;
  const duration = cadence === 'weekly' ? WEEK_MS : DAY_MS;
  return { key: new Date(startsAt).toISOString().slice(0, 10), startsAt, resetsAt: startsAt + duration };
}

function hashSeed(text) {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function seededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value ^= value + Math.imul(value ^ (value >>> 7), 61 | value);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function assignedDefinitions(identity, cadence, key) {
  const definitions = [...CONTRACT_DEFINITIONS[cadence]];
  const random = seededRandom(hashSeed(`${identity}|${cadence}|${key}`));
  for (let index = definitions.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [definitions[index], definitions[swapIndex]] = [definitions[swapIndex], definitions[index]];
  }
  return definitions.slice(0, CONTRACT_COUNTS[cadence]);
}

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function legacyPeriod(state, cadence) {
  const direct = state?.[cadence];
  if (Array.isArray(direct)) return { key: state[`${cadence}Key`], contracts: direct };
  if (isObject(direct)) return direct;
  const contracts = state?.[`${cadence}Contracts`];
  if (!Array.isArray(contracts)) return null;
  return {
    key: state[`${cadence}Key`] || state[`${cadence}Date`],
    resetsAt: state[`${cadence}ResetsAt`],
    contracts,
  };
}

function storedEntryMap(period) {
  const entries = Array.isArray(period?.contracts)
    ? period.contracts
    : Array.isArray(period?.assignments)
      ? period.assignments
      : [];
  const map = new Map();
  for (const entry of entries) {
    if (typeof entry === 'string') map.set(entry, { id: entry });
    else if (isObject(entry)) {
      const id = entry.id || entry.contractId || entry.definitionId;
      if (id) map.set(id, entry);
    }
  }
  return map;
}

function samePeriod(period, window) {
  if (!period) return false;
  const key = period.key || period.periodKey || period.date || period.week || period.cycle;
  if (key) return key === window.key;
  const reset = Number(period.resetsAt || period.resetAt);
  return Number.isFinite(reset) && reset === window.resetsAt;
}

function normalizePeriod(period, identity, cadence, window) {
  const definitions = assignedDefinitions(identity, cadence, window.key);
  if (!samePeriod(period, window)) {
    return {
      key: window.key,
      startsAt: window.startsAt,
      resetsAt: window.resetsAt,
      contracts: definitions.map(({ id }) => ({ id, progress: 0, claimed: false })),
    };
  }

  const entryMap = storedEntryMap(period);
  const progressMap = isObject(period.progress) ? period.progress : {};
  const claimedIds = new Set(Array.isArray(period.claimed) ? period.claimed : []);
  const contracts = definitions.map((definition) => {
    const stored = entryMap.get(definition.id) || {};
    const rawProgress = stored.progress ?? stored.amount ?? progressMap[definition.id] ?? 0;
    const claimed = Boolean(stored.claimed ?? stored.isClaimed ?? claimedIds.has(definition.id));
    const numericProgress = Number.isFinite(Number(rawProgress)) ? Math.floor(Number(rawProgress)) : 0;
    return {
      id: definition.id,
      progress: claimed ? definition.goal : Math.max(0, Math.min(definition.goal, numericProgress)),
      claimed,
    };
  });
  return { key: window.key, startsAt: window.startsAt, resetsAt: window.resetsAt, contracts };
}

function normalizeContractState(character, now = Date.now()) {
  if (!isObject(character)) throw new TypeError('character must be an object.');
  const value = timestamp(now);
  const source = isObject(character.contractState)
    ? character.contractState
    : isObject(character.contracts)
      ? character.contracts
      : {};
  const identity = String(character.userId || character.characterId || character.name || 'anonymous');
  character.contractState = {
    schemaVersion: CONTRACT_SCHEMA_VERSION,
    daily: normalizePeriod(legacyPeriod(source, 'daily'), identity, 'daily', periodWindow('daily', value)),
    weekly: normalizePeriod(legacyPeriod(source, 'weekly'), identity, 'weekly', periodWindow('weekly', value)),
  };
  return character.contractState;
}

function cloneReward(reward) {
  return {
    ...(reward.gold ? { gold: reward.gold } : {}),
    ...(reward.materials ? { materials: { ...reward.materials } } : {}),
    ...(reward.favour ? { favour: reward.favour } : {}),
    ...(reward.mastery ? { mastery: reward.mastery } : {}),
    ...(reward.guildXp ? { guildXp: reward.guildXp } : {}),
  };
}

function enrichContract(entry) {
  const definition = DEFINITION_BY_ID.get(entry.id);
  return {
    ...definition,
    reward: cloneReward(definition.reward),
    progress: entry.progress,
    claimed: entry.claimed,
    completed: entry.progress >= definition.goal,
    remaining: Math.max(0, definition.goal - entry.progress),
  };
}

function contractStatus(character, now = Date.now()) {
  const state = normalizeContractState(character, now);
  const describe = (period) => ({
    key: period.key,
    startsAt: period.startsAt,
    resetsAt: period.resetsAt,
    contracts: period.contracts.map(enrichContract),
  });
  const daily = describe(state.daily);
  const weekly = describe(state.weekly);
  return { daily, weekly, all: [...daily.contracts, ...weekly.contracts] };
}

function progressContract(character, event, amount = 1, context = {}) {
  const normalizedContext = isObject(context) ? context : {};
  const canonicalEvent = EVENT_ALIASES[String(event || '').toLowerCase()];
  if (!canonicalEvent) return { ok: false, message: 'Unknown contract event.', updated: [] };
  const numericAmount = Number(amount);
  if (!Number.isFinite(numericAmount) || numericAmount <= 0) return { ok: false, message: 'Contract progress must be a positive number.', updated: [] };
  if (normalizedContext.success === false || normalizedContext.eligible === false) {
    return { ok: true, event: canonicalEvent, amount: 0, updated: [] };
  }

  const appliedAmount = Math.max(1, Math.floor(numericAmount));
  const state = normalizeContractState(character, normalizedContext.now ?? Date.now());
  const updated = [];
  for (const cadence of ['daily', 'weekly']) {
    for (const entry of state[cadence].contracts) {
      const definition = DEFINITION_BY_ID.get(entry.id);
      if (entry.claimed || definition.event !== canonicalEvent) continue;
      const before = entry.progress;
      entry.progress = Math.min(definition.goal, entry.progress + appliedAmount);
      if (entry.progress === before) continue;
      updated.push({
        cadence,
        id: entry.id,
        before,
        progress: entry.progress,
        goal: definition.goal,
        completed: entry.progress >= definition.goal,
        justCompleted: before < definition.goal && entry.progress >= definition.goal,
      });
    }
  }
  return { ok: true, event: canonicalEvent, amount: appliedAmount, updated };
}

function rewardEffects(reward) {
  const effects = [];
  if (reward.gold) effects.push({ type: 'gold', amount: reward.gold });
  for (const [material, amount] of Object.entries(reward.materials || {})) effects.push({ type: 'material', material, amount });
  if (reward.favour) effects.push({ type: 'favour', amount: reward.favour });
  if (reward.mastery) effects.push({ type: 'mastery', amount: reward.mastery });
  if (reward.guildXp) effects.push({ type: 'guildXp', amount: reward.guildXp });
  return effects;
}

function claimContract(character, id, now = Date.now()) {
  const state = normalizeContractState(character, now);
  for (const cadence of ['daily', 'weekly']) {
    const entry = state[cadence].contracts.find((contract) => contract.id === id);
    if (!entry) continue;
    const definition = DEFINITION_BY_ID.get(entry.id);
    if (entry.claimed) return { ok: false, message: 'That contract reward has already been claimed.' };
    if (entry.progress < definition.goal) return { ok: false, message: 'That contract is not complete.', progress: entry.progress, goal: definition.goal };
    entry.claimed = true;
    const reward = cloneReward(definition.reward);
    return { ok: true, cadence, contract: enrichContract(entry), reward, effects: rewardEffects(reward) };
  }
  return { ok: false, message: 'That contract is not active.' };
}

module.exports = {
  CONTRACT_SCHEMA_VERSION,
  CONTRACT_COUNTS,
  CONTRACT_DEFINITIONS,
  EVENT_ALIASES,
  periodWindow,
  normalizeContractState,
  contractStatus,
  progressContract,
  claimContract,
};
