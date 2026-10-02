const PATHS = {
  chevron: 'M6 4l4 4-4 4',
  notebook: 'M4 2.5h8.5v11H4zM4 2.5v11M2.5 5h2M2.5 8h2M2.5 11h2',
  folder: 'M2 4.5a1 1 0 0 1 1-1h3l1.5 1.5H13a1 1 0 0 1 1 1V12a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1z',
  page: 'M4 1.75h5.5L12.5 4.75v9.5H4zM9.5 1.75v3h3M6 8h4.5M6 10.5h4.5',
  pdf: 'M4 1.75h5.5L12.5 4.75v9.5H4zM9.5 1.75v3h3M6 9.5h1.25a1 1 0 0 0 0-2H6v4',
  plus: 'M8 3v10M3 8h10',
  vault: 'M2.5 3h11v10h-11zM2.5 6h11'
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
