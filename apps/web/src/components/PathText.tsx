import { Fragment, type ReactElement } from 'react';

/**
 * A Storybook title like "Screen Components/Home/Section" with a `<wbr>` after each "/", so a
 * narrow column breaks it at the path separators rather than mid-word.
 */
export function PathText({ text }: { readonly text: string }): ReactElement {
  const parts = text.split('/');
  return (
    <>
      {parts.map((part, index) => (
        // The parts of one title never reorder, so the index is a stable key.
        <Fragment key={index}>
          {part}
          {index < parts.length - 1 ? (
            <>
              /<wbr />
            </>
          ) : null}
        </Fragment>
      ))}
    </>
  );
}
