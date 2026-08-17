'use strict';

const RAID_ACTION_COOLDOWN_MS = 60 * 60 * 1000;
const DEFAULT_PHASE_COUNT = 3;
const RAID_ROLE_SCHEMA_VERSION = 1;

const CONTRIBUTION_KEYS = Object.freeze([
  'damage',
  'protection',
  'healing',
  'intel',
  'armorBreak',
  'supplies',
]);

const PREPARATION_KEYS = Object.freeze(CONTRIBUTION_KEYS.filter((key) => key !== 'damage'));
const PREPARATION_CAPS = Object.freeze({
  protection: 100,
  healing: 100,
  intel: 100,
  armorBreak: 100,
  supplies: 100,
});

// Preparation fills quickly enough to reward a mixed raid, while per-action and
// boss-HP caps keep high-level and administrator equipment from skipping phases.
const RAID_ROLES = Object.freeze({
  vanguard: Object.freeze({
    id: 'vanguard', name: 'Vanguard / Tank', aliases: ['tank'], contribution: 'protection',
    damageScale: 0.35, damageCap: 0.003, preparationBase: 8, preparationScale: 0.65, preparationPerActionCap: 18,
    specializations: ['vanguard'], station: 'command',
    effects: { mastery: 2, favour: 1, guildInfluence: 2, guildXp: 14, resources: {} },
  }),
  healer: Object.freeze({
    id: 'healer', name: 'Healer / Support', aliases: ['support'], contribution: 'healing',
    damageScale: 0.12, damageCap: 0.001, preparationBase: 8, preparationScale: 0.65, preparationPerActionCap: 18,
    specializations: ['oracle'], station: 'infirmary',
    effects: { mastery: 2, favour: 3, guildInfluence: 1, guildXp: 14, resources: {} },
  }),
  scout: Object.freeze({
    id: 'scout', name: 'Scout', aliases: [], contribution: 'intel',
    damageScale: 0.3, damageCap: 0.003, preparationBase: 7, preparationScale: 0.6, preparationPerActionCap: 15,
    specializations: ['ranger', 'oracle'], station: 'command',
    effects: { mastery: 2, favour: 2, guildInfluence: 1, guildXp: 12, resources: { crystal: 1 } },
  }),
  saboteur: Object.freeze({
    id: 'saboteur', name: 'Saboteur', aliases: [], contribution: 'armorBreak',
    damageScale: 0.5, damageCap: 0.005, preparationBase: 7, preparationScale: 0.6, preparationPerActionCap: 15,
    specializations: ['shadow', 'arcanist'], station: 'workshop',
    effects: { mastery: 2, favour: 1, guildInfluence: 3, guildXp: 16, resources: {} },
  }),
  quartermaster: Object.freeze({
    id: 'quartermaster', name: 'Quartermaster', aliases: [], contribution: 'supplies',
    damageScale: 0.1, damageCap: 0.001, preparationBase: 10, preparationScale: 0.7, preparationPerActionCap: 20,
    specializations: [], station: 'workshop',
    effects: { mastery: 1, favour: 1, guildInfluence: 4, guildXp: 20, resources: { food: 2 } },
  }),
  striker: Object.freeze({
    id: 'striker', name: 'Striker', aliases: ['damage', 'dps'], contribution: 'damage',
    damageScale: 1, damageCap: 0.012, preparationBase: 0, preparationScale: 0, preparationPerActionCap: 0,
    specializations: ['warlord', 'arcanist'], station: 'shrine',
    effects: { mastery: 2, favour: 2, guildInfluence: 2, guildXp: 16, resources: {} },
  }),
});

const ROLE_ALIASES = Object.freeze(Object.fromEntries(
  Object.values(RAID_ROLES).flatMap((role) => [role.id, ...role.aliases].map((id) => [id, role.id])),
));

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function finiteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function boundedNumber(value, minimum, maximum, fallback = minimum) {
  return Math.max(minimum, Math.min(maximum, finiteNumber(value, fallback)));
}

function timestamp(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.max(0, value);
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
  }
  return 0;
}

function canonicalRoleId(roleId) {
  return ROLE_ALIASES[String(roleId || '').toLowerCase()] || null;
}

function emptyCounters() {
  return Object.fromEntries(PREPARATION_KEYS.map((key) => [key, 0]));
}

function emptyContribution() {
  return {
    damage: 0, protection: 0, healing: 0, intel: 0, armorBreak: 0, supplies: 0,
    actions: 0, roles: {},
  };
}

function normalizeCounters(value) {
  const counters = isRecord(value) ? value : {};
  for (const key of PREPARATION_KEYS) {
    counters[key] = Math.round(boundedNumber(counters[key], 0, PREPARATION_CAPS[key], 0));
  }
  return counters;
}

function normalizeContribution(value) {
  const contribution = isRecord(value) ? value : emptyContribution();
  for (const key of CONTRIBUTION_KEYS) contribution[key] = Math.max(0, Math.round(finiteNumber(contribution[key], 0)));
  contribution.actions = Math.max(0, Math.round(finiteNumber(contribution.actions, 0)));
  contribution.roles = isRecord(contribution.roles) ? contribution.roles : {};
  for (const [roleId, count] of Object.entries(contribution.roles)) {
    const canonical = canonicalRoleId(roleId);
    if (!canonical || canonical !== roleId) delete contribution.roles[roleId];
    else contribution.roles[roleId] = Math.max(0, Math.round(finiteNumber(count, 0)));
  }
  return contribution;
}

function normalizeRaidRoleState(raid, phaseCount = DEFAULT_PHASE_COUNT) {
  if (!isRecord(raid)) throw new TypeError('A raid object is required.');

  raid.maxHp = Math.max(1, Math.round(finiteNumber(raid.maxHp, finiteNumber(raid.hp, 1))));
  raid.hp = Math.round(boundedNumber(raid.hp, 0, raid.maxHp, raid.maxHp));
  raid.contributions = isRecord(raid.contributions) ? raid.contributions : {};
  for (const [userId, contribution] of Object.entries(raid.contributions)) {
    raid.contributions[userId] = Math.max(0, Math.round(finiteNumber(
      isRecord(contribution) ? contribution.damage : contribution,
      0,
    )));
  }

  const legacy = isRecord(raid.raidRoles) ? raid.raidRoles : {};
  const state = isRecord(raid.roleState) ? raid.roleState : {};
  state.schemaVersion = RAID_ROLE_SCHEMA_VERSION;
  state.phaseCount = Math.round(boundedNumber(phaseCount || state.phaseCount, 1, 10, DEFAULT_PHASE_COUNT));
  state.assignments = isRecord(state.assignments) ? state.assignments
    : (isRecord(legacy.assignments) ? legacy.assignments : {});
  state.lastActions = isRecord(state.lastActions) ? state.lastActions
    : (isRecord(legacy.lastActions) ? legacy.lastActions : {});
  state.phases = isRecord(state.phases) ? state.phases
    : (isRecord(legacy.phases) ? legacy.phases : {});
  state.contributions = isRecord(state.contributions) ? state.contributions
    : (isRecord(raid.roleContributions) ? raid.roleContributions : {});

  for (const [userId, roleId] of Object.entries(state.assignments)) {
    const canonical = canonicalRoleId(roleId);
    if (canonical) state.assignments[userId] = canonical;
    else delete state.assignments[userId];
  }
  for (const [userId, lastAction] of Object.entries(state.lastActions)) state.lastActions[userId] = timestamp(lastAction);
  for (const [userId, contribution] of Object.entries(state.contributions)) {
    state.contributions[userId] = normalizeContribution(contribution);
  }
  for (let phase = 0; phase < state.phaseCount; phase += 1) {
    const current = isRecord(state.phases[phase]) ? state.phases[phase] : {};
    current.counters = normalizeCounters(current.counters);
    current.actions = Math.max(0, Math.round(finiteNumber(current.actions, 0)));
    state.phases[phase] = current;
  }

  raid.roleState = state;
  return raid;
}

function raidPhaseIndex(raid, phaseCount = raid?.roleState?.phaseCount || DEFAULT_PHASE_COUNT) {
  const count = Math.round(boundedNumber(phaseCount, 1, 10, DEFAULT_PHASE_COUNT));
  const maxHp = Math.max(1, finiteNumber(raid?.maxHp, 1));
  const hp = boundedNumber(raid?.hp, 0, maxHp, maxHp);
  if (hp <= 0) return count - 1;
  return Math.min(count - 1, Math.floor((1 - hp / maxHp) * count));
}

function preparationBuffs(counters = {}) {
  const normalized = normalizeCounters({ ...counters });
  const intelDamage = normalized.intel * 0.0012;
  const armorBreakDamage = normalized.armorBreak * 0.0015;
  const supplyDamage = normalized.supplies * 0.0006;
  const damageBonus = Math.min(0.3, intelDamage + armorBreakDamage + supplyDamage);
  return {
    damageBonus,
    damageMultiplier: 1 + damageBonus,
    mitigation: Math.min(0.25, normalized.protection * 0.0025),
    recovery: Math.min(0.25, normalized.healing * 0.0025),
    lootBonus: Math.min(0.05, normalized.supplies * 0.0005),
  };
}

function userIdOf(character) {
  if (typeof character === 'string' && character) return character;
  if (!isRecord(character)) return null;
  return character.userId || character.id || null;
}

function lastRaidAction(state, character, userId) {
  const values = [];
  if (Object.prototype.hasOwnProperty.call(state.lastActions, userId)) values.push(timestamp(state.lastActions[userId]));
  if (character?.lastRaidAction !== undefined && character?.lastRaidAction !== null) values.push(timestamp(character.lastRaidAction));
  return values.length ? Math.max(...values) : null;
}

function selectRaidRole(raid, character, requestedRoleId, options = {}) {
  const userId = userIdOf(character);
  if (!userId) return { ok: false, message: 'A character with a user ID is required.' };
  const roleId = canonicalRoleId(requestedRoleId);
  if (!roleId) return { ok: false, message: 'Unknown raid role.' };
  normalizeRaidRoleState(raid, options.phaseCount);

  const state = raid.roleState;
  const previous = state.assignments[userId] || null;
  if (previous && previous !== roleId) {
    const now = finiteNumber(options.now, Date.now());
    const lastAction = lastRaidAction(state, character, userId);
    const remaining = lastAction === null ? 0 : RAID_ACTION_COOLDOWN_MS - (now - lastAction);
    if (remaining > 0) return { ok: false, message: 'You can change role when your next raid action is ready.', remaining };
  }
  state.assignments[userId] = roleId;
  return { ok: true, changed: previous !== roleId, previous, role: RAID_ROLES[roleId] };
}

function roleOutputMultiplier(role, character, guild) {
  const specializationBonus = role.specializations.includes(character?.specialization) ? 0.1 : 0;
  const stationLevel = boundedNumber(guild?.stations?.[role.station], 0, 5, 0);
  return 1 + specializationBonus + stationLevel * 0.02;
}

function actionEffects(role, character, guild) {
  const effects = role.effects;
  const masteryRemaining = Math.max(0, 100 - boundedNumber(character?.mastery, 0, 100, 0));
  const intelligence = Math.max(0, finiteNumber(character?.stats?.intelligence, 0));
  const favourMultiplier = 1 + Math.min(0.25, intelligence * 0.001);
  return {
    mastery: Math.min(effects.mastery, masteryRemaining),
    favour: character?.god ? Math.round(effects.favour * favourMultiplier) : 0,
    guildInfluence: guild ? effects.guildInfluence : 0,
    guildXp: guild ? effects.guildXp : 0,
    resources: { ...effects.resources },
  };
}

function resolveRaidRoleAction(raid, character, guild = null, basePower = 1, options = {}) {
  const userId = userIdOf(character);
  if (!userId) return { ok: false, message: 'A character with a user ID is required.' };
  normalizeRaidRoleState(raid, options.phaseCount);
  const state = raid.roleState;
  const roleId = state.assignments[userId];
  const role = RAID_ROLES[roleId];
  if (!role) return { ok: false, message: 'Choose a raid role before acting.' };
  if (raid.defeatedAt || raid.hp <= 0) return { ok: false, message: 'The current world boss is already defeated.' };

  const now = finiteNumber(options.now, Date.now());
  const lastAction = lastRaidAction(state, character, userId);
  const elapsed = lastAction === null ? Number.POSITIVE_INFINITY : now - lastAction;
  if (elapsed < RAID_ACTION_COOLDOWN_MS) {
    return { ok: false, message: 'Your raid action is still recovering.', remaining: RAID_ACTION_COOLDOWN_MS - elapsed };
  }

  const phaseBefore = raidPhaseIndex(raid, state.phaseCount);
  const phaseState = state.phases[phaseBefore];
  const buffsBefore = preparationBuffs(phaseState.counters);
  const outputMultiplier = roleOutputMultiplier(role, character, guild);
  const power = Math.max(1, finiteNumber(basePower, 1));
  const rawDamage = Math.max(1, Math.round(power * role.damageScale * buffsBefore.damageMultiplier * outputMultiplier));
  const damageCap = Math.max(1, Math.floor(raid.maxHp * role.damageCap));
  const damage = Math.min(raid.hp, damageCap, rawDamage);

  let preparation = null;
  if (role.contribution !== 'damage') {
    const attempted = Math.min(
      role.preparationPerActionCap,
      Math.max(1, Math.round((role.preparationBase + Math.log2(power + 1) * role.preparationScale) * outputMultiplier)),
    );
    const before = phaseState.counters[role.contribution];
    const after = Math.min(PREPARATION_CAPS[role.contribution], before + attempted);
    phaseState.counters[role.contribution] = after;
    preparation = { type: role.contribution, attempted, added: after - before, before, after, capped: after >= PREPARATION_CAPS[role.contribution] };
  }

  raid.hp = Math.max(0, raid.hp - damage);
  raid.contributions[userId] = Math.max(0, finiteNumber(raid.contributions[userId], 0)) + damage;
  const playerContribution = state.contributions[userId] ||= emptyContribution();
  playerContribution.damage += damage;
  if (preparation) playerContribution[preparation.type] += preparation.added;
  playerContribution.actions += 1;
  playerContribution.roles[role.id] = (playerContribution.roles[role.id] || 0) + 1;
  phaseState.actions += 1;
  state.lastActions[userId] = now;

  const phaseAfter = raidPhaseIndex(raid, state.phaseCount);
  if (!raid.hp) raid.defeatedAt = new Date(Math.max(0, now)).toISOString();
  return {
    ok: true,
    role,
    damage,
    damageCapped: damage === damageCap && rawDamage > damageCap,
    preparation,
    effects: actionEffects(role, character, guild),
    contribution: { ...playerContribution, roles: { ...playerContribution.roles } },
    phase: {
      before: phaseBefore,
      after: phaseAfter,
      advanced: phaseAfter > phaseBefore,
      counters: { ...phaseState.counters },
      buffsBefore,
      buffsAfter: preparationBuffs(phaseState.counters),
    },
    defeated: raid.hp <= 0,
    raid,
  };
}

function raidRoleStatus(raid, character, now = Date.now(), phaseCount) {
  const userId = userIdOf(character);
  normalizeRaidRoleState(raid, phaseCount);
  const state = raid.roleState;
  const phase = raidPhaseIndex(raid, state.phaseCount);
  const lastAction = userId ? lastRaidAction(state, character, userId) : null;
  const remaining = lastAction === null ? 0 : Math.max(0, RAID_ACTION_COOLDOWN_MS - (finiteNumber(now, Date.now()) - lastAction));
  return {
    role: userId && state.assignments[userId] ? RAID_ROLES[state.assignments[userId]] : null,
    ready: remaining === 0 && raid.hp > 0 && !raid.defeatedAt,
    remaining,
    phase,
    counters: { ...state.phases[phase].counters },
    buffs: preparationBuffs(state.phases[phase].counters),
    contribution: userId ? { ...(state.contributions[userId] || emptyContribution()) } : emptyContribution(),
  };
}

module.exports = {
  RAID_ACTION_COOLDOWN_MS,
  DEFAULT_PHASE_COUNT,
  RAID_ROLE_SCHEMA_VERSION,
  CONTRIBUTION_KEYS,
  PREPARATION_KEYS,
  PREPARATION_CAPS,
  RAID_ROLES,
  canonicalRoleId,
  normalizeRaidRoleState,
  raidPhaseIndex,
  preparationBuffs,
  selectRaidRole,
  setRaidRole: selectRaidRole,
  resolveRaidRoleAction,
  resolveRaidAction: resolveRaidRoleAction,
  raidRoleStatus,
};
