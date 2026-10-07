/**
 * The learner's identity: one 32-byte secret, generated in this browser.
 *
 * Only its hash is ever enrolled, and no claim reveals which hash. It lives in
 * this browser's storage and nowhere else, so the page offers a backup — lose
 * it and you are a new learner who needs a new invite.
 */

import { fromHex, randomBytes32, toHex } from '@nightschool/contract';

const KEY = 'nightschool:learner-secret';

export const loadSecret = (): Uint8Array | undefined => {
  try {
    const stored = localStorage.getItem(KEY);
    return stored ? fromHex(stored) : undefined;
  } catch {
    return undefined;
  }
};

export const saveSecret = (secret: Uint8Array): void => {
  try {
    localStorage.setItem(KEY, toHex(secret));
  } catch {
    // Storage blocked (private window): the secret lives for this tab only.
  }
};

export const createSecret = (): Uint8Array => {
  const secret = randomBytes32();
  saveSecret(secret);
  return secret;
};

export const forgetSecret = (): void => {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // Nothing stored to remove.
  }
};
