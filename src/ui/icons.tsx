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
