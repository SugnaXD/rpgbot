const { createHmac, timingSafeEqual } = require('node:crypto');
const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
} = require('discord.js');

const MAX_SELECT_OPTIONS = 25;
const MAX_CUSTOM_ID_LENGTH = 100;
const EMPTY_OPTION_VALUE = '__no_options__';
const ID_PART_PATTERN = /^[a-zA-Z0-9_-]+$/;
const BASE64URL_PATTERN = /^[a-zA-Z0-9_-]+$/;

function boundedText(value, field, maximum, { optional = false } = {}) {
  if (value === undefined || value === null) {
    if (optional) return undefined;
    throw new TypeError(`${field} must be a string.`);
  }
  if (typeof value !== 'string') throw new TypeError(`${field} must be a string.`);
  const normalized = value.trim();
  if (!normalized) {
    if (optional) return undefined;
    throw new RangeError(`${field} cannot be empty.`);
  }
  return normalized.slice(0, maximum);
}

function validateIdPart(value, field, maximum = 16) {
  if (typeof value !== 'string' || !value || value.length > maximum || !ID_PART_PATTERN.test(value)) {
    throw new RangeError(`${field} must contain 1-${maximum} letters, numbers, underscores, or hyphens.`);
  }
  return value;
}

function validatePage(value) {
  if (!Number.isSafeInteger(value) || value < 0 || value > 9999) {
    throw new RangeError('page must be an integer between 0 and 9999.');
  }
  return value;
}

function validateContext(value) {
  if (value === undefined || value === null) return null;
  if ((typeof value !== 'string' && typeof value !== 'number') || String(value).length > 32) {
    throw new RangeError('context must be a string or number no longer than 32 characters.');
  }
  return value;
}

/**
 * Creates a compact codec for Discord component custom IDs.
 *
 * Parsing is deliberately fail-closed and returns null for all untrusted input.
 * Supply a secret of at least 16 bytes to authenticate IDs with a truncated HMAC.
 */
function createMenuCustomIdCodec({ prefix = 'rm', secret } = {}) {
  validateIdPart(prefix, 'prefix', 8);
  const key = secret === undefined ? null : Buffer.from(secret);
  if (key && key.length < 16) throw new RangeError('secret must contain at least 16 bytes.');

  function signature(base) {
    return createHmac('sha256', key).update(base).digest().subarray(0, 9).toString('base64url');
  }

  function encode({ scope, action, kind = 'select', page = 0, context = null }) {
    const data = [
      validateIdPart(scope, 'scope'),
      validateIdPart(action, 'action'),
      validateIdPart(kind, 'kind', 8),
      validatePage(page),
      validateContext(context),
    ];
    const payload = Buffer.from(JSON.stringify(data)).toString('base64url');
    const base = `${prefix}.${payload}`;
    const customId = key ? `${base}.${signature(base)}` : base;
    if (customId.length > MAX_CUSTOM_ID_LENGTH) {
      throw new RangeError(`Encoded custom ID exceeds Discord's ${MAX_CUSTOM_ID_LENGTH}-character limit.`);
    }
    return customId;
  }

  function parse(customId, expected = {}) {
    try {
      if (typeof customId !== 'string' || customId.length > MAX_CUSTOM_ID_LENGTH) return null;
      const parts = customId.split('.');
      if (parts.length !== (key ? 3 : 2) || parts[0] !== prefix || !BASE64URL_PATTERN.test(parts[1])) return null;
      const base = `${parts[0]}.${parts[1]}`;
      if (key) {
        const supplied = Buffer.from(parts[2], 'base64url');
        const wanted = Buffer.from(signature(base), 'base64url');
        if (supplied.length !== wanted.length || !timingSafeEqual(supplied, wanted)) return null;
      }

      // Reject alternative/non-canonical base64 representations before decoding.
      const decoded = Buffer.from(parts[1], 'base64url');
      if (decoded.toString('base64url') !== parts[1]) return null;
      const data = JSON.parse(decoded.toString('utf8'));
      if (!Array.isArray(data) || data.length !== 5) return null;
      const result = Object.freeze({
        scope: validateIdPart(data[0], 'scope'),
        action: validateIdPart(data[1], 'action'),
        kind: validateIdPart(data[2], 'kind', 8),
        page: validatePage(data[3]),
        context: validateContext(data[4]),
      });
      for (const field of ['scope', 'action', 'kind', 'page', 'context']) {
        if (expected[field] !== undefined && result[field] !== expected[field]) return null;
      }
      return result;
    } catch {
      return null;
    }
  }

  return Object.freeze({ encode, parse });
}

function normalizeOption(option, index) {
  if (!option || typeof option !== 'object' || Array.isArray(option)) {
    throw new TypeError(`options[${index}] must be an object.`);
  }
  const value = boundedText(option.value, `options[${index}].value`, 100);
  // Values are identifiers: silently truncating one could select the wrong entity.
  if (option.value.trim().length > 100) throw new RangeError(`options[${index}].value cannot exceed 100 characters.`);
  const normalized = {
    label: boundedText(option.label, `options[${index}].label`, 100),
    value,
  };
  const description = boundedText(option.description, `options[${index}].description`, 100, { optional: true });
  if (description) normalized.description = description;
  if (option.emoji !== undefined) normalized.emoji = option.emoji;
  if (option.default !== undefined) normalized.default = Boolean(option.default);
  return normalized;
}

function normalizeOptions(options) {
  if (!Array.isArray(options)) throw new TypeError('options must be an array.');
  const normalized = options.map(normalizeOption);
  const values = new Set();
  for (const option of normalized) {
    if (values.has(option.value)) throw new RangeError(`Duplicate select option value: ${option.value}`);
    values.add(option.value);
  }
  return normalized;
}

function paginateOptions(options, page = 0, pageSize = MAX_SELECT_OPTIONS) {
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > MAX_SELECT_OPTIONS) {
    throw new RangeError(`pageSize must be an integer between 1 and ${MAX_SELECT_OPTIONS}.`);
  }
  const normalized = normalizeOptions(options);
  const pageCount = Math.max(1, Math.ceil(normalized.length / pageSize));
  const resolvedPage = Math.min(Math.max(Number.isInteger(page) ? page : 0, 0), pageCount - 1);
  const start = resolvedPage * pageSize;
  return Object.freeze({
    items: normalized.slice(start, start + pageSize),
    page: resolvedPage,
    pageCount,
    pageSize,
    total: normalized.length,
    hasPrevious: resolvedPage > 0,
    hasNext: resolvedPage + 1 < pageCount,
  });
}

function valueBound(value, field, fallback) {
  const resolved = value === undefined ? fallback : value;
  if (!Number.isInteger(resolved) || resolved < 0 || resolved > MAX_SELECT_OPTIONS) {
    throw new RangeError(`${field} must be an integer between 0 and ${MAX_SELECT_OPTIONS}.`);
  }
  return resolved;
}

/**
 * Builds one string-select row and, when necessary, a previous/next button row.
 */
function buildPagedStringSelect({
  scope,
  action,
  context = null,
  options,
  page = 0,
  pageSize = MAX_SELECT_OPTIONS,
  placeholder = 'Choose an option',
  emptyLabel = 'Nothing available',
  emptyDescription,
  minValues = 1,
  maxValues = 1,
  disabled = false,
  codec = createMenuCustomIdCodec(),
} = {}) {
  if (!codec || typeof codec.encode !== 'function' || typeof codec.parse !== 'function') {
    throw new TypeError('codec must provide encode and parse functions.');
  }
  const pagination = paginateOptions(options, page, pageSize);
  const isEmpty = pagination.total === 0;
  const visibleOptions = isEmpty ? [{
    label: boundedText(emptyLabel, 'emptyLabel', 100),
    description: boundedText(emptyDescription, 'emptyDescription', 100, { optional: true }),
    value: EMPTY_OPTION_VALUE,
  }] : pagination.items;

  const desiredMin = valueBound(minValues, 'minValues', 1);
  const desiredMax = valueBound(maxValues, 'maxValues', 1);
  if (desiredMax < desiredMin) throw new RangeError('maxValues cannot be less than minValues.');
  const resolvedMax = isEmpty ? 1 : Math.max(1, Math.min(desiredMax, visibleOptions.length));
  const resolvedMin = isEmpty ? 1 : Math.min(desiredMin, resolvedMax);
  let defaultsRemaining = resolvedMax;
  const boundedOptions = visibleOptions.map((option) => {
    const result = { ...option };
    if (result.description === undefined) delete result.description;
    if (result.default) {
      result.default = defaultsRemaining > 0;
      defaultsRemaining -= 1;
    }
    return result;
  });

  const selectId = codec.encode({ scope, action, kind: 'select', page: pagination.page, context });
  const pageSuffix = pagination.pageCount > 1 ? ` (${pagination.page + 1}/${pagination.pageCount})` : '';
  const select = new StringSelectMenuBuilder()
    .setCustomId(selectId)
    .setPlaceholder(`${boundedText(placeholder, 'placeholder', 140)}${pageSuffix}`.slice(0, 150))
    .setMinValues(resolvedMin)
    .setMaxValues(resolvedMax)
    .setDisabled(Boolean(disabled) || isEmpty)
    .addOptions(boundedOptions);
  const rows = [new ActionRowBuilder().addComponents(select)];

  let previousId = null;
  let nextId = null;
  if (pagination.pageCount > 1) {
    previousId = codec.encode({ scope, action, kind: 'page', page: Math.max(0, pagination.page - 1), context });
    nextId = codec.encode({ scope, action, kind: 'page', page: Math.min(pagination.pageCount - 1, pagination.page + 1), context });
    rows.push(new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(previousId).setLabel('Previous').setEmoji('◀️')
        .setStyle(ButtonStyle.Secondary).setDisabled(Boolean(disabled) || !pagination.hasPrevious),
      new ButtonBuilder().setCustomId(nextId).setLabel('Next').setEmoji('▶️')
        .setStyle(ButtonStyle.Secondary).setDisabled(Boolean(disabled) || !pagination.hasNext),
    ));
  }

  return Object.freeze({
    rows,
    page: pagination.page,
    pageCount: pagination.pageCount,
    pageSize: pagination.pageSize,
    total: pagination.total,
    empty: isEmpty,
    selectId,
    previousId,
    nextId,
  });
}

module.exports = {
  EMPTY_OPTION_VALUE,
  MAX_CUSTOM_ID_LENGTH,
  MAX_SELECT_OPTIONS,
  buildPagedStringSelect,
  createMenuCustomIdCodec,
  normalizeOptions,
  paginateOptions,
};
