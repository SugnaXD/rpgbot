const test = require('node:test');
const assert = require('node:assert/strict');
const { isBotOwner, isBotAdmin } = require('../src/core/auth');

test('only the configured user ID is the bot owner while the role can use admin commands', () => {
  const previousUser = process.env.ADMIN_USER_ID;
  const previousRole = process.env.ADMIN_ROLE_ID;
  process.env.ADMIN_USER_ID = 'owner';
  process.env.ADMIN_ROLE_ID = 'admins';
  try {
    const owner = { user: { id: 'owner' }, member: { roles: { cache: new Map() } } };
    const roleAdmin = { user: { id: 'moderator' }, member: { roles: { cache: new Map([['admins', {}]]) } } };
    const player = { user: { id: 'player' }, member: { roles: { cache: new Map() } } };
    assert.equal(isBotOwner(owner), true);
    assert.equal(isBotOwner(roleAdmin), false);
    assert.equal(isBotAdmin(owner), true);
    assert.equal(isBotAdmin(roleAdmin), true);
    assert.equal(isBotAdmin(player), false);
  } finally {
    if (previousUser === undefined) delete process.env.ADMIN_USER_ID;
    else process.env.ADMIN_USER_ID = previousUser;
    if (previousRole === undefined) delete process.env.ADMIN_ROLE_ID;
    else process.env.ADMIN_ROLE_ID = previousRole;
  }
});
