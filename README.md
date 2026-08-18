# Discord RPG Bot

A persistent RPG built with Node.js and discord.js. Players create heroes, fight monsters through interactive buttons, level up, collect gold, buy equipment, and compete on a server-wide leaderboard.

## Features

- Warrior, Rogue, and Mage classes with different starting stats
- Interactive turn-based combat: attack, defend, drink a potion, or flee
- Persistent JSON character storage with atomic writes
- Five worlds with ten floors each, floor bosses, unlocks, and revisitable cleared floors
- Guaranteed mob weapon/armor drops in Common, Uncommon, Rare, Epic, Legendary, Mythic, and Secret tiers
- XP, levels, stat growth, gold, equippable loot, and win/loss records
- Daily rewards, item shop, healing inn, profiles, and leaderboard
- Guild command deployment for instant development updates or global deployment for production

## Requirements

- Node.js 20 or newer
- A Discord application and bot from the [Discord Developer Portal](https://discord.com/developers/applications)

## Setup

1. Install packages with `npm install`.
2. Copy `.env.example` to `.env` and add your values:

   ```env
   DISCORD_TOKEN=your_bot_token
   CLIENT_ID=your_application_id
   GUILD_ID=your_test_server_id
   ```

   `GUILD_ID` is optional, but recommended during development because guild commands update immediately. Never commit `.env` or share your bot token.

3. On the Developer Portal's **Installation** page, install the bot to your server with the `bot` and `applications.commands` scopes. It only needs permission to view channels, send messages, embed links, and use external emoji.
4. Register slash commands and start the bot:

   ```bash
   npm run deploy
   npm start
   ```

## Commands

| Command | Purpose |
| --- | --- |
| `/start` | Create a named Warrior, Rogue, or Mage |
| `/profile` | View your character or another player's character |
| `/adventure` | Start an interactive monster battle |
| `/daily` | Claim gold and a potion every 20 hours |
| `/heal` | Pay the inn to restore all health |
| `/shop` | Browse available items |
| `/buy` | Purchase a potion or permanent equipment |
| `/leaderboard` | View the top ten heroes |
| `/worlds` | View world unlocks and current floor progress |
| `/travel` | Return to any world and floor you have reached |
| `/inventory` | Inspect dropped weapons and armor |
| `/equip` | Equip loot by its inventory slot |
| `/rpghelp` | Show an in-Discord command guide |

Character data is created at `data/characters.json`. Back up that file before redeploying or moving the bot. For a large public bot, replace the JSON store with PostgreSQL or another transactional database.

## Development

```bash
npm run dev
npm test
```

Game balance and content live in `src/content.js`. Pure mechanics live in `src/game.js`, Discord event handling is in `src/index.js`, and persistence is isolated in `src/store.js`.
