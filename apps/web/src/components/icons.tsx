import type { ReactElement, ReactNode } from 'react';

function Icon({ children, size = 16 }: { readonly children: ReactNode; readonly size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

export function GridIcon(): ReactElement {
  return (
    <Icon size={18}>
      <rect x="2" y="2" width="5" height="5" rx="1" />
      <rect x="9" y="2" width="5" height="5" rx="1" />
      <rect x="2" y="9" width="5" height="5" rx="1" />
      <rect x="9" y="9" width="5" height="5" rx="1" />
    </Icon>
  );
}

export function ListIcon(): ReactElement {
  return (
    <Icon size={18}>
      <path d="M5.5 4h8.5M5.5 8h8.5M5.5 12h8.5" />
      <circle cx="2.5" cy="4" r="0.6" fill="currentColor" />
      <circle cx="2.5" cy="8" r="0.6" fill="currentColor" />
      <circle cx="2.5" cy="12" r="0.6" fill="currentColor" />
    </Icon>
  );
}

export function ChevronLeftIcon(): ReactElement {
  return (
    <Icon>
      <path d="M10 3.5 5.5 8l4.5 4.5" />
    </Icon>
  );
}

export function ChevronRightIcon(): ReactElement {
  return (
    <Icon>
      <path d="M6 3.5 10.5 8 6 12.5" />
    </Icon>
  );
}

export function CaretIcon(): ReactElement {
  return (
    <Icon size={12}>
      <path d="M4 6l4 4 4-4" />
    </Icon>
  );
}

export function CheckIcon(): ReactElement {
  return (
    <Icon size={14}>
      <path d="M3 8.5 6.5 12 13 4.5" />
    </Icon>
  );
}

export function CloseIcon(): ReactElement {
  return (
    <Icon size={14}>
      <path d="M4 4l8 8M12 4l-8 8" />
    </Icon>
  );
}

export function OpenIcon(): ReactElement {
  return (
    <Icon size={14}>
      <path d="M13 8a5 5 0 1 1-1.5-3.6M13 2.5v2.5h-2.5" />
    </Icon>
  );
}

export function DiffIcon(): ReactElement {
  return (
    <Icon>
      <rect x="2" y="2" width="8" height="8" rx="1" />
      <rect x="6" y="6" width="8" height="8" rx="1" fill="currentColor" fillOpacity="0.25" />
    </Icon>
  );
}

export function FitIcon(): ReactElement {
  return (
    <Icon>
      <path d="M2 6V2h4M10 2h4v4M14 10v4h-4M6 14H2v-4" />
    </Icon>
  );
}

export function ActualSizeIcon(): ReactElement {
  return (
    <Icon>
      <rect x="2.5" y="2.5" width="11" height="11" rx="1" />
      <path d="M6 6v4M9 6v4" />
    </Icon>
  );
}
