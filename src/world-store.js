const fs = require('node:fs/promises');
const path = require('node:path');
const { isDeepStrictEqual } = require('node:util');
const { createWorldState, normalizeWorld } = require('./systems');

let temporaryFileSequence = 0;

function clone(value) {
  return structuredClone(value);
}

const MISSING = Symbol('missing');
const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const copied = (value) => value === MISSING ? MISSING : clone(value);
const stableKey = (value) => `${typeof value}:${JSON.stringify(value)}`;

function arrayIdentity(values) {
  for (const field of ['id', 'characterId']) {
    if (values.length && values.every((value) => isObject(value) && value[field] !== undefined)) return field;
  }
  return null;
}

function mergeArrays(base, current, incoming, pathname, preferIncoming, conflicts) {
  const identity = arrayIdentity([...base, ...current, ...incoming]);
  if (identity) {
    const baseMap = new Map(base.map((value) => [String(value[identity]), value]));
    const currentMap = new Map(current.map((value) => [String(value[identity]), value]));
    const incomingMap = new Map(incoming.map((value) => [String(value[identity]), value]));
    const order = [...new Set([...currentMap.keys(), ...incomingMap.keys()])];
    return order.flatMap((key) => {
      const merged = mergeWorld(
        baseMap.has(key) ? baseMap.get(key) : MISSING,
        currentMap.has(key) ? currentMap.get(key) : MISSING,
        incomingMap.has(key) ? incomingMap.get(key) : MISSING,
        `${pathname}[${identity}=${key}]`,
        preferIncoming,
        conflicts,
      );
      return merged === MISSING ? [] : [merged];
    });
  }

  // World arrays are set-like collections or append-only logs. Applying their
  // membership delta preserves independent joins, territory captures, and chat
  // messages even when two saves began from the same world revision.
  const values = new Map([...base, ...current, ...incoming].map((value) => [stableKey(value), value]));
  const baseKeys = new Set(base.map(stableKey));
  const currentKeys = new Set(current.map(stableKey));
  const incomingKeys = new Set(incoming.map(stableKey));
  const mergedKeys = new Set(currentKeys);
  for (const entry of values.keys()) {
    if (incomingKeys.has(entry) === baseKeys.has(entry)) continue;
    if (incomingKeys.has(entry)) mergedKeys.add(entry);
    else mergedKeys.delete(entry);
  }
  return [...mergedKeys].map((entry) => clone(values.get(entry)));
}

/** Apply the delta from base -> incoming onto current. */
function mergeWorld(base, current, incoming, pathname = '$', preferIncoming = true, conflicts = null) {
  if (isDeepStrictEqual(incoming, base)) return copied(current);
  if (isDeepStrictEqual(current, base)) return copied(incoming);

  if (isDeepStrictEqual(current, incoming)) return copied(current);

  if (Array.isArray(current) && Array.isArray(incoming) && (Array.isArray(base) || base === MISSING)) {
    return mergeArrays(base === MISSING ? [] : base, current, incoming, pathname, preferIncoming, conflicts);
  }

  if (isObject(current) && isObject(incoming) && (isObject(base) || base === MISSING)) {
    const baseObject = base === MISSING ? {} : base;
    const merged = {};
    const keys = new Set([...Object.keys(baseObject), ...Object.keys(current), ...Object.keys(incoming)]);
    for (const key of keys) {
      const value = mergeWorld(
        hasOwn(baseObject, key) ? baseObject[key] : MISSING,
        hasOwn(current, key) ? current[key] : MISSING,
        hasOwn(incoming, key) ? incoming[key] : MISSING,
        `${pathname}.${key}`,
        preferIncoming,
        conflicts,
      );
      if (value !== MISSING) merged[key] = value;
    }
    return merged;
  }

  if (conflicts) {
    conflicts.push(pathname);
    return copied(current);
  }
  return copied(preferIncoming ? incoming : current);
}

class WorldConflictError extends Error {
  constructor(paths) {
    super(`World changed concurrently at: ${paths.join(', ')}`);
    this.name = 'WorldConflictError';
    this.code = 'WORLD_CONFLICT';
    this.paths = paths;
  }
}

function reconcile(target, source) {
  for (const key of Object.keys(target)) if (!hasOwn(source, key)) delete target[key];
  for (const [key, value] of Object.entries(source)) {
    if (isObject(target[key]) && isObject(value)) reconcile(target[key], value);
    else if (Array.isArray(target[key]) && Array.isArray(value)) target[key].splice(0, target[key].length, ...clone(value));
    else target[key] = clone(value);
  }
  return target;
}

class WorldStore {
  constructor(file = path.join(process.cwd(), 'data', 'world.json'), options = {}) {
    this.file = file;
    this.fs = options.fs || fs;
    this.state = createWorldState();
    this.operationState = clone(this.state);
    this.directBase = clone(this.state);
    this.persistedData = JSON.stringify(this.state, null, 2);
    this.revision = 0;
    this.operations = Promise.resolve();
    // Keep the former public queue names as recovered aliases.
    this.queue = this.operations;
    this.transactions = this.operations;
  }

  async load() {
    await this.fs.mkdir(path.dirname(this.file), { recursive: true });
    try {
      this.state = normalizeWorld(JSON.parse(await this.fs.readFile(this.file, 'utf8')));
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    this.operationState = clone(this.state);
    this.directBase = clone(this.state);
    this.persistedData = JSON.stringify(this.state, null, 2);
  }

  /**
   * Run against the latest serialized world revision. Direct `.state` edits
   * made while this transaction awaits are rebased over its commit instead of
   * being overwritten.
   */
  transaction(mutator) {
    this.revision += 1;
    return this._enqueueOperation(async () => {
      const base = clone(this.operationState);
      const draft = clone(base);
      const result = await mutator(draft);
      normalizeWorld(draft);
      const data = JSON.stringify(draft, null, 2);
      await this._writeAtomically(data);
      const committed = normalizeWorld(JSON.parse(data));
      this.operationState = clone(committed);
      this.persistedData = data;

      // Overlay edits made through the legacy mutable state object while the
      // transaction was running, then update that object in place so existing
      // `const world = worldStore.state` references remain valid.
      reconcile(this.state, normalizeWorld(mergeWorld(base, committed, this.state)));
      this.directBase = normalizeWorld(mergeWorld(base, committed, this.directBase));
      return result;
    });
  }

  save() {
    // `directBase` identifies only the edits made since the previous save call.
    // Applying that delta later avoids replacing transaction changes that were
    // not yet visible when this snapshot was captured.
    const base = clone(this.directBase);
    const candidate = normalizeWorld(clone(this.state));
    this.directBase = clone(candidate);
    this.revision += 1;

    return this._enqueueOperation(async () => {
      try {
        const conflicts = [];
        const committed = normalizeWorld(mergeWorld(base, this.operationState, candidate, '$', true, conflicts));
        if (conflicts.length) throw new WorldConflictError([...new Set(conflicts)]);
        const data = JSON.stringify(committed, null, 2);
        await this._writeAtomically(data);

        this.operationState = clone(committed);
        this.persistedData = data;
        reconcile(this.state, normalizeWorld(mergeWorld(candidate, committed, this.state)));
        this.directBase = normalizeWorld(mergeWorld(candidate, committed, this.directBase));
      } catch (error) {
        // Undo only this failed save's delta. Edits made or queued afterwards
        // remain present and can still be persisted by their own operation.
        reconcile(this.state, normalizeWorld(mergeWorld(candidate, this.operationState, this.state)));
        this.directBase = normalizeWorld(mergeWorld(candidate, this.operationState, this.directBase));
        throw error;
      }
    });
  }

  _enqueueOperation(operation) {
    const pending = this.operations.then(operation);
    this.operations = pending.catch(() => undefined);
    this.queue = this.operations;
    this.transactions = this.operations;
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

module.exports = { WorldStore, WorldConflictError };
