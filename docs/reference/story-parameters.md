# Story parameters

A story can tell targus to leave it out, or to wait longer before its screenshot, with
`parameters.targus`. Both need the [`withTargus` decorator](../guide/prepare-your-app.md#2-add-the-withtargus-decorator):
it reports them to the CLI over the Storybook channel. Without the decorator the CLI uses its
defaults.

```tsx
export const Loading: Story = {
  // A spinner never holds still: leave it out of capture. It is not an error.
  parameters: { targus: { skip: true } },
};

export const Entering: Story = {
  // Wait 800 ms after the story renders before the first screenshot, instead of --settle.
  parameters: { targus: { delay: 800 } },
};
```

Set them on a story, or on a component's `meta` to apply them to every story of that component,
or in `.rnstorybook/preview.tsx` to apply them to every story, as with any Storybook parameter.
The type is exported as `TargusParameters`:

```ts
import type { TargusParameters } from '@targus/react-native';

const targus: TargusParameters = { delay: 500 };
```

| Parameter | Type                         | Default            | Effect                                                                                                                           |
| --------- | ---------------------------- | ------------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| `skip`    | boolean                      | `false`            | The story is selected but never screenshotted or submitted. It is listed as `skipped` in the capture and run summaries.         |
| `delay`   | milliseconds, 0 to 10000     | `--settle` (300)   | Replaces the settle wait for this story. A stability retry doubles it, as it doubles `--settle`.                               |

A value of the wrong type or out of range makes the story an `error` that names the field, so a
typo cannot silently change what is captured.

## When to use which

- **The story animates forever** (spinner, shimmer, looping Lottie): `skip: true`, or render a
  still frame of it under targus.
- **The story animates in, then holds still** (a sheet sliding up, a fade): `delay` a little
  longer than the animation.
- **The story shows the current time, a random value or remote data**: neither. Make it
  deterministic instead; see [Make stories deterministic](../guide/prepare-your-app.md#4-make-stories-deterministic).
