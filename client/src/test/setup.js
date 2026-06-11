import '@testing-library/jest-dom/vitest';
import * as axeMatchers from 'vitest-axe/matchers';
import { expect } from 'vitest';

// Adds `toHaveNoViolations()` so any test can assert a rendered tree is free of
// axe-core accessibility violations.
expect.extend(axeMatchers);
