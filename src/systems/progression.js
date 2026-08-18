const { STATS, MASTER_CLASSES } = require('../content');
const { QUESTS, ACHIEVEMENTS } = require('../content/progression');
const { normalizeCharacter, setCharacterLevel } = require('../game');
const { ascensionPowerMultiplier } = require('./combat-scaling');

const dateKey = (now = Date.now()) => new Date(now).toISOString().slice(0, 10);

function normalizeProgression(character, now = Date.now()) {
  const baseline = () => ({ wins: character.wins || 0, highestStage: character.highestStage || 1, itemsFound: character.itemsFound || 0 });
  character.questState ||= { date: dateKey(now), claimed: [], baseline: { wins: 0, highestStage: 1, itemsFound: 0 } };
  character.questState.baseline = { ...baseline(), ...(character.questState.baseline || {}) };
  if (character.questState.date !== dateKey(now)) character.questState = { date: dateKey(now), claimed: [], baseline: baseline() };
  character.achievementPoints ??= 0;
  character.claimedAchievements ||= [];
  character.ascensions ??= 0;
  character.ascensionPoints ??= 0;
  character.towerFloor ??= 0;
  return character;
}

function metric(character, field) {
  if (field === 'highestFloor') return Math.max(...Object.values(character.worldProgress || { 1: 1 }));
  if (field === 'items') return character.inventory?.length || 0;
  if (field === 'tower') return character.towerFloor || 0;
  return character[field] || 0;
}

function questStatus(character, now = Date.now()) {
  normalizeCharacter(character); normalizeProgression(character, now);
  return QUESTS.map((quest) => ({ ...quest, progress: Math.min(quest.goal, Math.max(0, metric(character, quest.field) - (character.questState.baseline[quest.field] || 0))), claimed: character.questState.claimed.includes(quest.id) }));
}

function claimQuest(character, questId, now = Date.now()) {
  const quest = questStatus(character, now).find((entry) => entry.id === questId);
  if (!quest) return { ok: false, message: 'Quest not found.' };
  if (quest.claimed) return { ok: false, message: 'That quest is already claimed.' };
  if (quest.progress < quest.goal) return { ok: false, message: 'That quest is incomplete.' };
  character.questState.claimed.push(quest.id); character.gold += quest.reward.gold;
  character.materials ||= { dust: 0 }; character.materials.dust += quest.reward.dust;
  return { ok: true, quest };
}

function achievementStatus(character) {
  normalizeCharacter(character); normalizeProgression(character);
  return ACHIEVEMENTS.map((achievement) => ({ ...achievement, progress: Math.min(achievement.goal, metric(character, achievement.field)), claimed: character.claimedAchievements.includes(achievement.id) }));
}

function claimAchievement(character, achievementId) {
  const achievement = achievementStatus(character).find((entry) => entry.id === achievementId);
  if (!achievement) return { ok: false, message: 'Achievement not found.' };
  if (achievement.claimed) return { ok: false, message: 'That achievement is already claimed.' };
  if (achievement.progress < achievement.goal) return { ok: false, message: 'That achievement is incomplete.' };
  character.claimedAchievements.push(achievement.id); character.achievementPoints += achievement.points;
  return { ok: true, achievement };
}

function ascend(character) {
  normalizeCharacter(character); normalizeProgression(character);
  if (character.level < 1000) return { ok: false, message: 'Reach level 1000 before ascending.' };
  const gained = 1 + Math.floor(character.achievementPoints / 100);
  character.ascensions += 1; character.ascensionPoints += gained;
  character.level = 1; character.xp = 0; character.world = 1; character.floor = 1; character.unlockedWorld = 1; character.worldProgress = { 1: 1 };
  character.stats = Object.fromEntries(Object.keys(STATS).map((key) => [key, 1 + (character.adminGrantedStats?.[key] || 0)]));
  const specialization = (MASTER_CLASSES[character.classId] || []).find((choice) => choice.id === character.specialization);
  for (const stat of ['agility', 'luck']) character.stats[stat] += specialization?.bonus?.[stat] || 0;
  setCharacterLevel(character, 1);
  return { ok: true, gained, ascensions: character.ascensions, multiplier: ascensionPowerMultiplier(character.ascensionPoints) };
}

module.exports = { dateKey, normalizeProgression, questStatus, claimQuest, achievementStatus, claimAchievement, ascend };
