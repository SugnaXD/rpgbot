const { MessageFlags } = require('discord.js');
const { equipItem } = require('../game');
const { sortedEquipment, inventoryButtons, equipmentMenu, parseEquipmentMenuId, inventoryEmbed } = require('../ui/equipment');

async function handleInventory(interaction, character, store) {
  const userId = interaction.user.id;
  const response = await interaction.reply({ embeds: [inventoryEmbed(character)], components: [inventoryButtons()], flags: MessageFlags.Ephemeral, withResponse: true });
  const message = response.resource?.message || response;
  let selectedType = null;
  let selectedPage = 0;
  const liveCharacter = () => {
    const live = store.get?.(userId) || character;
    return live?.characterId === character.characterId ? live : null;
  };
  const components = (live, disabled = false) => [
    inventoryButtons(disabled),
    ...(selectedType ? equipmentMenu(live, selectedType, selectedPage, disabled).rows : []),
  ];
  const collector = message.createMessageComponentCollector({
    filter: (component) => component.user.id === userId,
    time: 120000,
  });
  collector.on('collect', async (component) => {
    if (component.isButton()) {
      if (component.customId.startsWith('inventory_')) {
        const type = component.customId.replace('inventory_', '');
        const live = liveCharacter();
        if (!live) return component.reply({ content: 'Your active character changed. Open `/inventory` again.', flags: MessageFlags.Ephemeral });
        if (!sortedEquipment(live, type).length) return component.reply({ content: `You do not own any ${type} items yet.`, flags: MessageFlags.Ephemeral });
        selectedType = type; selectedPage = 0;
        return component.update({ embeds: [inventoryEmbed(live)], components: components(live) });
      }
      const route = parseEquipmentMenuId(component.customId);
      if (route?.kind === 'page') {
        const live = liveCharacter();
        if (!live) return component.reply({ content: 'Your active character changed. Open `/inventory` again.', flags: MessageFlags.Ephemeral });
        selectedType = route.context; selectedPage = route.page;
        return component.update({ embeds: [inventoryEmbed(live)], components: components(live) });
      }
    }
    if (component.isStringSelectMenu()) {
      const route = parseEquipmentMenuId(component.customId);
      if (!route || route.kind !== 'select') return;
      const live = liveCharacter();
      if (!live) return component.reply({ content: 'Your active character changed. Open `/inventory` again.', flags: MessageFlags.Ephemeral });
      selectedType = route.context; selectedPage = route.page;
      const index = live.inventory.findIndex((item) => item.id === component.values[0]);
      const result = equipItem(live, index);
      if (!result.ok) return component.reply({ content: result.message, flags: MessageFlags.Ephemeral });
      await (store.update ? store.update(userId, live) : store.set(userId, live));
      return component.update({ embeds: [inventoryEmbed(live)], components: components(live) });
    }
  });
  collector.on('end', () => {
    const live = liveCharacter() || character;
    return interaction.editReply({ components: components(live, true) }).catch(() => {});
  });
}

module.exports = { handleInventory };
