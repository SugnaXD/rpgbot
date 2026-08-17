require('dotenv').config();
const {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, Client, EmbedBuilder, Events,
  GatewayIntentBits, MessageFlags, StringSelectMenuBuilder,
} = require('discord.js');
const { CLASSES, SHOP, RARITIES, WORLDS, STATS, MASTER_CLASSES, ITEM_TRAITS, GODS, TERRITORIES, HALL_STATIONS, EXPEDITIONS, WORLD_BOSSES } = require('./content');
const { CharacterStore } = require('./store');
const { WorldStore } = require('./world-store');
const { isBotOwner, isBotAdmin } = require('./core/auth');
const { progressBar: bar, duration } = require('./core/format');
const { handleInventory } = require('./features/inventory');
const { runAdventure: runAdventureFeature } = require('./features/adventure');
const { handleProgressionCommand } = require('./features/progression-commands');
const { handleAdminCommand } = require('./features/admin-commands');
const { handleContractsCommand } = require('./features/contracts-commands');
const { handleRaidCommand } = require('./features/raid-commands');
const { progressContract } = require('./features/contracts-system');
const { MASTERY_REQUIRED, addMastery, specialize, pledge, startExpedition, claimExpedition, createGuild, joinGuild, guildXpForLevel, guildRewardBonuses, grantGuildXp, donate, upgradeStation, gatherTerritories, attackTerritory, raidAttack } = require('./systems');
const {
  MAX_LEVEL, STAT_KEYS, xpForLevel, createCharacter, normalizeCharacter,
  equipItem, gearBonus, derivedStats, lootLuck, gradePromotionChance, allocateStats, buyItem, claimDaily, healAtInn,
} = require('./game');

if (!process.env.DISCORD_TOKEN) {
  console.error('DISCORD_TOKEN is missing. Copy .env.example to .env and add your token.');
  process.exit(1);
}

const client = new Client({ intents: [GatewayIntentBits.Guilds] });
const store = new CharacterStore();
const worldStore = new WorldStore();
const activeBattles = new Set();
const colour = 0x7c3aed;
const getCharacter = async (interaction, userId = interaction.user.id) => {
  const character = store.get(userId);
  if (character) normalizeCharacter(character);
  if (!character) await interaction.reply({ content: userId === interaction.user.id ? 'Create a character first with `/start`.' : 'That player has no character.', flags: MessageFlags.Ephemeral });
  return character;
};

const selectRow = (customId, placeholder, options, disabled = false) => new ActionRowBuilder().addComponents(
  new StringSelectMenuBuilder()
    .setCustomId(customId)
    .setPlaceholder(placeholder)
    .setDisabled(disabled)
    .addOptions(options.slice(0, 25)),
);

const buttonRow = (...buttons) => new ActionRowBuilder().addComponents(...buttons);
const panelButton = (customId, label, style = ButtonStyle.Primary, disabled = false, emoji = null) => {
  const button = new ButtonBuilder().setCustomId(customId).setLabel(label).setStyle(style).setDisabled(disabled);
  if (emoji) button.setEmoji(emoji);
  return button;
};

async function openInteractivePanel(interaction, payload, onCollect, timeout = 120000) {
  const response = await interaction.reply({ ...payload, flags: MessageFlags.Ephemeral, withResponse: true });
  const message = response.resource?.message || response;
  const editableMessage = { id: message.id, edit: (options) => interaction.editReply(options) };
  let busy = false;
  const collector = message.createMessageComponentCollector({
    filter: (component) => component.user.id === interaction.user.id,
    time: timeout,
  });
  collector.on('collect', async (component) => {
    try {
      await component.deferUpdate();
      if (busy) {
        await component.followUp({ content: 'That panel is already processing another action.', flags: MessageFlags.Ephemeral });
        return;
      }
      busy = true;
      await onCollect(component, editableMessage, collector);
    } catch (error) {
      console.error('Interactive RPG panel failed:', error);
      await component.followUp({ content: 'That panel action could not be completed. Please try again.', flags: MessageFlags.Ephemeral }).catch(() => {});
    } finally {
      busy = false;
    }
  });
  collector.on('end', () => interaction.editReply({ components: [] }).catch(() => {}));
  return response;
}

const panelNotice = (embed, notice) => {
  if (notice) embed.addFields({ name: 'Latest action', value: notice });
  return embed;
};

function charactersPanel(profile, notice = null) {
  for (const character of profile.characters) normalizeCharacter(character);
  const list = profile.characters.map((character, index) => {
    const active = character.characterId === profile.activeId ? ' **• ACTIVE**' : '';
    return `**Slot ${index + 1}:** ${CLASSES[character.classId].emoji} ${character.name} — Level ${character.level} ${CLASSES[character.classId].name}${active}\n${WORLDS[character.world - 1].emoji} ${WORLDS[character.world - 1].name}, Floor ${character.floor}`;
  }).join('\n\n');
  const embed = panelNotice(new EmbedBuilder().setColor(colour).setTitle('🎭 Your Characters').setDescription(list)
    .setFooter({ text: 'Choose a character below to make it active. This panel expires in 2 minutes.' }), notice);
  const options = profile.characters.map((character, index) => ({
    label: `Slot ${index + 1} • ${character.name}`.slice(0, 100),
    description: `Level ${character.level} ${CLASSES[character.classId].name} • World ${character.world}, Floor ${character.floor}`.slice(0, 100),
    value: character.characterId,
    emoji: CLASSES[character.classId].emoji,
    default: character.characterId === profile.activeId,
  }));
  return { embeds: [embed], components: [selectRow('rpg_characters_switch', 'Choose your active character', options)] };
}

function shopPanel(character, selectedItemId = null, notice = null) {
  const selected = selectedItemId ? SHOP[selectedItemId] : null;
  const embed = panelNotice(new EmbedBuilder().setColor(0xeab308).setTitle('🏪 Adventurer’s Shop')
    .setDescription(Object.entries(SHOP).map(([key, item]) => `${item.emoji} **${item.name}** — ${item.price} gold\n${item.description}\nID: \`${key}\``).join('\n\n'))
    .addFields(
      { name: 'Your wallet', value: `🪙 **${character.gold.toLocaleString()} gold**`, inline: true },
      { name: 'Selected item', value: selected ? `${selected.emoji} **${selected.name}** — ${selected.price} gold` : '*Choose an item below.*', inline: true },
    ), notice);
  const options = Object.entries(SHOP).map(([value, item]) => ({
    label: `${item.name} • ${item.price} gold`.slice(0, 100), value, emoji: item.emoji,
    description: item.description.slice(0, 100), default: value === selectedItemId,
  }));
  return {
    embeds: [embed],
    components: [
      selectRow('rpg_shop_item', 'Choose an item to preview', options),
      buttonRow(panelButton('rpg_shop_buy', 'Buy selected item', ButtonStyle.Success, !selected, '🪙')),
    ],
  };
}

function worldsPanel(character, selectedWorldId = character.world, notice = null) {
  const unlockedWorlds = WORLDS.filter((world) => world.id <= character.unlockedWorld);
  const selectedWorld = unlockedWorlds.find((world) => world.id === selectedWorldId) || unlockedWorlds[0];
  const reachableFloor = Math.max(1, Math.min(10, character.worldProgress[selectedWorld.id] || 1));
  const list = WORLDS.map((world) => `${world.id <= character.unlockedWorld ? '🟢' : '🔒'} **${world.id}. ${world.emoji} ${world.name}** — Floors 1–10${world.id === character.world ? ` • Current floor: ${character.floor}` : ''}`).join('\n');
  const embed = panelNotice(new EmbedBuilder().setColor(colour).setTitle('🌍 Worlds & Floors')
    .setDescription(`${list}\n\nSelect an unlocked world, then choose a reached floor to travel there.`)
    .setFooter({ text: character.idleCombat ? 'Claim idle combat before travelling.' : 'Defeat each world’s floor 10 boss to unlock the next world.' }), notice);
  const worldOptions = unlockedWorlds.map((world) => ({
    label: `${world.id}. ${world.name}`.slice(0, 100), value: String(world.id), emoji: world.emoji,
    description: `Reached floor ${Math.max(1, Math.min(10, character.worldProgress[world.id] || 1))}`,
    default: world.id === selectedWorld.id,
  }));
  const floorOptions = Array.from({ length: reachableFloor }, (_, index) => index + 1).map((floor) => ({
    label: `Floor ${floor}`, value: `${selectedWorld.id}:${floor}`,
    description: floor === 10 ? 'World boss floor' : `Travel to ${selectedWorld.name}`,
    default: selectedWorld.id === character.world && floor === character.floor,
  }));
  return {
    embeds: [embed],
    components: [
      selectRow('rpg_world_select', 'Choose an unlocked world', worldOptions),
      selectRow('rpg_floor_select', `Travel within ${selectedWorld.name}`, floorOptions, character.idleCombat),
    ],
  };
}

function masteryPanel(character, pendingPath = null, notice = null) {
  const paths = MASTER_CLASSES[character.classId] || [];
  const selected = paths.find((path) => path.id === pendingPath);
  const current = paths.find((path) => path.id === character.specialization);
  const description = current
    ? `Advanced class: **${current.name}**\n${current.description}`
    : `${bar(character.mastery, 100, 20)}\nAdvanced classes unlock at **${MASTERY_REQUIRED}** mastery.\n\n${paths.map((path) => `**${path.name}:** ${path.description}`).join('\n') || '*This class has no mastery paths.*'}`;
  const embed = panelNotice(new EmbedBuilder().setColor(colour).setTitle(`🌟 ${character.name} — ${character.mastery}/100 Mastery`)
    .setDescription(description), notice);
  if (selected && !character.specialization) embed.addFields({ name: 'Pending mastery path', value: `**${selected.name}**\n${selected.description}` });
  if (!paths.length) return { embeds: [embed], components: [] };
  const unavailable = character.mastery < MASTERY_REQUIRED || Boolean(character.specialization);
  return {
    embeds: [embed],
    components: [
      selectRow('rpg_mastery_path', unavailable ? 'Mastery path unavailable' : 'Preview a mastery path', paths.map((path) => ({
        label: path.name, value: path.id, description: path.description.slice(0, 100),
        default: path.id === (character.specialization || pendingPath),
      })), unavailable),
      buttonRow(panelButton('rpg_mastery_confirm', 'Confirm mastery path', ButtonStyle.Success, unavailable || !selected, '🌟')),
    ],
  };
}

function pantheonPanel(character, pendingGodId = null, notice = null) {
  const divine = derivedStats(character);
  const selected = pendingGodId ? GODS[pendingGodId] : null;
  const embed = panelNotice(new EmbedBuilder().setColor(colour).setTitle('⛩️ Greek Pantheon & Divine Luck')
    .setDescription(Object.entries(GODS).map(([key, god]) => `**${key} — ${god.name}** [${god.faction}]\n${Object.entries(god.stats).map(([stat, cap]) => `+${cap * 100}% ${STATS[stat].name}`).join(' • ')} • up to +${god.luck * 100}% Divine Luck\n${god.description}`).join('\n\n'))
    .setFooter({ text: character.god ? `Pledged to ${GODS[character.god].name} • ${character.favour} favour • ${(divine.divineDevotion * 100).toFixed(1)}% devotion` : 'Bonuses scale with favour and reach their cap at 10,000 favour.' }), notice);
  if (selected && !character.god) embed.addFields({ name: 'Pending pledge', value: `**${selected.name}** • ${selected.faction}\n${selected.description}` });
  const locked = Boolean(character.god);
  return {
    embeds: [embed],
    components: [
      selectRow('rpg_pantheon_god', locked ? `Pledged to ${GODS[character.god].name}` : 'Preview a god', Object.entries(GODS).map(([value, god]) => ({
        label: `${god.name} • ${god.faction}`.slice(0, 100), value, description: god.description.slice(0, 100),
        default: value === (character.god || pendingGodId),
      })), locked),
      buttonRow(panelButton('rpg_pantheon_confirm', 'Confirm seasonal pledge', ButtonStyle.Success, locked || !selected, '⛩️')),
    ],
  };
}

function guildRegistryPanel(userId, page = 0, selectedGuildId = null, notice = null) {
  const world = worldStore.state;
  const guilds = Object.values(world.guilds).sort((a, b) => b.level - a.level || b.members.length - a.members.length || a.name.localeCompare(b.name));
  const pageSize = 20;
  const pageCount = Math.max(1, Math.ceil(guilds.length / pageSize));
  const safePage = Math.max(0, Math.min(pageCount - 1, page));
  const visible = guilds.slice(safePage * pageSize, (safePage + 1) * pageSize);
  const selected = world.guilds[selectedGuildId] || null;
  const membership = world.memberships[userId];
  const embed = panelNotice(new EmbedBuilder().setColor(colour).setTitle('🏰 Guild Registry')
    .setDescription(visible.length ? visible.map((guild) => `**${guild.name}** — Level ${guild.level} • ${guild.members.length} members • ${guild.territories.length} territories\nID \`${guild.id}\``).join('\n\n') : 'No guilds exist yet.')
    .setFooter({ text: `Page ${safePage + 1}/${pageCount} • Choose a guild, then confirm joining.` }), notice);
  if (selected) embed.addFields({ name: 'Selected guild', value: `**${selected.name}** • Level ${selected.level} • ${selected.members.length} members` });
  if (!visible.length) return { page: safePage, payload: { embeds: [embed], components: [] } };
  const options = visible.map((guild) => ({
    label: guild.name.slice(0, 100), value: guild.id,
    description: `Level ${guild.level} • ${guild.members.length} members • ${guild.territories.length} territories`.slice(0, 100),
    default: guild.id === selectedGuildId,
  }));
  return {
    page: safePage,
    payload: {
      embeds: [embed],
      components: [
        selectRow('rpg_guild_select', 'Choose a guild to inspect', options),
        buttonRow(
          panelButton('rpg_guild_prev', 'Previous', ButtonStyle.Secondary, safePage === 0, '⬅️'),
          panelButton('rpg_guild_join', membership ? 'Already in a guild' : 'Join selected guild', ButtonStyle.Success, Boolean(membership) || !selected, '🤝'),
          panelButton('rpg_guild_next', 'Next', ButtonStyle.Secondary, safePage >= pageCount - 1, '➡️'),
        ),
      ],
    },
  };
}

function guildHallPanel(userId, selectedStationId = null, notice = null) {
  const world = worldStore.state;
  const guild = world.guilds[world.memberships[userId]];
  if (!guild) return { embeds: [new EmbedBuilder().setColor(colour).setTitle('🏰 Guild Hall').setDescription('You are no longer in a guild.')], components: [] };
  const selectedStation = selectedStationId ? HALL_STATIONS[selectedStationId] : null;
  const selectedLevel = selectedStation ? guild.stations[selectedStationId] : 0;
  const selectedCost = selectedStation ? selectedStation.baseCost * (selectedLevel + 1) : 0;
  const cooldown = 20 * 60 * 60 * 1000;
  const remaining = guild.lastGatherAt ? Math.max(0, cooldown - (Date.now() - guild.lastGatherAt)) : 0;
  const embed = panelNotice(new EmbedBuilder().setColor(colour).setTitle(`🏰 ${guild.name} — Guild Hall`).addFields(
    { name: 'Resources', value: Object.entries(guild.resources).map(([key, value]) => `${key}: **${value}**`).join(' • ') },
    { name: 'Stations', value: Object.entries(guild.stations).map(([key, value]) => `${HALL_STATIONS[key].name}: **${value}**`).join('\n'), inline: true },
    { name: 'Power', value: `Level: **${guild.level}/500**\nGuild XP: **${guild.xp}/${guild.level < 500 ? guildXpForLevel(guild.level) : 0}**\nInfluence: **${guild.influence}**\nTerritories: **${guild.territories.length}**\nMembers: **${guild.members.length}**`, inline: true },
    { name: 'Member Rewards', value: `XP: **+${(guildRewardBonuses(guild).xp * 100).toFixed(1)}%**\nGold: **+${(guildRewardBonuses(guild).gold * 100).toFixed(1)}%**`, inline: true },
    { name: 'Guild Chat', value: guild.chat.slice(-5).map((entry) => `<@${entry.userId}>: ${entry.message}`).join('\n') || '*No messages yet.*' },
    { name: 'Territory collection', value: remaining ? `Ready in **${duration(remaining)}**.` : '**Ready now.**', inline: true },
  ), notice);
  if (selectedStation) embed.addFields({ name: 'Selected upgrade', value: `**${selectedStation.name}** level ${selectedLevel} → ${selectedLevel + 1}\nCost: **${selectedCost} ${selectedStation.resource}**` });
  const stationOptions = Object.entries(HALL_STATIONS).map(([value, station]) => {
    const level = guild.stations[value];
    const cost = station.baseCost * (level + 1);
    return { label: `${station.name} • Level ${level}`.slice(0, 100), value, description: `Next level costs ${cost} ${station.resource}`.slice(0, 100), default: value === selectedStationId };
  });
  return {
    embeds: [embed],
    components: [
      selectRow('rpg_guild_station', 'Choose a hall station to upgrade', stationOptions),
      buttonRow(
        panelButton('rpg_guild_upgrade', 'Upgrade selected station', ButtonStyle.Primary, !selectedStation, '🔨'),
        panelButton('rpg_guild_collect', remaining ? 'Collection cooling down' : 'Collect territory resources', ButtonStyle.Success, false, '📦'),
      ),
    ],
  };
}

function guildMapPanel(character, selectedTerritoryId = null, notice = null) {
  const world = worldStore.state;
  const guild = world.guilds[world.memberships[character.userId]] || null;
  const selected = selectedTerritoryId ? TERRITORIES[selectedTerritoryId] : null;
  const description = Object.entries(TERRITORIES).map(([key, territory]) => {
    const state = world.territories[key];
    return `${territory.emoji} **${key} — ${territory.name}** • ${territory.resource} +${territory.yield}\nOwner: ${state.owner ? world.guilds[state.owner]?.name || 'Unknown' : '*Unclaimed*'} • Defense ${state.defense}`;
  }).join('\n\n');
  const embed = panelNotice(new EmbedBuilder().setColor(colour).setTitle('🗺️ Guild War Map').setDescription(description)
    .setFooter({ text: guild ? 'Only adjacent enemy or unclaimed territories appear in the attack menu.' : 'Join a guild to attack territory.' }), notice);
  if (selected) embed.addFields({ name: 'Selected assault', value: `${selected.emoji} **${selected.name}** • ${world.territories[selectedTerritoryId].defense} defense` });
  if (!guild) return { embeds: [embed], components: [] };
  const options = Object.entries(TERRITORIES).filter(([key]) => {
    if (world.territories[key].owner === guild.id) return false;
    return !guild.territories.length || guild.territories.some((owned) => TERRITORIES[owned]?.neighbors.includes(key));
  }).map(([value, territory]) => ({
    label: territory.name, value, emoji: territory.emoji,
    description: `${world.territories[value].owner ? 'Enemy-held' : 'Unclaimed'} • Defense ${world.territories[value].defense}`,
    default: value === selectedTerritoryId,
  }));
  if (!options.length) return { embeds: [embed], components: [] };
  return {
    embeds: [embed],
    components: [
      selectRow('rpg_territory_select', 'Choose an adjacent territory', options),
      buttonRow(panelButton('rpg_territory_attack', 'Launch selected assault', ButtonStyle.Danger, !selected, '⚔️')),
    ],
  };
}

function statsPanel(character, selectedStat = null, notice = null) {
  const derived = derivedStats(character);
  const currentLootLuck = lootLuck(character);
  const values = STAT_KEYS.map((key) => `${STATS[key].emoji} **${STATS[key].name}: ${character.stats[key]}**\n${STATS[key].description}`).join('\n\n');
  const embed = panelNotice(new EmbedBuilder().setColor(colour).setTitle(`📊 ${character.name}’s Stats — Level ${character.level}/${MAX_LEVEL}`).setDescription(values).addFields(
    { name: 'Unspent Points', value: `**${character.statPoints}**`, inline: true },
    { name: 'Combat Totals', value: `❤️ ${derived.maxHp.toLocaleString()} HP\n💧 ${(character.mana ?? 0).toLocaleString()}/${(character.maxMana ?? 0).toLocaleString()} Mana\n⚔️ ${derived.attack.toLocaleString()} ATK\n🛡️ ${Math.round(derived.defense).toLocaleString()} DEF\n💚 ${derived.effectiveHp.toLocaleString()} Effective HP (${derived.effectiveHpMultiplier.toFixed(2)}×)\n💥 ${(derived.criticalChance * 100).toFixed(1)}% CRIT\n🍀 ${currentLootLuck.toLocaleString()} Loot Luck\n✨ ${(gradePromotionChance(currentLootLuck) * 100).toFixed(2)}% Per-stat Grade Promotion`, inline: true },
  ).setFooter({ text: `Each level awards ${STAT_KEYS.length} points. Select a stat and use a safe fixed allocation.` }), notice);
  if (selectedStat && STATS[selectedStat]) embed.addFields({ name: 'Selected stat', value: `${STATS[selectedStat].emoji} **${STATS[selectedStat].name}**` });
  const statOptions = STAT_KEYS.map((value) => ({
    label: STATS[value].name, value, emoji: STATS[value].emoji,
    description: STATS[value].description.slice(0, 100), default: value === selectedStat,
  }));
  return {
    embeds: [embed],
    components: [
      selectRow('rpg_stat_select', 'Choose a stat to improve', statOptions),
      buttonRow(...[1, 5, 10].map((amount) => panelButton(`rpg_stat_add_${amount}`, `Add ${amount}`, ButtonStyle.Success, !selectedStat || character.statPoints < amount, '➕'))),
    ],
  };
}

function worldBossPanel(character, notice = null) {
  const raid = worldStore.state.raid;
  const boss = WORLD_BOSSES.find((entry) => entry.id === raid.bossId);
  const phases = boss?.phases || ['Unknown phase'];
  const phase = phases[Math.min(phases.length - 1, Math.max(0, Math.floor((1 - raid.hp / Math.max(1, raid.maxHp)) * phases.length)))];
  const cooldown = 60 * 60 * 1000;
  const remaining = character.lastRaidAction ? Math.max(0, cooldown - (Date.now() - character.lastRaidAction)) : 0;
  const embed = panelNotice(new EmbedBuilder().setColor(0xef4444).setTitle(`🐉 ${boss?.name || raid.bossId} — ${phase}`)
    .setDescription(`${bar(raid.hp, raid.maxHp, 20)} **${raid.hp.toLocaleString()}/${raid.maxHp.toLocaleString()} HP**\n${remaining ? `Your raid action returns in **${duration(remaining)}**.` : '✅ **Your raid action is ready.**'}`).addFields(
      { name: 'Server Contributions', value: Object.entries(raid.contributions).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([user, damage], index) => `${index + 1}. <@${user}> — ${damage.toLocaleString()}`).join('\n') || 'No attacks yet.' },
      { name: 'Faction Scores', value: Object.entries(worldStore.state.factionScores).map(([name, score]) => `${name}: **${score}**`).join(' • ') },
    ), notice);
  return {
    embeds: [embed],
    components: [buttonRow(
      panelButton('rpg_worldboss_attack', 'Attack', ButtonStyle.Danger, raid.hp <= 0, '⚔️'),
      panelButton('rpg_worldboss_refresh', 'Refresh', ButtonStyle.Secondary, false, '🔄'),
    )],
  };
}

const HELP_CATEGORIES = {
  overview: { name: 'Overview', text: 'Create a hero, battle monsters, earn loot, and advance through persistent worlds. Use the menu below for focused command guides.' },
  characters: { name: 'Characters & Stats', text: '`/start` creates up to three heroes. `/characters` and `/switch` manage them. `/profile` shows progress, while `/stats view` and `/stats allocate` improve attributes.' },
  adventure: { name: 'Adventure & Travel', text: '`/adventure` starts interactive combat. `/worlds` shows progression and offers quick travel; `/travel` remains the direct route.' },
  equipment: { name: 'Loot & Crafting', text: '`/inventory` and `/equip` manage drops. `/items` locks or salvages gear. `/craft` creates, upgrades, rerolls, refines, and changes traits.' },
  town: { name: 'Town', text: '`/shop` buys supplies interactively. `/buy`, `/heal`, `/daily`, and `/leaderboard` provide direct town actions.' },
  persistent: { name: 'Persistent World', text: '`/mastery`, `/expedition`, `/pantheon`, `/guild`, `/guildmap`, `/worldboss`, `/raid`, and `/contracts` connect your hero to server-wide progression.' },
  challenges: { name: 'Idle & Challenges', text: '`/idle` runs offline combat. `/ability` selects combat skills. `/dungeon` and `/tower` provide repeatable challenges.' },
  goals: { name: 'Long-term Goals', text: '`/quests` and `/achievements` award progression. `/ascend` resets level progress at level 1000 for permanent power.' },
  admin: { name: 'Administration', text: '`/admin` requires the configured owner ID or admin role and includes confirmed character mutations plus the interactive equipment forge.' },
};

function helpPanel(categoryId = 'overview') {
  const category = HELP_CATEGORIES[categoryId] || HELP_CATEGORIES.overview;
  const embed = new EmbedBuilder().setColor(colour).setTitle(`📜 ${category.name}`).setDescription(category.text)
    .setFooter({ text: 'Choose another topic below. Direct slash commands continue to work.' });
  const options = Object.entries(HELP_CATEGORIES).map(([value, entry]) => ({ label: entry.name, value, default: value === categoryId }));
  return { embeds: [embed], components: [selectRow('rpg_help_category', 'Choose a help topic', options)] };
}

client.once(Events.ClientReady, (ready) => console.log(`Ready as ${ready.user.tag}.`));
client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  try {
    const id = interaction.user.id;
    if (interaction.commandName === 'start') {
      const profile = store.getProfile(id);
      if ((profile?.characters.length || 0) >= 3) return interaction.reply({ content: 'All three character slots are full. Use `/characters` to view them.', flags: MessageFlags.Ephemeral });
      const slot = (profile?.characters.length || 0) + 1;
      const classId = interaction.options.getString('class');
      if (CLASSES[classId].adminOnly && !isBotOwner(interaction)) {
        return interaction.reply({ content: 'The Admin class is reserved for the bot owner.', flags: MessageFlags.Ephemeral });
      }
      const character = createCharacter(id, interaction.options.getString('name'), classId);
      await store.add(id, character);
      const role = CLASSES[character.classId];
      return interaction.reply({ embeds: [new EmbedBuilder().setColor(colour).setTitle(`${role.emoji} ${character.name} begins their journey!`).setDescription(`You are a **${role.name}** in slot ${slot}, and are now active. Use \`/adventure\` to find your first battle.`)] });
    }
    if (interaction.commandName === 'profile') {
      const user = interaction.options.getUser('player') || interaction.user;
      const c = await getCharacter(interaction, user.id); if (!c) return;
      const totals = derivedStats(c);
      return interaction.reply({ embeds: [new EmbedBuilder().setColor(colour).setTitle(`${CLASSES[c.classId].emoji} ${c.name} — Level ${c.level} ${CLASSES[c.classId].name}`).setThumbnail(user.displayAvatarURL()).addFields(
        { name: 'Health', value: `${bar(c.hp, totals.maxHp)} ${c.hp}/${totals.maxHp}`, inline: false },
        { name: 'Progress', value: `${bar(c.xp, xpForLevel(c.level))} ${c.xp}/${xpForLevel(c.level)} XP`, inline: false },
        { name: 'Stats', value: `⚔️ ${totals.attack.toLocaleString()} ATK\n🛡️ ${Math.round(totals.defense).toLocaleString()} DEF\n💚 ${totals.effectiveHp.toLocaleString()} effective HP`, inline: true },
        { name: 'Inventory', value: `🪙 ${c.gold} gold\n🧪 ${c.potions} potions`, inline: true },
        { name: 'Record', value: `🏆 ${c.wins} wins\n💀 ${c.losses} losses`, inline: true },
        { name: 'Progress', value: `${WORLDS[c.world - 1].emoji} ${WORLDS[c.world - 1].name} • Floor ${c.floor}`, inline: false },
        { name: 'Idle Progression', value: `💧 ${c.mana ?? 0}/${c.maxMana ?? 0} mana\n♻️ ${c.materials?.dust || 0} dust\n🌟 ${c.ascensions || 0} ascensions\n🗼 Tower ${c.towerFloor || 0}`, inline: true },
      )] });
    }
    if (interaction.commandName === 'characters') {
      const profile = store.getProfile(id);
      if (!profile?.characters.length) return interaction.reply({ content: 'You have no characters. Create one with `/start`.', flags: MessageFlags.Ephemeral });
      return openInteractivePanel(interaction, charactersPanel(profile), async (component, message) => {
        if (component.customId !== 'rpg_characters_switch') return;
        if (activeBattles.has(id)) {
          await component.followUp({ content: 'Finish your active battle before switching characters.', flags: MessageFlags.Ephemeral });
          return;
        }
        const liveProfile = store.getProfile(id);
        const index = liveProfile?.characters.findIndex((entry) => entry.characterId === component.values[0]) ?? -1;
        if (index < 0) {
          await component.followUp({ content: 'That character no longer exists. Reopen `/characters`.', flags: MessageFlags.Ephemeral });
          return;
        }
        const selected = await store.switch(id, index);
        await message.edit(charactersPanel(store.getProfile(id), `${CLASSES[selected.classId].emoji} **${selected.name}** is now active.`));
      });
    }
    if (interaction.commandName === 'switch') {
      if (activeBattles.has(id)) return interaction.reply({ content: 'Finish your active battle before switching characters.', flags: MessageFlags.Ephemeral });
      const slot = interaction.options.getInteger('slot');
      const selected = await store.switch(id, slot - 1);
      if (!selected) return interaction.reply({ content: `Character slot ${slot} is empty. Create one with \`/start\`.`, flags: MessageFlags.Ephemeral });
      return interaction.reply(`${CLASSES[selected.classId].emoji} **${selected.name}** is now your active character.`);
    }
    if (interaction.commandName === 'admin') {
      if (!isBotAdmin(interaction)) return interaction.reply({ content: 'You are not authorized to use admin commands.', flags: MessageFlags.Ephemeral });
      return handleAdminCommand(interaction, store, worldStore);
    }
    if (interaction.commandName === 'rpghelp') return openInteractivePanel(interaction, helpPanel(), async (component, message) => {
      if (component.customId !== 'rpg_help_category') return;
      const categoryId = HELP_CATEGORIES[component.values[0]] ? component.values[0] : 'overview';
      await message.edit(helpPanel(categoryId));
    });
    const character = await getCharacter(interaction); if (!character) return;
    if (await handleContractsCommand(interaction, character, store, worldStore)) return;
    if (await handleRaidCommand(interaction, character, store, worldStore)) return;
    if (await handleProgressionCommand(interaction, character, store, activeBattles)) return;
    if (interaction.commandName === 'mastery') {
      const choice = interaction.options.getString('specialization');
      const paths = MASTER_CLASSES[character.classId] || [];
      if (!choice) {
        const expectedCharacterId = character.characterId;
        let pendingPath = null;
        return openInteractivePanel(interaction, masteryPanel(character), async (component, message) => {
          const live = store.get(id);
          if (!live || live.characterId !== expectedCharacterId) {
            await component.followUp({ content: 'Your active character changed. Reopen `/mastery` for the new character.', flags: MessageFlags.Ephemeral });
            return;
          }
          normalizeCharacter(live);
          if (component.customId === 'rpg_mastery_path') {
            const available = (MASTER_CLASSES[live.classId] || []).some((path) => path.id === component.values[0]);
            if (!available || live.specialization || live.mastery < MASTERY_REQUIRED) {
              await component.followUp({ content: 'That mastery path is not currently available.', flags: MessageFlags.Ephemeral });
              return;
            }
            pendingPath = component.values[0];
            await message.edit(masteryPanel(live, pendingPath));
            return;
          }
          if (component.customId !== 'rpg_mastery_confirm' || !pendingPath) return;
          const result = specialize(live, pendingPath);
          if (!result.ok) {
            await component.followUp({ content: result.message, flags: MessageFlags.Ephemeral });
            return;
          }
          pendingPath = null;
          await store.update(id, live);
          await message.edit(masteryPanel(live, null, `🌟 Mastered the path of the **${result.choice.name}**.`));
        });
      }
      const result = specialize(character, choice);
      if (!result.ok) return interaction.reply({ content: result.message, flags: MessageFlags.Ephemeral });
      await store.set(id, character);
      return interaction.reply(`🌟 **${character.name}** mastered the path of the **${result.choice.name}**!`);
    }
    if (interaction.commandName === 'pantheon') {
      const godId = interaction.options.getString('god');
      if (!godId) {
        const expectedCharacterId = character.characterId;
        let pendingGodId = null;
        return openInteractivePanel(interaction, pantheonPanel(character), async (component, message) => {
          const live = store.get(id);
          if (!live || live.characterId !== expectedCharacterId) {
            await component.followUp({ content: 'Your active character changed. Reopen `/pantheon` for the new character.', flags: MessageFlags.Ephemeral });
            return;
          }
          normalizeCharacter(live);
          if (component.customId === 'rpg_pantheon_god') {
            if (live.god || !GODS[component.values[0]]) {
              await component.followUp({ content: live.god ? 'Your seasonal pledge is already locked.' : 'That god is unavailable.', flags: MessageFlags.Ephemeral });
              return;
            }
            pendingGodId = component.values[0];
            await message.edit(pantheonPanel(live, pendingGodId));
            return;
          }
          if (component.customId !== 'rpg_pantheon_confirm' || !pendingGodId) return;
          const result = pledge(live, pendingGodId);
          if (!result.ok) {
            await component.followUp({ content: result.message, flags: MessageFlags.Ephemeral });
            return;
          }
          pendingGodId = null;
          await Promise.all([store.update(id, live), worldStore.save()]);
          await message.edit(pantheonPanel(live, null, `⛩️ Pledged to **${result.god.name}** and joined the **${result.god.faction} faction**.`));
        });
      }
      const result = pledge(character, godId);
      if (!result.ok) return interaction.reply({ content: result.message, flags: MessageFlags.Ephemeral });
      await store.set(id, character); await worldStore.save();
      return interaction.reply(`⛩️ You pledged to **${result.god.name}** and joined the **${result.god.faction} faction**.`);
    }
    if (interaction.commandName === 'expedition') {
      const action = interaction.options.getSubcommand();
      if (action === 'start') {
        const result = startExpedition(character, interaction.options.getString('mission'), interaction.options.getString('stance') || 'balanced');
        if (!result.ok) return interaction.reply({ content: result.message, flags: MessageFlags.Ephemeral });
        await store.set(id, character);
        return interaction.reply(`🧭 **${character.name}** departed on **${result.mission.name}**. Return in **${duration(result.expedition.endsAt - Date.now())}**.`);
      }
      if (action === 'status') {
        if (!character.expedition) return interaction.reply({ content: 'You have no active expedition.', flags: MessageFlags.Ephemeral });
        const mission = EXPEDITIONS[character.expedition.type]; const remaining = character.expedition.endsAt - Date.now();
        return interaction.reply(`🧭 **${mission.name}** • ${character.expedition.stance}\n${remaining > 0 ? `Returns in **${duration(remaining)}**.` : '✅ Ready to claim with `/expedition claim`.'}`);
      }
      const result = claimExpedition(character);
      if (!result.ok) return interaction.reply({ content: result.remaining ? `${result.message} **${duration(result.remaining)}** remains.` : result.message, flags: MessageFlags.Ephemeral });
      const guildProgress = grantGuildXp(worldStore.state, id, result.mission.danger * 50);
      progressContract(character, 'expedition', 1);
      if (result.favour) progressContract(character, 'favour', result.favour);
      await Promise.all([store.set(id, character), guildProgress.guild ? worldStore.save() : Promise.resolve()]);
      return interaction.reply(`🎒 Expedition complete: **${result.amount} ${result.resource}**, **${result.mastery.gained} mastery**${result.favour ? `, and **${result.favour} favour**` : ''}. These resources can upgrade your guild hall.`);
    }
    if (interaction.commandName === 'guild') {
      const action = interaction.options.getSubcommand(); const world = worldStore.state;
      if (action === 'list') {
        let page = 0;
        let selectedGuildId = null;
        const initial = guildRegistryPanel(id, page);
        page = initial.page;
        return openInteractivePanel(interaction, initial.payload, async (component, message) => {
          if (component.customId === 'rpg_guild_select') {
            selectedGuildId = worldStore.state.guilds[component.values[0]] ? component.values[0] : null;
            if (!selectedGuildId) {
              await component.followUp({ content: 'That guild no longer exists.', flags: MessageFlags.Ephemeral });
              return;
            }
          } else if (component.customId === 'rpg_guild_prev' || component.customId === 'rpg_guild_next') {
            page += component.customId === 'rpg_guild_next' ? 1 : -1;
            selectedGuildId = null;
          } else if (component.customId === 'rpg_guild_join') {
            if (!selectedGuildId) return;
            const result = joinGuild(worldStore.state, id, selectedGuildId);
            if (!result.ok) {
              await component.followUp({ content: result.message, flags: MessageFlags.Ephemeral });
              return;
            }
            await worldStore.save();
            const rendered = guildRegistryPanel(id, page, selectedGuildId, `🤝 Joined **${result.guild.name}**.`);
            page = rendered.page;
            await message.edit(rendered.payload);
            return;
          } else return;
          const rendered = guildRegistryPanel(id, page, selectedGuildId);
          page = rendered.page;
          await message.edit(rendered.payload);
        });
      }
      if (action === 'create') {
        const result = createGuild(world, id, interaction.options.getString('name'));
        if (!result.ok) return interaction.reply({ content: result.message, flags: MessageFlags.Ephemeral });
        await worldStore.save(); return interaction.reply(`🏰 **${result.guild.name}** was founded. Its hall now connects expeditions, stations, territory, and raids.`);
      }
      if (action === 'join') {
        const result = joinGuild(world, id, interaction.options.getString('id'));
        if (!result.ok) return interaction.reply({ content: result.message, flags: MessageFlags.Ephemeral });
        await worldStore.save(); return interaction.reply(`🤝 You joined **${result.guild.name}**.`);
      }
      const guild = world.guilds[world.memberships[id]];
      if (!guild) return interaction.reply({ content: 'Join or create a guild first.', flags: MessageFlags.Ephemeral });
      if (action === 'view') {
        let selectedStationId = null;
        return openInteractivePanel(interaction, guildHallPanel(id), async (component, message) => {
          if (component.customId === 'rpg_guild_station') {
            selectedStationId = HALL_STATIONS[component.values[0]] ? component.values[0] : null;
            await message.edit(guildHallPanel(id, selectedStationId));
            return;
          }
          if (component.customId === 'rpg_guild_upgrade') {
            if (!selectedStationId) return;
            const result = upgradeStation(worldStore.state, id, selectedStationId);
            if (!result.ok) {
              await component.followUp({ content: result.message, flags: MessageFlags.Ephemeral });
              return;
            }
            await worldStore.save();
            await message.edit(guildHallPanel(id, selectedStationId, `🔨 **${result.station.name}** reached level **${result.guild.stations[selectedStationId]}** for ${result.cost} ${result.station.resource}.`));
            return;
          }
          if (component.customId !== 'rpg_guild_collect') return;
          const liveWorld = worldStore.state;
          const liveGuild = liveWorld.guilds[liveWorld.memberships[id]];
          if (!liveGuild) {
            await component.followUp({ content: 'You are no longer in a guild.', flags: MessageFlags.Ephemeral });
            return;
          }
          const cooldown = 20 * 60 * 60 * 1000;
          const elapsed = liveGuild.lastGatherAt ? Date.now() - liveGuild.lastGatherAt : cooldown;
          if (elapsed < cooldown) {
            await component.followUp({ content: `Territory production is ready in **${duration(cooldown - elapsed)}**.`, flags: MessageFlags.Ephemeral });
            return;
          }
          const gains = gatherTerritories(liveWorld)[liveGuild.id] || {};
          liveGuild.lastGatherAt = Date.now();
          await worldStore.save();
          const notice = Object.keys(gains).length ? `📦 Collected ${Object.entries(gains).map(([key, value]) => `**${value} ${key}**`).join(', ')}.` : 'Your guild controls no producing territories yet.';
          await message.edit(guildHallPanel(id, selectedStationId, notice));
        });
      }
      if (action === 'donate') {
        const donatedAmount = interaction.options.getInteger('amount');
        const result = donate(world, character, interaction.options.getString('resource'), donatedAmount);
        if (!result.ok) return interaction.reply({ content: result.message, flags: MessageFlags.Ephemeral });
        progressContract(character, 'guild_donation', donatedAmount);
        await Promise.all([store.set(id, character), worldStore.save()]); return interaction.reply('📦 Donation delivered. It increased guild influence and your mastery.');
      }
      if (action === 'upgrade') {
        const result = upgradeStation(world, id, interaction.options.getString('station'));
        if (!result.ok) return interaction.reply({ content: result.message, flags: MessageFlags.Ephemeral });
        await worldStore.save(); return interaction.reply(`🔨 **${result.station.name}** upgraded to level **${result.guild.stations[interaction.options.getString('station')]}**.`);
      }
      if (action === 'collect') {
        const cooldown = 20 * 60 * 60 * 1000; const elapsed = guild.lastGatherAt ? Date.now() - guild.lastGatherAt : cooldown;
        if (elapsed < cooldown) return interaction.reply({ content: `Territory production is ready in **${duration(cooldown - elapsed)}**.`, flags: MessageFlags.Ephemeral });
        const gains = gatherTerritories(world)[guild.id] || {}; guild.lastGatherAt = Date.now(); await worldStore.save();
        return interaction.reply(Object.keys(gains).length ? `📦 Territory production delivered: ${Object.entries(gains).map(([key, value]) => `**${value} ${key}**`).join(', ')}.` : 'Your guild controls no producing territories yet.');
      }
      if (action === 'chat') {
        guild.chat.push({ userId: id, message: interaction.options.getString('message'), at: new Date().toISOString() }); guild.chat = guild.chat.slice(-50);
        await worldStore.save(); return interaction.reply({ content: `💬 Message posted to **${guild.name}**.`, flags: MessageFlags.Ephemeral });
      }
    }
    if (interaction.commandName === 'guildmap') {
      const target = interaction.options.getString('attack'); const world = worldStore.state;
      if (!target) {
        const expectedCharacterId = character.characterId;
        let selectedTerritoryId = null;
        return openInteractivePanel(interaction, guildMapPanel(character), async (component, message) => {
          const live = store.get(id);
          if (!live || live.characterId !== expectedCharacterId) {
            await component.followUp({ content: 'Your active character changed. Reopen `/guildmap`.', flags: MessageFlags.Ephemeral });
            return;
          }
          normalizeCharacter(live);
          if (component.customId === 'rpg_territory_select') {
            selectedTerritoryId = TERRITORIES[component.values[0]] ? component.values[0] : null;
            if (!selectedTerritoryId) return;
            await message.edit(guildMapPanel(live, selectedTerritoryId));
            return;
          }
          if (component.customId !== 'rpg_territory_attack' || !selectedTerritoryId) return;
          const power = derivedStats(live).attack + live.mastery + live.level;
          const result = attackTerritory(worldStore.state, id, selectedTerritoryId, power);
          if (!result.ok) {
            await component.followUp({ content: result.message, flags: MessageFlags.Ephemeral });
            return;
          }
          const territoryName = TERRITORIES[selectedTerritoryId].name;
          addMastery(live, result.captured ? 4 : 2, 'territory war');
          progressContract(live, 'territory', 1);
          await Promise.all([store.update(id, live), worldStore.save()]);
          const notice = result.captured
            ? `🏴 **${worldStore.state.guilds[worldStore.state.memberships[id]].name} captured ${territoryName}!**`
            : `⚔️ The assault weakened **${territoryName}**, but its defenders held.`;
          selectedTerritoryId = null;
          await message.edit(guildMapPanel(live, null, notice));
        });
      }
      const power = derivedStats(character).attack + character.mastery + character.level;
      const result = attackTerritory(world, id, target, power);
      if (!result.ok) return interaction.reply({ content: result.message, flags: MessageFlags.Ephemeral });
      addMastery(character, result.captured ? 4 : 2, 'territory war'); progressContract(character, 'territory', 1); await Promise.all([store.set(id, character), worldStore.save()]);
      return interaction.reply(result.captured ? `🏴 **${world.guilds[world.memberships[id]].name} captured ${TERRITORIES[target].name}!** It now supplies the guild hall and increases raid power.` : `⚔️ The assault weakened **${TERRITORIES[target].name}**, but its defenders held.`);
    }
    if (interaction.commandName === 'worldboss') {
      const raid = worldStore.state.raid; const boss = WORLD_BOSSES.find((entry) => entry.id === raid.bossId);
      if (!interaction.options.getBoolean('attack')) {
        const expectedCharacterId = character.characterId;
        return openInteractivePanel(interaction, worldBossPanel(character), async (component, message) => {
          const live = store.get(id);
          if (!live || live.characterId !== expectedCharacterId) {
            await component.followUp({ content: 'Your active character changed. Reopen `/worldboss`.', flags: MessageFlags.Ephemeral });
            return;
          }
          normalizeCharacter(live);
          if (component.customId === 'rpg_worldboss_refresh') {
            await message.edit(worldBossPanel(live));
            return;
          }
          if (component.customId !== 'rpg_worldboss_attack') return;
          const cooldown = 60 * 60 * 1000;
          const elapsed = live.lastRaidAction ? Date.now() - live.lastRaidAction : cooldown;
          if (elapsed < cooldown) {
            await component.followUp({ content: `Your raid action returns in **${duration(cooldown - elapsed)}**.`, flags: MessageFlags.Ephemeral });
            return;
          }
          const result = raidAttack(worldStore.state, live, derivedStats(live).attack * 5 + live.mastery * 2);
          if (!result.ok) {
            await component.followUp({ content: result.message, flags: MessageFlags.Ephemeral });
            return;
          }
          live.lastRaidAction = Date.now();
          progressContract(live, 'raid', result.damage);
          if (result.favour) progressContract(live, 'favour', result.favour);
          await Promise.all([store.update(id, live), worldStore.save()]);
          const liveBoss = WORLD_BOSSES.find((entry) => entry.id === worldStore.state.raid.bossId);
          await message.edit(worldBossPanel(live, `🐉 Dealt **${result.damage.toLocaleString()} raid damage**.${result.defeated ? ` **${liveBoss?.name || 'The boss'} was defeated!**` : ''}`));
        });
      }
      const cooldown = 60 * 60 * 1000; const elapsed = character.lastRaidAction ? Date.now() - character.lastRaidAction : cooldown;
      if (elapsed < cooldown) return interaction.reply({ content: `Your raid action returns in **${duration(cooldown - elapsed)}**.`, flags: MessageFlags.Ephemeral });
      const result = raidAttack(worldStore.state, character, derivedStats(character).attack * 5 + character.mastery * 2);
      if (!result.ok) return interaction.reply({ content: result.message, flags: MessageFlags.Ephemeral });
      character.lastRaidAction = Date.now();
      progressContract(character, 'raid', result.damage);
      if (result.favour) progressContract(character, 'favour', result.favour);
      await Promise.all([store.set(id, character), worldStore.save()]);
      return interaction.reply(`🐉 You dealt **${result.damage.toLocaleString()} raid damage**. This increased mastery, faction score, and guild influence.${result.defeated ? `\n🏆 **${boss.name} has been defeated by the server!**` : ''}`);
    }
    if (interaction.commandName === 'stats' && interaction.options.getSubcommand() === 'view') {
      const expectedCharacterId = character.characterId;
      let selectedStat = null;
      return openInteractivePanel(interaction, statsPanel(character), async (component, message) => {
        const live = store.get(id);
        if (!live || live.characterId !== expectedCharacterId) {
          await component.followUp({ content: 'Your active character changed. Reopen `/stats view`.', flags: MessageFlags.Ephemeral });
          return;
        }
        normalizeCharacter(live);
        if (component.customId === 'rpg_stat_select') {
          selectedStat = STAT_KEYS.includes(component.values[0]) ? component.values[0] : null;
          if (!selectedStat) return;
          await message.edit(statsPanel(live, selectedStat));
          return;
        }
        const match = component.customId.match(/^rpg_stat_add_(1|5|10)$/);
        if (!match || !selectedStat) return;
        const amount = Number(match[1]);
        const result = allocateStats(live, selectedStat, amount);
        if (!result.ok) {
          await component.followUp({ content: result.message, flags: MessageFlags.Ephemeral });
          return;
        }
        await store.update(id, live);
        await message.edit(statsPanel(live, selectedStat, `${STATS[selectedStat].emoji} Added **${amount}** to **${STATS[selectedStat].name}**.`));
      });
    }
    if (interaction.commandName === 'stats' && interaction.options.getSubcommand() === 'allocate') {
      const stat = interaction.options.getString('stat');
      const amount = interaction.options.getInteger('amount');
      const result = allocateStats(character, stat, amount);
      if (!result.ok) return interaction.reply({ content: result.message, flags: MessageFlags.Ephemeral });
      await store.set(id, character);
      return interaction.reply(`${STATS[stat].emoji} Added **${amount}** to **${STATS[stat].name}**. You have **${character.statPoints}** points left.`);
    }
    if (interaction.commandName === 'adventure') return runAdventureFeature(interaction, character, store, activeBattles);
    if (interaction.commandName === 'daily') {
      const result = claimDaily(character);
      if (!result.ok) return interaction.reply({ content: `Your next daily reward is ready in **${duration(result.remaining)}**.`, flags: MessageFlags.Ephemeral });
      await store.set(id, character);
      return interaction.reply(`🎁 You received **${result.gold} gold** and **1 health potion**!`);
    }
    if (interaction.commandName === 'heal') {
      const result = healAtInn(character);
      if (!result.ok) return interaction.reply({ content: result.message, flags: MessageFlags.Ephemeral });
      await store.set(id, character);
      return interaction.reply(`🛏️ You rested at the inn for **${result.cost} gold** and restored all HP.`);
    }
    if (interaction.commandName === 'shop') {
      const expectedCharacterId = character.characterId;
      let selectedItemId = null;
      return openInteractivePanel(interaction, shopPanel(character), async (component, message) => {
        const live = store.get(id);
        if (!live || live.characterId !== expectedCharacterId) {
          await component.followUp({ content: 'Your active character changed. Reopen `/shop`.', flags: MessageFlags.Ephemeral });
          return;
        }
        normalizeCharacter(live);
        if (component.customId === 'rpg_shop_item') {
          selectedItemId = SHOP[component.values[0]] ? component.values[0] : null;
          if (!selectedItemId) return;
          await message.edit(shopPanel(live, selectedItemId));
          return;
        }
        if (component.customId !== 'rpg_shop_buy' || !selectedItemId) return;
        const result = buyItem(live, selectedItemId);
        if (!result.ok) {
          await component.followUp({ content: result.message, flags: MessageFlags.Ephemeral });
          return;
        }
        await store.update(id, live);
        await message.edit(shopPanel(live, selectedItemId, `${result.item.emoji} Bought **${result.item.name}**. You have **${live.gold} gold** left.`));
      });
    }
    if (interaction.commandName === 'buy') {
      const result = buyItem(character, interaction.options.getString('item'));
      if (!result.ok) return interaction.reply({ content: result.message, flags: MessageFlags.Ephemeral });
      await store.set(id, character);
      return interaction.reply(`${result.item.emoji} You bought **${result.item.name}**! You have **${character.gold} gold** left.`);
    }
    if (interaction.commandName === 'leaderboard') {
      const top = store.all().sort((a, b) => b.level - a.level || b.xp - a.xp || b.wins - a.wins).slice(0, 10);
      return interaction.reply({ embeds: [new EmbedBuilder().setColor(0xeab308).setTitle('🏆 Adventurer Leaderboard').setDescription(top.length ? top.map((c, index) => `**${index + 1}. ${c.name}** — Level ${c.level} • ${c.wins} wins`).join('\n') : 'No adventurers yet.')] });
    }
    if (interaction.commandName === 'inventory') {
      return handleInventory(interaction, character, store);
    }
    if (interaction.commandName === 'equip') {
      const result = equipItem(character, interaction.options.getInteger('slot') - 1);
      if (!result.ok) return interaction.reply({ content: result.message, flags: MessageFlags.Ephemeral });
      await store.set(id, character);
      const primary = result.item.type === 'weapon' ? 'attack' : 'defense';
      return interaction.reply(`${RARITIES[result.item.rarity].emoji} Equipped **${result.item.name}** (+${result.item.stats?.[primary] || 0} ${primary === 'attack' ? 'ATK' : 'DEF'}).`);
    }
    if (interaction.commandName === 'worlds') {
      const expectedCharacterId = character.characterId;
      let selectedWorldId = character.world;
      return openInteractivePanel(interaction, worldsPanel(character, selectedWorldId), async (component, message) => {
        const live = store.get(id);
        if (!live || live.characterId !== expectedCharacterId) {
          await component.followUp({ content: 'Your active character changed. Reopen `/worlds`.', flags: MessageFlags.Ephemeral });
          return;
        }
        normalizeCharacter(live);
        if (component.customId === 'rpg_world_select') {
          const requestedWorld = Number(component.values[0]);
          if (!Number.isInteger(requestedWorld) || requestedWorld < 1 || requestedWorld > live.unlockedWorld || !WORLDS[requestedWorld - 1]) {
            await component.followUp({ content: 'That world is not unlocked.', flags: MessageFlags.Ephemeral });
            return;
          }
          selectedWorldId = requestedWorld;
          await message.edit(worldsPanel(live, selectedWorldId));
          return;
        }
        if (component.customId !== 'rpg_floor_select') return;
        const [worldText, floorText] = component.values[0].split(':');
        const worldId = Number(worldText); const floor = Number(floorText);
        if (live.idleCombat) {
          await component.followUp({ content: 'Claim idle combat before travelling.', flags: MessageFlags.Ephemeral });
          return;
        }
        if (!Number.isInteger(worldId) || !Number.isInteger(floor) || worldId > live.unlockedWorld || floor < 1 || floor > (live.worldProgress[worldId] || 1)) {
          await component.followUp({ content: 'That destination is no longer available.', flags: MessageFlags.Ephemeral });
          return;
        }
        live.world = worldId; live.floor = floor; selectedWorldId = worldId;
        await store.update(id, live);
        await message.edit(worldsPanel(live, selectedWorldId, `${WORLDS[worldId - 1].emoji} Travelled to **${WORLDS[worldId - 1].name} — Floor ${floor}**.`));
      });
    }
    if (interaction.commandName === 'travel') {
      if (character.idleCombat) return interaction.reply({ content: 'Claim idle combat before travelling.', flags: MessageFlags.Ephemeral });
      const worldId = interaction.options.getInteger('world');
      const floor = interaction.options.getInteger('floor') || 1;
      if (worldId > character.unlockedWorld) return interaction.reply({ content: 'That world is still locked. Defeat the previous world’s floor 10 boss.', flags: MessageFlags.Ephemeral });
      if (floor > (character.worldProgress[worldId] || 1)) return interaction.reply({ content: 'You have not reached that floor yet.', flags: MessageFlags.Ephemeral });
      character.world = worldId; character.floor = floor;
      await store.set(id, character);
      return interaction.reply(`${WORLDS[worldId - 1].emoji} Travelled to **${WORLDS[worldId - 1].name} — Floor ${floor}**.`);
    }
  } catch (error) {
    console.error(error);
    const payload = { content: 'Something went wrong while handling that command.', flags: MessageFlags.Ephemeral };
    if (interaction.replied || interaction.deferred) await interaction.followUp(payload).catch(() => {});
    else await interaction.reply(payload).catch(() => {});
  }
});

Promise.all([store.load(), worldStore.load()]).then(async () => {
  const migration = await store.migrateCharacters(normalizeCharacter);
  if (migration.migrated) console.log(`Migrated ${migration.migrated}/${migration.total} character(s) to the current progression schema.`);
  return client.login(process.env.DISCORD_TOKEN);
}).catch((error) => { console.error(error); process.exit(1); });
