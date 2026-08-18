const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs/promises');
const { CharacterStore } = require('../src/store');
const { createCharacter, normalizeCharacter } = require('../src/game');

function fsWithTransientWriteFailure(count = 1) {
  let failuresRemaining = count;
  return {
    mkdir: (...args) => fs.mkdir(...args),
    readFile: (...args) => fs.readFile(...args),
    rename: (...args) => fs.rename(...args),
    unlink: (...args) => fs.unlink(...args),
    writeFile: (...args) => {
      if (failuresRemaining > 0) {
        failuresRemaining -= 1;
        return Promise.reject(Object.assign(new Error('simulated write failure'), { code: 'EIO' }));
      }
      return fs.writeFile(...args);
    },
  };
}

test('stores up to three characters and switches the active slot', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'rpg-store-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const store = new CharacterStore(path.join(directory, 'characters.json'));
  await store.load();
  const heroes = ['One', 'Two', 'Three'].map((name) => createCharacter('user', name, 'warrior'));
  for (const hero of heroes) await store.add('user', hero);
  assert.equal(store.getProfile('user').characters.length, 3);
  assert.equal(store.get('user').name, 'Three');
  await store.switch('user', 0);
  assert.equal(store.get('user').name, 'One');
  await assert.rejects(() => store.add('user', createCharacter('user', 'Four', 'mage')), /CHARACTER_LIMIT/);
});

test('migrates a legacy single-character save', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'rpg-migrate-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const file = path.join(directory, 'characters.json');
  await fs.writeFile(file, JSON.stringify({ user: createCharacter('user', 'Legacy', 'rogue') }));
  const store = new CharacterStore(file);
  await store.load();
  assert.equal(store.getProfile('user').characters.length, 1);
  assert.equal(store.get('user').name, 'Legacy');
});

test('startup character migrations are atomic, persisted, and idempotent', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'rpg-schema-migrate-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const file = path.join(directory, 'characters.json');
  const hero = createCharacter('user', 'Stored Legacy', 'warrior');
  hero.inventory.push({
    id: 'legacy-item', name: 'Legacy Item', type: 'weapon', rarity: 'rare', grade: 'b',
    power: 50, stats: { attack: 12 }, schemaVersion: 3,
  });
  await fs.writeFile(file, JSON.stringify({ user: hero }));
  const store = new CharacterStore(file);
  await store.load();

  assert.deepEqual(await store.migrateCharacters(normalizeCharacter), { total: 1, migrated: 1 });
  assert.equal(store.get('user').inventory[0].schemaVersion, 4);
  const saved = JSON.parse(await fs.readFile(file, 'utf8'));
  assert.equal(saved.user.characters[0].inventory[0].schemaVersion, 4);
  assert.deepEqual(await store.migrateCharacters(normalizeCharacter), { total: 1, migrated: 0 });
});

test('updates a specific character without changing the active slot', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'rpg-update-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const store = new CharacterStore(path.join(directory, 'characters.json'));
  await store.load();
  const first = createCharacter('user', 'One', 'warrior');
  const second = createCharacter('user', 'Two', 'mage');
  await store.add('user', first); await store.add('user', second);
  first.gold = 4321;
  await store.update('user', first);
  assert.equal(store.get('user').characterId, second.characterId);
  assert.equal(store.getProfile('user').characters[0].gold, 4321);
});

test('a rejected character write rolls back memory and does not poison later transactions', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'rpg-store-retry-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const file = path.join(directory, 'characters.json');
  const store = new CharacterStore(file, { fs: fsWithTransientWriteFailure() });
  await store.load();
  const hero = createCharacter('user', 'Retry', 'warrior');

  await assert.rejects(store.add('user', hero), /simulated write failure/);
  assert.equal(store.has('user'), false, 'failed transaction must not become live in memory');

  await store.add('user', hero);
  assert.equal(store.get('user').name, 'Retry');
  const saved = JSON.parse(await fs.readFile(file, 'utf8'));
  assert.equal(saved.user.characters[0].name, 'Retry');
});

test('character reads and update inputs are detached transaction snapshots', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'rpg-store-snapshot-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const file = path.join(directory, 'characters.json');
  const store = new CharacterStore(file);
  await store.load();
  await store.add('user', createCharacter('user', 'Snapshot', 'rogue'));

  const edited = store.get('user');
  const originalGold = edited.gold;
  edited.gold = 125;
  assert.equal(store.get('user').gold, originalGold, 'editing a read must not bypass persistence');

  const update = store.update('user', edited);
  edited.gold = 999;
  await update;

  assert.equal(store.get('user').gold, 125);
  const saved = JSON.parse(await fs.readFile(file, 'utf8'));
  assert.equal(saved.user.characters[0].gold, 125);
});

test('concurrent stale character snapshots merge unrelated fields and inventory additions', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'rpg-store-merge-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const file = path.join(directory, 'characters.json');
  const store = new CharacterStore(file);
  await store.load();
  await store.add('user', createCharacter('user', 'Concurrent', 'mage'));

  const economyEdit = store.get('user');
  const combatEdit = store.get('user');
  economyEdit.gold += 40;
  economyEdit.inventory.push({ id: 'economy-drop', name: 'Coin Blade' });
  combatEdit.xp += 25;
  combatEdit.inventory.push({ id: 'combat-drop', name: 'Battle Robe' });

  await Promise.all([
    store.update('user', economyEdit),
    store.update('user', combatEdit),
  ]);

  const merged = store.get('user');
  assert.equal(merged.gold, 90);
  assert.equal(merged.xp, 25);
  assert.deepEqual(merged.inventory.map((item) => item.id).sort(), ['combat-drop', 'economy-drop']);
  const saved = JSON.parse(await fs.readFile(file, 'utf8'));
  assert.equal(saved.user.characters[0].gold, 90);
  assert.equal(saved.user.characters[0].xp, 25);
});

test('overlapping stale character edits reject instead of silently losing a committed value', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'rpg-store-conflict-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const store = new CharacterStore(path.join(directory, 'characters.json'));
  await store.load();
  await store.add('user', createCharacter('user', 'Conflict', 'warrior'));

  const first = store.get('user');
  const stale = store.get('user');
  first.gold = 100;
  stale.gold = 200;
  await store.update('user', first);
  await assert.rejects(store.update('user', stale), (error) => {
    assert.equal(error.code, 'CHARACTER_CONFLICT');
    assert.deepEqual(error.paths, ['$.gold']);
    return true;
  });
  assert.equal(store.get('user').gold, 100);

  // A long-lived battle/session object can be saved again because a successful
  // commit advances its private base snapshot.
  first.gold = 125;
  await store.update('user', first);
  assert.equal(store.get('user').gold, 125);
});

test('saving a stale character after a slot switch does not reactivate it', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'rpg-store-active-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const store = new CharacterStore(path.join(directory, 'characters.json'));
  await store.load();
  const first = createCharacter('user', 'First', 'warrior');
  const second = createCharacter('user', 'Second', 'mage');
  await store.add('user', first);
  const delayedFirst = store.get('user');
  await store.add('user', second);

  delayedFirst.gold += 10;
  await store.set('user', delayedFirst);

  assert.equal(store.get('user').characterId, second.characterId);
  assert.equal(store.getProfile('user').characters.find((entry) => entry.characterId === first.characterId).gold, 60);
});
