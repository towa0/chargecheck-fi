// Small inline icons. All are decorative: text next to them carries the meaning.
import type { SVGProps } from 'react';

type P = SVGProps<SVGSVGElement>;

function Svg({ children, ...rest }: P) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      {children}
    </svg>
  );
}

export const BoltIcon = (p: P) => (
  <Svg {...p} fill="currentColor" stroke="none">
    <path d="M9.2 1 3 9.1h4.2L6.4 15 13 6.6H8.7L9.2 1Z" />
  </Svg>
);

export const CheckIcon = (p: P) => (
  <Svg {...p}>
    <path d="m3.5 8.5 3 3 6-7" />
  </Svg>
);

export const ClockIcon = (p: P) => (
  <Svg {...p}>
    <circle cx="8" cy="8" r="6" />
    <path d="M8 4.5V8l2.5 1.5" />
  </Svg>
);

export const CrossIcon = (p: P) => (
  <Svg {...p}>
    <path d="m4.5 4.5 7 7m0-7-7 7" />
  </Svg>
);

export const QuestionIcon = (p: P) => (
  <Svg {...p}>
    <path d="M5.8 6a2.3 2.3 0 1 1 3.2 2.1c-.6.3-1 .8-1 1.4v.3" />
    <circle cx="8" cy="12.4" r=".6" fill="currentColor" stroke="none" />
  </Svg>
);

export const LocateIcon = (p: P) => (
  <Svg {...p}>
    <circle cx="8" cy="8" r="4.5" />
    <circle cx="8" cy="8" r="1.4" fill="currentColor" stroke="none" />
    <path d="M8 1v2m0 10v2M1 8h2m10 0h2" />
  </Svg>
);

export const ChevronIcon = (p: P) => (
  <Svg {...p}>
    <path d="m4 6 4 4 4-4" />
  </Svg>
);

export const DirectionsIcon = (p: P) => (
  <Svg {...p}>
    <path d="M8 1.5 14.5 8 8 14.5 1.5 8 8 1.5Z" />
    <path d="M6 9.5V8h4m-1.5-1.5L10 8 8.5 9.5" />
  </Svg>
);

export const MapIcon = (p: P) => (
  <Svg {...p}>
    <path d="M1.5 3.5 5.5 2l5 2 4-1.5v10l-4 1.5-5-2-4 1.5v-10Z" />
    <path d="M5.5 2v10m5-8v10" />
  </Svg>
);

export const ListIcon = (p: P) => (
  <Svg {...p}>
    <path d="M5.5 4h8m-8 4h8m-8 4h8" />
    <circle cx="2.5" cy="4" r=".8" fill="currentColor" stroke="none" />
    <circle cx="2.5" cy="8" r=".8" fill="currentColor" stroke="none" />
    <circle cx="2.5" cy="12" r=".8" fill="currentColor" stroke="none" />
  </Svg>
);

export const MoonIcon = (p: P) => (
  <Svg {...p}>
    <path d="M13 9.5A5.5 5.5 0 0 1 6.5 3a5.5 5.5 0 1 0 6.5 6.5Z" />
  </Svg>
);

export const StatusIcon = ({ kind, ...p }: P & { kind: 'free' | 'busy' | 'down' | 'unknown' }) => {
  if (kind === 'free') return <CheckIcon {...p} />;
  if (kind === 'busy') return <ClockIcon {...p} />;
  if (kind === 'down') return <CrossIcon {...p} />;
  return <QuestionIcon {...p} />;
};
