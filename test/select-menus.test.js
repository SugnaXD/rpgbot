const test = require('node:test');
const assert = require('node:assert/strict');
const {
  EMPTY_OPTION_VALUE,
  MAX_SELECT_OPTIONS,
  buildPagedStringSelect,
  createMenuCustomIdCodec,
  normalizeOptions,
  paginateOptions,
} = require('../src/ui/select-menus');

const options = (count) => Array.from({ length: count }, (_, index) => ({
  label: `Item ${index + 1}`,
  description: `Description ${index + 1}`,
  value: `item-${index + 1}`,
}));

test('paginateOptions bounds every Discord menu page to 25 options', () => {
  const first = paginateOptions(options(61));
  const last = paginateOptions(options(61), 99);
  assert.equal(first.items.length, MAX_SELECT_OPTIONS);
  assert.equal(first.pageCount, 3);
  assert.equal(first.hasNext, true);
  assert.equal(last.page, 2);
  assert.equal(last.items.length, 11);
  assert.equal(last.hasNext, false);
});

test('buildPagedStringSelect emits a menu and navigable pagination buttons', () => {
  const codec = createMenuCustomIdCodec({ secret: 'a sufficiently long test secret' });
  const result = buildPagedStringSelect({
    scope: 'inventory', action: 'equip', context: 'user-123', options: options(30), page: 1, codec,
  });
  const menu = result.rows[0].toJSON().components[0];
  const buttons = result.rows[1].toJSON().components;

  assert.equal(result.page, 1);
  assert.equal(menu.options.length, 5);
  assert.match(menu.placeholder, /\(2\/2\)$/);
  assert.equal(buttons[0].disabled, false);
  assert.equal(buttons[1].disabled, true);
  assert.deepEqual(codec.parse(menu.custom_id, { scope: 'inventory', action: 'equip', kind: 'select' }), {
    scope: 'inventory', action: 'equip', kind: 'select', page: 1, context: 'user-123',
  });
  assert.equal(codec.parse(buttons[0].custom_id, { kind: 'page' }).page, 0);
});

test('empty menus contain one inert option and are always disabled', () => {
  const result = buildPagedStringSelect({
    scope: 'guild', action: 'member', options: [], emptyLabel: 'No guild members',
  });
  const menu = result.rows[0].toJSON().components[0];
  assert.equal(result.empty, true);
  assert.equal(result.rows.length, 1);
  assert.equal(menu.disabled, true);
  assert.equal(menu.options.length, 1);
  assert.equal(menu.options[0].value, EMPTY_OPTION_VALUE);
  assert.equal(menu.options[0].label, 'No guild members');
});

test('menus clamp selection bounds and excess defaults on short final pages', () => {
  const entries = options(27).map((option) => ({ ...option, default: true }));
  const result = buildPagedStringSelect({
    scope: 'craft', action: 'salvage', options: entries, page: 1, minValues: 3, maxValues: 10,
  });
  const menu = result.rows[0].toJSON().components[0];
  assert.equal(menu.min_values, 2);
  assert.equal(menu.max_values, 2);
  assert.equal(menu.options.filter((option) => option.default).length, 2);
});

test('signed custom IDs reject tampering, malformed payloads, and unexpected routes', () => {
  const codec = createMenuCustomIdCodec({ prefix: 'rpg', secret: 'another sufficiently long secret' });
  const id = codec.encode({ scope: 'raid', action: 'role', kind: 'select', page: 3, context: '42' });
  const tampered = `${id.slice(0, -1)}${id.endsWith('A') ? 'B' : 'A'}`;

  assert.equal(codec.parse(tampered), null);
  assert.equal(codec.parse('rpg.not-json.not-a-signature'), null);
  assert.equal(codec.parse(id, { action: 'attack' }), null);
  assert.equal(codec.parse(id).page, 3);
  assert.ok(id.length <= 100);
});

test('option normalization truncates presentation text but rejects unsafe identifiers', () => {
  const [normalized] = normalizeOptions([{ label: 'x'.repeat(120), description: 'y'.repeat(120), value: 'safe-id' }]);
  assert.equal(normalized.label.length, 100);
  assert.equal(normalized.description.length, 100);
  assert.throws(() => normalizeOptions([{ label: 'One', value: 'z'.repeat(101) }]), /cannot exceed 100/);
  assert.throws(() => normalizeOptions([
    { label: 'One', value: 'same' }, { label: 'Two', value: 'same' },
  ]), /Duplicate/);
});

test('custom ID encoding enforces field and Discord length constraints', () => {
  const codec = createMenuCustomIdCodec({ secret: 'a sufficiently long test secret' });
  assert.throws(() => codec.encode({ scope: '../bad', action: 'view' }), /scope/);
  assert.throws(() => codec.encode({
    scope: 'sixteen_chars_ok', action: 'sixteen_chars_ok', context: 'x'.repeat(32),
  }), /exceeds Discord/);
});
