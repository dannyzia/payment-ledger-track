import { describe, expect, it } from 'vitest';
import { missingPasswordHelp, signInFailureHelp } from '../../scripts/e2e/device-sign-in-flow';

const base = {
  signedInAs: 'owner.mhk@cosmoledger.local',
  centerCode: 'RMP',
  accountEmail: 'rmp.check@cosmoledger.local',
  accountIsDefault: false,
};

describe('signInFailureHelp', () => {
  it('names the environment variable that supplied the password', () => {
    const message = signInFailureHelp({
      email: 'rmp.check@cosmoledger.local',
      screen: 'Invalid login credentials',
      passwordSource: 'CLT_DEVICE_RMP_PASSWORD',
    });
    expect(message).toContain('The password came from CLT_DEVICE_RMP_PASSWORD.');
    expect(message).toContain('.env.local');
    expect(message).toContain('--password=<password>');
  });

  it('does not tell a flag user to override the flag with the flag', () => {
    const message = signInFailureHelp({
      email: 'rmp.check@cosmoledger.local',
      screen: 'Invalid login credentials',
      passwordSource: '--password',
    });
    expect(message).toContain('The password came from --password.');
    expect(message).toContain('command line');
    expect(message).not.toContain('override this run');
  });

  it('collapses the app screen text onto one line', () => {
    const message = signInFailureHelp({
      email: 'x@y.z',
      screen: 'Invalid\n  login   credentials',
      passwordSource: 'CLT_DEVICE_PASSWORD',
    });
    expect(message).toContain('Screen said: Invalid login credentials');
  });

  it('says so when no source is known', () => {
    expect(signInFailureHelp({ email: 'x@y.z', screen: 'nope' })).toContain(
      'No password source was recorded',
    );
  });
});

describe('missingPasswordHelp', () => {
  it('names the exact variables for the requested centre', () => {
    const message = missingPasswordHelp(base);
    expect(message).toContain('CLT_DEVICE_RMP_ACCOUNT=rmp.check@cosmoledger.local');
    expect(message).toContain('CLT_DEVICE_RMP_PASSWORD=<password>');
    expect(message).toContain('.env.local');
  });

  it('says who is signed in and who is wanted', () => {
    const message = missingPasswordHelp(base);
    expect(message).toContain('signed in as owner.mhk@cosmoledger.local');
    expect(message).toContain('targets rmp.check@cosmoledger.local (RMP)');
  });

  it('handles no session at all', () => {
    expect(missingPasswordHelp({ ...base, signedInAs: null })).toContain('signed in as nobody');
  });

  it('asks for a real account instead of echoing the built-in fallback', () => {
    const message = missingPasswordHelp({ ...base, accountIsDefault: true });
    expect(message).toContain('no account is configured for RMP');
    expect(message).toContain('CLT_DEVICE_RMP_ACCOUNT=<account for RMP>');
    // The fallback belongs to another centre; suggesting it would swap this
    // message for an "account belongs to center" failure.
    expect(message).not.toContain('CLT_DEVICE_RMP_ACCOUNT=owner.mhk@cosmoledger.local');
  });

  it('does not mention the fallback when the account came from configuration', () => {
    expect(missingPasswordHelp(base)).not.toContain('fell back to');
  });

  it('keeps the one-off escape hatches', () => {
    const message = missingPasswordHelp(base);
    expect(message).toContain('--password=<password>');
    expect(message).toContain('CLT_DEVICE_PASSWORD');
  });
});
