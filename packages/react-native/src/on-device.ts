import { Component, type ReactNode } from 'react';

// Helpers for a story's play function on a device (ADR 0047). The on-device Storybook runs play
// functions when `reactNative: { playFn: true }` is set, but gives them no `canvas` and no
// `userEvent`: there is no DOM. These helpers find an element of the story in React's rendered
// tree and call its handler. That is the component's own `onPress`, not a touch on the screen.

/** The mounted `StoryTree` of each story, by story id. */
const mounted = new Map<string, StoryTree>();

export interface StoryTreeProps {
  readonly storyId: string;
  readonly children?: ReactNode;
}

/**
 * Wraps the story inside `withTargus` and records that it is mounted. A play function starts
 * before React has rendered its story, while the story before it is still on screen, so the
 * helpers wait for their own story's tree here. A class, because a class instance leads to its
 * place in React's tree.
 */
export class StoryTree extends Component<StoryTreeProps> {
  override componentDidMount(): void {
    mounted.set(this.props.storyId, this);
  }

  override componentDidUpdate(previous: StoryTreeProps): void {
    if (previous.storyId === this.props.storyId) return;
    this.forget(previous.storyId);
    mounted.set(this.props.storyId, this);
  }

  override componentWillUnmount(): void {
    this.forget(this.props.storyId);
  }

  override render(): ReactNode {
    return this.props.children ?? null;
  }

  private forget(storyId: string): void {
    if (mounted.get(storyId) === this) mounted.delete(storyId);
  }
}

/** A node of React's rendered tree (a fiber). Read through `Reflect`: it has no public type. */
type TreeNode = object;

function nodeAt(node: TreeNode, key: string): TreeNode | null {
  const value: unknown = Reflect.get(node, key);
  return typeof value === 'object' && value !== null ? value : null;
}

function stateNodeOf(node: TreeNode): unknown {
  return Reflect.get(node, 'stateNode');
}

/** The first node under `top`, depth first, that `matches`; `top` itself is not looked at. */
function findBelow(top: TreeNode, matches: (node: TreeNode) => boolean): TreeNode | null {
  const stack: TreeNode[] = [];
  const push = (node: TreeNode | null): void => {
    if (node !== null) stack.push(node);
  };
  push(nodeAt(top, 'child'));
  for (let node = stack.pop(); node !== undefined; node = stack.pop()) {
    if (matches(node)) return node;
    push(nodeAt(node, 'sibling'));
    push(nodeAt(node, 'child'));
  }
  return null;
}

/**
 * The node of `instance` in the tree that is on screen. React keeps two copies of a tree and an
 * instance may point at the one that is not current, whose props are a render behind, so the
 * instance is looked up again from the root's current tree.
 */
function currentNodeOf(instance: StoryTree): TreeNode | null {
  let top = nodeAt(instance, '_reactInternals');
  for (let above = top; above !== null; above = nodeAt(above, 'return')) top = above;
  const root = top === null ? null : stateNodeOf(top);
  const current = typeof root === 'object' && root !== null ? nodeAt(root, 'current') : null;
  return current === null ? null : findBelow(current, (node) => stateNodeOf(node) === instance);
}

/** The props that can name an element, in the order they are tried. */
const nameProps = ['accessibilityLabel', 'aria-label', 'testID', 'placeholder'] as const;

function propsOf(node: TreeNode): object | null {
  const props: unknown = Reflect.get(node, 'memoizedProps');
  return typeof props === 'object' && props !== null ? props : null;
}

/** The enabled element named `name` that has the handler `handler`, as that handler. */
function handlerOf(
  node: TreeNode,
  name: string,
  handler: string,
): ((...args: unknown[]) => unknown) | null {
  const props = propsOf(node);
  if (props === null || Reflect.get(props, 'disabled') === true) return null;
  if (!nameProps.some((key) => Reflect.get(props, key) === name)) return null;
  const found: unknown = Reflect.get(props, handler);
  return typeof found === 'function' ? (found as (...args: unknown[]) => unknown) : null;
}

/** What a play function can do to its story on a device. */
export interface DeviceActions {
  /**
   * Call the `onPress` of the element named `name`: its `accessibilityLabel`, `aria-label` or
   * `testID`. Waits for the story to be mounted and the element to be there.
   */
  press(name: string): Promise<void>;
  /**
   * Call the `onChangeText` of the text input named `name` (as for `press`, or its
   * `placeholder`) with `text`. The input shows the text only if the story keeps it in state and
   * passes it back as `value`.
   */
  changeText(name: string, text: string): Promise<void>;
}

export interface OnDeviceOptions {
  /** How long an action waits for its element, in milliseconds (default 2000). */
  readonly timeoutMs?: number;
}

// This package is compiled without DOM or Node types; React Native, like both, has the timer.
declare function setTimeout(callback: () => void, ms: number): unknown;

const turnMs = 16;
const defaultTimeoutMs = 2000;

const nextTurn = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

async function perform(
  storyId: string,
  name: string,
  handler: string,
  args: readonly unknown[],
  timeoutMs: number,
): Promise<void> {
  // Counted in turns, not read from the clock: a capture may run with the date frozen.
  const turns = Math.ceil(timeoutMs / turnMs);
  for (let turn = 0; ; turn += 1) {
    const tree = mounted.get(storyId);
    const top = tree === undefined ? null : currentNodeOf(tree);
    const node =
      top === null ? null : findBelow(top, (below) => handlerOf(below, name, handler) !== null);
    const call = node === null ? null : handlerOf(node, name, handler);
    if (call !== null) {
      call(...args);
      // Let React render what the handler changed before the next action looks at the tree.
      await nextTurn(0);
      return;
    }
    if (turn >= turns) {
      const why =
        tree === undefined
          ? 'the story was not mounted'
          : `no element named "${name}" has ${handler}`;
      throw new Error(`${why} within ${String(timeoutMs)} ms (story ${storyId})`);
    }
    await nextTurn(turnMs);
  }
}

/**
 * The actions for the story a play function belongs to: `onDevice(context).press('Save')`.
 * `context` is the play function's own argument; only its `id` is read.
 */
export function onDevice(
  context: { readonly id: string },
  { timeoutMs = defaultTimeoutMs }: OnDeviceOptions = {},
): DeviceActions {
  return {
    press: (name) => perform(context.id, name, 'onPress', [], timeoutMs),
    changeText: (name, text) => perform(context.id, name, 'onChangeText', [text], timeoutMs),
  };
}
