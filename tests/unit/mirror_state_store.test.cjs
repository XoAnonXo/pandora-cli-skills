const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const {
  defaultStateFile,
  defaultKillSwitchFile,
  strategyHash,
} = require('../../cli/lib/mirror_state_store.cjs');

test('mirror state store default paths honor env home overrides', () => {
  const tempHome = path.join(process.cwd(), '.tmp-mirror-home-override');
  const previousHome = process.env.HOME;
  const previousUserProfile = process.env.USERPROFILE;

  try {
    delete process.env.HOME;
    process.env.USERPROFILE = tempHome;

    assert.equal(defaultStateFile({ market: 'demo' }), path.join(tempHome, '.pandora', 'mirror', `${strategyHash({ market: 'demo' })}.json`));
    assert.equal(
      defaultKillSwitchFile(),
      path.join(tempHome, '.pandora', 'mirror', 'STOP'),
    );
  } finally {
    if (previousHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = previousHome;
    }
    if (previousUserProfile === undefined) {
      delete process.env.USERPROFILE;
    } else {
      process.env.USERPROFILE = previousUserProfile;
    }
  }
});
