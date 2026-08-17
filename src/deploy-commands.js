require('dotenv').config();
const { REST, Routes } = require('discord.js');
const { commandData } = require('./commands');

const { DISCORD_TOKEN, CLIENT_ID, GUILD_ID } = process.env;
if (!DISCORD_TOKEN || !CLIENT_ID) {
  console.error('DISCORD_TOKEN and CLIENT_ID are required in .env');
  process.exit(1);
}

const route = GUILD_ID
  ? Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID)
  : Routes.applicationCommands(CLIENT_ID);

new REST({ version: '10' }).setToken(DISCORD_TOKEN).put(route, { body: commandData })
  .then(() => console.log(`Deployed ${commandData.length} ${GUILD_ID ? 'guild' : 'global'} commands.`))
  .catch((error) => { console.error(error); process.exitCode = 1; });
