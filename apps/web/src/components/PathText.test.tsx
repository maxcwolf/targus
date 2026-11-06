import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { PathText } from './PathText.tsx';

describe('PathText', () => {
  it('offers a line break after each path separator only', () => {
    const { container } = render(
      <h2>
        <PathText text="Screen Components/Home/BloodPressureSection" />
      </h2>,
    );

    expect(container.textContent).toBe('Screen Components/Home/BloodPressureSection');
    expect(container.innerHTML).toBe(
      '<h2>Screen Components/<wbr>Home/<wbr>BloodPressureSection</h2>',
    );
  });

  it('leaves a title without separators alone', () => {
    const { container } = render(<PathText text="Button" />);

    expect(container.innerHTML).toBe('Button');
  });
});
