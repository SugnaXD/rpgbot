const fs = require('node:fs/promises');
const path = require('node:path');

class CharacterStore {
  constructor(file = path.join(process.cwd(), 'data', 'characters.json')) {
    this.file = file;
    this.characters = new Map();
    this.queue = Promise.resolve();
  }

  async load() {
    await fs.mkdir(path.dirname(this.file), { recursive: true });
    try {
      const records = JSON.parse(await fs.readFile(this.file, 'utf8'));
      this.characters = new Map(Object.entries(records));
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }

  get(userId) { return this.characters.get(userId); }
  has(userId) { return this.characters.has(userId); }
  all() { return [...this.characters.values()]; }

  async set(userId, character) {
    this.characters.set(userId, character);
    return this.save();
  }

  async save() {
    this.queue = this.queue.then(async () => {
      const temporary = `${this.file}.tmp`;
      const data = Object.fromEntries(this.characters);
      await fs.writeFile(temporary, JSON.stringify(data, null, 2));
      await fs.rename(temporary, this.file);
    });
    return this.queue;
  }
}

module.exports = { CharacterStore };
