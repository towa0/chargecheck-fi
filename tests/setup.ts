import '@testing-library/jest-dom/vitest';
import { beforeEach } from 'vitest';
import { resetStatusLimiter } from '../src/live/statuses.ts';

// The status limiter is shared by the whole page; each test starts as a fresh page.
beforeEach(() => resetStatusLimiter());
