const test = require('node:test');
const assert = require('node:assert/strict');
const { createCharacter } = require('../src/game');
const { createWorldState } = require('../src/systems');
const { claimContract, contractStatus } = require('../src/features/contracts-system');
const { contractsView, handleContractsCommand } = require('../src/features/contracts-commands');
const { raidView, resolveAndApplyRaidAction, handleRaidCommand } = require('../src/features/raid-commands');
const { selectRaidRole } = require('../src/features/raid-roles-system');

function firstComponent(view, row = 0) {
  return view.payload.components[row].toJSON().components[0];
}

test('contracts view offers only completed unclaimed rewards and refreshes after claim', () => {
  const hero = createCharacter('123456789012345678', 'Contractor', 'warrior');
  const initial = contractsView(hero);
  assert.equal(firstComponent(initial).disabled, true);

  const status = contractStatus(hero);
  const ready = status.daily.contracts[0];
  const entry = hero.contractState.daily.contracts.find((contract) => contract.id === ready.id);
  entry.progress = ready.goal;
  const completed = contractsView(hero);
  const menu = firstComponent(completed);
  assert.equal(menu.disabled, false);
  assert.deepEqual(menu.options.map((option) => option.value), [ready.id]);
  assert.ok(menu.custom_id.length <= 100);

  assert.equal(claimContract(hero, ready.id).ok, true);
  assert.equal(firstComponent(contractsView(hero)).disabled, true);
});

test('raid view enables live role actions and disables them during cooldown', () => {
  const hero = createCharacter('123456789012345678', 'Raider', 'warrior');
  const world = createWorldState();
  const withoutRole = raidView(world, hero);
  const roleMenu = firstComponent(withoutRole);
  const actionBefore = firstComponent(withoutRole, withoutRole.payload.components.length - 1);
  assert.equal(roleMenu.options.length, 6);
  assert.equal(actionBefore.disabled, true);

  assert.equal(selectRaidRole(world.raid, hero, 'striker').ok, true);
  const ready = raidView(world, hero);
  const selectedRole = firstComponent(ready).options.find((option) => option.default);
  const readyAction = firstComponent(ready, ready.payload.components.length - 1);
  assert.equal(selectedRole.value, 'striker');
  assert.equal(readyAction.disabled, false);

  assert.equal(resolveAndApplyRaidAction(world, hero, Date.now()).ok, true);
  const coolingDown = raidView(world, hero);
  const cooldownAction = firstComponent(coolingDown, coolingDown.payload.components.length - 1);
  assert.equal(cooldownAction.disabled, true);
  assert.match(cooldownAction.label, /^Ready in /);
});

test('contract and raid collectors reject other users and unrelated custom IDs', async () => {
  const hero = createCharacter('123456789012345678', 'Owner', 'warrior');
  const worldStore = { state: createWorldState(), save: async () => {} };
  const store = { get: () => hero, set: async () => {} };
  const createInteraction = (commandName) => {
    const state = {};
    const collector = { on() { return collector; } };
    const message = {
      createMessageComponentCollector(options) { state.collectorOptions = options; return collector; },
    };
    return {
      state,
      interaction: {
        commandName, user: { id: hero.userId },
        options: { getSubcommand: () => 'view' },
        reply: async (payload) => { state.payload = payload; return { resource: { message } }; },
        editReply: async () => {},
      },
    };
  };

  const contracts = createInteraction('contracts');
  assert.equal(await handleContractsCommand(contracts.interaction, hero, store, worldStore), true);
  const contractId = firstComponent({ payload: contracts.state.payload }).custom_id;
  assert.equal(contracts.state.collectorOptions.filter({ user: { id: hero.userId }, customId: contractId }), true);
  assert.equal(contracts.state.collectorOptions.filter({ user: { id: 'intruder' }, customId: contractId }), false);
  assert.equal(contracts.state.collectorOptions.filter({ user: { id: hero.userId }, customId: 'not-a-route' }), false);

  const raid = createInteraction('raid');
  assert.equal(await handleRaidCommand(raid.interaction, hero, store, worldStore), true);
  const raidId = firstComponent({ payload: raid.state.payload }).custom_id;
  assert.equal(raid.state.collectorOptions.filter({ user: { id: hero.userId }, customId: raidId }), true);
  assert.equal(raid.state.collectorOptions.filter({ user: { id: 'intruder' }, customId: raidId }), false);
  assert.equal(raid.state.collectorOptions.filter({ user: { id: hero.userId }, customId: contractId }), false);
});
