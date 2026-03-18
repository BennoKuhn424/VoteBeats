/**
 * Tests for queueRepo — the data-access layer for queue state.
 *
 * Both the underlying database and validateQueue are mocked so the tests
 * focus on the repo's own behaviour: locking, no-op handling, and the
 * validate-before-write contract.
 */

jest.mock('../utils/database');
jest.mock('../utils/validateQueue');

const db = require('../utils/database');
const { validateQueue } = require('../utils/validateQueue');
const queueRepo = require('../repos/queueRepo');

function makeQueue(nowPlaying = null, upcoming = []) {
  return { nowPlaying, upcoming };
}

beforeEach(() => {
  jest.resetAllMocks();
  // Default stubs
  db.getQueue.mockReturnValue(makeQueue());
  db.updateQueue.mockImplementation(() => {});
  validateQueue.mockReturnValue({ valid: true, issues: [] });
});

describe('queueRepo.get', () => {
  test('delegates to db.getQueue', () => {
    const q = makeQueue({ id: 's1' });
    db.getQueue.mockReturnValue(q);

    expect(queueRepo.get('V1')).toBe(q);
    expect(db.getQueue).toHaveBeenCalledWith('V1');
  });
});

describe('queueRepo.update — basic contract', () => {
  test('calls mutateFn with the current queue', async () => {
    const current = makeQueue({ id: 's1' });
    db.getQueue.mockReturnValue(current);
    const mutateFn = jest.fn((q) => ({ ...q }));

    await queueRepo.update('V1', mutateFn);

    expect(mutateFn).toHaveBeenCalledWith(current);
  });

  test('validates the new queue before writing', async () => {
    const next = makeQueue({ id: 's2' });
    const mutateFn = jest.fn(() => next);

    await queueRepo.update('V1', mutateFn);

    expect(validateQueue).toHaveBeenCalledWith('V1', next);
    expect(db.updateQueue).toHaveBeenCalledWith('V1', next);
  });

  test('returns the new queue after writing', async () => {
    const next = makeQueue({ id: 's2' });

    const result = await queueRepo.update('V1', () => next);

    expect(result).toBe(next);
  });

  test('skips validate and write when mutateFn returns null (no-op)', async () => {
    const current = makeQueue({ id: 's1' });
    db.getQueue.mockReturnValue(current);

    const result = await queueRepo.update('V1', () => null);

    expect(validateQueue).not.toHaveBeenCalled();
    expect(db.updateQueue).not.toHaveBeenCalled();
    // Returns the unchanged current queue
    expect(result).toBe(current);
  });

  test('skips write when mutateFn returns undefined', async () => {
    await queueRepo.update('V1', () => undefined);
    expect(db.updateQueue).not.toHaveBeenCalled();
  });
});

describe('queueRepo.update — per-venue locking', () => {
  test('serialises concurrent updates to the same venue', async () => {
    const order = [];

    const p1 = queueRepo.update('V1', () => {
      order.push('fn1');
      return makeQueue();
    });
    const p2 = queueRepo.update('V1', () => {
      order.push('fn2');
      return makeQueue();
    });
    const p3 = queueRepo.update('V1', () => {
      order.push('fn3');
      return makeQueue();
    });

    await Promise.all([p1, p2, p3]);

    expect(order).toEqual(['fn1', 'fn2', 'fn3']);
  });

  test('allows concurrent updates to different venues', async () => {
    const ran = [];

    await Promise.all([
      queueRepo.update('V1', () => { ran.push('V1'); return makeQueue(); }),
      queueRepo.update('V2', () => { ran.push('V2'); return makeQueue(); }),
    ]);

    expect(ran).toHaveLength(2);
    expect(ran).toContain('V1');
    expect(ran).toContain('V2');
  });

  test('releases the lock even when mutateFn result triggers an error in validateQueue', async () => {
    // First call: validateQueue throws
    validateQueue.mockImplementationOnce(() => { throw new Error('invalid!'); });
    await expect(queueRepo.update('V1', () => makeQueue())).rejects.toThrow('invalid!');

    // Second call: lock must not be stuck — this should run normally
    validateQueue.mockReturnValue({ valid: true, issues: [] });
    const result = await queueRepo.update('V1', () => makeQueue({ id: 'ok' }));
    expect(result.nowPlaying?.id).toBe('ok');
  });
});
