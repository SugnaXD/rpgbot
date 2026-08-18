const test = require('node:test');
const assert = require('node:assert/strict');
const { requestConfirmation } = require('../src/ui/confirmation');

function componentJson(payload) {
  return payload.components[0].toJSON().components;
}

function embedJson(payload) {
  return payload.embeds[0].toJSON();
}

function confirmationHarness(decision, { updateError = null, time = 250 } = {}) {
  const listeners = {};
  const updates = [];
  const edits = [];
  let initialPayload;
  let collectorOptions;

  const collector = {
    on(event, callback) {
      listeners[event] = callback;
      if (event === 'end') {
        queueMicrotask(async () => {
          if (decision === 'end') {
            await listeners.end('time');
            return;
          }

          const components = componentJson(initialPayload);
          const customId = components[decision === 'confirm' ? 0 : 1].custom_id;
          const component = {
            customId,
            user: { id: 'owner' },
            async update(payload) {
              updates.push(payload);
              if (updateError) throw updateError;
            },
          };
          await listeners.collect(component);
          await listeners.end('limit');
        });
      }
      return collector;
    },
  };

  const message = {
    createMessageComponentCollector(options) {
      collectorOptions = options;
      return collector;
    },
    async edit(payload) {
      edits.push(payload);
      return message;
    },
  };
  const interaction = {
    user: { id: 'owner' },
    replied: false,
    deferred: false,
    async reply(payload) {
      initialPayload = payload;
      return { resource: { message } };
    },
  };

  return {
    interaction,
    options: {
      title: 'Reset this hero?',
      description: 'Review the permanent changes before continuing.',
      consequences: ['Level returns to 1.', 'Equipped gear is kept.'],
      time,
    },
    updates,
    edits,
    get initialPayload() { return initialPayload; },
    get collectorOptions() { return collectorOptions; },
  };
}

test('requestConfirmation confirms, shows processing, and can mark the change complete', async () => {
  const harness = confirmationHarness('confirm');
  const result = await requestConfirmation(harness.interaction, harness.options);

  assert.equal(result.confirmed, true);
  assert.equal(harness.updates.length, 1);
  assert.equal(embedJson(harness.updates[0]).title, '⏳ Confirmation received');
  assert.ok(componentJson(harness.updates[0]).every((component) => component.disabled));

  await result.complete('The hero was reset and saved.', 'Hero reset complete');
  assert.equal(harness.edits.length, 1);
  assert.equal(embedJson(harness.edits[0]).title, 'Hero reset complete');
  assert.equal(embedJson(harness.edits[0]).description, 'The hero was reset and saved.');
  assert.ok(componentJson(harness.edits[0]).every((component) => component.disabled));
});

test('requestConfirmation cancels without applying a change', async () => {
  const harness = confirmationHarness('cancel');
  const result = await requestConfirmation(harness.interaction, harness.options);

  assert.equal(result.confirmed, false);
  assert.equal(harness.updates.length, 1);
  assert.equal(embedJson(harness.updates[0]).title, '✖️ Cancelled');
  assert.equal(embedJson(harness.updates[0]).description, 'Nothing was changed.');
  assert.ok(componentJson(harness.updates[0]).every((component) => component.disabled));
  assert.equal(harness.edits.length, 0);
});

test('requestConfirmation expires safely when the collector ends without a decision', async () => {
  const harness = confirmationHarness('end', { time: 4321 });
  const result = await requestConfirmation(harness.interaction, harness.options);

  assert.equal(result.confirmed, false);
  assert.equal(harness.collectorOptions.time, 4321);
  assert.equal(harness.edits.length, 1);
  assert.equal(embedJson(harness.edits[0]).title, '⏱️ Confirmation expired');
  assert.match(embedJson(harness.edits[0]).description, /nothing was changed/i);
  assert.ok(componentJson(harness.edits[0]).every((component) => component.disabled));
});

test('a confirmed operation can replace processing state with a failure explanation', async () => {
  const harness = confirmationHarness('confirm');
  const result = await requestConfirmation(harness.interaction, harness.options);

  await result.fail('The target character no longer exists.', 'Equipment not granted');
  assert.equal(harness.edits.length, 1);
  assert.equal(embedJson(harness.edits[0]).title, 'Equipment not granted');
  assert.equal(embedJson(harness.edits[0]).description, 'The target character no longer exists.');
  assert.ok(componentJson(harness.edits[0]).every((component) => component.disabled));
});

test('a Discord update failure still settles the confirmation decision', async () => {
  const originalError = console.error;
  console.error = () => {};
  try {
    const harness = confirmationHarness('confirm', { updateError: new Error('message disappeared') });
    const result = await requestConfirmation(harness.interaction, harness.options);
    assert.equal(result.confirmed, true);
  } finally {
    console.error = originalError;
  }
});
