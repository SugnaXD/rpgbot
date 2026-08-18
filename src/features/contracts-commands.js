const { randomBytes } = require('node:crypto');
const { EmbedBuilder, MessageFlags } = require('discord.js');
const { GODS } = require('../content');
const { addMastery, grantGuildXp } = require('../systems');
const { contractStatus, claimContract } = require('./contracts-system');
const { duration } = require('../core/format');
const { buildPagedStringSelect, createMenuCustomIdCodec } = require('../ui/select-menus');

const CONTRACT_MENU_TIME = 120000;
const contractMenuCodec = createMenuCustomIdCodec({ prefix: 'ct', secret: randomBytes(32) });

const rewardText = (reward) => [
  reward.gold && `${reward.gold} gold`,
  ...Object.entries(reward.materials || {}).map(([key, value]) => `${value} ${key}`),
  reward.favour && `${reward.favour} favour`, reward.mastery && `${reward.mastery} mastery`, reward.guildXp && `${reward.guildXp} guild XP`,
].filter(Boolean).join(' • ');

function applyContractRewards(character, world, reward) {
  character.gold += reward.gold || 0;
  character.materials ||= {};
  for (const [material, amount] of Object.entries(reward.materials || {})) character.materials[material] = (character.materials[material] || 0) + amount;
  if (reward.mastery) addMastery(character, reward.mastery, 'contract');
  if (reward.favour && character.god) {
    character.favour += reward.favour;
    const faction = GODS[character.god]?.faction;
    if (faction) world.factionScores[faction] = (world.factionScores[faction] || 0) + reward.favour;
  }
  const guildProgress = reward.guildXp ? grantGuildXp(world, character.userId, reward.guildXp) : { guild: null, levels: [] };
  return guildProgress;
}

function contractsView(character, options = {}) {
  const status = contractStatus(character);
  const line = (entry) => `${entry.claimed ? '✅' : entry.completed ? '🎁' : '▫️'} **${entry.name}** — \`${entry.id}\`\n${entry.progress}/${entry.goal} ${entry.unit} • ${rewardText(entry.reward)}`;
  const ready = status.all.filter((entry) => entry.completed && !entry.claimed);
  const menu = buildPagedStringSelect({
    scope: 'contracts', action: 'claim', context: character.userId,
    options: ready.map((entry) => ({
      label: `${entry.cadence === 'weekly' ? 'Weekly' : 'Daily'} • ${entry.name}`,
      description: rewardText(entry.reward), value: entry.id, emoji: '🎁',
    })),
    page: options.page || 0, placeholder: 'Claim a completed contract',
    emptyLabel: 'No contract rewards ready', emptyDescription: 'Complete a contract to claim its reward here.',
    disabled: Boolean(options.disabled), codec: contractMenuCodec,
  });
  const embed = new EmbedBuilder().setColor(0x2563eb).setTitle('📋 Contracts Board').addFields(
    { name: `Daily • resets in ${duration(status.daily.resetsAt - Date.now())}`, value: status.daily.contracts.map(line).join('\n\n') },
    { name: `Weekly • resets in ${duration(status.weekly.resetsAt - Date.now())}`, value: status.weekly.contracts.map(line).join('\n\n') },
  ).setFooter({ text: ready.length ? 'Choose a completed contract below, or use /contracts claim.' : 'No rewards are ready yet. Progress updates automatically.' });
  return {
    status, page: menu.page,
    payload: { ...(options.notice ? { content: options.notice } : {}), embeds: [embed], components: menu.rows },
  };
}

async function handleContractsView(interaction, character, store, worldStore) {
  const userId = interaction.user.id;
  const characterId = character.characterId;
  let page = 0;
  let view = contractsView(character, { page });
  const response = await interaction.reply({ ...view.payload, flags: MessageFlags.Ephemeral, withResponse: true });
  const message = response.resource?.message || response;
  const collector = message.createMessageComponentCollector({
    filter: (component) => component.user.id === userId
      && Boolean(contractMenuCodec.parse(component.customId, { scope: 'contracts', action: 'claim', context: userId })),
    time: CONTRACT_MENU_TIME,
  });

  collector.on('collect', async (component) => {
    const route = contractMenuCodec.parse(component.customId, { scope: 'contracts', action: 'claim', context: userId });
    if (!route) return;
    const liveCharacter = store.get(userId);
    if (!liveCharacter || liveCharacter.characterId !== characterId) {
      await component.deferUpdate();
      collector.stop('character_changed');
      view = contractsView(character, { page, disabled: true, notice: '⚠️ Your active character changed. Reopen `/contracts view` for the new character.' });
      return interaction.editReply(view.payload);
    }

    if (route.kind === 'page') {
      page = route.page;
      view = contractsView(liveCharacter, { page });
      return component.update(view.payload);
    }
    if (route.kind !== 'select' || !component.values?.[0]) return;

    await component.deferUpdate();
    const result = claimContract(liveCharacter, component.values[0]);
    if (!result.ok) {
      view = contractsView(liveCharacter, { page, notice: `⚠️ ${result.message}` });
      page = view.page;
      return interaction.editReply(view.payload);
    }
    const guildProgress = applyContractRewards(liveCharacter, worldStore.state, result.reward);
    await Promise.all([store.set(userId, liveCharacter), worldStore.save()]);
    const guildLevel = guildProgress.levels.length ? ` Your guild reached level **${guildProgress.guild.level}**!` : '';
    view = contractsView(liveCharacter, { page, notice: `🎁 Claimed **${result.contract.name}**: ${rewardText(result.reward)}.${guildLevel}` });
    page = view.page;
    return interaction.editReply(view.payload);
  });

  collector.on('end', (_, reason) => {
    if (reason === 'character_changed') return;
    const liveCharacter = store.get(userId);
    const current = liveCharacter?.characterId === characterId ? liveCharacter : character;
    const expired = contractsView(current, { page, disabled: true });
    interaction.editReply({ components: expired.payload.components }).catch(() => {});
  });
  return true;
}

async function handleContractsCommand(interaction, character, store, worldStore) {
  if (interaction.commandName !== 'contracts') return false;
  const action = interaction.options.getSubcommand();
  if (action === 'view') return handleContractsView(interaction, character, store, worldStore);
  const result = claimContract(character, interaction.options.getString('contract'));
  if (!result.ok) return interaction.reply({ content: result.message, flags: MessageFlags.Ephemeral });
  const guildProgress = applyContractRewards(character, worldStore.state, result.reward);
  await Promise.all([store.set(character.userId, character), worldStore.save()]);
  return interaction.reply(`🎁 Claimed **${result.contract.name}**: ${rewardText(result.reward)}.${guildProgress.levels.length ? ` Your guild reached level **${guildProgress.guild.level}**!` : ''}`);
}

module.exports = { rewardText, applyContractRewards, contractsView, handleContractsCommand };
