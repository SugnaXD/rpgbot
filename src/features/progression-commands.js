const { randomBytes } = require('node:crypto');
const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, MessageFlags } = require('discord.js');
const { RARITIES, GRADES, ITEM_TRAITS } = require('../content');
const { DUNGEONS } = require('../content/progression');
const { normalizeAbilities, availableAbilities } = require('../systems/abilities');
const { normalizeIdle, startIdle, claimIdle, MAX_IDLE_MS, BATTLE_INTERVAL_MS } = require('../systems/idle-combat');
const { normalizeItemEconomy, toggleItemLock, salvageItems, salvageByRarity, configureAutoSalvage, upgradeItem } = require('../systems/items');
const {
  CRAFTABLE_GRADES,
  CRAFTING_THEMES,
  canAfford,
  getCraftCost,
  getStatGradeImprovementCost,
  getTraitRerollCost,
  improveItemStatGrade,
  nextImprovementGrade,
  rerollItemStatGrade,
  rerollItemTrait,
  craftThemedItem,
} = require('./crafting-system');
const { progressContract } = require('./contracts-system');
const { normalizeProgression, questStatus, claimQuest, achievementStatus, claimAchievement, ascend } = require('../systems/progression');
const { normalizeChallenges, combatRating, runDungeon, challengeTower } = require('../systems/challenges');
const { itemStatsText, lootLuck } = require('../game');
const { isAdminItem } = require('../systems/item-power');
const { ascensionPowerMultiplier, ascensionRewardMultiplier } = require('../systems/combat-scaling');
const { duration } = require('../core/format');
const { requestConfirmation } = require('../ui/confirmation');
const { buildPagedStringSelect, createMenuCustomIdCodec } = require('../ui/select-menus');

const COLOR = 0x7c3aed;
const COMMANDS = new Set(['idle', 'ability', 'items', 'craft', 'quests', 'achievements', 'ascend', 'dungeon', 'tower']);
const materialsText = (materials = {}) => Object.entries(materials)
  .filter(([, value]) => value > 0)
  .map(([name, value]) => `**${value} ${name}**`)
  .join(', ') || '**no materials**';
const sameMaterials = (left = {}, right = {}) => [...new Set([...Object.keys(left), ...Object.keys(right)])]
  .every((key) => (left[key] || 0) === (right[key] || 0));

function userFacingError(message) {
  const error = new Error(message);
  error.userMessage = message;
  return error;
}

async function mutateActiveCharacter(store, userId, characterId, mutator) {
  if (typeof store.transaction === 'function') {
    return store.transaction((characters) => {
      const profile = characters.get(userId);
      const working = profile?.characters.find((entry) => entry.characterId === characterId);
      if (!working || profile.activeId !== characterId) throw userFacingError('Your active character changed while this prompt was open, so nothing was changed.');
      return mutator(working);
    });
  }
  const live = store.get(userId);
  if (!live || live.characterId !== characterId) throw userFacingError('Your active character changed while this prompt was open, so nothing was changed.');
  const working = structuredClone(live);
  const result = await mutator(working);
  await store.update(userId, working);
  return result;
}

function responsePayload(view, content) {
  const payload = { embeds: view.embeds || [], components: view.components || [] };
  if (content) payload.content = content;
  return payload;
}

function actionButton(codec, { scope, action, userId, label, emoji, style = ButtonStyle.Primary, disabled = false }) {
  return new ActionRowBuilder().addComponents(new ButtonBuilder()
    .setCustomId(codec.encode({ scope, action, kind: 'button', context: userId }))
    .setLabel(label).setEmoji(emoji).setStyle(style).setDisabled(disabled));
}

function abilityView(character, page, disabled, codec, userId) {
  const abilities = availableAbilities(character);
  const menu = buildPagedStringSelect({
    scope: 'ability', action: 'choose', context: userId, page, disabled, codec,
    placeholder: 'Choose your automatic ability', emptyLabel: 'No abilities available',
    options: abilities.map((ability) => ({
      label: ability.name,
      description: `${ability.mana} mana • ${ability.cooldown} turn cooldown • ${ability.description}`,
      value: ability.id,
      default: character.autoAbility === ability.id,
    })),
  });
  return {
    embeds: [new EmbedBuilder().setColor(COLOR).setTitle(`💧 ${character.name} — ${character.mana}/${character.maxMana} Mana`)
      .setDescription(abilities.map((ability) => `**${ability.name}** — ${ability.mana} mana • ${ability.cooldown} turn cooldown\n${ability.description}${character.autoAbility === ability.id ? ' • *Selected*' : ''}`).join('\n\n') || '*No abilities are available for this class.*')
      .setFooter({ text: 'Choose an ability below for idle combat; interactive battles let you select any available ability each turn.' })],
    components: menu.rows, page: menu.page,
  };
}

function questView(character, page, disabled, codec, userId) {
  const quests = questStatus(character);
  const claimable = quests.filter((quest) => !quest.claimed && quest.progress >= quest.goal);
  const menu = buildPagedStringSelect({
    scope: 'quests', action: 'claim', context: userId, page, disabled, codec,
    placeholder: 'Claim a completed daily quest', emptyLabel: 'No completed quests to claim',
    options: claimable.map((quest) => ({
      label: quest.name, value: quest.id, emoji: '🎁',
      description: `${quest.reward.gold} gold • ${quest.reward.dust} dust`,
    })),
  });
  return {
    embeds: [new EmbedBuilder().setColor(COLOR).setTitle('📜 Daily Quests').setDescription(quests.map((quest) => `${quest.claimed ? '✅' : quest.progress >= quest.goal ? '🎁' : '▫️'} **${quest.name}** — ${quest.progress}/${quest.goal}\n${quest.reward.gold} gold • ${quest.reward.dust} dust`).join('\n\n'))
      .setFooter({ text: claimable.length ? 'Completed rewards can be claimed below.' : 'Complete a quest to unlock its claim option.' })],
    components: menu.rows, page: menu.page,
  };
}

function achievementView(character, page, disabled, codec, userId) {
  const achievements = achievementStatus(character);
  const claimable = achievements.filter((entry) => !entry.claimed && entry.progress >= entry.goal);
  const menu = buildPagedStringSelect({
    scope: 'achievements', action: 'claim', context: userId, page, disabled, codec,
    placeholder: 'Claim a completed achievement', emptyLabel: 'No completed achievements to claim',
    options: claimable.map((entry) => ({
      label: entry.name, value: entry.id, emoji: '🏆',
      description: `${entry.progress}/${entry.goal} • ${entry.points} achievement points`,
    })),
  });
  return {
    embeds: [new EmbedBuilder().setColor(0xeab308).setTitle(`🏆 Achievements — ${character.achievementPoints} points`)
      .setDescription(achievements.map((entry) => `${entry.claimed ? '✅' : entry.progress >= entry.goal ? '🎁' : '▫️'} **${entry.name}** — ${entry.progress}/${entry.goal} • ${entry.points} points`).join('\n'))
      .setFooter({ text: claimable.length ? 'Claim completed achievements below.' : 'Your next completed achievement will appear in the menu.' })],
    components: menu.rows, page: menu.page,
  };
}

function dungeonView(character, page, disabled, codec, userId) {
  normalizeChallenges(character);
  const dungeons = Object.entries(DUNGEONS);
  const menu = buildPagedStringSelect({
    scope: 'dungeon', action: 'run', context: userId, page, disabled, codec,
    placeholder: 'Choose a dungeon to enter', emptyLabel: 'No dungeon attempts remain',
    options: character.dungeons.attempts ? dungeons.map(([id, dungeon]) => ({
      label: dungeon.name, value: id, emoji: dungeon.emoji,
      description: `Rating ${dungeon.requirement} • ${dungeon.gold} gold • ${dungeon.dust} dust`,
    })) : [],
  });
  return {
    embeds: [new EmbedBuilder().setColor(COLOR).setTitle(`🏰 Dungeons — ${character.dungeons.attempts}/3 attempts`)
      .setDescription(dungeons.map(([id, dungeon]) => `${dungeon.emoji} **${dungeon.name}** (${id})\nRating ${dungeon.requirement} • ${dungeon.gold} gold • ${dungeon.dust} dust`).join('\n\n'))
      .setFooter({ text: `Your combat rating: ${combatRating(character)}` })],
    components: menu.rows, page: menu.page,
  };
}

function towerView(character, _page, disabled, codec, userId) {
  normalizeChallenges(character);
  return {
    embeds: [new EmbedBuilder().setColor(COLOR).setTitle('🗼 Endless Tower')
      .setDescription(`Highest floor: **${character.towerFloor}**\nCurrent combat rating: **${combatRating(character)}**.`)
      .setFooter({ text: 'Each victory unlocks a stronger floor. Failed challenges do not lower your record.' })],
    components: [actionButton(codec, {
      scope: 'tower', action: 'challenge', userId, label: `Challenge Floor ${character.towerFloor + 1}`,
      emoji: '⚔️', style: ButtonStyle.Danger, disabled,
    })],
    page: 0,
  };
}

function idleView(character, _page, disabled, codec, userId) {
  normalizeIdle(character);
  if (!character.idleCombat) return {
    embeds: [new EmbedBuilder().setColor(COLOR).setTitle('💤 Idle Combat').setDescription('Idle combat is not running. Start it on your current world and floor to accumulate up to 12 hours of battles.')],
    components: [actionButton(codec, {
      scope: 'idle', action: 'start', userId, label: 'Start Idle Combat', emoji: '▶️',
      style: ButtonStyle.Success, disabled,
    })],
    page: 0,
  };
  const elapsed = Math.min(MAX_IDLE_MS, Math.max(0, Date.now() - character.idleCombat.startedAt));
  const battleReady = elapsed >= BATTLE_INTERVAL_MS;
  return {
    embeds: [new EmbedBuilder().setColor(COLOR).setTitle('💤 Idle Combat')
      .setDescription(`**${duration(elapsed)}** accumulated in World ${character.idleCombat.world}, Floor ${character.idleCombat.floor}.`)
      .setFooter({ text: battleReady ? 'Claim your accumulated battles below.' : `The first battle completes in ${duration(BATTLE_INTERVAL_MS - elapsed)}.` })],
    components: [actionButton(codec, {
      scope: 'idle', action: 'claim', userId, label: battleReady ? 'Claim Idle Rewards' : 'Waiting for First Battle',
      emoji: '🎁', disabled: disabled || !battleReady,
    })],
    page: 0,
  };
}

function idleClaimText(result) {
  return `💤 Idle claim: **${result.victories} victories**, **${result.gold} gold**, **${result.xp} XP**, **${result.drops.length} kept drops**${result.salvaged ? `, and **${result.salvaged} auto-salvaged** for ${result.dust} dust` : ''}.`;
}

function dungeonResultText(result) {
  return result.won ? `${result.dungeon.emoji} Cleared **${result.dungeon.name}**: ${result.gold} gold and ${result.dust} dust.` : `💀 **${result.dungeon.name}** defeated you. Rating ${result.rating}/${result.dungeon.requirement}.`;
}

function towerResultText(result) {
  return result.won ? `🗼 Cleared floor **${result.floor}** and earned ${result.gold} gold.` : `💀 Tower floor **${result.floor}** held. Rating ${result.rating}/${result.requirement}.`;
}

const CRAFT_OPERATIONS = Object.freeze({
  create: { name: 'Create Equipment', description: 'Choose a type, theme, and target grade.' },
  upgrade: { name: 'Upgrade Item', description: 'Raise an item by one level, up to +20.' },
  trait: { name: 'Reroll Trait', description: 'Replace one existing trait with a random unused trait.' },
  reroll: { name: 'Reroll Stat', description: 'Randomize one stat grade and percentage.' },
  refine: { name: 'Refine Stat', description: 'Raise one stat grade by exactly one tier.' },
});
const ITEM_OPERATIONS = Object.freeze({
  lock: { name: 'Lock / Unlock', description: 'Protect an item from bulk salvage.' },
  salvage: { name: 'Bulk Salvage', description: 'Review and confirm salvage through a rarity.' },
  auto: { name: 'Auto-Salvage', description: 'Configure automatic salvage for future drops.' },
});
const AUTO_SALVAGE_RARITIES = Object.freeze(['common', 'uncommon', 'rare', 'epic']);

const newCraftState = () => ({ operation: null, type: null, themeId: null, grade: null, itemId: null, stat: null, traitIndex: null, itemPage: 0 });
const newItemState = () => ({ operation: null, itemId: null, rarity: null, enabled: null, itemPage: 0 });

function panelPayload(view, content = null) {
  return { embeds: view.embeds || [], components: view.components || [], content };
}

function costText(cost) {
  if (!cost) return '*Not available*';
  return Object.entries(cost).map(([material, amount]) => `**${amount} ${material}**`).join(' • ');
}

function affordabilityText(character, cost) {
  if (!cost) return 'Unavailable for this selection.';
  if (canAfford(character.materials, cost)) return '✅ You have the required materials.';
  const missing = Object.entries(cost)
    .map(([material, amount]) => [material, Math.max(0, amount - (character.materials?.[material] || 0))])
    .filter(([, amount]) => amount > 0);
  return `❌ Missing ${missing.map(([material, amount]) => `**${amount} ${material}**`).join(' • ')}.`;
}

function itemOption(character, item) {
  const slot = character.inventory.findIndex((entry) => entry.id === item.id) + 1;
  const rarity = RARITIES[item.rarity] || RARITIES.common;
  return {
    label: `#${slot} ${item.locked ? '🔒 ' : ''}${item.name}${item.upgradeLevel ? ` +${item.upgradeLevel}` : ''}`,
    description: `${rarity.name} • ${itemStatsText(item)}`,
    value: item.id,
  };
}

function validCraftItems(character, operation) {
  return (character.inventory || []).filter((item) => {
    if (!item?.id || !['weapon', 'armor'].includes(item.type) || item.unsupportedItemVersion) return false;
    if (isAdminItem(item)) return false;
    if (operation === 'upgrade') return (item.upgradeLevel || 0) < 20;
    if (operation === 'trait') return Array.isArray(item.traits) && item.traits.length
      && Object.keys(ITEM_TRAITS).some((trait) => !item.traits.includes(trait));
    if (operation === 'reroll') return Object.keys(item.stats || {}).length > 0;
    if (operation === 'refine') return Object.keys(item.stats || {}).some((stat) => nextImprovementGrade(item, stat));
    return false;
  });
}

function craftSelection(character, state) {
  if (!CRAFT_OPERATIONS[state.operation]) return { ready: false, summary: 'Choose a crafting operation to begin.' };
  if (state.operation === 'create') {
    if (!['weapon', 'armor'].includes(state.type) || !CRAFTING_THEMES[state.themeId] || !CRAFTABLE_GRADES.includes(state.grade)) {
      return { ready: false, summary: 'Choose an equipment type, theme, and target grade.' };
    }
    const cost = getCraftCost(state.type, state.grade);
    const template = CRAFTING_THEMES[state.themeId][state.type];
    return {
      ready: true, cost,
      summary: `Create **${template.name}** as a **${GRADES[state.grade].name}-grade ${state.type}**. Its exact stat percentages are rolled when applied.`,
    };
  }
  const item = validCraftItems(character, state.operation).find((entry) => entry.id === state.itemId);
  if (!item) return { ready: false, summary: 'Choose an eligible inventory item.' };
  if (state.operation === 'upgrade') {
    const cost = { dust: 25 * ((item.upgradeLevel || 0) + 1) };
    return { ready: true, item, cost, summary: `Upgrade **${item.name}** from **+${item.upgradeLevel || 0}** to **+${(item.upgradeLevel || 0) + 1}**. Every item stat gains 2% of its base roll (up to +40% at +20).` };
  }
  if (state.operation === 'trait') {
    const index = Number(state.traitIndex);
    if (!Number.isInteger(index) || index < 0 || index >= item.traits.length) return { ready: false, item, summary: 'Choose one existing trait to replace.' };
    const traitId = item.traits[index];
    const cost = getTraitRerollCost(item);
    return { ready: true, item, cost, summary: `Replace **${ITEM_TRAITS[traitId]?.name || traitId}** on **${item.name}** with a random different, unused trait.` };
  }
  if (!state.stat || !Object.prototype.hasOwnProperty.call(item.stats || {}, state.stat)) {
    return { ready: false, item, summary: 'Choose one of this item’s stats.' };
  }
  if (state.operation === 'reroll') {
    return { ready: true, item, cost: { dust: 75 }, summary: `Reroll **${state.stat}** on **${item.name}**. Its new grade and percentage are random and may be lower.` };
  }
  const target = nextImprovementGrade(item, state.stat);
  const cost = getStatGradeImprovementCost(item, state.stat);
  if (!target || !cost) return { ready: false, item, summary: 'That stat is already at the refinement cap.' };
  const current = item.statGrades?.[state.stat] || item.grade;
  return { ready: true, item, cost, summary: `Refine **${state.stat}** on **${item.name}** from **${GRADES[current]?.name || current}** to **${GRADES[target].name}**.` };
}

function operationMenu(codec, scope, userId, definitions, selected, disabled) {
  return buildPagedStringSelect({
    scope, action: 'op', context: userId, codec, disabled,
    placeholder: 'Choose an operation',
    options: Object.entries(definitions).map(([value, definition]) => ({
      label: definition.name, description: definition.description, value, default: selected === value,
    })),
  }).rows;
}

function applyResetRow(codec, scope, userId, { ready, applyLabel, destructive = false, disabled = false }) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(codec.encode({ scope, action: 'apply', kind: 'button', context: userId }))
      .setLabel(applyLabel).setEmoji(destructive ? '⚠️' : '✅')
      .setStyle(destructive ? ButtonStyle.Danger : ButtonStyle.Success).setDisabled(disabled || !ready),
    new ButtonBuilder().setCustomId(codec.encode({ scope, action: 'reset', kind: 'button', context: userId }))
      .setLabel('Reset').setEmoji('↩️').setStyle(ButtonStyle.Secondary).setDisabled(disabled),
  );
}

function craftWizardView(character, state, disabled, codec, userId) {
  normalizeItemEconomy(character);
  const rows = [...operationMenu(codec, 'craftui', userId, CRAFT_OPERATIONS, state.operation, disabled)];
  if (state.operation === 'create') {
    const type = buildPagedStringSelect({
      scope: 'craftui', action: 'type', context: userId, codec, disabled, placeholder: 'Choose weapon or armor',
      options: [{ label: 'Weapon', value: 'weapon', emoji: '⚔️' }, { label: 'Armor', value: 'armor', emoji: '🛡️' }]
        .map((option) => ({ ...option, default: state.type === option.value })),
    });
    const theme = buildPagedStringSelect({
      scope: 'craftui', action: 'theme', context: userId, codec, disabled, placeholder: 'Choose a crafting theme',
      options: Object.entries(CRAFTING_THEMES).map(([value, definition]) => ({ label: definition.name, value, default: state.themeId === value })),
    });
    const grade = buildPagedStringSelect({
      scope: 'craftui', action: 'grade', context: userId, codec, disabled, placeholder: 'Choose a target grade',
      options: CRAFTABLE_GRADES.map((value) => ({ label: `Grade ${GRADES[value].name}`, value, emoji: GRADES[value].emoji, default: state.grade === value })),
    });
    rows.push(...type.rows, ...theme.rows, ...grade.rows);
  } else if (CRAFT_OPERATIONS[state.operation]) {
    const eligible = validCraftItems(character, state.operation);
    if (state.itemId && !eligible.some((item) => item.id === state.itemId)) {
      state.itemId = null; state.stat = null; state.traitIndex = null;
    }
    const itemMenu = buildPagedStringSelect({
      scope: 'craftui', action: 'item', context: userId, codec, disabled, page: state.itemPage,
      placeholder: 'Choose an eligible item', emptyLabel: 'No eligible items',
      options: eligible.map((item) => ({ ...itemOption(character, item), default: state.itemId === item.id })),
    });
    state.itemPage = itemMenu.page;
    rows.push(...itemMenu.rows);
    const item = eligible.find((entry) => entry.id === state.itemId);
    if (item && state.operation === 'trait') {
      const traits = buildPagedStringSelect({
        scope: 'craftui', action: 'trait', context: userId, codec, disabled, placeholder: 'Choose the trait to replace',
        options: item.traits.map((trait, index) => ({
          label: ITEM_TRAITS[trait]?.name || trait, description: ITEM_TRAITS[trait]?.description,
          value: String(index), default: state.traitIndex === index,
        })),
      });
      rows.push(...traits.rows);
    } else if (item && ['reroll', 'refine'].includes(state.operation)) {
      const stats = Object.keys(item.stats || {}).filter((stat) => state.operation !== 'refine' || nextImprovementGrade(item, stat));
      const statMenu = buildPagedStringSelect({
        scope: 'craftui', action: 'stat', context: userId, codec, disabled,
        placeholder: state.operation === 'refine' ? 'Choose a stat to improve' : 'Choose a stat to reroll',
        options: stats.map((stat) => ({
          label: stat, value: stat, default: state.stat === stat,
          description: `Current: ${item.stats[stat]} • Grade ${(item.statGrades?.[stat] || item.grade || 'f').toUpperCase()}`,
        })),
      });
      rows.push(...statMenu.rows);
    }
  }
  const selection = craftSelection(character, state);
  if (state.operation) rows.push(applyResetRow(codec, 'craftui', userId, {
    ready: selection.ready, applyLabel: 'Apply Crafting', disabled,
  }));
  const embed = new EmbedBuilder().setColor(COLOR).setTitle('🔨 Interactive Crafting Workshop')
    .setDescription(selection.summary)
    .addFields(
      { name: 'Material Wallet', value: materialsText(character.materials) },
      { name: 'Cost', value: selection.cost ? `${costText(selection.cost)}\n${affordabilityText(character, selection.cost)}` : '*Complete the selections to preview the cost.*' },
    )
    .setFooter({ text: 'Nothing is spent until you press Apply. Every choice is checked again against your active character.' });
  return { embeds: [embed], components: rows };
}

function managedItemSelection(character, state) {
  if (!ITEM_OPERATIONS[state.operation]) return { ready: false, summary: 'Choose an item-management operation.' };
  if (state.operation === 'lock') {
    const item = (character.inventory || []).find((entry) => entry.id === state.itemId);
    if (!item) return { ready: false, summary: 'Choose an inventory item to lock or unlock.' };
    return { ready: true, item, summary: `**${item.name}** will be **${item.locked ? 'unlocked' : 'locked'}**.` };
  }
  if (state.operation === 'salvage') {
    if (!RARITIES[state.rarity]) return { ready: false, summary: 'Choose the maximum rarity to salvage.' };
    const preview = salvageByRarity(structuredClone(character), state.rarity);
    if (!preview.ok) return { ready: false, summary: preview.message, preview };
    return {
      ready: true, preview,
      summary: `Salvage **${preview.count} eligible item(s)** through **${RARITIES[state.rarity].name}** for ${materialsText(preview.materialsGained)}. Locked, equipped, and admin items stay safe.`,
    };
  }
  if (typeof state.enabled !== 'boolean' || !AUTO_SALVAGE_RARITIES.includes(state.rarity)) {
    return { ready: false, summary: 'Choose whether auto-salvage is enabled and its maximum rarity.' };
  }
  return { ready: true, summary: `Auto-salvage will be **${state.enabled ? 'enabled' : 'disabled'}** through **${RARITIES[state.rarity].name}** for future drops.` };
}

function itemManagerView(character, state, disabled, codec, userId) {
  normalizeItemEconomy(character);
  const rows = [...operationMenu(codec, 'itemsui', userId, ITEM_OPERATIONS, state.operation, disabled)];
  if (state.operation === 'lock') {
    if (state.itemId && !character.inventory.some((item) => item.id === state.itemId)) state.itemId = null;
    const itemMenu = buildPagedStringSelect({
      scope: 'itemsui', action: 'item', context: userId, codec, disabled, page: state.itemPage,
      placeholder: 'Choose an item to lock or unlock', emptyLabel: 'Your inventory is empty',
      options: character.inventory.map((item) => ({ ...itemOption(character, item), default: state.itemId === item.id })),
    });
    state.itemPage = itemMenu.page;
    rows.push(...itemMenu.rows);
  } else if (state.operation === 'salvage') {
    const equipped = new Set(Object.values(character.equipped || {}).filter(Boolean));
    const eligible = character.inventory.filter((item) => !item.locked && !item.adminCreated && !equipped.has(item.id));
    const rarity = buildPagedStringSelect({
      scope: 'itemsui', action: 'rarity', context: userId, codec, disabled, placeholder: 'Choose the highest rarity to salvage',
      options: Object.entries(RARITIES).map(([value, definition]) => ({
        label: definition.name, value, emoji: definition.emoji, default: state.rarity === value,
        description: `${eligible.filter((item) => (RARITIES[item.rarity] || RARITIES.common).rank <= definition.rank).length} eligible item(s)`,
      })),
    });
    rows.push(...rarity.rows);
  } else if (state.operation === 'auto') {
    const enabled = buildPagedStringSelect({
      scope: 'itemsui', action: 'enabled', context: userId, codec, disabled, placeholder: 'Enable or disable auto-salvage',
      options: [{ label: 'Enabled', value: 'true', emoji: '✅' }, { label: 'Disabled', value: 'false', emoji: '⏸️' }]
        .map((option) => ({ ...option, default: state.enabled === (option.value === 'true') })),
    });
    const rarity = buildPagedStringSelect({
      scope: 'itemsui', action: 'rarity', context: userId, codec, disabled, placeholder: 'Choose the auto-salvage limit',
      options: AUTO_SALVAGE_RARITIES.map((value) => ({
        label: RARITIES[value].name, value, emoji: RARITIES[value].emoji, default: state.rarity === value,
      })),
    });
    rows.push(...enabled.rows, ...rarity.rows);
  }
  const selection = managedItemSelection(character, state);
  if (state.operation) rows.push(applyResetRow(codec, 'itemsui', userId, {
    ready: selection.ready,
    applyLabel: state.operation === 'salvage' ? 'Review & Confirm' : 'Apply Change',
    destructive: state.operation === 'salvage', disabled,
  }));
  return {
    embeds: [new EmbedBuilder().setColor(COLOR).setTitle('🎒 Item Management')
      .setDescription(selection.summary)
      .addFields(
        { name: 'Inventory', value: `**${character.inventory.length} items** • ${character.inventory.filter((item) => item.locked).length} locked` },
        { name: 'Auto-Salvage', value: `${character.autoSalvage.enabled ? 'Enabled' : 'Disabled'} through **${RARITIES[character.autoSalvage.maxRarity]?.name || 'Common'}**` },
        { name: 'Materials', value: materialsText(character.materials) },
      )
      .setFooter({ text: 'Bulk salvage always requires a separate confirmation. Equipped, locked, and admin items are protected.' })],
    components: rows,
  };
}

async function openCraftMenu(interaction, character, store) {
  const userId = interaction.user.id;
  const characterId = character.characterId;
  const codec = createMenuCustomIdCodec({ prefix: 'cw', secret: randomBytes(32) });
  const state = newCraftState();
  let lastCharacter = structuredClone(character);
  let processing = false;
  let active = true;
  const render = (source, disabled = false) => craftWizardView(structuredClone(source), state, disabled, codec, userId);
  const response = await interaction.reply({ ...panelPayload(render(lastCharacter)), flags: MessageFlags.Ephemeral, withResponse: true });
  const message = response?.resource?.message || (typeof response?.createMessageComponentCollector === 'function' ? response : null)
    || (interaction.fetchReply ? await interaction.fetchReply() : null);
  if (!message?.createMessageComponentCollector) return true;
  const collector = message.createMessageComponentCollector({
    filter: (component) => component.user.id === userId
      && Boolean(codec.parse(component.customId, { scope: 'craftui', context: userId })),
    time: 120000,
  });

  collector.on('collect', async (component) => {
    const route = codec.parse(component.customId, { scope: 'craftui', context: userId });
    if (!route) return;
    if (processing) {
      await component.reply({ content: 'Another crafting action is still being processed.', flags: MessageFlags.Ephemeral }).catch(() => {});
      return;
    }
    processing = true;
    let acknowledged = false;
    let persisted = false;
    try {
      const live = store.get(userId);
      if (!live || live.characterId !== characterId) {
        await component.update(panelPayload(render(lastCharacter, true), '⚠️ Your active character changed, so this crafting menu is closed.'));
        if (typeof collector.stop === 'function') collector.stop('character-changed');
        return;
      }
      lastCharacter = structuredClone(live);
      if (route.kind === 'page') {
        if (route.action !== 'item') throw new Error('INVALID_CRAFT_PAGE');
        state.itemPage = route.page;
        await component.update(panelPayload(render(lastCharacter)));
        return;
      }
      if (route.kind === 'select') {
        const value = component.values?.[0];
        if (route.action === 'op' && CRAFT_OPERATIONS[value]) Object.assign(state, newCraftState(), { operation: value });
        else if (route.action === 'type' && ['weapon', 'armor'].includes(value)) state.type = value;
        else if (route.action === 'theme' && CRAFTING_THEMES[value]) state.themeId = value;
        else if (route.action === 'grade' && CRAFTABLE_GRADES.includes(value)) state.grade = value;
        else if (route.action === 'item' && validCraftItems(live, state.operation).some((item) => item.id === value)) {
          state.itemId = value; state.stat = null; state.traitIndex = null;
        } else if (route.action === 'stat') {
          const item = validCraftItems(live, state.operation).find((entry) => entry.id === state.itemId);
          const validStats = Object.keys(item?.stats || {}).filter((stat) => state.operation !== 'refine' || nextImprovementGrade(item, stat));
          if (!validStats.includes(value)) throw new Error('INVALID_CRAFT_STAT');
          state.stat = value;
        } else if (route.action === 'trait') {
          const item = validCraftItems(live, 'trait').find((entry) => entry.id === state.itemId);
          const index = Number(value);
          if (!item || !Number.isInteger(index) || index < 0 || index >= item.traits.length) throw new Error('INVALID_CRAFT_TRAIT');
          state.traitIndex = index;
        } else throw new Error('INVALID_CRAFT_SELECTION');
        await component.update(panelPayload(render(lastCharacter)));
        return;
      }
      if (route.kind !== 'button') throw new Error('INVALID_CRAFT_ACTION');
      if (route.action === 'reset') {
        Object.assign(state, newCraftState());
        await component.update(panelPayload(render(lastCharacter)));
        return;
      }
      if (route.action !== 'apply') throw new Error('INVALID_CRAFT_ACTION');

      const selection = craftSelection(structuredClone(live), state);
      if (!selection.ready) {
        await component.update(panelPayload(render(lastCharacter), `⚠️ ${selection.summary}`));
        return;
      }
      const selectedState = structuredClone(state);
      if (typeof component.deferUpdate === 'function') {
        await component.deferUpdate();
        acknowledged = true;
      }
      const result = await mutateActiveCharacter(store, userId, characterId, (working) => {
        const currentSelection = craftSelection(working, selectedState);
        if (!currentSelection.ready) throw userFacingError(currentSelection.summary);
        let applied;
        if (selectedState.operation === 'create') applied = craftThemedItem(working, { type: selectedState.type, themeId: selectedState.themeId, grade: selectedState.grade });
        else if (selectedState.operation === 'upgrade') applied = upgradeItem(working, selectedState.itemId);
        else if (selectedState.operation === 'trait') applied = rerollItemTrait(working, selectedState.itemId, selectedState.traitIndex);
        else if (selectedState.operation === 'reroll') applied = rerollItemStatGrade(working, selectedState.itemId, selectedState.stat, { luck: lootLuck(working) });
        else applied = improveItemStatGrade(working, selectedState.itemId, selectedState.stat);
        if (!applied.ok) throw userFacingError(applied.message);
        if (applied.character) Object.assign(working, applied.character);
        progressContract(working, 'crafting', 1);
        return applied;
      });
      persisted = true;
      lastCharacter = store.get(userId) || lastCharacter;
      const completed = `🔨 **${result.item.name}** updated. ${itemStatsText(result.item)}\nMaterials: ${materialsText(lastCharacter.materials)}`;
      Object.assign(state, newCraftState());
      const payload = panelPayload(render(lastCharacter), completed);
      if (acknowledged) await interaction.editReply(payload);
      else await component.update(payload);
    } catch (error) {
      const invalid = String(error.message).startsWith('INVALID_CRAFT_');
      if (!invalid && !error.userMessage) console.error('Could not process crafting wizard:', error);
      const notice = error.userMessage
        ? `⚠️ ${error.userMessage}`
        : persisted
          ? '✅ The crafting change was saved, but this panel could not refresh. Reopen `/craft menu` to continue.'
          : invalid
            ? '⚠️ That crafting choice is no longer valid. Please choose again.'
            : '⚠️ The crafting change could not be saved. Please try again.';
      const payload = panelPayload(render(lastCharacter), notice);
      if (acknowledged) await interaction.editReply(payload).catch(() => {});
      else await component.update(payload).catch(() => {});
    } finally {
      processing = false;
    }
  });
  collector.on('end', async () => {
    active = false;
    const live = store.get(userId);
    const source = live?.characterId === characterId ? live : lastCharacter;
    await interaction.editReply({ components: render(source, true).components }).catch(() => {});
  });
  return true;
}

async function openItemManager(interaction, character, store) {
  const userId = interaction.user.id;
  const characterId = character.characterId;
  const codec = createMenuCustomIdCodec({ prefix: 'im', secret: randomBytes(32) });
  const state = newItemState();
  let lastCharacter = structuredClone(character);
  let processing = false;
  let active = true;
  const render = (source, disabled = false) => itemManagerView(structuredClone(source), state, disabled, codec, userId);
  const response = await interaction.reply({ ...panelPayload(render(lastCharacter)), flags: MessageFlags.Ephemeral, withResponse: true });
  const message = response?.resource?.message || (typeof response?.createMessageComponentCollector === 'function' ? response : null)
    || (interaction.fetchReply ? await interaction.fetchReply() : null);
  if (!message?.createMessageComponentCollector) return true;
  const collector = message.createMessageComponentCollector({
    filter: (component) => component.user.id === userId
      && Boolean(codec.parse(component.customId, { scope: 'itemsui', context: userId })),
    time: 120000,
  });

  collector.on('collect', async (component) => {
    const route = codec.parse(component.customId, { scope: 'itemsui', context: userId });
    if (!route) return;
    if (processing) {
      await component.reply({ content: 'Another item action is still being processed.', flags: MessageFlags.Ephemeral }).catch(() => {});
      return;
    }
    processing = true;
    let acknowledged = false;
    let persisted = false;
    try {
      const live = store.get(userId);
      if (!live || live.characterId !== characterId) {
        await component.update(panelPayload(render(lastCharacter, true), '⚠️ Your active character changed, so this item panel is closed.'));
        if (typeof collector.stop === 'function') collector.stop('character-changed');
        return;
      }
      lastCharacter = structuredClone(live);
      if (route.kind === 'page') {
        if (route.action !== 'item') throw new Error('INVALID_ITEM_PAGE');
        state.itemPage = route.page;
        await component.update(panelPayload(render(lastCharacter)));
        return;
      }
      if (route.kind === 'select') {
        const value = component.values?.[0];
        if (route.action === 'op' && ITEM_OPERATIONS[value]) {
          Object.assign(state, newItemState(), { operation: value });
          if (value === 'auto') {
            state.enabled = Boolean(live.autoSalvage?.enabled);
            state.rarity = AUTO_SALVAGE_RARITIES.includes(live.autoSalvage?.maxRarity) ? live.autoSalvage.maxRarity : 'common';
          }
        } else if (route.action === 'item' && live.inventory.some((item) => item.id === value)) state.itemId = value;
        else if (route.action === 'rarity' && RARITIES[value]
          && (state.operation !== 'auto' || AUTO_SALVAGE_RARITIES.includes(value))) state.rarity = value;
        else if (route.action === 'enabled' && ['true', 'false'].includes(value)) state.enabled = value === 'true';
        else throw new Error('INVALID_ITEM_SELECTION');
        await component.update(panelPayload(render(lastCharacter)));
        return;
      }
      if (route.kind !== 'button') throw new Error('INVALID_ITEM_ACTION');
      if (route.action === 'reset') {
        Object.assign(state, newItemState());
        await component.update(panelPayload(render(lastCharacter)));
        return;
      }
      if (route.action !== 'apply') throw new Error('INVALID_ITEM_ACTION');
      const selection = managedItemSelection(live, state);
      if (!selection.ready) {
        await component.update(panelPayload(render(lastCharacter), `⚠️ ${selection.summary}`));
        return;
      }

      if (state.operation === 'salvage') {
        const previewItemIds = selection.preview.salvaged.map((item) => item.id);
        const overflow = Object.values(selection.preview.overflow || {}).some((value) => value > 0);
        const confirmation = await requestConfirmation(component, {
          title: '♻️ Confirm Bulk Salvage',
          description: `Salvage all eligible equipment through ${RARITIES[state.rarity].name}?`,
          consequences: [
            `${selection.preview.count} item(s) will be permanently removed.`,
            `${materialsText(selection.preview.materialsGained)} will be added to your crafting materials.`,
            overflow ? `${materialsText(selection.preview.overflow)} will be lost because material caps are full.` : 'All yielded materials fit within your storage caps.',
            'Locked, equipped, and admin-created items remain untouched.',
          ],
          labels: { confirm: `Salvage ${selection.preview.count}`, cancel: 'Keep Items' },
          time: 60000,
        });
        if (!confirmation.confirmed) return;
        if (!active) {
          await confirmation.fail('The item-management panel expired before confirmation, so nothing was salvaged.');
          return;
        }
        let result;
        try {
          result = await mutateActiveCharacter(store, userId, characterId, (working) => {
            const currentPreview = salvageItems(structuredClone(working), previewItemIds);
            if (!currentPreview.ok
              || currentPreview.count !== selection.preview.count
              || !sameMaterials(currentPreview.materialsGained, selection.preview.materialsGained)
              || !sameMaterials(currentPreview.overflow, selection.preview.overflow)) {
              throw userFacingError('The selected items, their eligibility, or your material storage changed while confirmation was open. Nothing was salvaged; review a fresh preview.');
            }
            const applied = salvageItems(working, previewItemIds);
            if (!applied.ok) throw userFacingError(`Your inventory changed while confirmation was open: ${applied.message}`);
            progressContract(working, 'crafting', 1);
            return applied;
          });
        } catch (error) {
          if (!error.userMessage) console.error('Could not save managed bulk salvage:', error);
          await confirmation.fail(error.userMessage || 'The salvage could not be saved. Please try again.');
          return;
        }
        lastCharacter = store.get(userId) || lastCharacter;
        const lost = Object.values(result.overflow || {}).some((value) => value > 0) ? ` Storage caps discarded ${materialsText(result.overflow)}.` : '';
        await confirmation.complete(`Salvaged **${result.count} items** and received ${materialsText(result.materialsGained)}.${lost}`, '♻️ Salvage complete');
        Object.assign(state, newItemState());
        await interaction.editReply(panelPayload(render(lastCharacter), `♻️ Salvaged **${result.count} items**.`));
        return;
      }

      const selectedState = structuredClone(state);
      if (typeof component.deferUpdate === 'function') {
        await component.deferUpdate();
        acknowledged = true;
      }
      const result = await mutateActiveCharacter(store, userId, characterId, (working) => {
        const applied = selectedState.operation === 'lock'
          ? toggleItemLock(working, selectedState.itemId)
          : configureAutoSalvage(working, selectedState.enabled, selectedState.rarity);
        if (!applied.ok) throw userFacingError(applied.message);
        return applied;
      });
      persisted = true;
      lastCharacter = store.get(userId) || lastCharacter;
      const completed = selectedState.operation === 'lock'
        ? `🔒 **${result.item.name}** is now ${result.item.locked ? 'locked' : 'unlocked'}.`
        : `⚙️ Auto-salvage ${result.config.enabled ? 'enabled' : 'disabled'} through **${RARITIES[result.config.maxRarity].name}**.`;
      Object.assign(state, newItemState());
      const payload = panelPayload(render(lastCharacter), completed);
      if (acknowledged) await interaction.editReply(payload);
      else await component.update(payload);
    } catch (error) {
      const invalid = String(error.message).startsWith('INVALID_ITEM_');
      if (!invalid && !error.userMessage) console.error('Could not process item-management panel:', error);
      const notice = error.userMessage
        ? `⚠️ ${error.userMessage}`
        : persisted
          ? '✅ The item change was saved, but this panel could not refresh. Reopen `/items manage` to continue.'
          : invalid
            ? '⚠️ That item choice is no longer valid. Please choose again.'
            : '⚠️ The item change could not be saved. Please try again.';
      const payload = panelPayload(render(lastCharacter), notice);
      if (acknowledged) await interaction.editReply(payload).catch(() => {});
      else if (!component.replied && !component.deferred) await component.update(payload).catch(() => {});
    } finally {
      processing = false;
    }
  });
  collector.on('end', async () => {
    active = false;
    const live = store.get(userId);
    const source = live?.characterId === characterId ? live : lastCharacter;
    await interaction.editReply({ components: render(source, true).components }).catch(() => {});
  });
  return true;
}

async function openProgressionView(interaction, character, store, scope, render, act) {
  const userId = interaction.user.id;
  const characterId = character.characterId;
  const codec = createMenuCustomIdCodec({ prefix: 'pg', secret: randomBytes(32) });
  let currentPage = 0;
  let lastCharacter = structuredClone(character);
  let processing = false;
  const makeView = (source, disabled = false) => {
    const view = render(structuredClone(source), currentPage, disabled, codec, userId);
    currentPage = view.page ?? currentPage;
    return view;
  };
  const initialView = makeView(lastCharacter);
  const response = await interaction.reply({
    ...responsePayload(initialView), flags: MessageFlags.Ephemeral, withResponse: true,
  });
  const message = response?.resource?.message || (typeof response?.createMessageComponentCollector === 'function' ? response : null)
    || (interaction.fetchReply ? await interaction.fetchReply() : null);
  if (!message?.createMessageComponentCollector) return true;

  const collector = message.createMessageComponentCollector({
    filter: (component) => component.user.id === userId
      && Boolean(codec.parse(component.customId, { scope, context: userId })),
    time: 120000,
  });
  collector.on('collect', async (component) => {
    const route = codec.parse(component.customId, { scope, context: userId });
    if (!route) return;
    if (processing) {
      await component.reply({ content: 'Another menu action is still being saved. Please try again.', flags: MessageFlags.Ephemeral }).catch(() => {});
      return;
    }
    processing = true;
    let acknowledged = false;
    let persisted = false;
    try {
      await component.deferUpdate();
      acknowledged = true;
      const live = store.get(userId);
      if (!live || live.characterId !== characterId) {
        const expiredView = makeView(lastCharacter, true);
        await interaction.editReply({ ...responsePayload(expiredView, '⚠️ Your active character changed, so this menu is now closed.') });
        if (typeof collector.stop === 'function') collector.stop('character-changed');
        return;
      }
      if (route.kind === 'page') {
        currentPage = route.page;
        lastCharacter = structuredClone(live);
        await interaction.editReply(responsePayload(makeView(lastCharacter)));
        return;
      }

      const result = await mutateActiveCharacter(store, userId, characterId, async (working) => {
        const applied = await act(working, route, component.values?.[0]);
        if (!applied?.ok) throw userFacingError(applied?.message || 'That action is no longer available.');
        return applied;
      });
      persisted = true;
      lastCharacter = store.get(userId) || lastCharacter;
      await interaction.editReply(responsePayload(makeView(lastCharacter), result.message));
    } catch (error) {
      if (!error.userMessage) console.error(`Could not process ${scope} menu action:`, error);
      const fallback = makeView(lastCharacter);
      const notice = error.userMessage
        ? `⚠️ ${error.userMessage}`
        : persisted
          ? '✅ The action was saved, but this panel could not refresh. Reopen the command to continue.'
          : '⚠️ That action could not be saved. Please try again.';
      const payload = responsePayload(fallback, notice);
      if (acknowledged) await interaction.editReply(payload).catch(() => {});
      else await component.update(payload).catch(() => {});
    } finally {
      processing = false;
    }
  });
  collector.on('end', async () => {
    const live = store.get(userId);
    const source = live?.characterId === characterId ? live : lastCharacter;
    const expiredView = makeView(source, true);
    await interaction.editReply({ components: expiredView.components }).catch(() => {});
  });
  return true;
}

async function handleProgressionCommand(interaction, character, store, activeBattles = null) {
  const command = interaction.commandName;
  if (!COMMANDS.has(command)) return false;
  const userId = interaction.user.id;
  normalizeAbilities(character); normalizeIdle(character); normalizeItemEconomy(character); normalizeProgression(character); normalizeChallenges(character);

  if (command === 'idle') {
    const action = interaction.options.getSubcommand();
    if (action === 'start') {
      const result = startIdle(character); if (!result.ok) return interaction.reply({ content: result.message, flags: MessageFlags.Ephemeral });
      await store.set(userId, character); return interaction.reply('💤 Idle combat started on your current floor. Claim up to 12 hours with `/idle claim`.');
    }
    if (action === 'status') {
      return openProgressionView(interaction, character, store, 'idle', idleView, (working, route) => {
        if (route.kind !== 'button' || !['start', 'claim'].includes(route.action)) return { ok: false, message: 'That idle action is invalid.' };
        if (route.action === 'start') {
          const result = startIdle(working);
          return result.ok ? { ok: true, message: '💤 Idle combat started on your current floor.' } : result;
        }
        const result = claimIdle(working);
        return result.ok ? { ok: true, message: idleClaimText(result) } : result;
      });
    }
    const result = claimIdle(character); if (!result.ok) return interaction.reply({ content: result.message, flags: MessageFlags.Ephemeral });
    await store.set(userId, character);
    return interaction.reply(idleClaimText(result));
  }

  if (command === 'ability') {
    const action = interaction.options.getSubcommand(); const abilities = availableAbilities(character);
    if (action === 'list') return openProgressionView(interaction, character, store, 'ability', abilityView, (working, route, abilityId) => {
      if (route.kind !== 'select' || route.action !== 'choose') return { ok: false, message: 'That ability action is invalid.' };
      const ability = availableAbilities(working).find((entry) => entry.id === abilityId);
      if (!ability) return { ok: false, message: 'That ability does not belong to your class.' };
      working.autoAbility = ability.id;
      return { ok: true, message: `💧 **${ability.name}** selected for idle combat and preselected in interactive battles.` };
    });
    const ability = abilities.find((entry) => entry.id === interaction.options.getString('ability'));
    if (!ability) return interaction.reply({ content: 'That ability does not belong to your class.', flags: MessageFlags.Ephemeral });
    character.autoAbility = ability.id; await store.set(userId, character); return interaction.reply(`💧 **${ability.name}** selected for idle combat and preselected in interactive battles.`);
  }

  if (command === 'items') {
    const action = interaction.options.getSubcommand(); let result;
    if (action === 'manage') return openItemManager(interaction, character, store);
    if (action === 'lock') {
      const item = character.inventory[interaction.options.getInteger('slot') - 1]; result = item ? toggleItemLock(character, item.id) : { ok: false, message: 'That inventory slot is empty.' };
      if (result.ok) await store.set(userId, character);
      return interaction.reply(result.ok ? `🔒 **${result.item.name}** is now ${result.item.locked ? 'locked' : 'unlocked'}.` : { content: result.message, flags: MessageFlags.Ephemeral });
    }
    if (action === 'salvage') {
      const rarity = interaction.options.getString('rarity');
      const preview = salvageByRarity(structuredClone(character), rarity);
      if (!preview.ok) return interaction.reply({ content: preview.message, flags: MessageFlags.Ephemeral });
      const previewItemIds = preview.salvaged.map((item) => item.id);
      const overflow = Object.values(preview.overflow || {}).some((value) => value > 0);
      const confirmation = await requestConfirmation(interaction, {
        title: '♻️ Confirm Bulk Salvage', description: `Salvage all eligible equipment through ${RARITIES[rarity].name}?`,
        consequences: [`${preview.count} item(s) will be permanently removed.`, `${materialsText(preview.materialsGained)} will be added to your crafting materials.`, overflow ? `${materialsText(preview.overflow)} will be lost because those material caps are full.` : 'All yielded materials fit within your storage caps.', 'Locked, equipped, and admin-created items remain untouched.'],
        labels: { confirm: `Salvage ${preview.count}`, cancel: 'Keep Items' },
      });
      if (!confirmation.confirmed) return true;
      try {
        result = await mutateActiveCharacter(store, userId, character.characterId, (working) => {
          const currentPreview = salvageItems(structuredClone(working), previewItemIds);
          if (!currentPreview.ok
            || currentPreview.count !== preview.count
            || !sameMaterials(currentPreview.materialsGained, preview.materialsGained)
            || !sameMaterials(currentPreview.overflow, preview.overflow)) {
            throw userFacingError('The selected items, their eligibility, or your material storage changed while this prompt was open. No items were salvaged; run the command again for a fresh preview.');
          }
          const applied = salvageItems(working, previewItemIds);
          if (!applied.ok) throw userFacingError(applied.message);
          progressContract(working, 'crafting', 1);
          return applied;
        });
      } catch (error) {
        if (!error.userMessage) console.error('Could not save bulk salvage:', error);
        await confirmation.fail(error.userMessage || 'The salvage could not be saved. Please try again.');
        return true;
      }
      const gained = materialsText(result.materialsGained);
      const lost = Object.values(result.overflow || {}).some((value) => value > 0) ? ` Storage caps discarded ${materialsText(result.overflow)}.` : '';
      await confirmation.complete(`Salvaged **${result.count} items** and received ${gained}.${lost}`, '♻️ Salvage complete');
      return true;
    } else result = configureAutoSalvage(character, interaction.options.getBoolean('enabled'), interaction.options.getString('rarity'));
    if (!result.ok) return interaction.reply({ content: result.message, flags: MessageFlags.Ephemeral });
    await store.set(userId, character);
    return interaction.reply(`⚙️ Auto-salvage ${result.config.enabled ? 'enabled' : 'disabled'} through **${RARITIES[result.config.maxRarity].name}**.`);
  }

  if (command === 'craft') {
    const action = interaction.options.getSubcommand(); let result;
    if (action === 'menu') return openCraftMenu(interaction, character, store);
    if (action === 'reroll') {
      const item = character.inventory[interaction.options.getInteger('slot') - 1];
      if (!item) return interaction.reply({ content: 'That inventory slot is empty.', flags: MessageFlags.Ephemeral });
      const stat = interaction.options.getString('stat');
      if (!Object.prototype.hasOwnProperty.call(item.stats || {}, stat)) {
        return interaction.reply({ content: 'That item does not have the selected stat.', flags: MessageFlags.Ephemeral });
      }
      const cost = 75;
      if ((character.materials?.dust || 0) < cost) {
        return interaction.reply({ content: `Rerolling costs ${cost} dust.`, flags: MessageFlags.Ephemeral });
      }
      const itemId = item.id;
      const reviewed = {
        value: item.stats[stat], grade: item.statGrades?.[stat] || item.grade,
        percentage: item.statPercentages?.[stat], dust: character.materials.dust,
      };
      const gradeName = GRADES[reviewed.grade]?.name || String(reviewed.grade).toUpperCase();
      const confirmation = await requestConfirmation(interaction, {
        title: '🎲 Confirm Stat Reroll',
        description: `Reroll **${stat}** on **${item.name}**?`,
        consequences: [
          `The current ${gradeName} ${reviewed.percentage ?? '?'}% roll (+${reviewed.value}) will be permanently replaced.`,
          'The replacement grade and percentage are random from F through SSS and may be lower. Z remains drop/admin-only.',
          `Exactly ${cost} dust will be spent (reviewed balance: ${reviewed.dust}).`,
          'The rest of the item and its other stats remain unchanged.',
        ],
        labels: { confirm: 'Spend Dust & Reroll', cancel: 'Keep Current Stat' },
      });
      if (!confirmation.confirmed) return true;
      try {
        result = await mutateActiveCharacter(store, userId, character.characterId, (working) => {
          const current = working.inventory.find((entry) => entry.id === itemId);
          if (!current
            || current.stats?.[stat] !== reviewed.value
            || (current.statGrades?.[stat] || current.grade) !== reviewed.grade
            || current.statPercentages?.[stat] !== reviewed.percentage
            || working.materials?.dust !== reviewed.dust) {
            throw userFacingError('The item or dust balance changed while this prompt was open. Nothing was rerolled; run the command again for a fresh review.');
          }
          const applied = rerollItemStatGrade(working, itemId, stat, { luck: lootLuck(working) });
          if (!applied.ok) throw userFacingError(applied.message);
          Object.assign(working, applied.character);
          progressContract(working, 'crafting', 1);
          return applied;
        });
      } catch (error) {
        if (!error.userMessage) console.error('Could not save confirmed stat reroll:', error);
        await confirmation.fail(error.userMessage || 'The reroll could not be saved. Please try again.');
        return true;
      }
      const updated = store.get(userId);
      const newGrade = GRADES[result.grade]?.name || String(result.grade).toUpperCase();
      await confirmation.complete(`**${result.item.name}** now has **${newGrade} ${result.percentage}% ${stat} (+${result.item.stats[stat]})**. Materials: ${materialsText(updated?.materials)}.`, '🎲 Stat reroll complete');
      return true;
    }
    if (action === 'create') result = craftThemedItem(character, {
      type: interaction.options.getString('type'), themeId: interaction.options.getString('theme'), grade: interaction.options.getString('grade'),
    });
    else {
      const item = character.inventory[interaction.options.getInteger('slot') - 1];
      if (!item) return interaction.reply({ content: 'That inventory slot is empty.', flags: MessageFlags.Ephemeral });
      if (action === 'upgrade') result = upgradeItem(character, item.id);
      else if (action === 'trait') result = rerollItemTrait(character, item.id, interaction.options.getInteger('trait_slot') - 1);
      else result = improveItemStatGrade(character, item.id, interaction.options.getString('stat'));
    }
    if (!result.ok) return interaction.reply({ content: result.message, flags: MessageFlags.Ephemeral });
    if (result.character) Object.assign(character, result.character);
    progressContract(character, 'crafting', 1);
    await store.set(userId, character);
    return interaction.reply(`🔨 **${result.item.name}** updated. ${itemStatsText(result.item)}\nMaterials: ${Object.entries(character.materials).map(([key, value]) => `${key} **${value}**`).join(' • ')}`);
  }

  if (command === 'quests') {
    const action = interaction.options.getSubcommand();
    if (action === 'view') return openProgressionView(interaction, character, store, 'quests', questView, (working, route, questId) => {
      if (route.kind !== 'select' || route.action !== 'claim') return { ok: false, message: 'That quest action is invalid.' };
      const result = claimQuest(working, questId);
      return result.ok ? { ok: true, message: `🎁 Claimed **${result.quest.name}**.` } : result;
    });
    const result = claimQuest(character, interaction.options.getString('quest')); if (!result.ok) return interaction.reply({ content: result.message, flags: MessageFlags.Ephemeral });
    await store.set(userId, character); return interaction.reply(`🎁 Claimed **${result.quest.name}**.`);
  }

  if (command === 'achievements') {
    const action = interaction.options.getSubcommand();
    if (action === 'view') return openProgressionView(interaction, character, store, 'achievements', achievementView, (working, route, achievementId) => {
      if (route.kind !== 'select' || route.action !== 'claim') return { ok: false, message: 'That achievement action is invalid.' };
      const result = claimAchievement(working, achievementId);
      return result.ok ? { ok: true, message: `🏆 Claimed **${result.achievement.name}** for ${result.achievement.points} achievement points.` } : result;
    });
    const result = claimAchievement(character, interaction.options.getString('achievement')); if (!result.ok) return interaction.reply({ content: result.message, flags: MessageFlags.Ephemeral });
    await store.set(userId, character); return interaction.reply(`🏆 Claimed **${result.achievement.name}** for ${result.achievement.points} achievement points.`);
  }

  if (command === 'ascend') {
    if (activeBattles?.has(userId)) return interaction.reply({ content: 'Finish your active battle before ascending.', flags: MessageFlags.Ephemeral });
    if (character.idleCombat) return interaction.reply({ content: 'Claim idle combat before ascending.', flags: MessageFlags.Ephemeral });
    if (character.level < 1000) return interaction.reply({ content: 'Reach level 1000 before ascending.', flags: MessageFlags.Ephemeral });
    const projected = 1 + Math.floor(character.achievementPoints / 100);
    const currentPoints = character.ascensionPoints || 0;
    const projectedPoints = currentPoints + projected;
    const currentPower = ascensionPowerMultiplier(currentPoints);
    const projectedPower = ascensionPowerMultiplier(projectedPoints);
    const currentRewards = ascensionRewardMultiplier(currentPoints);
    const projectedRewards = ascensionRewardMultiplier(projectedPoints);
    const confirmation = await requestConfirmation(interaction, {
      title: '🌟 Confirm Ascension', description: `Ascend **${character.name}** and begin a stronger run?`,
      consequences: [
        'Level, XP, player-allocated stats, and world/floor unlocks reset.',
        `You gain ${projected} permanent point(s): combat ${currentPower.toFixed(3)}× → ${projectedPower.toFixed(3)}×; XP/gold ${currentRewards.toFixed(3)}× → ${projectedRewards.toFixed(3)}×.`,
        'Both bonuses diminish as they approach their 2.00× combat and 1.50× reward caps.',
        'Admin-granted stats, equipment, specialization/mastery, materials, god/favour, guild, achievements, and tower progress are preserved.',
      ],
      labels: { confirm: 'Ascend Character', cancel: 'Stay Level 1000' },
    });
    if (!confirmation.confirmed) return true;
    if (activeBattles?.has(userId)) {
      await confirmation.fail('A battle started while this prompt was open. Finish it before ascending.');
      return true;
    }
    if (activeBattles) activeBattles.add(userId);
    let result;
    try {
      result = await mutateActiveCharacter(store, userId, character.characterId, (working) => {
        if (working.idleCombat) throw userFacingError('Idle combat started while this prompt was open. Claim it before ascending.');
        if (working.level < 1000) throw userFacingError('This character is no longer level 1000, so it cannot ascend.');
        const currentProjected = 1 + Math.floor((working.achievementPoints || 0) / 100);
        if (currentProjected !== projected) {
          throw userFacingError('Your achievement points changed while this prompt was open. Run `/ascend` again to review the updated permanent-point reward.');
        }
        const applied = ascend(working);
        if (!applied.ok) throw userFacingError(applied.message);
        return applied;
      });
    } catch (error) {
      if (!error.userMessage) console.error('Could not save ascension:', error);
      await confirmation.fail(error.userMessage || 'The ascension could not be saved. Please try again.');
      return true;
    } finally {
      if (activeBattles) activeBattles.delete(userId);
    }
    await confirmation.complete(`**Ascension ${result.ascensions}!** Gained ${result.gained} permanent points. Your multiplier is now **${result.multiplier.toFixed(2)}×**.`, '🌟 Ascension complete');
    return true;
  }

  if (command === 'dungeon') {
    const action = interaction.options.getSubcommand();
    if (action === 'list') return openProgressionView(interaction, character, store, 'dungeon', dungeonView, (working, route, dungeonId) => {
      if (route.kind !== 'select' || route.action !== 'run') return { ok: false, message: 'That dungeon action is invalid.' };
      const result = runDungeon(working, dungeonId);
      return result.ok ? { ok: true, message: dungeonResultText(result) } : result;
    });
    const result = runDungeon(character, interaction.options.getString('dungeon'));
    if (!result.ok) return interaction.reply({ content: result.message, flags: MessageFlags.Ephemeral });
    await store.set(userId, character);
    return interaction.reply(dungeonResultText(result));
  }

  if (command === 'tower') {
    if (interaction.options.getSubcommand() === 'view') return openProgressionView(interaction, character, store, 'tower', towerView, (working, route) => {
      if (route.kind !== 'button' || route.action !== 'challenge') return { ok: false, message: 'That tower action is invalid.' };
      const result = challengeTower(working);
      return { ok: true, message: towerResultText(result) };
    });
    const result = challengeTower(character); await store.set(userId, character);
    return interaction.reply(towerResultText(result));
  }
  return false;
}

module.exports = { handleProgressionCommand };
