const { MASTER_CLASSES, ITEM_TRAITS, GODS, TERRITORIES, HALL_STATIONS, EXPEDITIONS, WORLD_BOSSES, GRADES } = require('./content');
const { ITEM_POWER_VERSION, ITEM_SCHEMA_VERSION, ADMIN_POWER_MODEL } = require('./systems/item-power');

const MASTERY_REQUIRED = 75;
const MAX_GUILD_LEVEL = 500;
const uid = () => `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;

function normalizeSystems(character) {
  character.mastery ??= 0;
  character.specialization ??= null;
  character.god ??= null;
  if ({ aster: 'zeus', morr: 'hermes', gaia: 'demeter' }[character.god]) character.god = { aster: 'zeus', morr: 'hermes', gaia: 'demeter' }[character.god];
  character.favour ??= 0;
  character.resources ||= { wood: 0, ore: 0, food: 0, crystal: 0, relic: 0 };
  character.expedition ??= null;
  return character;
}

function divineDevotion(character) {
  normalizeSystems(character);
  return character.god && GODS[character.god] ? Math.min(1, Math.sqrt(character.favour / 10000)) : 0;
}

function divineBonuses(character) {
  const devotion = divineDevotion(character); const god = GODS[character.god];
  if (!god) return { stats: {}, luck: 1, devotion: 0 };
  return { stats: Object.fromEntries(Object.entries(god.stats).map(([stat, cap]) => [stat, cap * devotion])), luck: 1 + god.luck * devotion, devotion };
}

function favourGain(character, base) {
  normalizeSystems(character);
  const intelligence = character.stats?.intelligence || 1;
  return Math.max(0, Math.round(base * (1 + Math.min(0.25, intelligence * 0.001))));
}

function addMastery(character, amount, source = 'activity') {
  normalizeSystems(character);
  const before = character.mastery;
  character.mastery = Math.min(100, character.mastery + Math.max(0, amount));
  return { gained: character.mastery - before, unlocked: before < MASTERY_REQUIRED && character.mastery >= MASTERY_REQUIRED, source };
}

function specialize(character, specializationId) {
  normalizeSystems(character);
  if (character.mastery < MASTERY_REQUIRED) return { ok: false, message: `You need ${MASTERY_REQUIRED} mastery.` };
  if (character.specialization) return { ok: false, message: 'You already completed your mastery path.' };
  const choice = (MASTER_CLASSES[character.classId] || []).find((entry) => entry.id === specializationId);
  if (!choice) return { ok: false, message: 'That specialization is unavailable to your class.' };
  character.specialization = choice.id;
  character.attack += choice.bonus.attack || 0;
  character.defense += choice.bonus.defense || 0;
  character.maxHp += choice.bonus.hp || 0;
  character.hp += choice.bonus.hp || 0;
  if (choice.bonus.agility) character.stats.agility += choice.bonus.agility;
  if (choice.bonus.luck) character.stats.luck += choice.bonus.luck;
  return { ok: true, choice };
}

function traitMultiplier(character, field) {
  normalizeSystems(character);
  const multiplier = (character.inventory || [])
    .filter((item) => Object.values(character.equipped || {}).includes(item.id))
    .flatMap((item) => item.traits || [])
    .reduce((total, id) => total + (ITEM_TRAITS[id]?.[field] || 0), 1);
  return Math.min(1.35, Math.max(0, multiplier));
}

function addItemTraits(item, random = Math.random) {
  const raritySlots = { common: 0, uncommon: 0, rare: 1, epic: 1, legendary: 2, mythic: 2, secret: 3 }[item.rarity] || 0;
  const ids = Object.keys(ITEM_TRAITS);
  const existing = [...new Set((Array.isArray(item.traits) ? item.traits : []).filter((id) => ITEM_TRAITS[id]))];
  item.traitSlots = Number.isInteger(item.traitSlots)
    ? Math.max(0, Math.min(3, item.traitSlots))
    : Math.max(raritySlots, Math.min(3, existing.length));
  item.traits = existing.slice(0, item.traitSlots);
  while (item.traits.length < item.traitSlots && ids.length) {
    const available = ids.filter((id) => !item.traits.includes(id));
    if (!available.length) break;
    item.traits.push(available[Math.min(available.length - 1, Math.floor(random() * available.length))]);
  }
  return item;
}

function createAdminItem(config = {}) {
  const type = config.type === 'armor' ? 'armor' : 'weapon';
  const grade = ['f', 'c', 'b', 'a', 's', 'ss', 'sss', 'z'].includes(config.grade) ? config.grade : 'z';
  const magnitude = Math.max(1, Math.min(1_000_000, Number(config.magnitude) || 10000));
  const allowedStats = ['attack', 'defense', 'hp', 'strength', 'agility', 'luck', 'intelligence', 'mana'];
  const selected = [...new Set(config.stats || [])].filter((stat) => allowedStats.includes(stat));
  const stats = Object.fromEntries((selected.length ? selected : [type === 'weapon' ? 'attack' : 'defense']).map((stat) => [stat, stat === 'hp' ? magnitude * 5 : magnitude]));
  const traits = [...new Set(config.traits || [])].filter((trait) => ITEM_TRAITS[trait]);
  const percentage = GRADES[grade].maxPercent;
  return {
    id: `admin-${uid()}`, name: String(config.name || `Admin ${type === 'weapon' ? 'Weapon' : 'Armor'}`).slice(0, 60),
    type, rarity: 'secret', grade, power: Math.round(magnitude * 100 / percentage), worldId: 0, floor: 0, stage: 0, itemLevel: 0,
    powerModel: ADMIN_POWER_MODEL, powerVersion: ITEM_POWER_VERSION, source: 'admin', stats, baseStats: { ...stats }, traits, traitSlots: Math.min(3, traits.length), adminCreated: true,
    statGrades: Object.fromEntries(Object.keys(stats).map((stat) => [stat, grade])),
    statPercentages: Object.fromEntries(Object.keys(stats).map((stat) => [stat, percentage])),
    schemaVersion: ITEM_SCHEMA_VERSION, upgradeLevel: 0, locked: false,
  };
}

function pledge(character, godId) {
  normalizeSystems(character);
  if (!GODS[godId]) return { ok: false, message: 'Unknown god.' };
  if (character.god && character.god !== godId) return { ok: false, message: 'You must remain pledged for this season.' };
  character.god = godId;
  return { ok: true, god: GODS[godId] };
}

function startExpedition(character, expeditionId, stance = 'balanced', now = Date.now()) {
  normalizeSystems(character);
  if (character.expedition) return { ok: false, message: 'You already have an active expedition.' };
  const mission = EXPEDITIONS[expeditionId];
  if (!mission) return { ok: false, message: 'Unknown expedition.' };
  const speed = traitMultiplier(character, 'expeditionSpeed');
  const stanceTime = stance === 'cautious' ? 1.2 : stance === 'aggressive' ? 0.85 : 1;
  character.expedition = { id: uid(), type: expeditionId, stance, startedAt: now, endsAt: now + mission.hours * 3600000 * stanceTime / speed };
  return { ok: true, mission, expedition: character.expedition };
}

function claimExpedition(character, now = Date.now(), random = Math.random) {
  normalizeSystems(character);
  const run = character.expedition;
  if (!run) return { ok: false, message: 'You have no active expedition.' };
  if (now < run.endsAt) return { ok: false, message: 'Your expedition is still underway.', remaining: run.endsAt - now };
  const mission = EXPEDITIONS[run.type];
  const stanceYield = run.stance === 'aggressive' ? 1.25 : run.stance === 'cautious' ? 0.9 : run.stance === 'scavenging' ? 1.35 : 1;
  const godBonus = ['artemis', 'hermes', 'hades'].includes(character.god) ? 1 + 0.05 * divineDevotion(character) : 1;
  const amount = Math.round(mission.baseYield * stanceYield * traitMultiplier(character, 'expeditionYield') * godBonus * (0.85 + random() * 0.3));
  character.resources[mission.resource] += amount;
  const mastery = addMastery(character, mission.danger * 2, 'expedition');
  const favour = character.god ? favourGain(character, mission.danger) : 0;
  character.favour += favour;
  character.expedition = null;
  return { ok: true, mission, resource: mission.resource, amount, mastery, favour };
}

function createWorldState() {
  const boss = WORLD_BOSSES[0];
  return {
    guilds: {}, memberships: {}, territories: Object.fromEntries(Object.keys(TERRITORIES).map((id) => [id, { owner: null, defense: 100, contestedAt: null }])),
    factionScores: Object.fromEntries(Object.values(GODS).map((god) => [god.faction, 0])),
    raid: { bossId: boss.id, hp: boss.maxHp, maxHp: boss.maxHp, contributions: {}, defeatedAt: null },
  };
}

function normalizeWorld(world) {
  const base = createWorldState();
  world.guilds ||= {}; world.memberships ||= {}; world.territories ||= base.territories; world.factionScores ||= base.factionScores; world.raid ||= base.raid;
  for (const faction of Object.keys(base.factionScores)) world.factionScores[faction] ??= 0;
  for (const guild of Object.values(world.guilds)) { guild.level ||= 1; guild.xp ||= 0; }
  return world;
}

function createGuild(world, userId, name) {
  normalizeWorld(world);
  if (world.memberships[userId]) return { ok: false, message: 'You are already in a guild.' };
  if (Object.values(world.guilds).some((guild) => guild.name.toLowerCase() === name.toLowerCase())) return { ok: false, message: 'That guild name is taken.' };
  const guild = { id: uid(), name, leaderId: userId, members: [userId], level: 1, xp: 0, resources: { wood: 100, ore: 100, food: 100, crystal: 30, relic: 5 }, stations: Object.fromEntries(Object.keys(HALL_STATIONS).map((id) => [id, 0])), territories: [], influence: 0, chat: [] };
  world.guilds[guild.id] = guild; world.memberships[userId] = guild.id;
  return { ok: true, guild };
}

function guildXpForLevel(level) {
  return Math.round(250 + level * 30 + Math.pow(level, 1.65) * 4);
}

function guildRewardBonuses(guild) {
  if (!guild) return { xp: 0, gold: 0 };
  guild.level ||= 1; guild.xp ||= 0;
  // Diminishing curve: meaningful late progression without making early guilds mandatory.
  const progress = Math.pow((guild.level - 1) / (MAX_GUILD_LEVEL - 1), 0.65);
  return { xp: 0.25 * progress, gold: 0.15 * progress };
}

function grantGuildXp(world, userId, amount) {
  normalizeWorld(world);
  const guild = world.guilds[world.memberships[userId]];
  if (!guild) return { gained: 0, levels: [], guild: null };
  guild.level ||= 1; guild.xp ||= 0;
  const gained = Math.max(0, Math.floor(amount)); guild.xp += gained;
  const levels = [];
  while (guild.level < MAX_GUILD_LEVEL && guild.xp >= guildXpForLevel(guild.level)) {
    guild.xp -= guildXpForLevel(guild.level); guild.level += 1; levels.push(guild.level);
  }
  if (guild.level >= MAX_GUILD_LEVEL) guild.xp = 0;
  return { gained, levels, guild };
}

function joinGuild(world, userId, guildId) {
  normalizeWorld(world);
  if (world.memberships[userId]) return { ok: false, message: 'You are already in a guild.' };
  const guild = world.guilds[guildId];
  if (!guild) return { ok: false, message: 'Guild not found.' };
  guild.members.push(userId); world.memberships[userId] = guildId;
  return { ok: true, guild };
}

function donate(world, character, resource, amount) {
  normalizeWorld(world); normalizeSystems(character);
  const guild = world.guilds[world.memberships[character.userId]];
  if (!guild) return { ok: false, message: 'Join a guild first.' };
  if (!character.resources[resource] || character.resources[resource] < amount) return { ok: false, message: `You do not have ${amount} ${resource}.` };
  character.resources[resource] -= amount; guild.resources[resource] += amount; guild.influence += Math.ceil(amount / 10);
  addMastery(character, Math.max(1, Math.floor(amount / 25)), 'guild contribution');
  grantGuildXp(world, character.userId, Math.ceil(amount / 2));
  if (['demeter', 'hephaestus'].includes(character.god)) { const gain = favourGain(character, Math.ceil(amount / 20)); character.favour += gain; world.factionScores[GODS[character.god].faction] += gain; }
  return { ok: true, guild };
}

function upgradeStation(world, userId, stationId) {
  normalizeWorld(world);
  const guild = world.guilds[world.memberships[userId]]; const station = HALL_STATIONS[stationId];
  if (!guild) return { ok: false, message: 'Join a guild first.' };
  if (!station) return { ok: false, message: 'Unknown station.' };
  const level = guild.stations[stationId]; const cost = station.baseCost * (level + 1);
  if ((guild.resources[station.resource] || 0) < cost) return { ok: false, message: `The guild needs ${cost} ${station.resource}.` };
  guild.resources[station.resource] -= cost; guild.stations[stationId] += 1; guild.influence += 25 * (level + 1);
  grantGuildXp(world, userId, cost);
  return { ok: true, guild, station, cost };
}

function gatherTerritories(world) {
  normalizeWorld(world); const gains = {};
  for (const [id, state] of Object.entries(world.territories)) if (state.owner && world.guilds[state.owner]) {
    const territory = TERRITORIES[id]; const guild = world.guilds[state.owner];
    guild.resources[territory.resource] += territory.yield; gains[state.owner] ||= {}; gains[state.owner][territory.resource] = (gains[state.owner][territory.resource] || 0) + territory.yield;
  }
  return gains;
}

function attackTerritory(world, userId, territoryId, power) {
  normalizeWorld(world); const guild = world.guilds[world.memberships[userId]]; const territory = world.territories[territoryId];
  if (!guild) return { ok: false, message: 'Join a guild first.' };
  if (!territory) return { ok: false, message: 'Unknown territory.' };
  if (territory.owner === guild.id) return { ok: false, message: 'Your guild already controls that territory.' };
  const adjacent = !guild.territories.length || guild.territories.some((owned) => TERRITORIES[owned].neighbors.includes(territoryId));
  if (!adjacent) return { ok: false, message: 'Your guild must control an adjacent territory.' };
  const attack = power * (1 + guild.stations.workshop * 0.08); const defenseGuild = world.guilds[territory.owner];
  const defense = territory.defense * (1 + (defenseGuild?.stations.command || 0) * 0.1);
  if (attack < defense) { territory.defense = Math.max(20, territory.defense - Math.round(attack / 3)); grantGuildXp(world, userId, 75); return { ok: true, captured: false, attack, defense }; }
  if (defenseGuild) defenseGuild.territories = defenseGuild.territories.filter((id) => id !== territoryId);
  territory.owner = guild.id; territory.defense = 100; guild.territories.push(territoryId); guild.influence += 100;
  grantGuildXp(world, userId, 750);
  return { ok: true, captured: true, attack, defense, guild };
}

function raidAttack(world, character, basePower) {
  normalizeWorld(world); normalizeSystems(character);
  if (world.raid.defeatedAt) return { ok: false, message: 'The current world boss is already defeated.' };
  const guild = world.guilds[world.memberships[character.userId]];
  const shrine = guild?.stations.shrine || 0;
  const godBonus = ['zeus', 'poseidon', 'apollo'].includes(character.god) ? 1 + 0.08 * divineDevotion(character) : 1;
  const damage = Math.max(1, Math.round(basePower * traitMultiplier(character, 'raid') * (1 + shrine * 0.05) * godBonus));
  world.raid.hp = Math.max(0, world.raid.hp - damage); world.raid.contributions[character.userId] = (world.raid.contributions[character.userId] || 0) + damage;
  if (guild) guild.influence += Math.max(1, Math.floor(damage / 100));
  if (guild) grantGuildXp(world, character.userId, Math.min(1000, Math.max(5, Math.floor(damage / 10))));
  addMastery(character, 2, 'raid');
  let favour = 0;
  if (character.god) { favour = favourGain(character, 2); character.favour += favour; world.factionScores[GODS[character.god].faction] += favour; }
  if (!world.raid.hp) world.raid.defeatedAt = new Date().toISOString();
  return { ok: true, damage, favour, defeated: !world.raid.hp, raid: world.raid };
}

module.exports = { MASTERY_REQUIRED, MAX_GUILD_LEVEL, normalizeSystems, divineDevotion, divineBonuses, favourGain, addMastery, specialize, traitMultiplier, addItemTraits, createAdminItem, pledge, startExpedition, claimExpedition, createWorldState, normalizeWorld, createGuild, joinGuild, guildXpForLevel, guildRewardBonuses, grantGuildXp, donate, upgradeStation, gatherTerritories, attackTerritory, raidAttack };
