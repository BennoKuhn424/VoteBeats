/**
 * @jest-environment node
 *
 * In-process backup scheduler (utils/backupScheduler.js): interval resolution
 * from env, timer behaviour with fake timers, child-process result handling,
 * and the no-overlap guard. The spawn is mocked with an EventEmitter-based
 * fake child — the backup script itself has its own behaviour documented in
 * BACKUPS.md and is exercised operationally.
 */

const { EventEmitter } = require('events');
const {
  startBackupScheduler,
  runBackupOnce,
  resolveIntervalMs,
  SCRIPT_PATH,
} = require('../utils/backupScheduler');

/** A fake child process whose exit we control. */
function fakeChild() {
  return new EventEmitter();
}

let logSpy;
let errSpy;

beforeEach(() => {
  logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
  errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  logSpy.mockRestore();
  errSpy.mockRestore();
  jest.useRealTimers();
});

describe('resolveIntervalMs', () => {
  test('defaults to 24h in production', () => {
    expect(resolveIntervalMs({ NODE_ENV: 'production' })).toBe(24 * 60 * 60 * 1000);
  });

  test('disabled by default outside production', () => {
    expect(resolveIntervalMs({ NODE_ENV: 'test' })).toBe(0);
    expect(resolveIntervalMs({})).toBe(0);
  });

  test('BACKUP_INTERVAL_HOURS overrides in any environment', () => {
    expect(resolveIntervalMs({ BACKUP_INTERVAL_HOURS: '6' })).toBe(6 * 60 * 60 * 1000);
    expect(resolveIntervalMs({ NODE_ENV: 'production', BACKUP_INTERVAL_HOURS: '0' })).toBe(0);
  });

  test('garbage values fall back to the environment default', () => {
    expect(resolveIntervalMs({ NODE_ENV: 'production', BACKUP_INTERVAL_HOURS: 'nope' })).toBe(24 * 60 * 60 * 1000);
    expect(resolveIntervalMs({ NODE_ENV: 'production', BACKUP_INTERVAL_HOURS: '-3' })).toBe(24 * 60 * 60 * 1000);
  });
});

describe('runBackupOnce', () => {
  test('resolves 0 and logs ok on a clean exit', async () => {
    const child = fakeChild();
    const spawnFn = jest.fn(() => child);
    const promise = runBackupOnce({ spawnFn });
    child.emit('exit', 0);
    await expect(promise).resolves.toBe(0);

    expect(spawnFn).toHaveBeenCalledWith(process.execPath, [SCRIPT_PATH], { stdio: 'inherit' });
    expect(logSpy.mock.calls.map((c) => c[0]).join('\n')).toContain('db-backup-ok');
  });

  test('resolves the failure code and logs loudly on non-zero exit', async () => {
    const child = fakeChild();
    const promise = runBackupOnce({ spawnFn: () => child });
    child.emit('exit', 4); // fresh backup failed integrity_check
    await expect(promise).resolves.toBe(4);
    expect(errSpy.mock.calls.map((c) => c[0]).join('\n')).toContain('db-backup-failed');
  });

  test('never rejects when spawn itself fails', async () => {
    const spawnFn = () => { throw new Error('ENOENT'); };
    await expect(runBackupOnce({ spawnFn })).resolves.toBe(-1);
    expect(errSpy.mock.calls.map((c) => c[0]).join('\n')).toContain('db-backup-spawn-failed');
  });
});

describe('startBackupScheduler', () => {
  test('returns null (disabled) outside production by default', () => {
    expect(startBackupScheduler({ env: { NODE_ENV: 'test' } })).toBeNull();
  });

  test('runs 5 minutes after boot, then on the interval', async () => {
    jest.useFakeTimers();
    const spawnFn = jest.fn(() => {
      const child = fakeChild();
      process.nextTick(() => child.emit('exit', 0));
      return child;
    });

    const handle = startBackupScheduler({ spawnFn, env: { NODE_ENV: 'production' } });
    expect(handle).not.toBeNull();

    expect(spawnFn).not.toHaveBeenCalled();
    // The async variants yield to microtasks so the previous run's
    // `running` guard resets between ticks (as it does in real time).
    await jest.advanceTimersByTimeAsync(5 * 60 * 1000); // initial delay
    expect(spawnFn).toHaveBeenCalledTimes(1);

    await jest.advanceTimersByTimeAsync(24 * 60 * 60 * 1000); // one full interval
    expect(spawnFn).toHaveBeenCalledTimes(2);

    handle.stop();
    await jest.advanceTimersByTimeAsync(48 * 60 * 60 * 1000);
    expect(spawnFn).toHaveBeenCalledTimes(2); // stopped — no more runs
  });

  test('skips a tick while the previous backup is still running', () => {
    jest.useFakeTimers();
    // Child that NEVER exits — simulates a hung BACKUP_REMOTE_CMD upload.
    const spawnFn = jest.fn(() => fakeChild());

    const handle = startBackupScheduler({
      spawnFn,
      env: { NODE_ENV: 'production', BACKUP_INTERVAL_HOURS: '1' },
    });

    jest.advanceTimersByTime(5 * 60 * 1000); // initial run starts, never exits
    expect(spawnFn).toHaveBeenCalledTimes(1);

    jest.advanceTimersByTime(3 * 60 * 60 * 1000); // three intervals later
    expect(spawnFn).toHaveBeenCalledTimes(1); // still just the hung child

    handle.stop();
  });

  test('initial delay never exceeds a very short interval', () => {
    jest.useFakeTimers();
    const spawnFn = jest.fn(() => {
      const child = fakeChild();
      process.nextTick(() => child.emit('exit', 0));
      return child;
    });
    // 0.05h = 3 minutes — shorter than the 5-minute boot delay
    const handle = startBackupScheduler({
      spawnFn,
      env: { BACKUP_INTERVAL_HOURS: '0.05' },
    });
    jest.advanceTimersByTime(3 * 60 * 1000);
    expect(spawnFn).toHaveBeenCalledTimes(1);
    handle.stop();
  });
});
