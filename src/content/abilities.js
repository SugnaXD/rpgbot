const ABILITIES = {
  warrior: [
    { id: 'power_strike', name: 'Power Strike', mana: 20, cooldown: 2, multiplier: 1.8, description: 'A heavy single-target attack.' },
    { id: 'second_wind', name: 'Second Wind', mana: 30, cooldown: 3, healPercent: 0.25, description: 'Restore 25% of maximum HP.' },
  ],
  rogue: [
    { id: 'backstab', name: 'Backstab', mana: 18, cooldown: 2, multiplier: 2.1, description: 'A high-damage precision strike.' },
    { id: 'vanish', name: 'Vanish', mana: 24, cooldown: 3, shield: 0.65, description: 'Reduce the next incoming hit by 65%.' },
  ],
  mage: [
    { id: 'arcane_blast', name: 'Arcane Blast', mana: 25, cooldown: 2, multiplier: 2.4, description: 'Convert mana into heavy magic damage.' },
    { id: 'renewal', name: 'Renewal', mana: 35, cooldown: 3, healPercent: 0.35, description: 'Restore 35% of maximum HP.' },
  ],
  admin: [
    { id: 'smite', name: 'Smite', mana: 1, cooldown: 1, multiplier: 10, description: 'Admin-only overwhelming damage.' },
    { id: 'restore', name: 'Restore', mana: 1, cooldown: 1, healPercent: 1, description: 'Completely restore HP.' },
  ],
};

module.exports = { ABILITIES };
