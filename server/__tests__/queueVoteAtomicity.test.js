/**
 * Atomicity test for queueRepo.update + DB side-effects.
 *
 * THE BUG (pre-fix): the mutateFn inside queueRepo.update wrote to the `votes`
 * table via db.setVote() *outside* any SQLite transaction. If validateQueue or
 * db.updateQueue subsequently threw, the queue stayed unchanged but the vote
 * write had already been committed — leaving the votes table out of sync with
 * the queue state.
 *
 * THE FIX: queueRepo.update wraps the mutateFn body + validateQueue +
 * db.updateQueue in a single sqlite.transaction(...). On any throw inside the
 * wrapped function, better-sqlite3 rolls back the entire transaction, and any
 * vote writes the mutateFn made are undone.
 *
 * This test uses a real on-disk SQLite database in a temp dir to prove the
 * rollback actually happens at the engine level, not just in our code.
 */

const path = require('path');
const fs = require('fs');
const os = require('os');

// Set DATA_DIR BEFORE requiring sqlite/database — they read it at module load.
const TMP_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'speeldit-atomicity-'));
process.env.DATA_DIR = TMP_DATA_DIR;
process.env.PAYMENT_ENCRYPTION_KEY = '0'.repeat(64); // any valid 32-byte hex

// validateQueue must be mockable so we can force a throw after vote writes.
jest.mock('../utils/validateQueue');

const sqlite = require('../utils/sqlite');
const db = require('../utils/database');
const queueRepo = require('../repos/queueRepo');
const { validateQueue } = require('../utils/validateQueue');

const VENUE = 'ATOMV1';
const SONG_ID = 'song_atomic';
const DEVICE = 'device_atomic';

beforeEach(() => {
  // Wipe all per-test state
  sqlite.exec(`DELETE FROM queues WHERE venue_code = '${VENUE}'`);
  sqlite.exec(`DELETE FROM votes  WHERE venue_code = '${VENUE}'`);

  // Seed a queue with one upcoming song
  db.updateQueue(VENUE, {
    nowPlaying: null,
    upcoming: [{
      id: SONG_ID,
      appleId: '999',
      title: 'Test',
      artist: 'A',
      albumArt: '',
      duration: 180,
      votes: 0,
    }],
  });

  validateQueue.mockReturnValue({ valid: true, issues: [] });
});

afterAll(() => {
  try { fs.rmSync(TMP_DATA_DIR, { recursive: true, force: true }); } catch (_) {}
});

function getVote(deviceId) {
  return db.getVote(VENUE, SONG_ID, deviceId);
}

describe('queueRepo.update — atomicity with DB side-effects', () => {
  test('rolls back vote write when validateQueue throws', async () => {
    // Sanity check
    expect(getVote(DEVICE)).toBeUndefined();

    validateQueue.mockImplementationOnce(() => {
      throw new Error('validation failed!');
    });

    await expect(
      queueRepo.update(VENUE, (queue) => {
        // Vote write happens INSIDE the mutateFn — should be rolled back.
        db.setVote(VENUE, SONG_ID, DEVICE, 1);
        return {
          ...queue,
          upcoming: queue.upcoming.map((s) =>
            s.id === SONG_ID ? { ...s, votes: 1 } : s
          ),
        };
      }),
    ).rejects.toThrow('validation failed!');

    // The vote must NOT be in the table — transaction was rolled back.
    expect(getVote(DEVICE)).toBeUndefined();

    // The queue must remain unchanged (votes still 0).
    const q = db.getQueue(VENUE);
    expect(q.upcoming[0].votes).toBe(0);
  });

  test('rolls back vote write when db.updateQueue throws', async () => {
    expect(getVote(DEVICE)).toBeUndefined();

    // Force a constraint error on queue write by stubbing writeQueueTransaction
    // indirectly: wrap db.updateQueue to throw the next time only.
    const origUpdateQueue = db.updateQueue;
    let armed = true;
    db.updateQueue = (venueCode, queue) => {
      if (armed) {
        armed = false;
        throw new Error('queue write failed!');
      }
      return origUpdateQueue(venueCode, queue);
    };

    try {
      await expect(
        queueRepo.update(VENUE, (queue) => {
          db.setVote(VENUE, SONG_ID, DEVICE, 1);
          return {
            ...queue,
            upcoming: queue.upcoming.map((s) =>
              s.id === SONG_ID ? { ...s, votes: 1 } : s
            ),
          };
        }),
      ).rejects.toThrow('queue write failed!');

      expect(getVote(DEVICE)).toBeUndefined();
    } finally {
      db.updateQueue = origUpdateQueue;
    }
  });

  test('commits vote write when the whole update succeeds', async () => {
    expect(getVote(DEVICE)).toBeUndefined();

    await queueRepo.update(VENUE, (queue) => {
      db.setVote(VENUE, SONG_ID, DEVICE, 1);
      return {
        ...queue,
        upcoming: queue.upcoming.map((s) =>
          s.id === SONG_ID ? { ...s, votes: 1 } : s
        ),
      };
    });

    expect(getVote(DEVICE)).toBe(1);
    const q = db.getQueue(VENUE);
    expect(q.upcoming[0].votes).toBe(1);
  });

  test('rolls back vote write when mutateFn itself throws after writing', async () => {
    expect(getVote(DEVICE)).toBeUndefined();

    await expect(
      queueRepo.update(VENUE, () => {
        db.setVote(VENUE, SONG_ID, DEVICE, 1);
        throw new Error('mutateFn boom!');
      }),
    ).rejects.toThrow('mutateFn boom!');

    expect(getVote(DEVICE)).toBeUndefined();
  });
});
