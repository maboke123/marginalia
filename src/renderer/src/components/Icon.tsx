const PATHS = {
  chevron: 'M6 4l4 4-4 4',
  notebook: 'M4 2.5h8.5v11H4zM4 2.5v11M2.5 5h2M2.5 8h2M2.5 11h2',
  folder: 'M2 4.5a1 1 0 0 1 1-1h3l1.5 1.5H13a1 1 0 0 1 1 1V12a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1z',
  page: 'M4 1.75h5.5L12.5 4.75v9.5H4zM9.5 1.75v3h3M6 8h4.5M6 10.5h4.5',
  pdf: 'M4 1.75h5.5L12.5 4.75v9.5H4zM9.5 1.75v3h3M6 9.5h1.25a1 1 0 0 0 0-2H6v4',
  plus: 'M8 3v10M3 8h10',
  minus: 'M3 8h10',
  import: 'M8 2.5v7.5M5 7l3 3 3-3M3 11v2.5h10V11',
  vault: 'M2.5 3h11v10h-11zM2.5 6h11',
  cursor: 'M4 2.5l8 5.5-3.5.75L10.5 13l-1.5.75-2-4.25L4 12z',
  pen: 'M10.5 2.5l3 3-7.5 7.5-3.75.75.75-3.75zM9 4l3 3',
  highlighter: 'M9.5 2.5l4 4-5 5-4-4zM4.5 7.5l-2 4 2 2 4-2M2.5 13.5h4',
  eraser: 'M6 13.5h7.5M2.75 9.75l6-6.25a1 1 0 0 1 1.4 0l3.1 3.1a1 1 0 0 1 0 1.4L7.5 13.5H5.25z',
  text: 'M3 3.5h10M8 3.5v9.5M6 13h4',
  undo: 'M5.5 3.5L2.5 6.5l3 3M2.5 6.5H10a3.5 3.5 0 0 1 0 7H7',
  columns: 'M2.5 3h11v10h-11zM8 3v10',
  redo: 'M10.5 3.5l3 3-3 3M13.5 6.5H6a3.5 3.5 0 0 0 0 7h3',
  close: 'M4 4l8 8M12 4l-8 8',
  settings:
    'M8 5.75a2.25 2.25 0 1 0 0 4.5 2.25 2.25 0 0 0 0-4.5zM8 1.75v1.5M8 12.75v1.5M1.75 8h1.5M12.75 8h1.5M3.6 3.6l1.05 1.05M11.35 11.35l1.05 1.05M3.6 12.4l1.05-1.05M11.35 4.65l1.05-1.05',
  send: 'M8 13V3.5M4 7.5l4-4 4 4',
  stop: 'M4.5 4.5h7v7h-7z',
  chat: 'M2.5 3.5h11v7.5H7l-3 2.5v-2.5H2.5z',
  search: 'M7 2.75a4.25 4.25 0 1 0 0 8.5 4.25 4.25 0 0 0 0-8.5zM10.1 10.1l3.4 3.4',
  export: 'M8 10V2.5M5 5.5l3-3 3 3M3 9v4.5h10V9',
  addPage: 'M4 1.75h5.5L12.5 4.75v9.5H4zM9.5 1.75v3h3M8.25 7.5v4.5M6 9.75h4.5'
} as const

export type IconName = keyof typeof PATHS

export function Icon({
  name,
  className
}: {
  name: IconName
  className?: string
}): React.JSX.Element {
  return (
    <svg
      className={className}
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.25"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={PATHS[name]} />
    </svg>
  )
}
