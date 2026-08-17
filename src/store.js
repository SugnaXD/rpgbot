const fs = require('node:fs/promises');
const path = require('node:path');
const { isDeepStrictEqual } = require('node:util');

let temporaryFileSequence = 0;

function clone(value) {
  return structuredClone(value);
}

function cloneCharacters(characters) {
  return new Map([...characters].map(([userId, profile]) => [userId, clone(profile)]));
}

const MISSING = Symbol('missing');
const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const copied = (value) => value === MISSING ? MISSING : clone(value);

function arrayIdentity(values) {
  for (const field of ['id', 'characterId']) {
    if (values.length && values.every((value) => isObject(value) && value[field] !== undefined)) return field;
  }
  return null;
}

function mergeArrays(base, current, incoming, path, conflicts) {
  const identity = arrayIdentity([...base, ...current, ...incoming]);
  if (identity) {
    const baseMap = new Map(base.map((value) => [String(value[identity]), value]));
    const currentMap = new Map(current.map((value) => [String(value[identity]), value]));
    const incomingMap = new Map(incoming.map((value) => [String(value[identity]), value]));
    const order = [...new Set([...currentMap.keys(), ...incomingMap.keys()])];
    return order.flatMap((key) => {
      const merged = mergeSnapshots(
        baseMap.has(key) ? baseMap.get(key) : MISSING,
        currentMap.has(key) ? currentMap.get(key) : MISSING,
        incomingMap.has(key) ? incomingMap.get(key) : MISSING,
        `${path}[${identity}=${key}]`,
        conflicts,
      );
      return merged === MISSING ? [] : [merged];
    });
  }

  // Primitive arrays in character data are set-like (owned item ids, claimed
  // achievements, traits). Apply membership changes instead of replacing the
  // entire stale array so independent additions/removals survive.
  if ([...base, ...current, ...incoming].every((value) => value === null || ['string', 'number', 'boolean'].includes(typeof value))) {
    const key = (value) => `${typeof value}:${JSON.stringify(value)}`;
    const values = new Map([...base, ...current, ...incoming].map((value) => [key(value), value]));
    const baseKeys = new Set(base.map(key));
    const currentKeys = new Set(current.map(key));
    const incomingKeys = new Set(incoming.map(key));
    const mergedKeys = new Set(currentKeys);
    for (const entry of values.keys()) {
      if (incomingKeys.has(entry) === baseKeys.has(entry)) continue;
      if (incomingKeys.has(entry)) mergedKeys.add(entry);
      else mergedKeys.delete(entry);
    }
    return [...mergedKeys].map((entry) => clone(values.get(entry)));
  }

  conflicts.push(path);
  return clone(current);
}

function mergeSnapshots(base, current, incoming, path, conflicts) {
  if (isDeepStrictEqual(incoming, base)) return copied(current);
  if (isDeepStrictEqual(current, base) || isDeepStrictEqual(current, incoming)) return copied(incoming);

  if (Array.isArray(current) && Array.isArray(incoming) && (Array.isArray(base) || base === MISSING)) {
    return mergeArrays(base === MISSING ? [] : base, current, incoming, path, conflicts);
  }

  if (isObject(current) && isObject(incoming) && (isObject(base) || base === MISSING)) {
    const baseObject = base === MISSING ? {} : base;
    const merged = {};
    const keys = new Set([...Object.keys(baseObject), ...Object.keys(current), ...Object.keys(incoming)]);
    for (const key of keys) {
      const value = mergeSnapshots(
        hasOwn(baseObject, key) ? baseObject[key] : MISSING,
        hasOwn(current, key) ? current[key] : MISSING,
        hasOwn(incoming, key) ? incoming[key] : MISSING,
        `${path}.${key}`,
        conflicts,
      );
      if (value !== MISSING) merged[key] = value;
    }
    return merged;
  }

  conflicts.push(path);
  return copied(current);
}

class CharacterConflictError extends Error {
  constructor(paths) {
    super(`Character changed concurrently at: ${paths.join(', ')}`);
    this.name = 'CharacterConflictError';
    this.code = 'CHARACTER_CONFLICT';
    this.paths = paths;
  }
}

class CharacterStore {
  constructor(file = path.join(process.cwd(), 'data', 'characters.json'), options = {}) {
    this.file = file;
    this.fs = options.fs || fs;
    this.characters = new Map();
    // `queue` is always a recovered tail. Individual save promises still reject,
    // but one failed disk write cannot prevent later writes from running.
    this.queue = Promise.resolve();
    this.transactions = Promise.resolve();
    this.snapshots = new WeakMap();
  }

  async load() {
    await this.fs.mkdir(path.dirname(this.file), { recursive: true });
    try {
      const records = JSON.parse(await this.fs.readFile(this.file, 'utf8'));
      this.characters = new Map(Object.entries(records).map(([userId, saved]) => {
        if (saved.characters && Array.isArray(saved.characters)) return [userId, saved];
        saved.characterId ||= `legacy-${userId}`;
        return [userId, { activeId: saved.characterId, characters: [saved] }];
      }));
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }

  // Reads are detached snapshots. A command may freely mutate one, but the
  // mutation only becomes visible after set/update has durably committed it.
  getProfile(userId) {
    const profile = this.characters.get(userId);
    if (!profile) return undefined;
    const snapshot = clone(profile);
    snapshot.characters.forEach((character, index) => this.snapshots.set(character, clone(profile.characters[index])));
    return snapshot;
  }

  get(userId) {
    const profile = this.characters.get(userId);
    const character = profile?.characters.find((entry) => entry.characterId === profile.activeId) || profile?.characters[0];
    return character ? this._snapshot(character) : undefined;
  }

  has(userId) {
    const profile = this.characters.get(userId);
    return Boolean(profile?.characters.find((entry) => entry.characterId === profile.activeId) || profile?.characters[0]);
  }

  all() {
    return [...this.characters.values()].flatMap((profile) => profile.characters.map((character) => this._snapshot(character)));
  }

  async migrateCharacters(migrator) {
    if (typeof migrator !== 'function') throw new TypeError('A character migration function is required.');
    const applyMigration = (characters) => {
      let total = 0;
      let migrated = 0;
      for (const profile of characters.values()) {
        for (const character of profile.characters || []) {
          total += 1;
          const before = clone(character);
          migrator(character);
          if (!isDeepStrictEqual(character, before)) migrated += 1;
        }
      }
      return { total, migrated };
    };
    const preview = applyMigration(cloneCharacters(this.characters));
    if (!preview.migrated) return preview;
    return this.transaction(applyMigration);
  }

  async add(userId, character) {
    const nextCharacter = clone(character);
    await this.transaction((characters) => {
      const profile = characters.get(userId) || { activeId: null, characters: [] };
      if (profile.characters.length >= 3) throw new Error('CHARACTER_LIMIT');
      profile.characters.push(nextCharacter);
      profile.activeId = nextCharacter.characterId;
      characters.set(userId, profile);
    });
    this.snapshots.set(character, clone(nextCharacter));
  }

  async switch(userId, slot) {
    const selected = await this.transaction((characters) => {
      const profile = characters.get(userId);
      const character = profile?.characters[slot];
      if (!character) return null;
      profile.activeId = character.characterId;
      return clone(character);
    });
    return selected ? this._snapshot(selected) : null;
  }

  async set(userId, character) {
    const base = this.snapshots.get(character);
    const nextCharacter = clone(character);
    await this.transaction((characters) => {
      const profile = characters.get(userId) || { activeId: nextCharacter.characterId, characters: [] };
      const index = profile.characters.findIndex((saved) => saved.characterId === nextCharacter.characterId);
      if (index >= 0) profile.characters[index] = this._mergeCharacter(base, profile.characters[index], nextCharacter);
      else {
        profile.characters.push(nextCharacter);
        profile.activeId = nextCharacter.characterId;
      }
      // A delayed command saving character A must not silently switch the user
      // back from character B. Only repair an active id that is actually empty.
      if (!profile.characters.some((saved) => saved.characterId === profile.activeId)) profile.activeId = nextCharacter.characterId;
      characters.set(userId, profile);
    });
    this.snapshots.set(character, clone(nextCharacter));
  }

  async update(userId, character) {
    const base = this.snapshots.get(character);
    const nextCharacter = clone(character);
    await this.transaction((characters) => {
      const profile = characters.get(userId);
      if (!profile) throw new Error('PROFILE_NOT_FOUND');
      const index = profile.characters.findIndex((saved) => saved.characterId === nextCharacter.characterId);
      if (index < 0) throw new Error('CHARACTER_NOT_FOUND');
      profile.characters[index] = this._mergeCharacter(base, profile.characters[index], nextCharacter);
    });
    this.snapshots.set(character, clone(nextCharacter));
  }

  _snapshot(character) {
    const snapshot = clone(character);
    this.snapshots.set(snapshot, clone(character));
    return snapshot;
  }

  _mergeCharacter(base, current, incoming) {
    // Objects not obtained from this store retain the historical replacement
    // behavior used by imports, admin tools, and newly created characters.
    if (!base || base.characterId !== incoming.characterId) return clone(incoming);
    const conflicts = [];
    const merged = mergeSnapshots(base, current, incoming, '$', conflicts);
    if (conflicts.length) throw new CharacterConflictError([...new Set(conflicts)]);
    return merged;
  }

  /**
   * Apply a mutation to an isolated draft and publish it only after the exact
   * draft has been atomically written. Failed mutations leave memory unchanged.
   * The callback receives a Map keyed by Discord user id.
   */
  transaction(mutator) {
    const pending = this.transactions.then(async () => {
      const draft = cloneCharacters(this.characters);
      const result = await mutator(draft);
      const data = JSON.stringify(Object.fromEntries(draft), null, 2);
      await this._enqueueWrite(data);
      // Commit the JSON representation, keeping memory identical to what can
      // actually be recovered after a restart (for example, `undefined` is not
      // retained in memory when JSON omitted it on disk).
      this.characters = new Map(Object.entries(JSON.parse(data)));
      return result;
    });
    this.transactions = pending.catch(() => undefined);
    return pending;
  }

  save() {
    // Serialize before entering the queue. Otherwise a later in-memory change
    // could silently become part of an earlier save operation.
    const data = JSON.stringify(Object.fromEntries(this.characters), null, 2);
    return this._enqueueWrite(data);
  }

  _enqueueWrite(data) {
    const pending = this.queue.then(() => this._writeAtomically(data));
    this.queue = pending.catch(() => undefined);
    return pending;
  }

  async _writeAtomically(data) {
    await this.fs.mkdir(path.dirname(this.file), { recursive: true });
    const sequence = temporaryFileSequence++;
    const temporary = `${this.file}.${process.pid}.${sequence}.tmp`;
    try {
      await this.fs.writeFile(temporary, data);
      await this.fs.rename(temporary, this.file);
    } catch (error) {
      await this.fs.unlink(temporary).catch(() => {});
      throw error;
    }
  }
}

module.exports = { CharacterStore, CharacterConflictError };
