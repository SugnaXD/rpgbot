const test = require('node:test');
const assert = require('node:assert/strict');
const {
  CONTRACT_COUNTS,
  CONTRACT_DEFINITIONS,
  periodWindow,
  normalizeContractState,
  contractStatus,
  progressContract,
  claimContract,
} = require('../src/features/contracts-system');

const MONDAY = Date.parse('2026-08-17T10:00:00Z');

function character(userId = 'contract-user') {
  return { userId, gold: 10, favour: 2, mastery: 4, materials: { dust: 3 } };
}

test('contract assignments are deterministic for a player and period', () => {
  const first = character();
  const second = character();
  const firstState = normalizeContractState(first, MONDAY);
  const secondState = normalizeContractState(second, MONDAY);
  assert.deepEqual(firstState, secondState);
  assert.equal(firstState.daily.contracts.length, CONTRACT_COUNTS.daily);
  assert.equal(firstState.weekly.contracts.length, CONTRACT_COUNTS.weekly);
  assert.equal(new Set(firstState.daily.contracts.map(({ id }) => id)).size, CONTRACT_COUNTS.daily);
  assert.equal(new Set(firstState.weekly.contracts.map(({ id }) => id)).size, CONTRACT_COUNTS.weekly);
});

test('the daily and weekly catalogs span every connected game system', () => {
  const expected = ['combat', 'crafting', 'expedition', 'favour', 'guild_donation', 'raid', 'territory'];
  assert.deepEqual([...new Set(CONTRACT_DEFINITIONS.daily.map(({ event }) => event))].sort(), expected);
  assert.deepEqual([...new Set(CONTRACT_DEFINITIONS.weekly.map(({ event }) => event))].sort(), expected);
  for (const definition of [...CONTRACT_DEFINITIONS.daily, ...CONTRACT_DEFINITIONS.weekly]) {
    assert.ok(definition.goal > 0);
    assert.ok(Object.keys(definition.reward).length >= 2, `${definition.id} should feed at least two systems`);
  }
});

test('UTC daily and Monday weekly reset windows are exact', () => {
  assert.deepEqual(periodWindow('daily', MONDAY), {
    key: '2026-08-17',
    startsAt: Date.parse('2026-08-17T00:00:00Z'),
    resetsAt: Date.parse('2026-08-18T00:00:00Z'),
  });
  assert.deepEqual(periodWindow('weekly', Date.parse('2026-08-23T23:59:59Z')), {
    key: '2026-08-17',
    startsAt: Date.parse('2026-08-17T00:00:00Z'),
    resetsAt: Date.parse('2026-08-24T00:00:00Z'),
  });
});

test('a daily reset preserves weekly progress while a Monday reset rotates both', () => {
  const hero = character();
  const state = normalizeContractState(hero, MONDAY);
  state.daily.contracts[0].progress = 1;
  state.daily.contracts[0].claimed = true;
  state.weekly.contracts[0].progress = 3;
  const weeklyId = state.weekly.contracts[0].id;

  const tuesday = normalizeContractState(hero, Date.parse('2026-08-18T01:00:00Z'));
  assert.equal(tuesday.daily.key, '2026-08-18');
  assert.ok(tuesday.daily.contracts.every((entry) => entry.progress === 0 && !entry.claimed));
  assert.equal(tuesday.weekly.contracts.find((entry) => entry.id === weeklyId).progress, 3);

  const nextMonday = normalizeContractState(hero, Date.parse('2026-08-24T00:00:00Z'));
  assert.equal(nextMonday.daily.key, '2026-08-24');
  assert.equal(nextMonday.weekly.key, '2026-08-24');
  assert.ok(nextMonday.weekly.contracts.every((entry) => entry.progress === 0 && !entry.claimed));
});

test('normalization migrates legacy assignments and sanitizes their progress', () => {
  const original = character('legacy-user');
  const current = normalizeContractState(original, MONDAY);
  const dailyId = current.daily.contracts[0].id;
  const dailyGoal = CONTRACT_DEFINITIONS.daily.find(({ id }) => id === dailyId).goal;
  const weeklyId = current.weekly.contracts[0].id;
  delete original.contractState;
  original.contracts = {
    daily: { periodKey: '2026-08-17', assignments: [{ definitionId: dailyId, amount: dailyGoal + 999 }] },
    weekly: { key: '2026-08-17', progress: { [weeklyId]: -50 }, claimed: [weeklyId] },
  };

  const migrated = normalizeContractState(original, MONDAY);
  assert.equal(migrated.schemaVersion, 1);
  assert.deepEqual(migrated.daily.contracts.find(({ id }) => id === dailyId), { id: dailyId, progress: dailyGoal, claimed: false });
  const weeklyGoal = CONTRACT_DEFINITIONS.weekly.find(({ id }) => id === weeklyId).goal;
  assert.deepEqual(migrated.weekly.contracts.find(({ id }) => id === weeklyId), { id: weeklyId, progress: weeklyGoal, claimed: true });
});

test('progress uses aliases, updates both cadences, caps at goals, and reports completion', () => {
  let selected = null;
  for (let offset = 0; offset < 70 && !selected; offset += 1) {
    const now = MONDAY + offset * 24 * 60 * 60 * 1000;
    const hero = character(`raid-user-${offset}`);
    const status = contractStatus(hero, now);
    const daily = status.daily.contracts.find(({ event }) => event === 'raid');
    const weekly = status.weekly.contracts.find(({ event }) => event === 'raid');
    if (daily && weekly) selected = { hero, now, daily, weekly };
  }
  assert.ok(selected, 'expected a deterministic rotation containing raid contracts in both cadences');
  const result = progressContract(selected.hero, 'raid_damage', 999999, { now: selected.now });
  assert.equal(result.ok, true);
  assert.equal(result.updated.length, 2);
  assert.ok(result.updated.every(({ completed, justCompleted, progress, goal }) => completed && justCompleted && progress === goal));
  const status = contractStatus(selected.hero, selected.now);
  assert.equal(status.all.find(({ id }) => id === selected.daily.id).progress, selected.daily.goal);
  assert.equal(status.all.find(({ id }) => id === selected.weekly.id).progress, selected.weekly.goal);
});

test('failed activity context and invalid amounts do not grant progress', () => {
  const hero = character();
  const before = structuredClone(normalizeContractState(hero, MONDAY));
  assert.deepEqual(progressContract(hero, 'combat_win', 1, { now: MONDAY, success: false }).updated, []);
  assert.equal(progressContract(hero, 'combat_win', 0, { now: MONDAY }).ok, false);
  assert.equal(progressContract(hero, 'unknown_event', 1, { now: MONDAY }).ok, false);
  assert.deepEqual(hero.contractState, before);
});

test('claim returns caller-applied effects and cannot be repeated', () => {
  const hero = character();
  const target = contractStatus(hero, MONDAY).daily.contracts[0];
  progressContract(hero, target.event, target.goal, { now: MONDAY });
  const characterRewardsBefore = { gold: hero.gold, favour: hero.favour, mastery: hero.mastery, materials: structuredClone(hero.materials) };
  const claimed = claimContract(hero, target.id, MONDAY);
  assert.equal(claimed.ok, true);
  assert.deepEqual(claimed.reward, target.reward);
  assert.ok(claimed.effects.length >= 2);
  assert.deepEqual({ gold: hero.gold, favour: hero.favour, mastery: hero.mastery, materials: hero.materials }, characterRewardsBefore);
  assert.equal(claimContract(hero, target.id, MONDAY).ok, false);
});

test('incomplete and inactive contracts cannot be claimed', () => {
  const hero = character();
  const target = contractStatus(hero, MONDAY).daily.contracts[0];
  const incomplete = claimContract(hero, target.id, MONDAY);
  assert.equal(incomplete.ok, false);
  assert.equal(incomplete.progress, 0);
  assert.equal(claimContract(hero, 'daily_not_assigned', MONDAY).ok, false);
});
