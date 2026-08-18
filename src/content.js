const CLASSES = {
  warrior: { name: 'Warrior', emoji: '⚔️', maxHp: 125, attack: 14, defense: 7 },
  rogue: { name: 'Rogue', emoji: '🗡️', maxHp: 95, attack: 18, defense: 4 },
  mage: { name: 'Mage', emoji: '🔮', maxHp: 85, attack: 21, defense: 3 },
};

const ENEMIES = [
  { name: 'Slime', emoji: '🟢', minLevel: 1, hp: 35, attack: 7, xp: 25, gold: 15 },
  { name: 'Goblin', emoji: '👺', minLevel: 1, hp: 48, attack: 10, xp: 36, gold: 22 },
  { name: 'Skeleton', emoji: '💀', minLevel: 2, hp: 62, attack: 13, xp: 48, gold: 30 },
  { name: 'Dire Wolf', emoji: '🐺', minLevel: 3, hp: 78, attack: 16, xp: 62, gold: 40 },
  { name: 'Ogre', emoji: '👹', minLevel: 5, hp: 110, attack: 21, xp: 90, gold: 62 },
  { name: 'Dragon Whelp', emoji: '🐉', minLevel: 7, hp: 145, attack: 27, xp: 130, gold: 95 },
];

const SHOP = {
  potion: { name: 'Health Potion', emoji: '🧪', price: 35, description: 'Restores 45 HP during an adventure.' },
  iron_sword: { name: 'Iron Sword', emoji: '⚔️', price: 180, description: '+4 permanent attack.', unique: true, attack: 4 },
  iron_armor: { name: 'Iron Armor', emoji: '🛡️', price: 180, description: '+4 permanent defense.', unique: true, defense: 4 },
};

const RARITIES = {
  common: { name: 'Common', emoji: '⚪', color: 0x9ca3af, multiplier: 1, weight: 5500 },
  uncommon: { name: 'Uncommon', emoji: '🟢', color: 0x22c55e, multiplier: 1.35, weight: 2600 },
  rare: { name: 'Rare', emoji: '🔵', color: 0x3b82f6, multiplier: 1.8, weight: 1200 },
  epic: { name: 'Epic', emoji: '🟣', color: 0xa855f7, multiplier: 2.5, weight: 500 },
  legendary: { name: 'Legendary', emoji: '🟠', color: 0xf59e0b, multiplier: 3.5, weight: 160 },
  mythic: { name: 'Mythic', emoji: '🔴', color: 0xef4444, multiplier: 5, weight: 39 },
  secret: { name: 'Secret', emoji: '🌈', color: 0xec4899, multiplier: 8, weight: 1 },
};

const WORLDS = [
  { id: 1, name: 'Verdant Wilds', emoji: '🌲', enemies: ['Slime', 'Goblin', 'Wild Boar'], boss: 'Elder Treant', power: 1 },
  { id: 2, name: 'Scorched Dunes', emoji: '🏜️', enemies: ['Scorpion', 'Sand Wraith', 'Dune Raider'], boss: 'Sunscale Wyrm', power: 2.1 },
  { id: 3, name: 'Frozen Reach', emoji: '❄️', enemies: ['Ice Wolf', 'Frost Revenant', 'Yeti'], boss: 'Glacier Titan', power: 3.6 },
  { id: 4, name: 'Shadow Realm', emoji: '🌑', enemies: ['Nightmare', 'Void Stalker', 'Dread Knight'], boss: 'The Hollow King', power: 5.5 },
  { id: 5, name: 'Celestial Rift', emoji: '🌌', enemies: ['Starborn', 'Rift Seraph', 'Astral Dragon'], boss: 'Eternity', power: 8 },
];

const WEAPON_NAMES = ['Blade', 'Axe', 'Staff', 'Dagger', 'Bow', 'Greatsword'];
const ARMOR_NAMES = ['Plate', 'Mail', 'Robes', 'Leathers', 'Cuirass', 'Ward'];

module.exports = { CLASSES, ENEMIES, SHOP, RARITIES, WORLDS, WEAPON_NAMES, ARMOR_NAMES };
