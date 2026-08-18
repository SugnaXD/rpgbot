const { randomBytes } = require('node:crypto');
const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, MessageFlags } = require('discord.js');
const { GODS, WORLD_BOSSES } = require('../content');
const { derivedStats } = require('../game');
const { addMastery, grantGuildXp } = require('../systems');
const { RAID_ROLES, selectRaidRole, resolveRaidRoleAction, raidRoleStatus } = require('./raid-roles-system');
const { progressContract } = require('./contracts-system');
const { duration, progressBar } = require('../core/format');
const { buildPagedStringSelect, createMenuCustomIdCodec } = require('../ui/select-menus');

const RAID_MENU_TIME = 120000;
const raidMenuCodec = createMenuCustomIdCodec({ prefix: 'rd', secret: randomBytes(32) });

function applyRaidRoleEffects(world, character, guild, effects) {
  if (effects.mastery) addMastery(character, effects.mastery, 'raid role');
  if (effects.favour && character.god) {
    character.favour += effects.favour;
    const faction = GODS[character.god]?.faction;
    if (faction) world.factionScores[faction] = (world.factionScores[faction] || 0) + effects.favour;
  }
  if (guild) {
    guild.influence += effects.guildInfluence || 0;
    for (const [resource, amount] of Object.entries(effects.resources || {})) guild.resources[resource] = (guild.resources[resource] || 0) + amount;
  } else {
    character.resources ||= {};
    for (const [resource, amount] of Object.entries(effects.resources || {})) character.resources[resource] = (character.resources[resource] || 0) + amount;
  }
  return effects.guildXp ? grantGuildXp(world, character.userId, effects.guildXp) : { guild: null, levels: [] };
}

function resolveAndApplyRaidAction(world, character, now = Date.now()) {
  const raid = world.raid;
  const guild = world.guilds[world.memberships[character.userId]] || null;
  const boss = WORLD_BOSSES.find((entry) => entry.id === raid.bossId);
  const result = resolveRaidRoleAction(raid, character, guild, derivedStats(character).attack * 5 + character.mastery * 2, { now });
  if (!result.ok) return { ...result, boss, guild };
  character.lastRaidAction = now;
  const guildProgress = applyRaidRoleEffects(world, character, guild, result.effects);
  const contractValue = result.damage + (result.preparation?.added || 0) * 50;
  progressContract(character, 'raid', contractValue);
  if (result.effects.favour) progressContract(character, 'favour', result.effects.favour);
  return { ...result, boss, guild, guildProgress };
}

function raidActionText(result) {
  const prep = result.preparation ? ` and added **${result.preparation.added} ${result.preparation.type}** preparation` : '';
  return `⚔️ As **${result.role.name}**, you dealt **${result.damage.toLocaleString()} damage**${prep}. Phase buffs now grant **+${(result.phase.buffsAfter.damageBonus * 100).toFixed(1)}% damage**.${result.phase.advanced ? '\n🔺 The raid advanced to a new phase!' : ''}${result.defeated ? `\n🏆 **${result.boss?.name || 'The world boss'} was defeated!**` : ''}${result.guildProgress.levels.length ? `\n🏰 Your guild reached level **${result.guildProgress.guild.level}**!` : ''}`;
}

function raidView(world, character, options = {}) {
  const raid = world.raid;
  const boss = WORLD_BOSSES.find((entry) => entry.id === raid.bossId);
  const status = raidRoleStatus(raid, character);
  const inactive = raid.hp <= 0 || Boolean(raid.defeatedAt);
  const roles = buildPagedStringSelect({
    scope: 'raid', action: 'role', context: character.userId,
    options: Object.values(RAID_ROLES).map((role) => ({
      label: role.name,
      description: `${role.contribution} preparation • ${(role.damageScale * 100).toFixed(0)}% damage scale`,
      value: role.id, default: status.role?.id === role.id,
    })),
    page: options.page || 0, placeholder: 'Choose your persistent raid role',
    disabled: Boolean(options.disabled) || inactive, codec: raidMenuCodec,
  });
  const actId = raidMenuCodec.encode({ scope: 'raid', action: 'act', kind: 'button', context: character.userId });
  const refreshId = raidMenuCodec.encode({ scope: 'raid', action: 'refresh', kind: 'button', context: character.userId });
  const actionDisabled = Boolean(options.disabled) || inactive || !status.role || !status.ready;
  const actionLabel = !status.role ? 'Choose a Role First' : status.ready ? 'Perform Role Action' : `Ready in ${duration(status.remaining)}`;
  const actionRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(actId).setLabel(actionLabel).setEmoji('⚔️').setStyle(ButtonStyle.Danger).setDisabled(actionDisabled),
    new ButtonBuilder().setCustomId(refreshId).setLabel('Refresh').setEmoji('🔄').setStyle(ButtonStyle.Secondary).setDisabled(Boolean(options.disabled)),
  );
  const counters = Object.entries(status.counters).map(([key, value]) => `${key}: **${value}/100**`).join(' • ');
  const embed = new EmbedBuilder().setColor(0xef4444).setTitle(`🐉 ${boss?.name || raid.bossId} — Coordinated Raid`).setDescription(`${progressBar(raid.hp, raid.maxHp, 20)} **${raid.hp.toLocaleString()}/${raid.maxHp.toLocaleString()} HP**`).addFields(
    { name: 'Your Role', value: status.role ? `**${status.role.name}**\n${status.ready ? '✅ Action ready' : inactive ? '🏆 Boss defeated' : `⏳ ${duration(status.remaining)}`}` : 'Choose a role from the menu below.' },
    { name: `Phase ${status.phase + 1} Preparation`, value: `${counters}\nDamage bonus **+${(status.buffs.damageBonus * 100).toFixed(1)}%** • mitigation **${(status.buffs.mitigation * 100).toFixed(1)}%** • recovery **${(status.buffs.recovery * 100).toFixed(1)}%**` },
    { name: 'Your Contributions', value: Object.entries(status.contribution).filter(([key, value]) => key !== 'roles' && value).map(([key, value]) => `${key}: **${value.toLocaleString()}**`).join(' • ') || 'None yet.' },
    { name: 'Roles', value: Object.values(RAID_ROLES).map((role) => `**${role.name}:** ${role.contribution}`).join(' • ') },
  ).setFooter({ text: 'Role changes and actions are rechecked against the live raid before being saved.' });
  return {
    status, page: roles.page,
    payload: { ...(options.notice ? { content: options.notice } : {}), embeds: [embed], components: [...roles.rows, actionRow] },
  };
}

function raidRoute(customId, userId) {
  const route = raidMenuCodec.parse(customId, { scope: 'raid', context: userId });
  return route && ['role', 'act', 'refresh'].includes(route.action) ? route : null;
}

async function handleRaidView(interaction, character, store, worldStore) {
  const userId = interaction.user.id;
  const characterId = character.characterId;
  let page = 0;
  let view = raidView(worldStore.state, character, { page });
  const response = await interaction.reply({ ...view.payload, flags: MessageFlags.Ephemeral, withResponse: true });
  const message = response.resource?.message || response;
  const collector = message.createMessageComponentCollector({
    filter: (component) => component.user.id === userId && Boolean(raidRoute(component.customId, userId)),
    time: RAID_MENU_TIME,
  });

  collector.on('collect', async (component) => {
    const route = raidRoute(component.customId, userId);
    if (!route) return;
    const liveCharacter = store.get(userId);
    const liveWorld = worldStore.state;
    if (!liveCharacter || liveCharacter.characterId !== characterId) {
      await component.deferUpdate();
      collector.stop('character_changed');
      view = raidView(liveWorld, character, { page, disabled: true, notice: '⚠️ Your active character changed. Reopen `/raid view` for the new character.' });
      return interaction.editReply(view.payload);
    }

    if (route.action === 'role' && route.kind === 'page') {
      page = route.page;
      view = raidView(liveWorld, liveCharacter, { page });
      return component.update(view.payload);
    }
    if (route.action === 'refresh' && route.kind === 'button') {
      view = raidView(liveWorld, liveCharacter, { page });
      page = view.page;
      return component.update(view.payload);
    }

    await component.deferUpdate();
    if (route.action === 'role' && route.kind === 'select' && component.values?.[0]) {
      const result = selectRaidRole(liveWorld.raid, liveCharacter, component.values[0]);
      if (!result.ok) {
        const detail = result.remaining ? `${result.message} ${duration(result.remaining)} remains.` : result.message;
        view = raidView(liveWorld, liveCharacter, { page, notice: `⚠️ ${detail}` });
        return interaction.editReply(view.payload);
      }
      await worldStore.save();
      view = raidView(liveWorld, liveCharacter, { page, notice: `⚔️ Your raid role is now **${result.role.name}**.` });
      return interaction.editReply(view.payload);
    }
    if (route.action !== 'act' || route.kind !== 'button') return;

    const result = resolveAndApplyRaidAction(liveWorld, liveCharacter);
    if (!result.ok) {
      const detail = result.remaining ? `${result.message} ${duration(result.remaining)} remains.` : result.message;
      view = raidView(liveWorld, liveCharacter, { page, notice: `⚠️ ${detail}` });
      return interaction.editReply(view.payload);
    }
    await Promise.all([store.set(userId, liveCharacter), worldStore.save()]);
    view = raidView(liveWorld, liveCharacter, { page, notice: raidActionText(result) });
    return interaction.editReply(view.payload);
  });

  collector.on('end', (_, reason) => {
    if (reason === 'character_changed') return;
    const liveCharacter = store.get(userId);
    const current = liveCharacter?.characterId === characterId ? liveCharacter : character;
    const expired = raidView(worldStore.state, current, { page, disabled: true });
    interaction.editReply({ components: expired.payload.components }).catch(() => {});
  });
  return true;
}

async function handleRaidCommand(interaction, character, store, worldStore) {
  if (interaction.commandName !== 'raid') return false;
  const action = interaction.options.getSubcommand(); const world = worldStore.state; const raid = world.raid;
  if (action === 'role') {
    const result = selectRaidRole(raid, character, interaction.options.getString('role'));
    if (!result.ok) return interaction.reply({ content: result.remaining ? `${result.message} ${duration(result.remaining)} remains.` : result.message, flags: MessageFlags.Ephemeral });
    await worldStore.save(); return interaction.reply(`⚔️ Your raid role is now **${result.role.name}**.`);
  }
  if (action === 'view') return handleRaidView(interaction, character, store, worldStore);
  const result = resolveAndApplyRaidAction(world, character);
  if (!result.ok) return interaction.reply({ content: result.remaining ? `${result.message} ${duration(result.remaining)} remains.` : result.message, flags: MessageFlags.Ephemeral });
  await Promise.all([store.set(character.userId, character), worldStore.save()]);
  return interaction.reply(raidActionText(result));
}

module.exports = { applyRaidRoleEffects, resolveAndApplyRaidAction, raidView, handleRaidCommand };
