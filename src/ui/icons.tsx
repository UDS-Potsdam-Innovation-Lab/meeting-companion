// Inline icons. They are decorative; the button around them carries the accessible name.
const base = {
  width: 16,
  height: 16,
  viewBox: "0 0 16 16",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
  focusable: false,
};

export const ArrowUpIcon = () => (
  <svg {...base}>
    <path d="M8 13V3M3.5 7.5 8 3l4.5 4.5" />
  </svg>
);

export const ArrowDownIcon = () => (
  <svg {...base}>
    <path d="M8 3v10M3.5 8.5 8 13l4.5-4.5" />
  </svg>
);

export const CloseIcon = () => (
  <svg {...base}>
    <path d="M4 4l8 8M12 4l-8 8" />
  </svg>
);

export const TrashIcon = () => (
  <svg {...base}>
    <path d="M2.5 4.5h11M6.5 4.5V3h3v1.5M4 4.5l.7 8.5h6.6l.7-8.5" />
  </svg>
);

export const PlusIcon = () => (
  <svg {...base}>
    <path d="M8 3v10M3 8h10" />
  </svg>
);

export const PencilIcon = () => (
  <svg {...base}>
    <path d="M10.5 2.5l3 3L6 13H3v-3l7.5-7.5z" />
  </svg>
);

export const LogoMark = () => (
  <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden focusable={false}>
    <path d="M7 1l6 6-6 6-6-6z" fill="#FFFFFF" />
  </svg>
);

export const PauseIcon = () => (
  <svg {...base} fill="currentColor" stroke="none">
    <rect x="3.5" y="3" width="3" height="10" rx="0.8" />
    <rect x="9.5" y="3" width="3" height="10" rx="0.8" />
  </svg>
);

export const PlayIcon = () => (
  <svg {...base} fill="currentColor" stroke="none">
    <path d="M4.5 3.2v9.6a.6.6 0 0 0 .9.5l7.6-4.8a.6.6 0 0 0 0-1L5.4 2.7a.6.6 0 0 0-.9.5Z" />
  </svg>
);

export const MicIcon = () => (
  <svg {...base}>
    <rect x="5.5" y="1.8" width="5" height="8" rx="2.5" />
    <path d="M3 7.5a5 5 0 0 0 10 0M8 12.5v2" />
  </svg>
);

export const ArrowRightIcon = () => (
  <svg {...base}>
    <path d="M3 8h10M8.5 3.5 13 8l-4.5 4.5" />
  </svg>
);

export const WaveIcon = () => (
  <svg {...base} width={24}>
    <path d="M1 7v2M4 5v6M7 3v10M10 6v4M13 4v8" />
  </svg>
);

export const ChevronDownIcon = () => (
  <svg {...base} width={12} height={12}>
    <path d="M4 6l4 4 4-4" />
  </svg>
);
