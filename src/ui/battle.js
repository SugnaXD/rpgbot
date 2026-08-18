const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, StringSelectMenuBuilder } = require('discord.js');
const { CLASSES } = require('../content');
const { availableAbilities } = require('../systems/abilities');
const { derivedStats } = require('../game');
const { progressBar } = require('../core/format');

const COLOR = 0x7c3aed;

function battleButtons(disabled = false) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('attack').setLabel('Attack').setEmoji('⚔️').setStyle(ButtonStyle.Danger).setDisabled(disabled),
    new ButtonBuilder().setCustomId('defend').setLabel('Defend').setEmoji('🛡️').setStyle(ButtonStyle.Primary).setDisabled(disabled),
    new ButtonBuilder().setCustomId('potion').setLabel('Potion').setEmoji('🧪').setStyle(ButtonStyle.Success).setDisabled(disabled),
    new ButtonBuilder().setCustomId('flee').setLabel('Flee').setEmoji('🏃').setStyle(ButtonStyle.Secondary).setDisabled(disabled),
  );
}

function battleAbilitySelect(character, disabled = false) {
  const abilities = availableAbilities(character);
  return new ActionRowBuilder().addComponents(new StringSelectMenuBuilder()
    .setCustomId('battle_ability')
    .setPlaceholder('Use a class ability')
    .setDisabled(disabled || !abilities.length)
    .addOptions((abilities.length ? abilities : [{ id: 'none', name: 'No abilities', mana: 0, cooldown: 0, description: 'No class abilities are available.' }]).map((ability) => ({
      label: `${ability.name} • ${ability.mana} mana`,
      description: `${ability.description} • ${character.abilityCooldowns?.[ability.id] || 0} turn cooldown`.slice(0, 100),
      value: ability.id,
      default: character.autoAbility === ability.id,
    }))));
}

function battleEmbed(character, enemy, log) {
  const maximumHp = derivedStats(character).maxHp;
  return new EmbedBuilder().setColor(COLOR)
    .setTitle(`${enemy.emoji} ${character.name} vs ${enemy.name}`)
    .setDescription(log)
    .addFields(
      { name: `${CLASSES[character.classId].emoji} ${character.name}`, value: `${progressBar(character.hp, maximumHp)} ${character.hp}/${maximumHp} HP`, inline: true },
      { name: `${enemy.emoji} ${enemy.name} • Lv ${enemy.level || enemy.recommendedLevel || '?'}`, value: `${progressBar(enemy.hp, enemy.maxHp)} ${Math.max(0, enemy.hp)}/${enemy.maxHp} HP`, inline: true },
      { name: '💧 Mana', value: `${character.mana || 0}/${character.maxMana || 0}`, inline: false },
    ).setFooter({ text: 'Battles expire after 2 minutes of inactivity.' });
}

module.exports = { battleButtons, battleAbilitySelect, battleEmbed };
