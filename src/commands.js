const { SlashCommandBuilder } = require('discord.js');
const { CLASSES, SHOP } = require('./content');

const commands = [
  new SlashCommandBuilder().setName('start').setDescription('Create your RPG character')
    .addStringOption((option) => option.setName('name').setDescription('Your hero name').setRequired(true).setMinLength(2).setMaxLength(20))
    .addStringOption((option) => option.setName('class').setDescription('Your character class').setRequired(true)
      .addChoices(...Object.entries(CLASSES).map(([value, role]) => ({ name: `${role.emoji} ${role.name}`, value })))),
  new SlashCommandBuilder().setName('profile').setDescription('View an RPG character')
    .addUserOption((option) => option.setName('player').setDescription('Player to inspect')),
  new SlashCommandBuilder().setName('adventure').setDescription('Hunt a monster in an interactive battle'),
  new SlashCommandBuilder().setName('daily').setDescription('Claim your daily gold and potion'),
  new SlashCommandBuilder().setName('heal').setDescription('Rest at the inn and restore all HP'),
  new SlashCommandBuilder().setName('shop').setDescription('Browse the item shop'),
  new SlashCommandBuilder().setName('buy').setDescription('Buy an item from the shop')
    .addStringOption((option) => option.setName('item').setDescription('Item to buy').setRequired(true)
      .addChoices(...Object.entries(SHOP).map(([value, item]) => ({ name: `${item.name} — ${item.price} gold`, value })))),
  new SlashCommandBuilder().setName('leaderboard').setDescription('View the greatest adventurers'),
  new SlashCommandBuilder().setName('inventory').setDescription('View your weapon and armor drops'),
  new SlashCommandBuilder().setName('equip').setDescription('Equip a dropped weapon or armor')
    .addIntegerOption((option) => option.setName('slot').setDescription('Inventory slot shown by /inventory').setRequired(true).setMinValue(1).setMaxValue(50)),
  new SlashCommandBuilder().setName('worlds').setDescription('View worlds, floors, and your progress'),
  new SlashCommandBuilder().setName('travel').setDescription('Travel to an unlocked world and floor')
    .addIntegerOption((option) => option.setName('world').setDescription('World number').setRequired(true).setMinValue(1).setMaxValue(5))
    .addIntegerOption((option) => option.setName('floor').setDescription('Floor 1–10').setRequired(false).setMinValue(1).setMaxValue(10)),
  new SlashCommandBuilder().setName('rpghelp').setDescription('Learn how to play'),
];

module.exports = { commands, commandData: commands.map((command) => command.toJSON()) };
