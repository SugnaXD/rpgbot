const { SlashCommandBuilder } = require('discord.js');
const { CLASSES, SHOP, STATS } = require('./content');
const { ABILITIES } = require('./content/abilities');
const { QUESTS, ACHIEVEMENTS, DUNGEONS } = require('./content/progression');

const commands = [
  new SlashCommandBuilder().setName('start').setDescription('Create a character (maximum three)')
    .addStringOption((option) => option.setName('name').setDescription('Your hero name').setRequired(true).setMinLength(2).setMaxLength(20))
    .addStringOption((option) => option.setName('class').setDescription('Your character class').setRequired(true)
      .addChoices(...Object.entries(CLASSES).map(([value, role]) => ({ name: `${role.emoji} ${role.name}`, value })))),
  new SlashCommandBuilder().setName('profile').setDescription('View an RPG character')
    .addUserOption((option) => option.setName('player').setDescription('Player to inspect')),
  new SlashCommandBuilder().setName('adventure').setDescription('Hunt a monster in an interactive battle'),
  new SlashCommandBuilder().setName('stats').setDescription('View and improve your character stats')
    .addSubcommand((sub) => sub.setName('view').setDescription('View attributes and derived combat stats'))
    .addSubcommand((sub) => sub.setName('allocate').setDescription('Spend stat points')
      .addStringOption((option) => option.setName('stat').setDescription('Attribute to increase').setRequired(true)
        .addChoices(...Object.entries(STATS).map(([value, stat]) => ({ name: `${stat.emoji} ${stat.name}`, value }))))
      .addIntegerOption((option) => option.setName('amount').setDescription('Points to spend').setRequired(true).setMinValue(1).setMaxValue(10000))),
  new SlashCommandBuilder().setName('characters').setDescription('View your three character slots'),
  new SlashCommandBuilder().setName('switch').setDescription('Switch your active character')
    .addIntegerOption((option) => option.setName('slot').setDescription('Character slot 1–3').setRequired(true).setMinValue(1).setMaxValue(3)),
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
  new SlashCommandBuilder().setName('mastery').setDescription('View mastery or choose an advanced class at 75 mastery')
    .addStringOption((option) => option.setName('specialization').setDescription('Advanced class to unlock')),
  new SlashCommandBuilder().setName('expedition').setDescription('Run offline resource expeditions')
    .addSubcommand((sub) => sub.setName('start').setDescription('Begin an offline expedition')
      .addStringOption((option) => option.setName('mission').setDescription('Mission').setRequired(true).addChoices(
        { name: 'Foraging Run (1h)', value: 'forage' }, { name: 'Ruined Convoy (4h)', value: 'salvage' }, { name: 'Frontier Survey (8h)', value: 'survey' }, { name: 'Relic Hunt (12h)', value: 'relic_hunt' }))
      .addStringOption((option) => option.setName('stance').setDescription('Risk and reward stance').addChoices(
        { name: 'Balanced', value: 'balanced' }, { name: 'Cautious', value: 'cautious' }, { name: 'Aggressive', value: 'aggressive' }, { name: 'Scavenging', value: 'scavenging' })))
    .addSubcommand((sub) => sub.setName('status').setDescription('Check your expedition'))
    .addSubcommand((sub) => sub.setName('claim').setDescription('Claim a completed expedition')),
  new SlashCommandBuilder().setName('pantheon').setDescription('View gods or pledge to one for the season')
    .addStringOption((option) => option.setName('god').setDescription('God to pledge to').addChoices(
      ...['zeus','athena','ares','artemis','poseidon','hades','hermes','hephaestus','apollo','demeter'].map((value) => ({ name: value[0].toUpperCase() + value.slice(1), value })))),
  new SlashCommandBuilder().setName('guild').setDescription('Create, join, develop, and chat with a guild')
    .addSubcommand((sub) => sub.setName('view').setDescription('View your guild hall'))
    .addSubcommand((sub) => sub.setName('list').setDescription('List guilds'))
    .addSubcommand((sub) => sub.setName('create').setDescription('Create a guild').addStringOption((option) => option.setName('name').setDescription('Guild name').setRequired(true).setMinLength(2).setMaxLength(30)))
    .addSubcommand((sub) => sub.setName('join').setDescription('Join a guild').addStringOption((option) => option.setName('id').setDescription('Guild ID from /guild list').setRequired(true)))
    .addSubcommand((sub) => sub.setName('donate').setDescription('Donate expedition resources').addStringOption((option) => option.setName('resource').setDescription('Resource').setRequired(true).addChoices(...['wood','ore','food','crystal','relic'].map((value) => ({ name: value, value })))).addIntegerOption((option) => option.setName('amount').setDescription('Amount').setRequired(true).setMinValue(1)))
    .addSubcommand((sub) => sub.setName('upgrade').setDescription('Upgrade a hall station').addStringOption((option) => option.setName('station').setDescription('Station').setRequired(true).addChoices(...['forge','workshop','infirmary','command','shrine'].map((value) => ({ name: value, value })))))
    .addSubcommand((sub) => sub.setName('collect').setDescription('Collect daily resources from controlled territories'))
    .addSubcommand((sub) => sub.setName('chat').setDescription('Post to the persistent guild chat').addStringOption((option) => option.setName('message').setDescription('Message').setRequired(true).setMaxLength(300))),
  new SlashCommandBuilder().setName('guildmap').setDescription('View or contest the guild territory map')
    .addStringOption((option) => option.setName('attack').setDescription('Territory ID to attack')),
  new SlashCommandBuilder().setName('worldboss').setDescription('View or attack the server-wide world boss')
    .addBooleanOption((option) => option.setName('attack').setDescription('Spend your raid action attacking the boss')),
  new SlashCommandBuilder().setName('idle').setDescription('Manage automatic offline floor combat')
    .addSubcommand((sub) => sub.setName('start').setDescription('Start fighting your current floor offline'))
    .addSubcommand((sub) => sub.setName('status').setDescription('Check elapsed idle-combat time'))
    .addSubcommand((sub) => sub.setName('claim').setDescription('Claim up to 12 hours of idle combat')),
  new SlashCommandBuilder().setName('ability').setDescription('View abilities or choose your preferred automatic ability')
    .addSubcommand((sub) => sub.setName('list').setDescription('View class abilities and mana'))
    .addSubcommand((sub) => sub.setName('set').setDescription('Choose the preferred battle and idle-combat ability')
      .addStringOption((option) => option.setName('ability').setDescription('Ability').setRequired(true).addChoices(
        ...Object.values(ABILITIES).flat().map((ability) => ({ name: ability.name, value: ability.id }))))),
  new SlashCommandBuilder().setName('items').setDescription('Lock, salvage, and configure dropped items')
    .addSubcommand((sub) => sub.setName('manage').setDescription('Open the interactive item-management panel'))
    .addSubcommand((sub) => sub.setName('lock').setDescription('Lock or unlock an inventory item')
      .addIntegerOption((option) => option.setName('slot').setDescription('Inventory slot').setRequired(true).setMinValue(1).setMaxValue(10000)))
    .addSubcommand((sub) => sub.setName('salvage').setDescription('Salvage all unlocked, unequipped items through a rarity')
      .addStringOption((option) => option.setName('rarity').setDescription('Maximum rarity').setRequired(true).addChoices(
        ...['common','uncommon','rare','epic','legendary','mythic','secret'].map((value) => ({ name: value, value })))))
    .addSubcommand((sub) => sub.setName('auto').setDescription('Configure automatic salvage for new drops')
      .addBooleanOption((option) => option.setName('enabled').setDescription('Enable auto-salvage').setRequired(true))
      .addStringOption((option) => option.setName('rarity').setDescription('Maximum rarity').setRequired(true).addChoices(
        ...['common','uncommon','rare','epic'].map((value) => ({ name: value, value }))))),
  new SlashCommandBuilder().setName('craft').setDescription('Craft and improve equipment with dust')
    .addSubcommand((sub) => sub.setName('menu').setDescription('Open the interactive crafting and refinement wizard'))
    .addSubcommand((sub) => sub.setName('create').setDescription('Craft themed equipment from salvaged materials')
      .addStringOption((option) => option.setName('type').setDescription('Equipment type').setRequired(true).addChoices({ name: 'Weapon', value: 'weapon' }, { name: 'Armor', value: 'armor' }))
      .addStringOption((option) => option.setName('theme').setDescription('Crafting theme').setRequired(true).addChoices(
        { name: 'Olympian', value: 'olympian' }, { name: 'Wild Hunt', value: 'wild' }, { name: 'Chthonic', value: 'chthonic' }, { name: 'Hephaestian Masterwork', value: 'forge' }))
      .addStringOption((option) => option.setName('grade').setDescription('Target grade').setRequired(true).addChoices(
        ...['f','c','b','a','s','ss','sss'].map((value) => ({ name: value.toUpperCase(), value })))))
    .addSubcommand((sub) => sub.setName('upgrade').setDescription('Upgrade an item up to +20')
      .addIntegerOption((option) => option.setName('slot').setDescription('Inventory slot').setRequired(true).setMinValue(1).setMaxValue(10000)))
    .addSubcommand((sub) => sub.setName('reroll').setDescription('Reroll one equipment stat grade and percentage')
      .addIntegerOption((option) => option.setName('slot').setDescription('Inventory slot').setRequired(true).setMinValue(1).setMaxValue(10000))
      .addStringOption((option) => option.setName('stat').setDescription('Stat name shown on the item').setRequired(true).addChoices(
        ...['attack','defense','hp','strength','agility','luck','intelligence','mana'].map((value) => ({ name: value, value })))))
    .addSubcommand((sub) => sub.setName('trait').setDescription('Reroll one item trait using crafting materials')
      .addIntegerOption((option) => option.setName('slot').setDescription('Inventory slot').setRequired(true).setMinValue(1).setMaxValue(10000))
      .addIntegerOption((option) => option.setName('trait_slot').setDescription('Trait position shown on the item').setRequired(true).setMinValue(1).setMaxValue(3)))
    .addSubcommand((sub) => sub.setName('refine').setDescription('Improve one equipment stat grade by one tier')
      .addIntegerOption((option) => option.setName('slot').setDescription('Inventory slot').setRequired(true).setMinValue(1).setMaxValue(10000))
      .addStringOption((option) => option.setName('stat').setDescription('Stat to improve').setRequired(true).addChoices(
        ...['attack','defense','hp','strength','agility','luck','intelligence','mana'].map((value) => ({ name: value, value }))))),
  new SlashCommandBuilder().setName('contracts').setDescription('View and claim rotating daily and weekly contracts')
    .addSubcommand((sub) => sub.setName('view').setDescription('View active contracts and reset times'))
    .addSubcommand((sub) => sub.setName('claim').setDescription('Claim a completed contract')
      .addStringOption((option) => option.setName('contract').setDescription('Contract ID shown by /contracts view').setRequired(true))),
  new SlashCommandBuilder().setName('raid').setDescription('Choose a raid role and coordinate against the world boss')
    .addSubcommand((sub) => sub.setName('view').setDescription('View roles, preparation, and contributions'))
    .addSubcommand((sub) => sub.setName('role').setDescription('Choose your persistent raid role')
      .addStringOption((option) => option.setName('role').setDescription('Raid role').setRequired(true).addChoices(
        { name: 'Vanguard — protection', value: 'vanguard' }, { name: 'Healer — recovery', value: 'healer' },
        { name: 'Scout — intelligence', value: 'scout' }, { name: 'Saboteur — armor break', value: 'saboteur' },
        { name: 'Quartermaster — supplies', value: 'quartermaster' }, { name: 'Striker — damage', value: 'striker' })))
    .addSubcommand((sub) => sub.setName('act').setDescription('Spend your hourly action performing your raid role')),
  new SlashCommandBuilder().setName('quests').setDescription('View or claim daily quests')
    .addSubcommand((sub) => sub.setName('view').setDescription('View daily quest progress'))
    .addSubcommand((sub) => sub.setName('claim').setDescription('Claim a completed quest')
      .addStringOption((option) => option.setName('quest').setDescription('Quest').setRequired(true).addChoices(...QUESTS.map((quest) => ({ name: quest.name, value: quest.id }))))),
  new SlashCommandBuilder().setName('achievements').setDescription('View or claim permanent achievements')
    .addSubcommand((sub) => sub.setName('view').setDescription('View achievement progress'))
    .addSubcommand((sub) => sub.setName('claim').setDescription('Claim a completed achievement')
      .addStringOption((option) => option.setName('achievement').setDescription('Achievement').setRequired(true).addChoices(...ACHIEVEMENTS.map((entry) => ({ name: entry.name, value: entry.id }))))),
  new SlashCommandBuilder().setName('ascend').setDescription('Preview and confirm ascension at level 1000'),
  new SlashCommandBuilder().setName('dungeon').setDescription('Run daily combat challenges')
    .addSubcommand((sub) => sub.setName('list').setDescription('View dungeons and attempts'))
    .addSubcommand((sub) => sub.setName('run').setDescription('Spend an attempt entering a dungeon')
      .addStringOption((option) => option.setName('dungeon').setDescription('Dungeon').setRequired(true).addChoices(...Object.entries(DUNGEONS).map(([value, dungeon]) => ({ name: dungeon.name, value }))))),
  new SlashCommandBuilder().setName('tower').setDescription('View or challenge the endless tower')
    .addSubcommand((sub) => sub.setName('view').setDescription('View your next tower floor'))
    .addSubcommand((sub) => sub.setName('challenge').setDescription('Attempt the next tower floor')),
  new SlashCommandBuilder().setName('admin').setDescription('Owner and admin-role character controls')
    .addSubcommand((sub) => sub.setName('make-equipment').setDescription('Forge equipment for a player\'s active character')
      .addUserOption((option) => option.setName('player').setDescription('Target player').setRequired(true))
      .addStringOption((option) => option.setName('name').setDescription('Custom item name').setMaxLength(60)))
    .addSubcommand((sub) => sub.setName('add-stats').setDescription('Add a raw stat amount to an active character')
      .addUserOption((option) => option.setName('player').setDescription('Target player').setRequired(true))
      .addStringOption((option) => option.setName('stat').setDescription('Stat to add').setRequired(true).addChoices(
        ...Object.entries(STATS).map(([value, stat]) => ({ name: stat.name, value }))))
      .addIntegerOption((option) => option.setName('amount').setDescription('Amount to add').setRequired(true).setMinValue(1).setMaxValue(1000000)))
    .addSubcommand((sub) => sub.setName('add-ascensions').setDescription('Add ascensions and permanent ascension points')
      .addUserOption((option) => option.setName('player').setDescription('Target player').setRequired(true))
      .addIntegerOption((option) => option.setName('amount').setDescription('Ascensions to add').setRequired(true).setMinValue(1).setMaxValue(10000)))
    .addSubcommand((sub) => sub.setName('guild-join').setDescription('Move all of a player\'s character slots into a guild')
      .addUserOption((option) => option.setName('player').setDescription('Target player').setRequired(true))
      .addStringOption((option) => option.setName('guild_id').setDescription('Guild ID from /guild list').setRequired(true)))
    .addSubcommand((sub) => sub.setName('set-level').setDescription('Set an active character level')
      .addUserOption((option) => option.setName('player').setDescription('Target player').setRequired(true))
      .addIntegerOption((option) => option.setName('level').setDescription('Level 1–1000').setRequired(true).setMinValue(1).setMaxValue(1000)))
    .addSubcommand((sub) => sub.setName('give-gold').setDescription('Give gold to an active character')
      .addUserOption((option) => option.setName('player').setDescription('Target player').setRequired(true))
      .addIntegerOption((option) => option.setName('amount').setDescription('Gold amount').setRequired(true).setMinValue(1).setMaxValue(100000000)))
    .addSubcommand((sub) => sub.setName('give-xp').setDescription('Give XP to an active character')
      .addUserOption((option) => option.setName('player').setDescription('Target player').setRequired(true))
      .addIntegerOption((option) => option.setName('amount').setDescription('XP amount').setRequired(true).setMinValue(1).setMaxValue(100000000)))
    .addSubcommand((sub) => sub.setName('heal').setDescription('Fully heal an active character')
      .addUserOption((option) => option.setName('player').setDescription('Target player').setRequired(true))),
  new SlashCommandBuilder().setName('rpghelp').setDescription('Learn how to play'),
];

module.exports = { commands, commandData: commands.map((command) => command.toJSON()) };
