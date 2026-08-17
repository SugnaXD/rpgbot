const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, MessageFlags } = require('discord.js');
const { randomUUID } = require('node:crypto');

function confirmationComponents(token, labels = {}, disabled = false) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`confirm:${token}`).setLabel(labels.confirm || 'Confirm').setEmoji('✅').setStyle(ButtonStyle.Danger).setDisabled(disabled),
    new ButtonBuilder().setCustomId(`cancel:${token}`).setLabel(labels.cancel || 'Cancel').setEmoji('✖️').setStyle(ButtonStyle.Secondary).setDisabled(disabled),
  );
}

function confirmationEmbed({ title, description, consequences = [], color = 0xf59e0b }, state = 'pending', status = {}) {
  const presentation = {
    pending: { title, description, color },
    processing: { title: '⏳ Confirmation received', description: 'The bot is validating and saving this change.', color: 0x3b82f6 },
    completed: { title: '✅ Change complete', description: 'The requested change was saved.', color: 0x22c55e },
    cancelled: { title: '✖️ Cancelled', description: 'Nothing was changed.', color: 0x6b7280 },
    failed: { title: '⚠️ Change not applied', description: 'The requested change could not be completed. Nothing was saved.', color: 0xef4444 },
    expired: { title: '⏱️ Confirmation expired', description: 'No choice was received, so nothing was changed.', color: 0x6b7280 },
  }[state] || { title, description, color };
  const embed = new EmbedBuilder()
    .setColor(presentation.color)
    .setTitle(status.title || presentation.title)
    .setDescription(status.description || presentation.description);
  if (state === 'pending' && consequences.length) embed.addFields({ name: 'What will happen', value: consequences.map((line) => `• ${line}`).join('\n') });
  if (state === 'pending') embed.setFooter({ text: 'Only the person who opened this confirmation can respond. It expires in 2 minutes.' });
  return embed;
}

async function requestConfirmation(interaction, options) {
  const token = randomUUID().slice(0, 8);
  const payload = {
    embeds: [confirmationEmbed(options)], components: [confirmationComponents(token, options.labels)],
    flags: MessageFlags.Ephemeral, withResponse: true,
  };
  const response = interaction.replied || interaction.deferred ? await interaction.followUp(payload) : await interaction.reply(payload);
  const message = response.resource?.message || response;
  const editMessage = (editPayload) => interaction.webhook?.editMessage && message.id
    ? interaction.webhook.editMessage(message.id, editPayload)
    : message.edit(editPayload);
  return new Promise((resolve) => {
    let decided = false;
    let settled = false;
    const result = (confirmed) => ({
      confirmed,
      message,
      complete: (description, title) => editMessage({
        embeds: [confirmationEmbed(options, 'completed', { title, description })],
        components: [confirmationComponents(token, options.labels, true)],
      }).catch(() => {}),
      fail: (description, title) => editMessage({
        embeds: [confirmationEmbed(options, 'failed', { title, description })],
        components: [confirmationComponents(token, options.labels, true)],
      }).catch(() => {}),
    });
    const finish = (confirmed) => {
      if (settled) return;
      settled = true;
      resolve(result(confirmed));
    };
    const collector = message.createMessageComponentCollector({
      filter: (component) => component.user.id === interaction.user.id
        && [`confirm:${token}`, `cancel:${token}`].includes(component.customId),
      time: options.time || 120000, max: 1,
    });
    collector.on('collect', async (component) => {
      decided = true;
      const confirmed = component.customId === `confirm:${token}`;
      try {
        await component.update({
          embeds: [confirmationEmbed(options, confirmed ? 'processing' : 'cancelled')],
          components: [confirmationComponents(token, options.labels, true)],
        });
      } catch (error) {
        console.error('Could not update confirmation message:', error);
      } finally {
        finish(confirmed);
      }
    });
    collector.on('end', async () => {
      if (decided) return;
      await editMessage({
        embeds: [confirmationEmbed(options, 'expired')],
        components: [confirmationComponents(token, options.labels, true)],
      }).catch(() => {});
      finish(false);
    });
  });
}

module.exports = { confirmationComponents, confirmationEmbed, requestConfirmation };
