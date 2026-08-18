const QUESTS = [
  { id: 'daily_battles', name: 'Monster Hunter', field: 'wins', goal: 10, reward: { gold: 250, dust: 25 } },
  { id: 'daily_floor', name: 'Push Forward', field: 'highestStage', goal: 5, reward: { gold: 180, dust: 20 } },
  { id: 'daily_loot', name: 'Treasure Seeker', field: 'itemsFound', goal: 5, reward: { gold: 150, dust: 30 } },
];

const ACHIEVEMENTS = [
  { id: 'level_10', name: 'Promising Hero', field: 'level', goal: 10, points: 5 },
  { id: 'level_100', name: 'Centurion', field: 'level', goal: 100, points: 25 },
  { id: 'wins_100', name: 'Veteran', field: 'wins', goal: 100, points: 20 },
  { id: 'world_5', name: 'Realmwalker', field: 'unlockedWorld', goal: 5, points: 30 },
  { id: 'ascend_1', name: 'Reborn', field: 'ascensions', goal: 1, points: 50 },
  { id: 'tower_25', name: 'Towering', field: 'tower', goal: 25, points: 25 },
];

const DUNGEONS = {
  crypt: { name: 'Forgotten Crypt', requirement: 75, gold: 300, dust: 40, emoji: '🪦' },
  volcano: { name: 'Molten Sanctum', requirement: 350, gold: 1200, dust: 130, emoji: '🌋' },
  void: { name: 'Void Cathedral', requirement: 1200, gold: 5000, dust: 400, emoji: '🕳️' },
};

module.exports = { QUESTS, ACHIEVEMENTS, DUNGEONS };
