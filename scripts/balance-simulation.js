'use strict';

const { createHash } = require('node:crypto');

const {
  MAX_LEVEL,
  STAGE_GROWTH,
  diminishingDefenseMultiplier,
  enemyScalingDescriptor,
} = require('../src/systems/combat-scaling');
const {
  MAX_ADMIN_POWER,
  MAX_ADMIN_STAT,
  MAX_LEGACY_POWER,
  MAX_NATURAL_POWER,
  MAX_STAT_PERCENTAGE,
  MAX_UPGRADE_LEVEL,
  RARITY_POWER_FACTORS,
  STAT_SCALES,
  legacyStatCap,
  naturalBaseStat,
  naturalItemPower,
  naturalPowerDetails,
  naturalStatCap,
  recalculateNaturalItem,
  snapshotLegacyItem,
  upgradeMultiplier,
  upgradedNaturalStat,
  worldFloorFromStage,
} = require('../src/systems/item-power');

const CHECKPOINT_LEVELS = Object.freeze([50, 250, 1000]);
const RARITIES = Object.freeze(Object.keys(RARITY_POWER_FACTORS));
const STATS = Object.freeze(Object.keys(STAT_SCALES));
const ITEM_LOCATIONS = Object.freeze([
  Object.freeze({ label: 'W1F1', stage: 1 }),
  Object.freeze({ label: 'W1F10', stage: 10 }),
  Object.freeze({ label: 'W2F10', stage: 20 }),
  Object.freeze({ label: 'W3F10', stage: 30 }),
  Object.freeze({ label: 'W4F10', stage: 40 }),
  Object.freeze({ label: 'W5F10', stage: 50 }),
]);
const COMBAT_LOCATIONS = Object.freeze(ITEM_LOCATIONS.map((location) => Object.freeze({
  ...worldFloorFromStage(location.stage),
  label: location.label,
  isBoss: location.stage % 10 === 0,
})));

const EPSILON = 1e-10;

function balancedBaseline(level) {
  const boundedLevel = Math.max(1, Math.min(MAX_LEVEL, Math.floor(Number(level) || 1)));
  return {
    level: boundedLevel,
    attack: 4 * boundedLevel + 11,
    hp: 17 * boundedLevel + 83,
    defense: 3 * boundedLevel + 5,
    critChance: Math.min(0.5, 0.12 + boundedLevel * 0.001),
  };
}

function fightMetrics(enemy, player) {
  const expectedPlayerDamage = player.attack * (1 + player.critChance * 0.75);
  const expectedIncomingDamage = enemy.exact.attack / diminishingDefenseMultiplier(player.defense);
  return {
    expectedPlayerDamage,
    rounds: enemy.exact.hp / expectedPlayerDamage,
    incomingHitRatio: expectedIncomingDamage / player.hp,
  };
}

function combatMilestones() {
  return CHECKPOINT_LEVELS.flatMap((level) => {
    const player = balancedBaseline(level);
    return COMBAT_LOCATIONS.map((location) => {
      const enemy = enemyScalingDescriptor({
        world: location.worldId,
        floor: location.floor,
        level,
        isBoss: location.isBoss,
        variant: 'balanced',
      });
      const metrics = fightMetrics(enemy, player);
      return {
        level,
        location: location.label,
        enemy: location.isBoss ? 'boss' : 'regular',
        hp: enemy.hp,
        attack: enemy.attack,
        xp: enemy.xp,
        gold: enemy.gold,
        rounds: metrics.rounds,
        incomingHitRatio: metrics.incomingHitRatio,
      };
    });
  });
}

function itemMilestones() {
  return RARITIES.map((rarity) => ({
    rarity,
    factor: RARITY_POWER_FACTORS[rarity],
    powers: Object.fromEntries(ITEM_LOCATIONS.map((location) => {
      const { worldId, floor } = worldFloorFromStage(location.stage);
      return [location.label, naturalItemPower({
        worldId,
        floor,
        itemLevel: location.stage * 20,
        rarity,
      })];
    })),
  }));
}

function farmCapMilestones() {
  const locations = [ITEM_LOCATIONS[0], ITEM_LOCATIONS[1]];
  return locations.flatMap((location) => ['common', 'secret'].map((rarity) => {
    const { worldId, floor } = worldFloorFromStage(location.stage);
    const capLevel = location.stage * 20;
    const atCap = naturalPowerDetails({ worldId, floor, itemLevel: capLevel, rarity });
    const overlevelled = naturalPowerDetails({ worldId, floor, itemLevel: 1000, rarity });
    return {
      location: location.label,
      rarity,
      capLevel,
      cappedScaledLevel: atCap.scaledLevel,
      overlevelScaledLevel: overlevelled.scaledLevel,
      cappedPower: atCap.power,
      overlevelPower: overlevelled.power,
      same: atCap.power === overlevelled.power,
    };
  }));
}

function upgradeMilestones() {
  const { worldId, floor } = worldFloorFromStage(50);
  const power = naturalItemPower({ worldId, floor, itemLevel: 1000, rarity: 'secret' });
  const rows = STATS.map((stat) => {
    const baseStat = naturalBaseStat({ power, percentage: MAX_STAT_PERCENTAGE, stat });
    return {
      stat,
      base: upgradedNaturalStat({ baseStat, stat, upgradeLevel: 0 }),
      plus10: upgradedNaturalStat({ baseStat, stat, upgradeLevel: 10 }),
      plus20: upgradedNaturalStat({ baseStat, stat, upgradeLevel: 20 }),
      capAt20: naturalStatCap(stat, 20),
    };
  });
  return {
    source: 'W5F10 secret, item level 1000, 25% roll',
    power,
    multipliers: {
      plus0: upgradeMultiplier(0),
      plus10: upgradeMultiplier(10),
      plus20: upgradeMultiplier(20),
    },
    rows,
  };
}

function approximatelyEqual(left, right, epsilon = EPSILON) {
  return Math.abs(left - right) <= epsilon * Math.max(1, Math.abs(left), Math.abs(right));
}

function guardrail(id, target, observed, pass) {
  return { id, target, observed, pass: Boolean(pass) };
}

function combatContinuityGuardrail() {
  let minimumThreatGrowth = Infinity;
  let maximumThreatGrowth = -Infinity;
  let minimumHpGrowth = Infinity;
  let maximumHpGrowth = -Infinity;
  let pass = true;

  for (const level of CHECKPOINT_LEVELS) {
    let previous;
    for (let stage = 1; stage <= 50; stage += 1) {
      const { worldId, floor } = worldFloorFromStage(stage);
      const enemy = enemyScalingDescriptor({
        world: worldId,
        floor,
        level,
        isBoss: false,
        variant: 'balanced',
      });
      const threat = enemy.exact.hp * enemy.exact.attack;
      if (previous) {
        const hpGrowth = enemy.exact.hp / previous.hp;
        const attackGrowth = enemy.exact.attack / previous.attack;
        const threatGrowth = threat / previous.threat;
        minimumHpGrowth = Math.min(minimumHpGrowth, hpGrowth, attackGrowth);
        maximumHpGrowth = Math.max(maximumHpGrowth, hpGrowth, attackGrowth);
        minimumThreatGrowth = Math.min(minimumThreatGrowth, threatGrowth);
        maximumThreatGrowth = Math.max(maximumThreatGrowth, threatGrowth);
        pass &&= enemy.exact.hp > previous.hp
          && enemy.exact.attack > previous.attack
          && threat > previous.threat
          && approximatelyEqual(hpGrowth, STAGE_GROWTH)
          && approximatelyEqual(attackGrowth, STAGE_GROWTH);
      }
      previous = { hp: enemy.exact.hp, attack: enemy.exact.attack, threat };
    }
  }

  return guardrail(
    'combat-stage-continuity',
    '50 regular stages monotonic; +6.25% HP/ATK each stage',
    `HP/ATK ${formatDecimal(minimumHpGrowth, 4)}-${formatDecimal(maximumHpGrowth, 4)}x; threat ${formatDecimal(minimumThreatGrowth, 4)}-${formatDecimal(maximumThreatGrowth, 4)}x`,
    pass,
  );
}

function bossSpikeGuardrail() {
  let minimumHpRatio = Infinity;
  let maximumHpRatio = -Infinity;
  let minimumAttackRatio = Infinity;
  let maximumAttackRatio = -Infinity;
  let minimumThreatRatio = Infinity;
  let maximumThreatRatio = -Infinity;
  let pass = true;

  for (const level of CHECKPOINT_LEVELS) {
    for (let world = 1; world <= 5; world += 1) {
      const prior = enemyScalingDescriptor({ world, floor: 9, level, isBoss: false });
      const boss = enemyScalingDescriptor({ world, floor: 10, level, isBoss: true });
      const hpRatio = boss.exact.hp / prior.exact.hp;
      const attackRatio = boss.exact.attack / prior.exact.attack;
      const threatRatio = (boss.exact.hp * boss.exact.attack)
        / (prior.exact.hp * prior.exact.attack);
      minimumHpRatio = Math.min(minimumHpRatio, hpRatio);
      maximumHpRatio = Math.max(maximumHpRatio, hpRatio);
      minimumAttackRatio = Math.min(minimumAttackRatio, attackRatio);
      maximumAttackRatio = Math.max(maximumAttackRatio, attackRatio);
      minimumThreatRatio = Math.min(minimumThreatRatio, threatRatio);
      maximumThreatRatio = Math.max(maximumThreatRatio, threatRatio);
      pass &&= hpRatio >= 2.6 && hpRatio <= 2.7
        && attackRatio >= 1.8 && attackRatio <= 1.9
        && threatRatio >= 4.8 && threatRatio <= 5.1;
    }
  }

  return guardrail(
    'boss-vs-prior-regular',
    'HP 2.6-2.7x; ATK 1.8-1.9x; threat 4.8-5.1x',
    `HP ${formatRange(minimumHpRatio, maximumHpRatio)}; ATK ${formatRange(minimumAttackRatio, maximumAttackRatio)}; threat ${formatRange(minimumThreatRatio, maximumThreatRatio)}`,
    pass,
  );
}

function finalBossPacingGuardrails() {
  const metrics = CHECKPOINT_LEVELS.map((level) => {
    const enemy = enemyScalingDescriptor({ world: 5, floor: 10, level, isBoss: true });
    return { level, ...fightMetrics(enemy, balancedBaseline(level)) };
  });
  const rounds = metrics.map((entry) => entry.rounds);
  const incoming = metrics.map((entry) => entry.incomingHitRatio);
  const roundText = metrics.map((entry) => `L${entry.level} ${formatDecimal(entry.rounds, 2)}`).join(', ');
  const incomingText = metrics
    .map((entry) => `L${entry.level} ${formatPercent(entry.incomingHitRatio, 1)}`)
    .join(', ');
  return [
    guardrail(
      'final-boss-rounds',
      'W5F10 takes 7-9 expected rounds at L50/L250/L1000',
      roundText,
      rounds.every((roundCount) => roundCount >= 7 && roundCount <= 9),
    ),
    guardrail(
      'final-boss-incoming-hit',
      'one mitigated hit is 6-15% of balanced baseline HP',
      incomingText,
      incoming.every((ratio) => ratio >= 0.06 && ratio <= 0.15),
    ),
  ];
}

function dropContinuityGuardrail() {
  let minimumStep = Infinity;
  let maximumStep = -Infinity;
  let pass = true;

  for (const rarity of RARITIES) {
    let previous;
    for (let stage = 1; stage <= 50; stage += 1) {
      const { worldId, floor } = worldFloorFromStage(stage);
      const power = naturalItemPower({
        worldId,
        floor,
        itemLevel: stage * 20,
        rarity,
      });
      if (previous !== undefined) {
        const step = power - previous;
        minimumStep = Math.min(minimumStep, step);
        maximumStep = Math.max(maximumStep, step);
        pass &&= step > 0;
      }
      previous = power;
    }
  }

  return guardrail(
    'natural-drop-continuity',
    'matched-level power strictly increases across all 50 stages/all rarities',
    `integer step +${minimumStep} to +${maximumStep}`,
    pass,
  );
}

function rarityBoundsGuardrail() {
  const factors = RARITIES.map((rarity) => RARITY_POWER_FACTORS[rarity]);
  const adjacentRatios = factors.slice(1).map((factor, index) => factor / factors[index]);
  const pass = factors.every((factor, index) => factor >= 1
      && factor <= 1.6
      && (index === 0 || factor > factors[index - 1]))
    && adjacentRatios.every((ratio) => ratio <= 1.1);
  return guardrail(
    'rarity-factor-bounds',
    'strictly increasing 1.00-1.60x; adjacent jump <=1.10x',
    `${factors.map((factor) => formatDecimal(factor, 2)).join(' / ')}; max adjacent ${formatDecimal(Math.max(...adjacentRatios), 3)}x`,
    pass,
  );
}

function farmCapGuardrail() {
  let checks = 0;
  let pass = true;
  for (let floor = 1; floor <= 10; floor += 1) {
    const stage = floor;
    for (const rarity of RARITIES) {
      const capped = naturalPowerDetails({
        worldId: 1,
        floor,
        itemLevel: stage * 20,
        rarity,
      });
      const overlevelled = naturalPowerDetails({
        worldId: 1,
        floor,
        itemLevel: 1000,
        rarity,
      });
      checks += 1;
      pass &&= capped.scaledLevel === overlevelled.scaledLevel
        && capped.power === overlevelled.power;
    }
  }
  return guardrail(
    'low-world-overlevel-cap',
    'L1000 cannot exceed stage x20 item budget on W1',
    `${checks}/${checks} W1 floor/rarity comparisons capped`,
    pass,
  );
}

function upgradeBudgetGuardrail() {
  const actual = [upgradeMultiplier(0), upgradeMultiplier(10), upgradeMultiplier(20)];
  const pass = actual[0] === 1 && actual[1] === 1.2 && actual[2] === 1.4
    && MAX_UPGRADE_LEVEL === 20;
  return guardrail(
    'upgrade-budget',
    '+0=1.00x, +10=1.20x, +20=1.40x; hard cap +20',
    `+0 ${formatDecimal(actual[0], 2)}x / +10 ${formatDecimal(actual[1], 2)}x / +20 ${formatDecimal(actual[2], 2)}x; cap +${MAX_UPGRADE_LEVEL}`,
    pass,
  );
}

function finiteCapsGuardrail() {
  let enemyValues = 0;
  let itemValues = 0;
  let statValues = 0;
  let pass = true;

  for (const level of [1, ...CHECKPOINT_LEVELS, Infinity]) {
    for (let stage = 1; stage <= 50; stage += 1) {
      const { worldId, floor } = worldFloorFromStage(stage);
      for (const isBoss of [false, true]) {
        const enemy = enemyScalingDescriptor({ world: worldId, floor, level, isBoss });
        for (const value of [enemy.hp, enemy.attack, enemy.xp, enemy.gold]) {
          enemyValues += 1;
          pass &&= Number.isFinite(value) && value >= 1 && value <= Number.MAX_SAFE_INTEGER;
        }
      }
    }
  }

  for (const rarity of [...RARITIES, 'unknown']) {
    for (let stage = 1; stage <= 50; stage += 1) {
      const { worldId, floor } = worldFloorFromStage(stage);
      for (const itemLevel of [1, stage * 20, 1000, Infinity]) {
        const power = naturalItemPower({ worldId, floor, itemLevel, rarity });
        itemValues += 1;
        pass &&= Number.isFinite(power) && power >= 1 && power <= MAX_NATURAL_POWER;
      }
    }
  }

  for (const stat of STATS) {
    for (const upgradeLevel of [0, 10, 20, Infinity]) {
      const baseStat = naturalBaseStat({
        power: Infinity,
        percentage: Infinity,
        stat,
      });
      const upgraded = upgradedNaturalStat({ baseStat: Infinity, stat, upgradeLevel });
      const cap = naturalStatCap(stat, upgradeLevel);
      const legacyCap = legacyStatCap(stat);
      for (const [value, maximum] of [
        [baseStat, naturalStatCap(stat, 0)],
        [upgraded, cap],
        [cap, naturalStatCap(stat, 20)],
        [legacyCap, naturalStatCap(stat, 20) * 8],
      ]) {
        statValues += 1;
        pass &&= Number.isFinite(value) && value >= 0 && value <= maximum;
      }
    }
  }

  const admin = recalculateNaturalItem({
    adminCreated: true,
    power: Infinity,
    upgradeLevel: Infinity,
    stats: Object.fromEntries(STATS.map((stat) => [stat, Infinity])),
  });
  pass &&= Number.isFinite(admin.power) && admin.power === MAX_ADMIN_POWER;
  for (const value of Object.values(admin.stats)) {
    statValues += 1;
    pass &&= Number.isFinite(value) && value === MAX_ADMIN_STAT;
  }

  const legacy = snapshotLegacyItem({
    power: Infinity,
    upgradeLevel: Infinity,
    stats: Object.fromEntries(STATS.map((stat) => [stat, Infinity])),
  });
  pass &&= Number.isFinite(legacy.power) && legacy.power === MAX_LEGACY_POWER;
  for (const [stat, value] of Object.entries(legacy.stats)) {
    statValues += 1;
    pass &&= Number.isFinite(value) && value <= legacyStatCap(stat);
  }

  return guardrail(
    'finite-hard-caps',
    'enemy/item/stat/admin/legacy outputs remain finite and within exported caps',
    `${enemyValues} enemy, ${itemValues} item, ${statValues} stat values checked`,
    pass,
  );
}

function buildGuardrails() {
  return [
    combatContinuityGuardrail(),
    bossSpikeGuardrail(),
    ...finalBossPacingGuardrails(),
    dropContinuityGuardrail(),
    rarityBoundsGuardrail(),
    farmCapGuardrail(),
    upgradeBudgetGuardrail(),
    finiteCapsGuardrail(),
  ];
}

function buildTargetReport() {
  const report = {
    model: {
      stageGrowth: STAGE_GROWTH,
      levels: CHECKPOINT_LEVELS,
      naturalPowerCap: MAX_NATURAL_POWER,
      upgradeCap: MAX_UPGRADE_LEVEL,
    },
    combat: combatMilestones(),
    items: itemMilestones(),
    farmCaps: farmCapMilestones(),
    upgrades: upgradeMilestones(),
    guardrails: buildGuardrails(),
  };
  report.signature = createHash('sha256')
    .update(JSON.stringify(report))
    .digest('hex')
    .slice(0, 16);
  return report;
}

function formatInteger(value) {
  return Math.round(value).toLocaleString('en-US');
}

function formatDecimal(value, places = 2) {
  return Number(value).toFixed(places);
}

function formatPercent(value, places = 1) {
  return `${(Number(value) * 100).toFixed(places)}%`;
}

function formatRange(minimum, maximum, places = 3) {
  if (approximatelyEqual(minimum, maximum)) return `${formatDecimal(minimum, places)}x`;
  return `${formatDecimal(minimum, places)}-${formatDecimal(maximum, places)}x`;
}

function table(headers, rows) {
  const normalizedRows = rows.map((row) => row.map((cell) => String(cell)));
  const widths = headers.map((header, index) => Math.max(
    String(header).length,
    ...normalizedRows.map((row) => (row[index] || '').length),
  ));
  const formatRow = (row) => row
    .map((cell, index) => String(cell).padEnd(widths[index]))
    .join('  ')
    .trimEnd();
  return [
    formatRow(headers),
    formatRow(widths.map((width) => '-'.repeat(width))),
    ...normalizedRows.map(formatRow),
  ].join('\n');
}

function renderReport(report) {
  const sections = [
    'IdleRPG target balance simulation',
    `Model: 50 stages @ ${(STAGE_GROWTH - 1) * 100}% growth | natural item cap ${MAX_NATURAL_POWER} | upgrade cap +${MAX_UPGRADE_LEVEL}`,
    '',
    'Combat milestones (balanced Warrior baseline)',
    table(
      ['Level', 'Stage', 'Enemy', 'HP', 'ATK', 'XP', 'Gold', 'Rounds', 'Hit/HP'],
      report.combat.map((entry) => [
        entry.level,
        entry.location,
        entry.enemy,
        formatInteger(entry.hp),
        formatInteger(entry.attack),
        formatInteger(entry.xp),
        formatInteger(entry.gold),
        formatDecimal(entry.rounds, 2),
        formatPercent(entry.incomingHitRatio, 1),
      ]),
    ),
    '',
    'Natural item power milestones (matched item level = stage x20)',
    table(
      ['Rarity', 'Factor', ...ITEM_LOCATIONS.map((location) => location.label)],
      report.items.map((entry) => [
        entry.rarity,
        `${formatDecimal(entry.factor, 2)}x`,
        ...ITEM_LOCATIONS.map((location) => entry.powers[location.label]),
      ]),
    ),
    '',
    'Low-world overlevel farm cap',
    table(
      ['Stage', 'Rarity', 'Cap lvl', 'Scaled @cap', 'Scaled @L1000', 'Power @cap', 'Power @L1000', 'Equal'],
      report.farmCaps.map((entry) => [
        entry.location,
        entry.rarity,
        entry.capLevel,
        entry.cappedScaledLevel,
        entry.overlevelScaledLevel,
        entry.cappedPower,
        entry.overlevelPower,
        entry.same ? 'yes' : 'NO',
      ]),
    ),
    '',
    `Upgrade/stat milestones (${report.upgrades.source}; power ${report.upgrades.power})`,
    `Multipliers: +0 ${formatDecimal(report.upgrades.multipliers.plus0, 2)}x | +10 ${formatDecimal(report.upgrades.multipliers.plus10, 2)}x | +20 ${formatDecimal(report.upgrades.multipliers.plus20, 2)}x`,
    table(
      ['Stat', '+0', '+10', '+20', 'Natural cap +20'],
      report.upgrades.rows.map((entry) => [
        entry.stat,
        entry.base,
        entry.plus10,
        entry.plus20,
        entry.capAt20,
      ]),
    ),
    '',
    'Deterministic guardrails',
    table(
      ['Result', 'Guardrail', 'Target', 'Observed'],
      report.guardrails.map((entry) => [
        entry.pass ? 'PASS' : 'FAIL',
        entry.id,
        entry.target,
        entry.observed,
      ]),
    ),
    '',
    `Overall: ${report.guardrails.every((entry) => entry.pass) ? 'PASS' : 'FAIL'}`,
    `Deterministic signature: ${report.signature}`,
  ];
  return sections.join('\n');
}

if (require.main === module) {
  const report = buildTargetReport();
  if (process.argv.includes('--json')) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    process.stdout.write(`${renderReport(report)}\n`);
  }
  if (report.guardrails.some((entry) => !entry.pass)) process.exitCode = 1;
}

module.exports = {
  balancedBaseline,
  buildTargetReport,
  fightMetrics,
  renderReport,
};
