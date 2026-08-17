const { RARITY_POWER_FACTORS } = require('./systems/item-power');

const CLASSES = {
  warrior: { name: 'Warrior', emoji: '⚔️', maxHp: 100, attack: 14, defense: 7 },
  rogue: { name: 'Rogue', emoji: '🗡️', maxHp: 100, attack: 18, defense: 4 },
  mage: { name: 'Mage', emoji: '🔮', maxHp: 100, attack: 21, defense: 3 },
  admin: { name: 'Admin', emoji: '👑', maxHp: 100, attack: 150, defense: 100, adminOnly: true },
};

const SHOP = {
  potion: { name: 'Health Potion', emoji: '🧪', price: 35, description: 'Restores 45 HP during an adventure.' },
  iron_sword: { name: 'Iron Sword', emoji: '⚔️', price: 180, description: '+4 permanent attack.', unique: true, attack: 4 },
  iron_armor: { name: 'Iron Armor', emoji: '🛡️', price: 180, description: '+4 permanent defense.', unique: true, defense: 4 },
};

const RARITIES = {
  common: { name: 'Common', emoji: '⚪', color: 0x9ca3af, multiplier: RARITY_POWER_FACTORS.common, weight: 5500, rank: 0 },
  uncommon: { name: 'Uncommon', emoji: '🟢', color: 0x22c55e, multiplier: RARITY_POWER_FACTORS.uncommon, weight: 2600, rank: 1 },
  rare: { name: 'Rare', emoji: '🔵', color: 0x3b82f6, multiplier: RARITY_POWER_FACTORS.rare, weight: 1200, rank: 2 },
  epic: { name: 'Epic', emoji: '🟣', color: 0xa855f7, multiplier: RARITY_POWER_FACTORS.epic, weight: 500, rank: 3 },
  legendary: { name: 'Legendary', emoji: '🟠', color: 0xf59e0b, multiplier: RARITY_POWER_FACTORS.legendary, weight: 160, rank: 4 },
  mythic: { name: 'Mythic', emoji: '🔴', color: 0xef4444, multiplier: RARITY_POWER_FACTORS.mythic, weight: 39, rank: 5 },
  secret: { name: 'Secret', emoji: '🌈', color: 0xec4899, multiplier: RARITY_POWER_FACTORS.secret, weight: 1, rank: 6 },
};

const WORLDS = [
  { id: 1, name: 'Verdant Wilds', emoji: '🌲', enemies: ['Slime', 'Goblin', 'Wild Boar'], boss: 'Elder Treant' },
  { id: 2, name: 'Scorched Dunes', emoji: '🏜️', enemies: ['Scorpion', 'Sand Wraith', 'Dune Raider'], boss: 'Sunscale Wyrm' },
  { id: 3, name: 'Frozen Reach', emoji: '❄️', enemies: ['Ice Wolf', 'Frost Revenant', 'Yeti'], boss: 'Glacier Titan' },
  { id: 4, name: 'Shadow Realm', emoji: '🌑', enemies: ['Nightmare', 'Void Stalker', 'Dread Knight'], boss: 'The Hollow King' },
  { id: 5, name: 'Celestial Rift', emoji: '🌌', enemies: ['Starborn', 'Rift Seraph', 'Astral Dragon'], boss: 'Eternity' },
];

const WEAPON_NAMES = ['Blade', 'Axe', 'Staff', 'Dagger', 'Bow', 'Greatsword'];
const ARMOR_NAMES = ['Plate', 'Mail', 'Robes', 'Leathers', 'Cuirass', 'Ward'];

const STATS = {
  strength: { name: 'Strength', emoji: '💪', description: '+1 attack damage' },
  hp: { name: 'HP', emoji: '❤️', description: '+5 maximum HP' },
  defense: { name: 'Defense', emoji: '🛡️', description: 'Raises effective HP with diminishing returns, capped at 5×' },
  agility: { name: 'Agility', emoji: '💨', description: '+0.1% critical chance' },
  luck: { name: 'Luck', emoji: '🍀', description: 'Improves rare drops; every 200 total Luck adds +1% chance to promote a random equipment stat by one grade tier (max 5%)' },
  intelligence: { name: 'Intelligence', emoji: '🧠', description: '+1 magic attack for Mage paths and improves divine favour gains' },
  mana: { name: 'Mana', emoji: '💧', description: '+5 maximum mana for class abilities' },
};

const GRADES = {
  f: { name: 'F', rank: 0, emoji: '⚪', minPercent: 5, maxPercent: 7.4, weight: 4500 },
  c: { name: 'C', rank: 1, emoji: '🟢', minPercent: 7.5, maxPercent: 9.9, weight: 2700 },
  b: { name: 'B', rank: 2, emoji: '🔵', minPercent: 10, maxPercent: 12.4, weight: 1500 },
  a: { name: 'A', rank: 3, emoji: '🟣', minPercent: 12.5, maxPercent: 14.9, weight: 700 },
  s: { name: 'S', rank: 4, emoji: '🟠', minPercent: 15, maxPercent: 17.4, weight: 350 },
  ss: { name: 'SS', rank: 5, emoji: '🔴', minPercent: 17.5, maxPercent: 19.9, weight: 150 },
  sss: { name: 'SSS', rank: 6, emoji: '💗', minPercent: 20, maxPercent: 22.4, weight: 90 },
  z: { name: 'Z', rank: 7, emoji: '🌈', minPercent: 22.5, maxPercent: 25, weight: 10 },
};

const MASTER_CLASSES = {
  warrior: [
    { id: 'vanguard', name: 'Vanguard', bonus: { defense: 12, hp: 80 }, description: 'Protects allies and holds raid lines.' },
    { id: 'warlord', name: 'Warlord', bonus: { attack: 14 }, description: 'Leads assaults and territory attacks.' },
  ],
  rogue: [
    { id: 'shadow', name: 'Shadow', bonus: { attack: 12, agility: 18 }, description: 'Excels at scouting and sabotage.' },
    { id: 'ranger', name: 'Ranger', bonus: { attack: 8, luck: 20 }, description: 'Finds extra expedition resources.' },
  ],
  mage: [
    { id: 'arcanist', name: 'Arcanist', bonus: { attack: 16 }, description: 'Breaks boss wards and powers research.' },
    { id: 'oracle', name: 'Oracle', bonus: { hp: 50, luck: 16 }, description: 'Supports raids and discovers omens.' },
  ],
};

const ITEM_TRAITS = {
  keen: { name: 'Keen', description: '+8% combat and raid damage', combat: 0.08, raid: 0.08 },
  bulwark: { name: 'Bulwark', description: '+10% territory defense', territoryDefense: 0.1 },
  scavenger: { name: 'Scavenger', description: '+12% expedition resources', expeditionYield: 0.12 },
  pathfinder: { name: 'Pathfinder', description: '-10% expedition duration', expeditionSpeed: 0.1 },
  giant_slayer: { name: 'Giant Slayer', description: '+15% boss damage', raid: 0.15 },
  artisan: { name: 'Artisan', description: '+10% guild construction value', construction: 0.1 },
};

const GODS = {
  zeus: { name: 'Zeus', faction: 'olympian', stats: { strength: 0.1, intelligence: 0.1 }, luck: 0.08, description: 'Strength and Intelligence; favours world-boss victories.' },
  athena: { name: 'Athena', faction: 'olympian', stats: { defense: 0.1, intelligence: 0.1 }, luck: 0.06, description: 'Defense and Intelligence; favours strategy and territory defense.' },
  ares: { name: 'Ares', faction: 'olympian', stats: { strength: 0.12, defense: 0.06 }, luck: 0.04, description: 'Strength and Defense; favours combat and conquest.' },
  artemis: { name: 'Artemis', faction: 'wild', stats: { agility: 0.1, luck: 0.08 }, luck: 0.12, description: 'Agility and Luck; favours expeditions and rare finds.' },
  poseidon: { name: 'Poseidon', faction: 'elder', stats: { hp: 0.1, strength: 0.08 }, luck: 0.07, description: 'HP and Strength; favours endurance and raids.' },
  hades: { name: 'Hades', faction: 'chthonic', stats: { defense: 0.08, luck: 0.1 }, luck: 0.1, description: 'Defense and Luck; favours loot and dangerous expeditions.' },
  hermes: { name: 'Hermes', faction: 'olympian', stats: { agility: 0.12, intelligence: 0.06 }, luck: 0.1, description: 'Agility and Intelligence; favours fast expeditions.' },
  hephaestus: { name: 'Hephaestus', faction: 'olympian', stats: { defense: 0.1, strength: 0.08 }, luck: 0.05, description: 'Defense and Strength; favours equipment and construction.' },
  apollo: { name: 'Apollo', faction: 'olympian', stats: { intelligence: 0.12, agility: 0.06 }, luck: 0.08, description: 'Intelligence and Agility; favours mastery and raid support.' },
  demeter: { name: 'Demeter', faction: 'wild', stats: { hp: 0.12, luck: 0.06 }, luck: 0.09, description: 'HP and Luck; favours gathering and guild resources.' },
};

const TERRITORIES = {
  greenwatch: { name: 'Greenwatch', emoji: '🌲', resource: 'wood', yield: 30, neighbors: ['ironhollow', 'sunfield'] },
  ironhollow: { name: 'Ironhollow', emoji: '⛏️', resource: 'ore', yield: 25, neighbors: ['greenwatch', 'ashgate', 'starfall'] },
  sunfield: { name: 'Sunfield', emoji: '🌾', resource: 'food', yield: 35, neighbors: ['greenwatch', 'ashgate'] },
  ashgate: { name: 'Ashgate', emoji: '🔥', resource: 'crystal', yield: 18, neighbors: ['sunfield', 'ironhollow', 'starfall'] },
  starfall: { name: 'Starfall Keep', emoji: '🏰', resource: 'relic', yield: 10, neighbors: ['ironhollow', 'ashgate'] },
};

const HALL_STATIONS = {
  forge: { name: 'Forge', resource: 'ore', baseCost: 100, description: 'Improves item trait strength.' },
  workshop: { name: 'Workshop', resource: 'wood', baseCost: 100, description: 'Improves territory attacks and construction.' },
  infirmary: { name: 'Infirmary', resource: 'food', baseCost: 120, description: 'Reduces expedition injuries.' },
  command: { name: 'Command Room', resource: 'crystal', baseCost: 80, description: 'Improves scouting and territory defense.' },
  shrine: { name: 'Shrine', resource: 'relic', baseCost: 40, description: 'Improves faction favour and raid contribution.' },
};

const EXPEDITIONS = {
  forage: { name: 'Foraging Run', hours: 1, danger: 1, resource: 'food', baseYield: 25 },
  salvage: { name: 'Ruined Convoy', hours: 4, danger: 2, resource: 'ore', baseYield: 55 },
  survey: { name: 'Frontier Survey', hours: 8, danger: 3, resource: 'crystal', baseYield: 85 },
  relic_hunt: { name: 'Relic Hunt', hours: 12, danger: 5, resource: 'relic', baseYield: 35 },
};

const WORLD_BOSSES = [
  { id: 'worldbreaker', name: 'The Worldbreaker', maxHp: 250000, phases: ['Armoured', 'Enraged', 'Cataclysm'], reward: 800 },
  { id: 'voidmother', name: 'The Voidmother', maxHp: 400000, phases: ['Brood', 'Eclipse', 'Hunger'], reward: 1200 },
];

module.exports = { CLASSES, SHOP, RARITIES, WORLDS, WEAPON_NAMES, ARMOR_NAMES, STATS, GRADES, MASTER_CLASSES, ITEM_TRAITS, GODS, TERRITORIES, HALL_STATIONS, EXPEDITIONS, WORLD_BOSSES };
