import type { ReactElement } from 'react';

export interface TabItem<Id extends string> {
  readonly id: Id;
  readonly label: string;
  readonly count?: number;
}

export interface TabsProps<Id extends string> {
  readonly label: string;
  readonly items: readonly TabItem<Id>[];
  readonly active: Id;
  readonly onSelect: (id: Id) => void;
  /** Render as a joined segmented control instead of loose tabs. */
  readonly segmented?: boolean;
}

/** A row of tab buttons; the parent owns which one is active. */
export function Tabs<Id extends string>({
  label,
  items,
  active,
  onSelect,
  segmented = false,
}: TabsProps<Id>): ReactElement {
  return (
    <div role="tablist" aria-label={label} className={segmented ? 'tabs segmented' : 'tabs'}>
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          role="tab"
          aria-selected={item.id === active}
          className={segmented ? 'segment' : 'tab'}
          onClick={() => {
            onSelect(item.id);
          }}
        >
          {item.label}
          {item.count === undefined ? null : <span className="tab-count">{item.count}</span>}
        </button>
      ))}
    </div>
  );
}
