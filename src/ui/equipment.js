const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require('discord.js');
const { GRADES, RARITIES } = require('../content');
const { itemStatsText } = require('../game');
const { buildPagedStringSelect, createMenuCustomIdCodec } = require('./select-menus');

const COLOR = 0x7c3aed;
const gradeOf = (item) => GRADES[item.grade] || GRADES.f;
const rarityOf = (item) => RARITIES[item.rarity] || RARITIES.common;
const equipmentMenuCodec = createMenuCustomIdCodec({ prefix: 'inv' });

function sortedEquipment(character, type) {
  const primary = type === 'weapon' ? 'attack' : 'defense';
  return character.inventory.filter((item) => item.type === type && !item.unsupportedItemVersion)
    .sort((a, b) => rarityOf(b).rank - rarityOf(a).rank
      || gradeOf(b).rank - gradeOf(a).rank
      || (b.stats?.[primary] || 0) - (a.stats?.[primary] || 0)
      || (b.itemLevel || 0) - (a.itemLevel || 0));
}

function inventoryButtons(disabled = false) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('inventory_weapon').setLabel('Equip Weapon').setEmoji('⚔️').setStyle(ButtonStyle.Danger).setDisabled(disabled),
    new ButtonBuilder().setCustomId('inventory_armor').setLabel('Equip Armor').setEmoji('🛡️').setStyle(ButtonStyle.Primary).setDisabled(disabled),
  );
}

function equipmentOptions(character, type) {
  return sortedEquipment(character, type).map((item) => ({
      label: `#${character.inventory.indexOf(item) + 1} ${item.locked ? '🔒 ' : ''}[${rarityOf(item).name}] [${gradeOf(item).name}] ${item.name}${item.upgradeLevel ? ` +${item.upgradeLevel}` : ''}`.slice(0, 100),
      description: itemStatsText(item).slice(0, 100), value: item.id,
      emoji: gradeOf(item).emoji, default: character.equipped[type] === item.id,
    }));
}

function equipmentMenu(character, type, page = 0, disabled = false) {
  return buildPagedStringSelect({
    scope: 'equipment', action: 'equip', context: type, options: equipmentOptions(character, type), page,
    placeholder: `Choose a ${type} — rarity then stat grade`, emptyLabel: `No ${type} items available`,
    disabled, codec: equipmentMenuCodec,
  });
}

// Retained for callers that only need the first select row.
function equipmentSelect(character, type, page = 0, disabled = false) {
  return equipmentMenu(character, type, page, disabled).rows[0];
}

function parseEquipmentMenuId(customId) {
  return equipmentMenuCodec.parse(customId, { scope: 'equipment', action: 'equip' });
}

function inventoryEmbed(character) {
  const weapon = character.inventory.find((item) => item.id === character.equipped.weapon);
  const armor = character.inventory.find((item) => item.id === character.equipped.armor);
  const show = (item) => item ? `${rarityOf(item).emoji} **${item.locked ? '🔒 ' : ''}[${rarityOf(item).name}] ${item.name}${item.upgradeLevel ? ` +${item.upgradeLevel}` : ''}**\n${itemStatsText(item)}` : '*Nothing equipped*';
  return new EmbedBuilder().setColor(COLOR).setTitle(`🎒 ${character.name}’s Equipment`)
    .setDescription('Choose a category below, then select an item. The dropdown sorts **Secret → Common**, then by primary stat grade and actual primary stat.').addFields(
      { name: '⚔️ Weapon', value: show(weapon), inline: true },
      { name: '🛡️ Armor', value: show(armor), inline: true },
      { name: 'Inventory', value: `${sortedEquipment(character, 'weapon').length} weapons • ${sortedEquipment(character, 'armor').length} armor • ${character.materials?.dust || 0} dust`, inline: false },
    ).setFooter({ text: 'Rarity adjusts the item budget; F–Z grades control each stat roll. Natural upgrades add 2% per level, up to +40% at +20.' });
}

module.exports = { gradeOf, sortedEquipment, inventoryButtons, equipmentOptions, equipmentMenu, equipmentSelect, parseEquipmentMenuId, inventoryEmbed };
