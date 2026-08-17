require('dotenv').config();
const {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, Client, EmbedBuilder,
  Events, GatewayIntentBits, MessageFlags,
} = require('discord.js');
const { CLASSES, SHOP, RARITIES, WORLDS } = require('./content');
const { CharacterStore } = require('./store');
const {
  xpForLevel, createCharacter, rollFloorEnemy, generateDrop, normalizeCharacter,
  advanceFloor, equipItem, gearBonus, playerDamage, enemyDamage,
  grantRewards, buyItem, claimDaily, healAtInn,
} = require('./game');

if (!process.env.DISCORD_TOKEN) {
  console.error('DISCORD_TOKEN is missing. Copy .env.example to .env and add your token.');
  process.exit(1);
}

const client = new Client({ intents: [GatewayIntentBits.Guilds] });
const store = new CharacterStore();
const activeBattles = new Set();
const colour = 0x7c3aed;

const bar = (current, maximum, width = 10) => {
  const filled = Math.round(Math.max(0, current) / maximum * width);
  return `${'█'.repeat(filled)}${'░'.repeat(width - filled)}`;
};
const duration = (ms) => {
  const hours = Math.floor(ms / 3600000);
  const minutes = Math.ceil((ms % 3600000) / 60000);
  return `${hours}h ${minutes}m`;
};
const getCharacter = async (interaction, userId = interaction.user.id) => {
  const character = store.get(userId);
  if (character) normalizeCharacter(character);
  if (!character) await interaction.reply({ content: userId === interaction.user.id ? 'Create a character first with `/start`.' : 'That player has no character.', flags: MessageFlags.Ephemeral });
  return character;
};
const battleButtons = (disabled = false) => new ActionRowBuilder().addComponents(
  new ButtonBuilder().setCustomId('attack').setLabel('Attack').setEmoji('⚔️').setStyle(ButtonStyle.Danger).setDisabled(disabled),
  new ButtonBuilder().setCustomId('defend').setLabel('Defend').setEmoji('🛡️').setStyle(ButtonStyle.Primary).setDisabled(disabled),
  new ButtonBuilder().setCustomId('potion').setLabel('Potion').setEmoji('🧪').setStyle(ButtonStyle.Success).setDisabled(disabled),
  new ButtonBuilder().setCustomId('flee').setLabel('Flee').setEmoji('🏃').setStyle(ButtonStyle.Secondary).setDisabled(disabled),
);
const battleEmbed = (character, enemy, log) => new EmbedBuilder().setColor(colour)
  .setTitle(`${enemy.emoji} ${character.name} vs ${enemy.name}`)
  .setDescription(log)
  .addFields(
    { name: `${CLASSES[character.classId].emoji} ${character.name}`, value: `${bar(character.hp, character.maxHp)} ${character.hp}/${character.maxHp} HP`, inline: true },
    { name: `${enemy.emoji} ${enemy.name}`, value: `${bar(enemy.hp, enemy.maxHp)} ${Math.max(0, enemy.hp)}/${enemy.maxHp} HP`, inline: true },
  ).setFooter({ text: 'Battles expire after 2 minutes of inactivity.' });

async function runAdventure(interaction, character) {
  if (activeBattles.has(interaction.user.id)) return interaction.reply({ content: 'You already have an active battle.', flags: MessageFlags.Ephemeral });
  if (character.hp <= 0) return interaction.reply({ content: 'You are unconscious. Use `/heal` before adventuring.', flags: MessageFlags.Ephemeral });
  activeBattles.add(interaction.user.id);
  normalizeCharacter(character);
  const enemy = rollFloorEnemy(character.world, character.floor);
  const world = WORLDS[character.world - 1];
  let log = `${world.emoji} **${world.name} — Floor ${character.floor}**\nA wild **${enemy.name}** blocks your path!`;
  const response = await interaction.reply({ embeds: [battleEmbed(character, enemy, log)], components: [battleButtons()], withResponse: true });
  const message = response.resource.message;
  const collector = message.createMessageComponentCollector({ filter: (button) => button.user.id === interaction.user.id, time: 120000 });

  collector.on('collect', async (button) => {
    let defending = false;
    if (button.customId === 'flee') {
      collector.stop('fled');
      return button.update({ embeds: [battleEmbed(character, enemy, '🏃 You escaped safely.')], components: [battleButtons(true)] });
    }
    if (button.customId === 'potion') {
      if (!character.potions) return button.reply({ content: 'You have no potions.', flags: MessageFlags.Ephemeral });
      if (character.hp === character.maxHp) return button.reply({ content: 'You are already at full health.', flags: MessageFlags.Ephemeral });
      const healed = Math.min(45, character.maxHp - character.hp);
      character.hp += healed; character.potions -= 1;
      log = `🧪 You restored **${healed} HP**.`;
    } else if (button.customId === 'defend') {
      defending = true;
      log = '🛡️ You brace for the next attack.';
    } else {
      const hit = playerDamage(character);
      enemy.hp -= hit.amount;
      log = `⚔️ You dealt **${hit.amount} damage**${hit.critical ? ' — **critical hit!**' : '.'}`;
    }
    if (enemy.hp <= 0) {
      const levels = grantRewards(character, enemy);
      const drop = generateDrop(character.world, character.floor);
      character.inventory.push(drop);
      const progress = advanceFloor(character);
      await store.set(character.userId, character);
      log += `\n🏆 Victory! You earned **${enemy.xp} XP** and **${enemy.gold} gold**.`;
      log += `\n${RARITIES[drop.rarity].emoji} Drop: **${drop.name}** (+${drop.power} ${drop.type === 'weapon' ? 'ATK' : 'DEF'})`;
      if (levels.length) log += `\n⬆️ You reached **level ${character.level}** and your HP was restored!`;
      if (progress.worldUnlocked) log += `\n🌍 **${WORLDS[progress.worldUnlocked - 1].name} unlocked!**`;
      collector.stop('victory');
      return button.update({ embeds: [battleEmbed(character, enemy, log)], components: [battleButtons(true)] });
    }
    const taken = enemyDamage(enemy, character, Math.random, defending);
    character.hp = Math.max(0, character.hp - taken);
    log += `\n${enemy.emoji} ${enemy.name} dealt **${taken} damage**.`;
    if (character.hp <= 0) {
      character.losses += 1;
      character.gold = Math.max(0, character.gold - Math.min(character.gold, 15));
      await store.set(character.userId, character);
      log += '\n💫 You were defeated! Rest at the inn with `/heal`.';
      collector.stop('defeat');
      return button.update({ embeds: [battleEmbed(character, enemy, log)], components: [battleButtons(true)] });
    }
    await store.set(character.userId, character);
    return button.update({ embeds: [battleEmbed(character, enemy, log)], components: [battleButtons()] });
  });
  collector.on('end', async (_, reason) => {
    activeBattles.delete(interaction.user.id);
    if (reason === 'time') await interaction.editReply({ components: [battleButtons(true)] }).catch(() => {});
  });
}

client.once(Events.ClientReady, (ready) => console.log(`Ready as ${ready.user.tag}.`));
client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  try {
    const id = interaction.user.id;
    if (interaction.commandName === 'start') {
      if (store.has(id)) return interaction.reply({ content: 'You already have a character.', flags: MessageFlags.Ephemeral });
      const character = createCharacter(id, interaction.options.getString('name'), interaction.options.getString('class'));
      await store.set(id, character);
      const role = CLASSES[character.classId];
      return interaction.reply({ embeds: [new EmbedBuilder().setColor(colour).setTitle(`${role.emoji} ${character.name} begins their journey!`).setDescription(`You are a **${role.name}**. Use \`/adventure\` to find your first battle.`)] });
    }
    if (interaction.commandName === 'profile') {
      const user = interaction.options.getUser('player') || interaction.user;
      const c = await getCharacter(interaction, user.id); if (!c) return;
      return interaction.reply({ embeds: [new EmbedBuilder().setColor(colour).setTitle(`${CLASSES[c.classId].emoji} ${c.name} — Level ${c.level} ${CLASSES[c.classId].name}`).setThumbnail(user.displayAvatarURL()).addFields(
        { name: 'Health', value: `${bar(c.hp, c.maxHp)} ${c.hp}/${c.maxHp}`, inline: false },
        { name: 'Progress', value: `${bar(c.xp, xpForLevel(c.level))} ${c.xp}/${xpForLevel(c.level)} XP`, inline: false },
        { name: 'Stats', value: `⚔️ ${c.attack} + ${gearBonus(c, 'weapon')} ATK\n🛡️ ${c.defense} + ${gearBonus(c, 'armor')} DEF`, inline: true },
        { name: 'Inventory', value: `🪙 ${c.gold} gold\n🧪 ${c.potions} potions`, inline: true },
        { name: 'Record', value: `🏆 ${c.wins} wins\n💀 ${c.losses} losses`, inline: true },
        { name: 'Progress', value: `${WORLDS[c.world - 1].emoji} ${WORLDS[c.world - 1].name} • Floor ${c.floor}`, inline: false },
      )] });
    }
    const character = await getCharacter(interaction); if (!character) return;
    if (interaction.commandName === 'adventure') return runAdventure(interaction, character);
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
    if (interaction.commandName === 'shop') return interaction.reply({ embeds: [new EmbedBuilder().setColor(0xeab308).setTitle('🏪 Adventurer’s Shop').setDescription(Object.entries(SHOP).map(([key, item]) => `${item.emoji} **${item.name}** — ${item.price} gold\n${item.description}\nBuy with \`/buy item:${key}\``).join('\n\n'))] });
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
      const equippedIds = new Set(Object.values(character.equipped));
      const items = character.inventory.slice(-50);
      const offset = character.inventory.length - items.length;
      const description = items.length ? items.map((item, index) => {
        const rarity = RARITIES[item.rarity];
        return `**${offset + index + 1}.** ${rarity.emoji} ${item.name} — **+${item.power} ${item.type === 'weapon' ? 'ATK' : 'DEF'}**${equippedIds.has(item.id) ? ' • Equipped' : ''}`;
      }).join('\n') : 'No drops yet. Defeat a mob with `/adventure`.';
      return interaction.reply({ embeds: [new EmbedBuilder().setColor(colour).setTitle(`🎒 ${character.name}’s Equipment`).setDescription(description).setFooter({ text: 'Use /equip with an inventory slot number.' })], flags: MessageFlags.Ephemeral });
    }
    if (interaction.commandName === 'equip') {
      const result = equipItem(character, interaction.options.getInteger('slot') - 1);
      if (!result.ok) return interaction.reply({ content: result.message, flags: MessageFlags.Ephemeral });
      await store.set(id, character);
      return interaction.reply(`${RARITIES[result.item.rarity].emoji} Equipped **${result.item.name}** (+${result.item.power} ${result.item.type === 'weapon' ? 'ATK' : 'DEF'}).`);
    }
    if (interaction.commandName === 'worlds') {
      const list = WORLDS.map((world) => `${world.id <= character.unlockedWorld ? '🟢' : '🔒'} **${world.id}. ${world.emoji} ${world.name}** — Floors 1–10${world.id === character.world ? ` • Current floor: ${character.floor}` : ''}`).join('\n');
      return interaction.reply({ embeds: [new EmbedBuilder().setColor(colour).setTitle('🌍 Worlds & Floors').setDescription(`${list}\n\nDefeat each world’s floor 10 boss to unlock the next world.`)] });
    }
    if (interaction.commandName === 'travel') {
      const worldId = interaction.options.getInteger('world');
      const floor = interaction.options.getInteger('floor') || 1;
      if (worldId > character.unlockedWorld) return interaction.reply({ content: 'That world is still locked. Defeat the previous world’s floor 10 boss.', flags: MessageFlags.Ephemeral });
      if (floor > (character.worldProgress[worldId] || 1)) return interaction.reply({ content: 'You have not reached that floor yet.', flags: MessageFlags.Ephemeral });
      character.world = worldId; character.floor = floor;
      await store.set(id, character);
      return interaction.reply(`${WORLDS[worldId - 1].emoji} Travelled to **${WORLDS[worldId - 1].name} — Floor ${floor}**.`);
    }
    if (interaction.commandName === 'rpghelp') return interaction.reply({ embeds: [new EmbedBuilder().setColor(colour).setTitle('📜 How to Play').setDescription('Create a hero, battle monsters, earn loot, and climb the leaderboard.').addFields(
      { name: 'Adventure', value: '`/start` • `/profile` • `/adventure` • `/worlds` • `/travel`' },
      { name: 'Loot', value: '`/inventory` • `/equip`' },
      { name: 'Town', value: '`/shop` • `/buy` • `/heal` • `/daily` • `/leaderboard`' },
    )] });
  } catch (error) {
    console.error(error);
    const payload = { content: 'Something went wrong while handling that command.', flags: MessageFlags.Ephemeral };
    if (interaction.replied || interaction.deferred) await interaction.followUp(payload).catch(() => {});
    else await interaction.reply(payload).catch(() => {});
  }
});

store.load().then(() => client.login(process.env.DISCORD_TOKEN)).catch((error) => { console.error(error); process.exit(1); });
