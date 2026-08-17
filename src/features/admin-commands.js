const { MessageFlags } = require('discord.js');
const { STATS } = require('../content');
const { normalizeCharacter, setCharacterLevel, grantXp, derivedStats } = require('../game');
const { createAdminItem } = require('../systems');
const { addCharacterStat, addCharacterAscensions, forceGuildJoin } = require('../systems/admin');
const { adminForgeComponents, adminForgeEmbed } = require('../ui/admin-forge');
const { requestConfirmation } = require('../ui/confirmation');

async function confirmedAdminMutation(interaction, options, apply, save) {
  const confirmation = await requestConfirmation(interaction, options);
  if (!confirmation.confirmed) return true;
  let result;
  try {
    result = await apply();
    if (result?.ok === false) {
      await confirmation.fail(result.message);
      return true;
    }
    await save(result);
  } catch (error) {
    if (!error.userMessage) console.error('Could not apply confirmed admin action:', error);
    await confirmation.fail(error.userMessage || 'The admin action could not be saved. No success was reported.');
    return true;
  }
  await confirmation.complete(options.success(result), options.successTitle || '🛠️ Admin action complete');
  return true;
}

function findCharacter(store, userId, characterId) {
  return store.getProfile(userId)?.characters.find((character) => character.characterId === characterId) || null;
}

function userError(message) {
  const error = new Error(message);
  error.userMessage = message;
  return error;
}

async function handleAdminCommand(interaction, store, worldStore) {
  const adminId = interaction.user.id; const action = interaction.options.getSubcommand();
  const targetUser = interaction.options.getUser('player'); const target = store.get(targetUser.id);
  if (!target) return interaction.reply({ content: 'That player has no active character.', flags: MessageFlags.Ephemeral });
  normalizeCharacter(target);
  const targetCharacterId = target.characterId;
  const applyMutation = (working, mutation) => {
    normalizeCharacter(working);
    const result = mutation(working) || { ok: true };
    if (result.ok === false) throw userError(result.message);
    return { ...result, character: structuredClone(working), characterName: working.name };
  };
  const mutateTarget = (mutation) => async () => {
    if (typeof store.transaction === 'function') {
      return store.transaction((characters) => {
        const working = characters.get(targetUser.id)?.characters.find((entry) => entry.characterId === targetCharacterId);
        if (!working) throw userError('That character no longer exists, so nothing was changed.');
        return applyMutation(working, mutation);
      });
    }
    const stored = findCharacter(store, targetUser.id, targetCharacterId);
    if (!stored) throw userError('That character no longer exists, so nothing was changed.');
    const result = applyMutation(structuredClone(stored), mutation);
    await store.update(targetUser.id, result.character);
    return result;
  };
  const saveTarget = async () => {};

  if (action === 'make-equipment') {
    const config = { name: interaction.options.getString('name') || 'Relic of Absolute Power', characterName: target.name, type: 'weapon', grade: 'z', magnitude: 10000, stats: ['attack', 'strength'], traits: ['keen', 'giant_slayer'] };
    const response = await interaction.reply({ embeds: [adminForgeEmbed(targetUser, config)], components: adminForgeComponents(config), flags: MessageFlags.Ephemeral, withResponse: true });
    const message = response.resource?.message || response;
    const collector = message.createMessageComponentCollector({ filter: (component) => component.user.id === adminId, time: 300000 });
    let finalizing = false;
    collector.on('collect', async (component) => {
      let acknowledged = false;
      let persisted = false;
      try {
        if (finalizing) return component.deferUpdate().catch(() => {});
        if (component.customId === 'admin_item_form') [config.type, config.grade] = component.values[0].split(':');
        else if (component.customId === 'admin_item_stats') config.stats = component.values;
        else if (component.customId === 'admin_item_power') config.magnitude = Number(component.values[0]);
        else if (component.customId === 'admin_item_traits') config.traits = component.values;
        else if (component.customId === 'admin_item_cancel') {
          finalizing = true;
          collector.stop('cancelled');
          return component.update({ embeds: [adminForgeEmbed(targetUser, config, 'cancelled')], components: adminForgeComponents(config, true) });
        } else if (component.customId === 'admin_item_grant') {
          finalizing = true;
          const stored = findCharacter(store, targetUser.id, targetCharacterId);
          if (!stored) {
            collector.stop('failed');
            return component.update({ embeds: [adminForgeEmbed(targetUser, config, 'failed', 'The selected character no longer exists, so no item was granted.')], components: adminForgeComponents(config, true) });
          }
          const grantedConfig = structuredClone(config);
          const item = createAdminItem(grantedConfig);
          await component.deferUpdate();
          acknowledged = true;
          if (typeof store.transaction === 'function') {
            await store.transaction((characters) => {
              const working = characters.get(targetUser.id)?.characters.find((entry) => entry.characterId === targetCharacterId);
              if (!working) throw userError('The selected character no longer exists, so no item was granted.');
              normalizeCharacter(working);
              working.inventory.push(item);
            });
          } else {
            const working = structuredClone(stored);
            normalizeCharacter(working);
            working.inventory.push(item);
            await store.update(targetUser.id, working);
          }
          persisted = true;
          collector.stop('granted');
          return interaction.editReply({ embeds: [adminForgeEmbed(targetUser, grantedConfig, 'granted')], components: adminForgeComponents(grantedConfig, true) });
        }
        return component.update({ embeds: [adminForgeEmbed(targetUser, config)], components: adminForgeComponents(config) });
      } catch (error) {
        if (!error.userMessage) console.error('Could not complete admin equipment forge:', error);
        collector.stop(persisted ? 'granted' : 'failed');
        const payload = persisted
          ? { embeds: [adminForgeEmbed(targetUser, config, 'granted')], components: adminForgeComponents(config, true) }
          : { embeds: [adminForgeEmbed(targetUser, config, 'failed', error.userMessage || 'The item could not be saved, so it was not granted.')], components: adminForgeComponents(config, true) };
        if (acknowledged) return interaction.editReply(payload).catch(() => {});
        return component.update(payload).catch(() => interaction.editReply(payload).catch(() => {}));
      }
    });
    collector.on('end', (_, reason) => {
      if (!['granted', 'cancelled', 'failed'].includes(reason)) interaction.editReply({ embeds: [adminForgeEmbed(targetUser, config, 'failed', 'The forge expired before an item was granted.')], components: adminForgeComponents(config, true) }).catch(() => {});
    });
    return true;
  }

  if (action === 'add-stats') {
    const stat = interaction.options.getString('stat'); const amount = interaction.options.getInteger('amount'); const before = target.stats[stat] || 1;
    return confirmedAdminMutation(interaction, {
      title: '🛠️ Confirm Admin Stat Grant', description: `Add **${amount.toLocaleString()} ${STATS[stat].name}** to **${target.name}**?`,
      consequences: [`${STATS[stat].name} increases by ${amount.toLocaleString()} (it was ${before.toLocaleString()} when this prompt opened).`, stat === 'hp' ? `Maximum and current HP also increase by ${(amount * 5).toLocaleString()}.` : stat === 'mana' ? `Maximum and current mana also increase by ${(amount * 5).toLocaleString()}.` : 'The raw character stat is permanently increased.', 'This does not consume stat points.'],
      labels: { confirm: 'Add Stat', cancel: 'Cancel Grant' }, success: (result) => `Added **${result.amount.toLocaleString()} ${STATS[stat].name}** to **${result.characterName}**. New total: **${result.total.toLocaleString()}**.`,
    }, mutateTarget((live) => addCharacterStat(live, stat, amount)), saveTarget);
  }

  if (action === 'add-ascensions') {
    const amount = interaction.options.getInteger('amount');
    return confirmedAdminMutation(interaction, {
      title: '🌟 Confirm Admin Ascensions', description: `Add **${amount.toLocaleString()} ascension(s)** to **${target.name}**?`,
      consequences: [`Ascension count increases by ${amount.toLocaleString()} (it was ${(target.ascensions || 0).toLocaleString()} when this prompt opened).`, `Permanent ascension points increase by ${amount}; combat and reward bonuses follow the diminishing capped ascension curve.`, 'No level or world progress is reset.'],
      labels: { confirm: 'Add Ascensions', cancel: 'Cancel Grant' }, success: (result) => `**${result.characterName}** now has **${result.ascensions} ascensions** and **${result.points} points**.`,
    }, mutateTarget((live) => addCharacterAscensions(live, amount)), saveTarget);
  }

  if (action === 'guild-join') {
    const guildId = interaction.options.getString('guild_id'); const guild = worldStore.state.guilds[guildId];
    if (!guild) return interaction.reply({ content: 'Guild not found. Use the exact ID shown by `/guild list`.', flags: MessageFlags.Ephemeral });
    const previousId = worldStore.state.memberships[targetUser.id]; const previous = previousId ? worldStore.state.guilds[previousId] : null;
    if (previousId === guildId) return interaction.reply({ content: `That player is already in **${guild.name}**.`, flags: MessageFlags.Ephemeral });
    return confirmedAdminMutation(interaction, {
      title: '🏰 Confirm Forced Guild Join', description: `Move **${target.name}** into **${guild.name}**?`,
      consequences: [previous ? `They will be removed from **${previous.name}**.` : 'They are not currently in a guild.', previous?.leaderId === targetUser.id ? (previous.members.length > 1 ? `Leadership of **${previous.name}** will transfer to another member.` : `**${previous.name}** will disband because its only member is leaving.`) : null, `They will be added to **${guild.name}** immediately.`, 'Guild membership is Discord-account-wide and applies to all three character slots.', 'Character progression and inventories are unchanged.'].filter(Boolean),
      labels: { confirm: 'Move Player', cancel: 'Keep Membership' }, success: () => `🏰 **${target.name}** joined **${guild.name}**.`,
    }, () => worldStore.transaction((draft) => {
      if ((draft.memberships[targetUser.id] || null) !== (previousId || null)) {
        const error = new Error('Guild membership changed during confirmation.');
        error.userMessage = 'That player\'s guild membership changed while this prompt was open. Run the command again to review the current move.';
        throw error;
      }
      const result = forceGuildJoin(draft, targetUser.id, guildId);
      if (!result.ok) {
        const error = new Error(result.message);
        error.userMessage = result.message;
        throw error;
      }
      return result;
    }), async () => {});
  }

  if (action === 'set-level') {
    const level = interaction.options.getInteger('level');
    return confirmedAdminMutation(interaction, {
      title: '🛠️ Confirm Level Change', description: `Set **${target.name}** from level ${target.level} to level ${level}?`,
      consequences: ['XP is reset to 0.', 'Base HP, mana, attack, defense, and available stat points are recalculated.', 'Allocated stats can prevent lowering to an invalid level.'],
      labels: { confirm: 'Set Level', cancel: 'Keep Level' }, success: (result) => `**${result.characterName}** is now level **${result.character.level}**.`,
    }, mutateTarget((live) => setCharacterLevel(live, level)), saveTarget);
  }

  const amount = interaction.options.getInteger('amount');
  const descriptions = {
    'give-gold': [`Gold increases by ${amount?.toLocaleString()}.`, 'No existing currency is removed.'],
    'give-xp': [`${amount?.toLocaleString()} XP is applied immediately.`, 'This may trigger multiple levels and award stat points.'],
    heal: ['HP and mana are restored to their current maximums.', 'No gold or items are consumed.'],
  };
  return confirmedAdminMutation(interaction, {
    title: '🛠️ Confirm Admin Action', description: `Apply **${action}** to **${target.name}**?`, consequences: descriptions[action],
    labels: { confirm: 'Apply Action', cancel: 'Cancel' }, success: (result) => `Admin action **${action}** applied to **${result.characterName}**.`,
  }, mutateTarget((live) => {
    if (action === 'give-gold') live.gold += amount;
    else if (action === 'give-xp') grantXp(live, amount);
    else { live.hp = derivedStats(live).maxHp; live.mana = live.maxMana; }
    return { ok: true };
  }), saveTarget);
}

module.exports = { handleAdminCommand };
