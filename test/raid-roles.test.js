'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  RAID_ACTION_COOLDOWN_MS,
  RAID_ROLES,
  PREPARATION_CAPS,
  canonicalRoleId,
  normalizeRaidRoleState,
  preparationBuffs,
  raidPhaseIndex,
  selectRaidRole,
  resolveRaidRoleAction,
  raidRoleStatus,
} = require('../src/features/raid-roles-system');

function makeRaid(hp = 100_000, maxHp = hp) {
  return { bossId: 'test-boss', hp, maxHp, contributions: {}, defeatedAt: null };
}

function makeCharacter(userId, overrides = {}) {
  return {
    userId,
    level: 100,
    mastery: 50,
    specialization: null,
    god: 'zeus',
    stats: { intelligence: 100 },
    ...overrides,
  };
}

const guild = {
  id: 'g1', level: 50, xp: 0, influence: 0,
  stations: { command: 2, infirmary: 2, workshop: 2, shrine: 2 },
};

test('raid-role persistence normalization migrates legacy data without replacing damage contributions', () => {
  const raid = makeRaid();
  raid.contributions = { legacy: 75, nested: { damage: 25 } };
  raid.roleContributions = {
    u1: { damage: '12', protection: 4, actions: 1, roles: { vanguard: 1 } },
  };
  raid.raidRoles = {
    assignments: { u1: 'tank', invalid: 'wizard' },
    lastActions: { u1: '2026-08-17T00:00:00.000Z' },
    phases: { 0: { counters: { protection: 999, healing: -5, intel: '12' } } },
  };

  assert.equal(normalizeRaidRoleState(raid), raid);
  assert.equal(raid.contributions.legacy, 75);
  assert.equal(raid.contributions.nested, 25);
  assert.equal(raid.roleState.assignments.u1, 'vanguard');
  assert.equal(raid.roleState.assignments.invalid, undefined);
  assert.equal(raid.roleState.phases[0].counters.protection, PREPARATION_CAPS.protection);
  assert.equal(raid.roleState.phases[0].counters.healing, 0);
  assert.equal(raid.roleState.phases[0].counters.intel, 12);
  assert.equal(raid.roleState.contributions.u1.damage, 12);
  assert.equal(raid.roleState.schemaVersion, 1);
});

test('role selection supports tank, support, and damage aliases and rejects unknown roles', () => {
  const raid = makeRaid();
  const hero = makeCharacter('u1');
  assert.equal(canonicalRoleId('tank'), 'vanguard');
  assert.equal(canonicalRoleId('support'), 'healer');
  assert.equal(canonicalRoleId('DPS'), 'striker');
  assert.equal(selectRaidRole(raid, hero, 'tank', { now: 0 }).role.id, 'vanguard');
  assert.equal(selectRaidRole(raid, makeCharacter('u2'), 'support', { now: 0 }).role.id, 'healer');
  assert.equal(selectRaidRole(raid, makeCharacter('u3'), 'damage', { now: 0 }).role.id, 'striker');
  assert.equal(selectRaidRole(raid, makeCharacter('u4'), 'wizard', { now: 0 }).ok, false);
});

test('raid actions enforce an hourly cooldown and role changes wait for that cooldown', () => {
  const raid = makeRaid();
  const hero = makeCharacter('u1');
  selectRaidRole(raid, hero, 'scout', { now: 0 });
  assert.equal(resolveRaidRoleAction(raid, hero, guild, 500, { now: 0 }).ok, true);

  const early = resolveRaidRoleAction(raid, hero, guild, 500, { now: RAID_ACTION_COOLDOWN_MS - 1 });
  assert.equal(early.ok, false);
  assert.equal(early.remaining, 1);
  assert.equal(selectRaidRole(raid, hero, 'striker', { now: 1_000 }).ok, false);

  assert.equal(selectRaidRole(raid, hero, 'striker', { now: RAID_ACTION_COOLDOWN_MS }).ok, true);
  assert.equal(resolveRaidRoleAction(raid, hero, guild, 500, { now: RAID_ACTION_COOLDOWN_MS }).ok, true);
  assert.equal(raid.roleState.contributions.u1.actions, 2);
});

test('all six roles affect the boss, their contribution track, and existing progression loops', () => {
  const raid = makeRaid(1_000_000);
  const expectedTracks = {
    vanguard: 'protection', healer: 'healing', scout: 'intel', saboteur: 'armorBreak',
    quartermaster: 'supplies', striker: 'damage',
  };

  for (const [index, roleId] of Object.keys(RAID_ROLES).entries()) {
    const hero = makeCharacter(`u${index}`, { specialization: RAID_ROLES[roleId].specializations[0] || null });
    assert.equal(selectRaidRole(raid, hero, roleId, { now: 0 }).ok, true);
    const hpBefore = raid.hp;
    const result = resolveRaidRoleAction(raid, hero, guild, 1_000, { now: 0 });
    assert.equal(result.ok, true);
    assert.ok(result.damage > 0);
    assert.ok(raid.hp < hpBefore);
    assert.ok(result.contribution[expectedTracks[roleId]] > 0);
    assert.ok(result.effects.mastery > 0);
    assert.ok(result.effects.guildXp > 0);
    assert.ok(result.effects.guildInfluence > 0);
    assert.ok(result.effects.favour > 0);
    assert.equal(typeof raid.contributions[hero.userId], 'number');
  }
});

test('shared preparation and individual outputs stay within balance caps', () => {
  const raid = makeRaid();
  normalizeRaidRoleState(raid);
  Object.assign(raid.roleState.phases[0].counters, {
    protection: 10_000, healing: 10_000, intel: 10_000, armorBreak: 10_000, supplies: 10_000,
  });
  normalizeRaidRoleState(raid);
  const buffs = preparationBuffs(raid.roleState.phases[0].counters);
  assert.equal(buffs.damageBonus, 0.3);
  assert.equal(buffs.mitigation, 0.25);
  assert.equal(buffs.recovery, 0.25);
  assert.equal(buffs.lootBonus, 0.05);

  const hero = makeCharacter('admin', { mastery: 100, specialization: 'warlord' });
  selectRaidRole(raid, hero, 'striker', { now: 0 });
  const result = resolveRaidRoleAction(raid, hero, guild, 1_000_000_000, { now: 0 });
  assert.equal(result.damage, Math.floor(raid.maxHp * RAID_ROLES.striker.damageCap));
  assert.equal(result.damageCapped, true);
  assert.equal(result.effects.mastery, 0);
});

test('crossing a health threshold advances to a fresh phase while preserving prior counters', () => {
  const raid = makeRaid(2_001, 3_000);
  normalizeRaidRoleState(raid, 3);
  raid.roleState.phases[0].counters.intel = 50;
  const hero = makeCharacter('u1', { specialization: 'warlord' });
  selectRaidRole(raid, hero, 'striker', { phaseCount: 3, now: 0 });
  const result = resolveRaidRoleAction(raid, hero, guild, 1_000_000, { phaseCount: 3, now: 0 });

  assert.equal(result.phase.before, 0);
  assert.equal(result.phase.after, 1);
  assert.equal(result.phase.advanced, true);
  assert.equal(raidPhaseIndex(raid, 3), 1);
  assert.equal(raid.roleState.phases[0].counters.intel, 50);
  assert.deepEqual(raid.roleState.phases[1].counters, {
    protection: 0, healing: 0, intel: 0, armorBreak: 0, supplies: 0,
  });

  const status = raidRoleStatus(raid, hero, RAID_ACTION_COOLDOWN_MS, 3);
  assert.equal(status.phase, 1);
  assert.equal(status.ready, true);
  assert.equal(status.counters.intel, 0);
});
