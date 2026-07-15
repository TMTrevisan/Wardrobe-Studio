// Vitest global setup — runs before every test file.
import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

// Auto-cleanup rendered React trees between tests.
afterEach(() => {
  cleanup();
});

// jsdom 23+ ships a fetch implementation, so we no longer need to stub
// it. If you upgrade to a setup that strips fetch, re-add the stub.