const { MessageFlags } = require('discord.js');
const { WORLDS, RARITIES } = require('../content');
const { addMastery } = require('../systems');
const {
  rollFloorEnemy, generateDrop, normalizeCharacter, advanceFloor,
  itemStatsText, derivedStats, lootLuck, playerDamage, enemyDamage, grantRewards,
} = require('../game');
const { battleButtons, battleAbilitySelect, battleEmbed } = require('../ui/battle');
const { normalizeAbilities, useAbility, restoreMana, tickAbilityCooldowns } = require('../systems/abilities');
const { receiveDrop } = require('../systems/items');
const { progressContract } = require('./contracts-system');
const { ascensionRewardMultiplier } = require('../systems/combat-scaling');

async function runAdventure(interaction, character, store, activeBattles) {
  const userId = interaction.user.id;
  if (activeBattles.has(userId)) return interaction.reply({ content: 'You already have an active battle.', flags: MessageFlags.Ephemeral });
  if (character.idleCombat) return interaction.reply({ content: 'Claim your idle combat before starting an interactive adventure.', flags: MessageFlags.Ephemeral });
  if (character.hp <= 0) return interaction.reply({ content: 'You are unconscious. Use `/heal` before adventuring.', flags: MessageFlags.Ephemeral });
  activeBattles.add(userId);
  normalizeCharacter(character); normalizeAbilities(character);
  const battleWorld = character.world;
  const battleFloor = character.floor;
  let enemy = rollFloorEnemy(battleWorld, battleFloor, Math.random, character.level);
  const world = WORLDS[battleWorld - 1];
  let log = `${world.emoji} **${world.name} — Floor ${battleFloor}**\nA wild **${enemy.name}** blocks your path!`;
  const activeComponents = () => [battleButtons(), battleAbilitySelect(character)];
  const finishedComponents = () => [battleButtons(true), battleAbilitySelect(character, true)];
  const response = await interaction.reply({ embeds: [battleEmbed(character, enemy, log)], components: activeComponents(), withResponse: true });
  const collector = response.resource.message.createMessageComponentCollector({ filter: (button) => button.user.id === userId, time: 120000 });

  let processing = false;
  collector.on('collect', async (button) => {
    if (processing) {
      await button.reply({ content: 'That battle turn is still being saved. Please wait.', flags: MessageFlags.Ephemeral }).catch(() => {});
      return;
    }
    processing = true;
    let acknowledged = false;
    let persisted = false;
    try {
      const live = store.get(userId);
      if (!live || live.characterId !== character.characterId) {
        collector.stop('character-changed');
        return button.update({
          embeds: [battleEmbed(character, enemy, '⚠️ Your active character changed, so this battle was closed without applying another turn.')],
          components: finishedComponents(),
        });
      }
      if (live.world !== battleWorld || live.floor !== battleFloor) {
        character = live;
        collector.stop('travelled');
        return button.update({
          embeds: [battleEmbed(character, enemy, '⚠️ Your world or floor changed, so the old battle was closed. Start `/adventure` again at your current destination.')],
          components: finishedComponents(),
        });
      }
      // Start every turn from the latest durable character so changes made by
      // other commands before this click are retained.
      character = live;
      normalizeCharacter(character); normalizeAbilities(character);

      let defending = false;
      if (button.customId === 'flee') {
        collector.stop('fled');
        return button.update({ embeds: [battleEmbed(character, enemy, '🏃 You escaped safely.')], components: finishedComponents() });
      }
      if (button.customId === 'potion') {
        if (!character.potions) return button.reply({ content: 'You have no potions.', flags: MessageFlags.Ephemeral });
        const maximumHp = derivedStats(character).maxHp;
        if (character.hp >= maximumHp) return button.reply({ content: 'You are already at full health.', flags: MessageFlags.Ephemeral });
        const healed = Math.min(45, maximumHp - character.hp);
        character.hp += healed; character.potions -= 1;
        log = `🧪 You restored **${healed} HP**.`;
      } else if (button.isStringSelectMenu?.() && button.customId === 'battle_ability') {
        const base = playerDamage(character).amount;
        const used = useAbility(character, button.values[0], base);
        if (!used.ok) return button.reply({ content: used.message, flags: MessageFlags.Ephemeral });
        enemy.hp -= used.damage;
        defending = Boolean(used.shield);
        log = `💧 **${used.ability.name}**${used.damage ? ` dealt **${used.damage} damage**` : ''}${used.healed ? ` restored **${used.healed} HP**` : ''}.`;
      } else if (button.customId === 'defend') {
        defending = true;
        log = '🛡️ You brace for the next attack.';
      } else {
        const hit = playerDamage(character);
        enemy.hp -= hit.amount;
        log = `⚔️ You dealt **${hit.amount} damage**${hit.critical ? ' — **critical hit!**' : '.'}`;
      }

      await button.deferUpdate();
      acknowledged = true;
      if (enemy.hp <= 0) {
        const rewardMultiplier = ascensionRewardMultiplier(character.ascensionPoints);
        const awardedXp = Math.round(enemy.xp * rewardMultiplier);
        const awardedGold = Math.round(enemy.gold * rewardMultiplier);
        const levels = grantRewards(character, enemy);
        const mastery = addMastery(character, enemy.isBoss ? 3 : 1, 'combat');
        const drop = generateDrop(
          character.world,
          character.floor,
          Math.random,
          lootLuck(character),
          null,
          character.level,
        );
        const received = receiveDrop(character, drop);
        const progress = advanceFloor(character);
        progressContract(character, 'combat', 1);
        await store.set(character.userId, character);
        persisted = true;
        log += `\n🏆 Victory! You earned **${awardedXp} XP** and **${awardedGold} gold**.`;
        log += received.kept
          ? `\n${RARITIES[drop.rarity].emoji} Drop: **[${RARITIES[drop.rarity].name}] ${drop.name}** — ${itemStatsText(drop)}`
          : `\n♻️ Auto-salvaged **${drop.name}** for **${received.dust} dust**.`;
        if (levels.length) log += `\n⬆️ You reached **level ${character.level}** and your HP was restored!`;
        if (mastery.unlocked) log += '\n🌟 **Mastery 75 reached!** Use `/mastery` to choose an advanced class.';
        if (progress.worldUnlocked) log += `\n🌍 **${WORLDS[progress.worldUnlocked - 1].name} unlocked!**`;
        collector.stop('victory');
        return interaction.editReply({ embeds: [battleEmbed(character, enemy, log)], components: finishedComponents() });
      }
      const taken = enemyDamage(enemy, character, Math.random, defending);
      restoreMana(character, 5);
      tickAbilityCooldowns(character);
      character.hp = Math.max(0, character.hp - taken);
      log += `\n${enemy.emoji} ${enemy.name} dealt **${taken} damage**.`;
      if (character.hp <= 0) {
        character.losses += 1;
        character.gold = Math.max(0, character.gold - Math.min(character.gold, 15));
        await store.set(character.userId, character);
        persisted = true;
        log += '\n💫 You were defeated! Rest at the inn with `/heal`.';
        collector.stop('defeat');
        return interaction.editReply({ embeds: [battleEmbed(character, enemy, log)], components: finishedComponents() });
      }
      await store.set(character.userId, character);
      persisted = true;
      return interaction.editReply({ embeds: [battleEmbed(character, enemy, log)], components: activeComponents() });
    } catch (error) {
      if (error.code !== 'CHARACTER_CONFLICT') console.error('Could not process battle turn:', error);
      const latest = store.get(userId);
      if (latest?.characterId === character.characterId) character = latest;
      const notice = persisted
        ? '✅ Your turn was saved, but the battle panel could not refresh. Reopen `/adventure` to continue.'
        : error.code === 'CHARACTER_CONFLICT'
          ? '⚠️ Another command changed the same character data during this turn. That saved progress was kept, this turn was not applied, and the battle was closed safely.'
          : '⚠️ This battle turn could not be saved, so the battle was closed without reporting success.';
      collector.stop('error');
      const payload = { embeds: [battleEmbed(character, enemy, notice)], components: finishedComponents() };
      if (acknowledged || button.deferred) await interaction.editReply(payload).catch(() => {});
      else if (!button.replied) await button.update(payload).catch(() => {});
    } finally {
      processing = false;
    }
  });
  collector.on('end', async (_, reason) => {
    activeBattles.delete(userId);
    if (reason === 'time') await interaction.editReply({ components: finishedComponents() }).catch(() => {});
  });
}

module.exports = { runAdventure };
