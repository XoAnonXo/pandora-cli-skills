const events = require('./events.cjs');
const execution = require('./execution.cjs');

function createMirrorHedgeBundle(options = {}) {
  return {
    options: { ...options },
    events: events.createMirrorHedgeEventBundle(options),
    execution: execution.createMirrorHedgeExecutionBundle(options),
  };
}

module.exports = {
  ...events,
  ...execution,
  events,
  execution,
  createMirrorHedgeBundle,
};
