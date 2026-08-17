const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, StringSelectMenuBuilder } = require('discord.js');
const { GRADES, ITEM_TRAITS } = require('../content');

function components(config, disabled = false) {
  return [
    new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId('admin_item_form').setPlaceholder('Equipment type and grade').setDisabled(disabled).addOptions(
      ...['weapon', 'armor'].flatMap((type) => ['f','c','b','a','s','ss','sss','z'].map((grade) => ({ label: `${type === 'weapon' ? 'Weapon' : 'Armor'} • Grade ${grade.toUpperCase()}`, value: `${type}:${grade}`, default: config.type === type && config.grade === grade }))))),
    new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId('admin_item_stats').setPlaceholder('Select customized stats').setMinValues(1).setMaxValues(8).setDisabled(disabled).addOptions(
      ...[['attack','Attack'],['defense','Defense'],['hp','HP (5× magnitude)'],['strength','Strength'],['agility','Agility'],['luck','Luck'],['intelligence','Intelligence'],['mana','Mana']].map(([value,label]) => ({ label, value, default: config.stats.includes(value) })))),
    new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId('admin_item_power').setPlaceholder('Choose stat magnitude').setDisabled(disabled).addOptions(
      ...[[100,'Enhanced'],[1000,'Overpowered'],[10000,'Godlike'],[100000,'Reality-Breaking'],[1000000,'Maximum']].map(([value,label]) => ({ label: `${label} • ${value.toLocaleString()}`, value: String(value), default: config.magnitude === value })))),
    new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId('admin_item_traits').setPlaceholder('Select traits (optional)').setMinValues(0).setMaxValues(Object.keys(ITEM_TRAITS).length).setDisabled(disabled).addOptions(
      ...Object.entries(ITEM_TRAITS).map(([value, trait]) => ({ label: trait.name, description: trait.description, value, default: config.traits.includes(value) })))),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('admin_item_grant').setLabel('Confirm & Grant').setEmoji('✅').setStyle(ButtonStyle.Success).setDisabled(disabled),
      new ButtonBuilder().setCustomId('admin_item_cancel').setLabel('Cancel').setEmoji('✖️').setStyle(ButtonStyle.Secondary).setDisabled(disabled),
    ),
  ];
}

function embed(target, config, state = 'pending', status = '') {
  const presentation = {
    pending: { color: 0xec4899, description: `Target: <@${target.id}> • active character **${config.characterName}**\nItem: **${config.name}**\n\nReview every field, then confirm or cancel.` },
    granted: { color: 0x22c55e, description: `✅ **${config.name}** was saved to **${config.characterName}** (<@${target.id}>).` },
    cancelled: { color: 0x6b7280, description: `✖️ Equipment creation was cancelled. Nothing was granted to <@${target.id}>.` },
    failed: { color: 0xef4444, description: `⚠️ ${status || 'The equipment was not granted.'}` },
  }[state];
  const result = new EmbedBuilder().setColor(presentation.color).setTitle('🛠️ Admin Item Forge').setDescription(presentation.description).addFields(
    { name: 'Form', value: `${config.type} • Grade ${config.grade.toUpperCase()} (${GRADES[config.grade].maxPercent}% roll)`, inline: true },
    { name: 'Per-stat value', value: `${config.magnitude.toLocaleString()} (HP receives 5×)`, inline: true },
    { name: 'Stats', value: config.stats.join(', ') || '*Choose stats*' },
    { name: 'Traits', value: config.traits.map((id) => ITEM_TRAITS[id].name).join(', ') || '*None*' },
    { name: 'What confirmation does', value: 'Creates a permanent Secret admin item with the displayed type, grade, stats, value, and traits, then adds it to the target character’s inventory. It costs no materials and admin-created gear cannot be salvaged.' },
  );
  if (state === 'pending') result.setFooter({ text: 'Only the admin who opened this forge can change or grant the item. It expires in 5 minutes.' });
  return result;
}

module.exports = { adminForgeComponents: components, adminForgeEmbed: embed };
