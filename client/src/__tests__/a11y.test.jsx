/**
 * Automated accessibility regression tests.
 *
 * Renders key components/pages and runs axe-core against the output, asserting
 * zero violations. This locks in the accessibility work (labels, roles,
 * aria-pressed toggles, alt text) so a future refactor can't silently regress
 * it.
 *
 * Note on jsdom: axe's `color-contrast` rule needs real layout/paint and is
 * automatically skipped under jsdom — contrast is verified manually / in the
 * design tokens, not here. Page-level landmark rules are disabled because these
 * are isolated component renders, not full documents.
 */
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import { axe } from 'vitest-axe';
import { MemoryRouter } from 'react-router-dom';

import Button from '../components/shared/Button';
import Logo from '../components/shared/Logo';
import Home from '../pages/Home';
import NowPlaying from '../components/customer/NowPlaying';

// api is imported transitively; never hit the network from a render test.
vi.mock('../utils/api', () => ({
  default: { vote: vi.fn().mockResolvedValue({}), getLyrics: vi.fn() },
}));

// Rules that only make sense for a whole page, not an isolated component.
const COMPONENT_AXE_OPTIONS = {
  rules: {
    region: { enabled: false },
    'landmark-one-main': { enabled: false },
    'page-has-heading-one': { enabled: false },
  },
};

async function expectNoViolations(ui, options = COMPONENT_AXE_OPTIONS) {
  const { container } = render(ui);
  const results = await axe(container, options);
  expect(results).toHaveNoViolations();
}

describe('accessibility — shared components', () => {
  it('Button (primary) has no violations', async () => {
    await expectNoViolations(<Button>Save</Button>);
  });

  it('Button (secondary) has no violations', async () => {
    await expectNoViolations(<Button variant="secondary">Cancel</Button>);
  });

  it('Button (danger, disabled) has no violations', async () => {
    await expectNoViolations(<Button variant="danger" disabled>Delete</Button>);
  });

  it('Logo has no violations', async () => {
    await expectNoViolations(<Logo size="xl" />);
  });
});

describe('accessibility — pages & cards', () => {
  it('Home page has no violations', async () => {
    // Home is a full page, so allow its landmark/heading structure to be checked.
    const { container } = render(
      <MemoryRouter>
        <Home />
      </MemoryRouter>
    );
    const results = await axe(container, { rules: { region: { enabled: false } } });
    expect(results).toHaveNoViolations();
  });

  it('NowPlaying card has no violations (with an active vote)', async () => {
    const song = {
      id: 's1',
      appleId: '123',
      title: 'Test Song',
      artist: 'Test Artist',
      albumArt: 'https://example.com/art.jpg',
      duration: 200,
    };
    await expectNoViolations(
      <NowPlaying
        song={song}
        hasLyrics
        onLyrics={() => {}}
        venueCode="V1"
        deviceId="d1"
        myVote={1}
      />
    );
  });
});
