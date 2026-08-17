# Discord RPG Bot

A persistent RPG built with Node.js and discord.js. Players create heroes, fight monsters through interactive buttons, level up, collect gold, buy equipment, and compete on a server-wide leaderboard.

## Features

- Warrior, Rogue, and Mage classes with different starting stats
- Three character slots per Discord user with active-character switching
- Owner-only Admin class with boosted stats, locked to one configured Discord user ID
- Strength, HP, Defense, Agility, Luck, Intelligence, and Mana with seven spendable points per level
- Every class starts with 100 HP; defense uses a diminishing effective-HP curve that approaches, but never exceeds, 5×
- Level cap of 1000
- Protected `/admin` controls available to the configured owner ID or admin role
- Private Confirm/Cancel buttons explain irreversible ascension, bulk-salvage, stat rerolls, and admin changes before anything is saved
- Up to 12 hours of offline floor combat with capped drop storage and auto-salvage support
- Mana-powered class abilities selectable every battle turn, with a preferred ability for automatic combat builds
- Protected multi-material salvaging, themed crafting, +20 upgrades, trait rerolls, and stat-grade refinement
- Three rotating daily and four rotating weekly contracts across every major game system
- Six coordinated raid roles with phase preparation, non-damage contributions, and bounded boss damage
- Daily quests, permanent achievements, and level-1000 ascension bonuses
- Three daily dungeons and a progressively scaling endless tower
- Interactive turn-based combat: attack, defend, drink a potion, choose a class ability, or flee
- Transactional JSON character/world storage with atomic writes, rollback, and recovery after a failed save
- Five worlds with ten floors each, floor bosses, unlocks, and revisitable cleared floors
- Guaranteed mob weapon/armor drops in Common, Uncommon, Rare, Epic, Legendary, Mythic, and Secret tiers, all following one continuous world/floor/item-level budget
- Independent equipment rarity (Common–Secret) and per-stat grade rolls: rarity adds a bounded 1.00×–1.60× budget, while F 5–7.4%, C 7.5–9.9%, B 10–12.4%, A 12.5–14.9%, S 15–17.4%, SS 17.5–19.9%, SSS 20–22.4%, and Z 22.5–25% determine each stat roll
- Base stat-grade chances decrease at every tier: F 45%, C 27%, B 15%, A 7%, S 3.5%, SS 1.5%, SSS 0.9%, and Z 0.1%
- Loot Luck applies a diminishing, bounded bias to item rarity. Every 200 total Loot Luck also adds a 1% chance for each random equipment stat to rise one grade tier, capped at 5% at 1,000 Luck
- Owner-scoped, ephemeral select-menu panels across character switching, shops, travel, gods, guilds, crafting, contracts, raids, challenges, and help
- Paginated weapon, armor, guild, crafting, achievement, and item-management menus that safely exceed Discord's 25-option limit
- XP, levels, stat growth, gold, equippable loot, and win/loss records
- Daily rewards, item shop, healing inn, profiles, and leaderboard
- Guild command deployment for instant development updates or global deployment for production
- Class mastery earned through combat, expeditions, guild work, territory wars, and raids; advanced classes unlock at exactly 75 mastery
- Trait-bearing equipment that affects combat, expeditions, guild construction, territory defense, and boss raids
- Offline expeditions with four durations and risk/reward stances
- Ten Greek gods with favour-scaled attribute bonuses, Divine Luck, and server-wide faction scores
- Intelligence as a full allocatable stat that powers Mage attacks and improves favour gain
- Persistent guilds with resources, influence, chat, and upgradeable Forge, Workshop, Infirmary, Command Room, and Shrine
- Guild progression through level 500 with a diminishing reward curve capped at +25% XP and +15% gold
- A connected five-territory guild-war map with adjacency, defense, conquest, and resource production
- Multi-phase server-wide world bosses with personal contributions, guild influence, mastery, and faction progress

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
   ADMIN_USER_ID=your_discord_user_id
   ADMIN_ROLE_ID=your_admin_role_id
   ```

   `GUILD_ID` is optional, but recommended during development because guild commands update immediately. To find user and role IDs, enable Discord Developer Mode and right-click the account or role. Only `ADMIN_USER_ID` can create the Admin character class; that owner and members of `ADMIN_ROLE_ID` may use `/admin`. Never commit `.env` or share your bot token.

3. On the Developer Portal's **Installation** page, install the bot to your server with the `bot` and `applications.commands` scopes. It only needs permission to view channels, send messages, embed links, and use external emoji.
4. Register slash commands and start the bot:

   ```bash
   npm run deploy
   npm start
   ```

   If PowerShell blocks `npm.ps1`, use `npm.cmd run deploy` and `npm.cmd start` instead.

## Commands

| Command | Purpose |
| --- | --- |
| `/start` | Create a named Warrior, Rogue, Mage, or owner-only Admin |
| `/characters` | View your three slots and switch the active character from a select menu |
| `/switch` | Change the active character used by commands |
| `/profile` | View your character or another player's character |
| `/stats view` | View combat totals and allocate +1/+5/+10 through an interactive stat menu |
| `/stats allocate` | Spend points on Strength, HP, Defense, Agility, Luck, Intelligence, or Mana |
| `/adventure` | Start an interactive battle with action buttons and a class-ability menu |
| `/daily` | Claim gold and a potion every 20 hours |
| `/heal` | Pay the inn to restore all health |
| `/shop` | Preview and buy available items from an interactive shop menu |
| `/buy` | Purchase a potion or permanent equipment |
| `/leaderboard` | View the top ten heroes |
| `/worlds` | View unlocks and travel through linked world and floor menus |
| `/travel` | Return to any world and floor you have reached |
| `/mastery` | View mastery and confirm an advanced class from a class-specific menu after reaching 75 |
| `/expedition` | Start, inspect, or claim an offline expedition |
| `/pantheon` | Preview gods and confirm a seasonal pledge from a menu |
| `/guild` | Create/join guilds, browse a paginated registry, upgrade the hall, collect resources, donate, and chat |
| `/guildmap` | View territories and select an adjacent target for a guild assault |
| `/worldboss` | View, refresh, or attack the server-wide boss with buttons |
| `/raid` | Select a raid role and perform or refresh coordinated actions from the raid panel |
| `/inventory` | Inspect and equip every loot item using paginated dropdowns |
| `/equip` | Equip loot by its inventory slot |
| `/rpghelp` | Browse every command category from an in-Discord help menu |
| `/admin` | Add stats/ascensions, move account-wide guild membership, forge equipment, set levels, grant XP/gold, or heal (authorized users only) |
| `/idle` | Start, inspect, or claim offline combat directly or from its status panel |
| `/ability` | View abilities and select the preferred battle/idle ability |
| `/items manage` | Interactively lock gear, confirm bulk salvage, and configure auto-salvage |
| `/craft menu` | Open the full create/upgrade/trait/stat/refinement wizard with previews and an Apply gate |
| `/contracts view` | Track and claim completed daily or weekly contracts from the board |
| `/quests view` | View objectives and select completed rewards to claim |
| `/achievements view` | View milestones and select completed rewards to claim |
| `/ascend` | Reset level/world progress at level 1000 for permanent power |
| `/dungeon list` | View requirements and select a daily dungeon to enter |
| `/tower view` | View and challenge the next endless-tower floor from one panel |

### Extended progression rules

- The campaign is one continuous 50-stage curve: a regular enemy budget rises 6.25% per floor without dropping at world boundaries. Floor 10 bosses have 2.5× HP and 1.75× attack, with matching bounded reward spikes.
- Enemies track the active character from level 1 through 1000. Scaling is flat through level 50, then linear up to 20× at level 1000; XP and gold use slower sub-linear level curves so high-level farming stays useful without exploding the economy.
- Natural item power is `12 + 2.4 × stage + 0.32 × effective item level`, followed by the 1.00×–1.60× rarity factor and a hard 750 budget cap. Effective item level cannot exceed `stage × 20`, so a level-1000 character cannot farm endgame gear on World 1.
- Weapon and armor stats share that budget with explicit weights: attack/defense 1.00×, strength/intelligence 0.55×, agility/luck 0.35×, HP 4.00×, and mana 2.00×. Upgrades are recalculated from the original roll at +2% per rank, exactly +40% at +20, rather than compounding.
- Existing equipment is migrated as an idempotent legacy snapshot: its current strength is preserved, while later upgrades use the new bounded +2% steps. Admin-forged gear has an explicit exempt power model and cannot enter normal salvage, upgrade, or reroll paths.
- Defense uses `1 + defense / (100 + defense / 4)` for its effective-HP multiplier. Ascension combat power approaches a 2× cap and reward gain approaches a 1.5× cap, preventing either system from invalidating future worlds.
- Idle combat resolves one battle per minute for at most 12 hours and stores at most 25 item drops per claim.
- Auto-salvage applies to newly earned adventure and idle drops at or below the configured rarity.
- Salvaging never removes locked, equipped, or admin-created items. It yields bounded dust, metal/hide, essence, and relic shards.
- Themed crafting supports Olympian, Wild Hunt, Chthonic, and Hephaestian equipment through SSS. Z remains drop/admin-only. Trait rerolls cannot create duplicate traits, and grade refinement caps at SSS.
- Contracts reset daily at 00:00 UTC and weekly each Monday at 00:00 UTC. Claims are single-use and reward at least two connected progression systems.
- Raid preparation is phase-specific: protection and healing improve survivability, intel/armor break/supplies raise shared damage or loot, and all roles receive contribution credit.
- Class abilities consume mana and have turn cooldowns. Interactive battles expose every available class ability in a dropdown; the preferred ability is preselected and contributes to idle-combat strength.
- Interactive panels are private to their owner, re-read live character/world state before saving, and expire after two minutes. Direct slash subcommands remain available for experienced players.
- Daily quests reset on the UTC date boundary. Dungeon attempts reset to three on the same boundary.
- Ascension requires level 1000. Its confirmation explains the reset before saving. It resets level, XP, player-allocated stats, and world/floor progress, while preserving admin-granted stats, equipment and shop bonuses, specialization/mastery, materials, gods, guild membership, achievements, tower progress, and permanent ascension points.
- Admin character changes target the player's active character when the command opens. A later slot switch does not redirect the change or switch that player back. Forced guild membership is account-wide across all three slots.

Character data is created at `data/characters.json`. Back up that file before redeploying or moving the bot. For a large public bot, replace the JSON store with PostgreSQL or another transactional database.

## Development

```bash
npm run dev
npm test
npm run balance
```

Game content lives in `src/content.js`; the guarded combat and equipment curves live in `src/systems/combat-scaling.js` and `src/systems/item-power.js`. Pure mechanics live in `src/game.js` and `src/systems.js`; interactive controllers live in `src/features/`; Discord presentation lives in `src/ui/`; shared helpers live in `src/core/`; and persistence is isolated in the character and world stores. Run `npm run balance` after changing any progression constant. See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the extension pattern.
