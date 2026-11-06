import { diffImages } from '@targus/core';

import type { CompareImages } from './capture-stories.ts';

/** The real `CompareImages`: pixelmatch through core's `diffImages` (ADR 0003). */
export const compareWithCore: CompareImages = (a, b) => {
  const { ratio, diffPng } = diffImages(a, b);
  return { ratio, diffPng };
};
