# Play functions

A play function is Storybook's way to put a story into a state by interacting with it: press a
tab, type into a field. targus captures a story after its play function has finished, on the web
and on a device, and records a play function that throws as an error for that story.

## On the web

Nothing to set up. Storybook runs the play function as part of rendering the story, and a web
capture waits for it.

```tsx
export const ToggledByPlay: Story = {
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByText('Closed'));
    await userEvent.tab();
  },
};
```

- Take `canvas` and `userEvent` from the play function's argument, not from an import of
  `storybook/test`, when the same story file is also bundled into the app.
- A click leaves the element focused and the capture then shows the browser's focus ring. End
  with `userEvent.tab()`, or anything else that moves focus away, unless the ring is what you
  want to see.

## On a device

The on-device Storybook removes play functions unless you ask it to keep them, and it gives
them no `canvas` and no `userEvent`: there is no DOM in a React Native app. targus adds
`onDevice`, which finds an element of the story and calls its handler.

1. Keep play functions, in `.rnstorybook/main.ts`, then regenerate `storybook.requires.ts`
   (`sb-rn-get-stories`, or a Metro start):

   ```ts
   const config: StorybookConfig = {
     // ...
     reactNative: { playFn: true },
   };
   ```

   Storybook describes this option as not yet fully supported on native. targus relies on it
   only to have the play function called.

2. Use `onDevice` in the play function. It needs the `withTargus` decorator
   ([prepare your app](prepare-your-app.md)).

   ```tsx
   import { onDevice } from '@targus/react-native';

   export const ToggledByPlay: Story = {
     play: async (context) => {
       await onDevice(context).press('Closed');
     },
   };
   ```

| Action                         | What it does                                                                |
| ------------------------------ | --------------------------------------------------------------------------- |
| `press(name)`                  | Calls `onPress` of the element whose `accessibilityLabel`, `aria-label` or `testID` is `name` |
| `changeText(name, text)`       | Calls `onChangeText` of the input with that name, or that `placeholder`     |
| `onDevice(context, { timeoutMs })` | How long an action waits for its element (default 2000)                 |

Each action waits until its own story is mounted and the element is there, and fails with a
message that names what it looked for. Disabled elements are passed over.

What `onDevice` is not:

- **Not a touch.** It calls the component's handler. Gestures, scrolling, the keyboard and
  anything a native view does by itself when touched are out of reach.
- **Not typing.** `changeText` calls `onChangeText`; the input shows the text only if the story
  keeps it in state and passes it back as `value`.
- **Not a public React API.** It reads React's rendered tree, which React does not document.
  targus's tests run it against the React version in this repository.

## One story file for both

With `playFn` on, every play function runs on the device too, and one written for the web
throws there. Branch on the platform:

```tsx
import { Platform } from 'react-native';
import { onDevice } from '@targus/react-native';

export const ToggledByPlay: Story = {
  play: async (context) => {
    if (Platform.OS !== 'web') {
      await onDevice(context).press('Closed');
      return;
    }
    const { canvas, userEvent } = context;
    await userEvent.click(canvas.getByText('Closed'));
    await userEvent.tab();
  },
};
```

A play function with nothing to do on a device returns early: `if (Platform.OS !== 'web') return;`.

## When a play function fails

The story is recorded as an error, with the message after `play function:`, and the build fails
like any story that fails to render ([review](review.md)). On a device the capture does not wait
for the render timeout: Storybook reports the failure and targus moves on.

## How a device capture waits

The device Storybook says a story is playing, then the story mounts and `withTargus` reports its
parameters, then the play function finishes and Storybook says the story is rendered. The CLI
waits for that last message once it has seen the first, so a slow play function is not captured
half way. `--render-timeout` covers the play function as well as the render.
