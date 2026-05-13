/**
 * @jest-environment node
 *
 * Regression test for the bug where a venue's empty queue caused the
 * scheduled-playlist autofill to never fire.
 *
 * Pre-fix behaviour:
 *   db.getQueues() returns a map of only-venues-with-queue-rows.
 *   The fast tick in server.js iterated that map, so a venue whose queue
 *   was empty (no nowPlaying, no upcoming → zero rows) was silently
 *   excluded — even when a schedule slot said "play X right now."
 *
 * Post-fix behaviour:
 *   runAutofillSweep iterates db.getAllVenues() instead and skips venues
 *   that the fast tick is already handling. Every venue with autoplay on
 *   gets a chance to run autofillIfQueueEmpty, which is where the schedule
 *   evaluation happens.
 *
 * This test exercises the sweep in isolation; the schedule evaluator
 * itself is unit-tested in playlistSchedule.test.js and queueAutofillSchedule.test.js.
 */

const { runAutofillSweep } = require('../utils/autofillSweep');

function makeDb({ venues, activeQueueCodes }) {
  return {
    getAllVenues: jest.fn(() => venues),
    getQueues: jest.fn(() => {
      const out = {};
      for (const code of activeQueueCodes) out[code] = { nowPlaying: null, upcoming: [] };
      return out;
    }),
  };
}

describe('runAutofillSweep — covers empty-queue venues the fast tick misses', () => {
  test('REGRESSION: calls autofillIfQueueEmpty for a venue with no queue rows', async () => {
    // This is the scenario from the bug report: empty queue, slot starts at
    // 14:00, nothing happens at 14:00 because the venue is not in getQueues().
    const db = makeDb({
      venues: {
        EMPTY1: { code: 'EMPTY1', settings: { autoplayMode: 'playlist', autoplayQueue: true } },
      },
      activeQueueCodes: [], // crucial: venue has zero queue rows
    });
    const autofillIfQueueEmpty = jest.fn().mockResolvedValue(null);

    await runAutofillSweep({ db, autofillIfQueueEmpty });

    expect(autofillIfQueueEmpty).toHaveBeenCalledTimes(1);
    expect(autofillIfQueueEmpty).toHaveBeenCalledWith('EMPTY1');
  });

  test('skips a venue the fast tick already owns (has queue rows)', async () => {
    // The fast tick in server.js handles this venue via db.getQueues(); the
    // slow sweep must not duplicate that work, otherwise both ticks race to
    // autofill at the same time.
    const db = makeDb({
      venues: {
        ACTIVE: { code: 'ACTIVE', settings: { autoplayMode: 'playlist', autoplayQueue: true } },
      },
      activeQueueCodes: ['ACTIVE'],
    });
    const autofillIfQueueEmpty = jest.fn().mockResolvedValue(null);

    await runAutofillSweep({ db, autofillIfQueueEmpty });

    expect(autofillIfQueueEmpty).not.toHaveBeenCalled();
  });

  test('skips a venue with autoplay turned off', async () => {
    const db = makeDb({
      venues: {
        OFF1: { code: 'OFF1', settings: { autoplayMode: 'off', autoplayQueue: true } },
        OFF2: { code: 'OFF2', settings: { autoplayMode: 'playlist', autoplayQueue: false } },
      },
      activeQueueCodes: [],
    });
    const autofillIfQueueEmpty = jest.fn().mockResolvedValue(null);

    await runAutofillSweep({ db, autofillIfQueueEmpty });

    expect(autofillIfQueueEmpty).not.toHaveBeenCalled();
  });

  test('sweeps every eligible venue and skips ineligible ones in one pass', async () => {
    const db = makeDb({
      venues: {
        EMPTY1: { code: 'EMPTY1', settings: { autoplayMode: 'playlist' } },
        EMPTY2: { code: 'EMPTY2', settings: { autoplayMode: 'random' } },
        ACTIVE: { code: 'ACTIVE', settings: { autoplayMode: 'playlist' } },
        OFF:    { code: 'OFF',    settings: { autoplayMode: 'off' } },
      },
      activeQueueCodes: ['ACTIVE'],
    });
    const autofillIfQueueEmpty = jest.fn().mockResolvedValue(null);

    await runAutofillSweep({ db, autofillIfQueueEmpty });

    expect(autofillIfQueueEmpty).toHaveBeenCalledWith('EMPTY1');
    expect(autofillIfQueueEmpty).toHaveBeenCalledWith('EMPTY2');
    expect(autofillIfQueueEmpty).not.toHaveBeenCalledWith('ACTIVE');
    expect(autofillIfQueueEmpty).not.toHaveBeenCalledWith('OFF');
    expect(autofillIfQueueEmpty).toHaveBeenCalledTimes(2);
  });

  test('an error on one venue does not abort the rest of the sweep', async () => {
    const db = makeDb({
      venues: {
        BAD:  { code: 'BAD',  settings: { autoplayMode: 'playlist' } },
        GOOD: { code: 'GOOD', settings: { autoplayMode: 'playlist' } },
      },
      activeQueueCodes: [],
    });
    const autofillIfQueueEmpty = jest.fn(async (code) => {
      if (code === 'BAD') throw new Error('autofill failed');
      return null;
    });
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    await runAutofillSweep({ db, autofillIfQueueEmpty });

    expect(autofillIfQueueEmpty).toHaveBeenCalledWith('BAD');
    expect(autofillIfQueueEmpty).toHaveBeenCalledWith('GOOD');
    expect(autofillIfQueueEmpty).toHaveBeenCalledTimes(2);
    errSpy.mockRestore();
  });

  test('handles missing autofillIfQueueEmpty gracefully (no throw)', async () => {
    const db = makeDb({
      venues: { ANY: { code: 'ANY', settings: { autoplayMode: 'playlist' } } },
      activeQueueCodes: [],
    });
    await expect(runAutofillSweep({ db, autofillIfQueueEmpty: undefined }))
      .resolves.toBeUndefined();
  });

  test('handles db.getAllVenues throwing without crashing the sweep', async () => {
    const db = {
      getAllVenues: jest.fn(() => { throw new Error('db down'); }),
      getQueues: jest.fn(() => ({})),
    };
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    await expect(runAutofillSweep({ db, autofillIfQueueEmpty: jest.fn() }))
      .resolves.toBeUndefined();
    errSpy.mockRestore();
  });
});
