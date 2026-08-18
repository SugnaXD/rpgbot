# RPG Bot Architecture

The codebase is organized by responsibility so new game systems do not accumulate in the Discord entry point.

## Directories

- `src/core/` — cross-cutting authorization and formatting helpers
- `src/features/` — interactive gameplay controllers such as adventures and inventory
- `src/systems/` — focused rule modules for abilities, idle combat, item economy, progression, challenges, and the versioned combat/item scaling kernels
- `src/content/` — focused data modules for abilities, quests, achievements, and dungeons
- `src/ui/` — Discord embeds, buttons, and select-menu builders
- `src/game.js` — pure character, combat, loot, stat, and progression rules
- `src/systems.js` — persistent-world rules for mastery, factions, guilds, territory, and raids
- `src/content.js` — declarative balance data and game content
- `src/store.js` — character persistence
- `src/world-store.js` — shared world persistence
- `src/commands.js` — slash-command schemas
- `src/index.js` — client startup and command routing

## Adding a feature

1. Put static names and tiers in `content.js`; progression formulas belong in `systems/combat-scaling.js` or `systems/item-power.js` so the simulator can guard them.
2. Put other deterministic rules in `game.js` or `systems.js` and export them for tests.
3. Put Discord presentation builders under `ui/`.
4. Put collectors and interaction workflows under `features/`.
5. Keep persistence behind the relevant store and pass stores into feature handlers.
6. Add pure-rule tests under `test/` before wiring the command route.

Run both `npm test` and `npm run balance` after changing combat, level, rarity, grade, equipment, defense, or ascension math.

Feature modules should not create their own Discord clients or load `.env`; the entry point owns process startup and injects required state.
