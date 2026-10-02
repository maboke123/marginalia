import { useState } from 'react'

/** Arrow keys move through a result list, Enter picks. */
export function useListKeys(
  count: number,
  pick: (index: number) => void
): {
  active: number
  setActive(i: number): void
  onKeyDown(e: React.KeyboardEvent): void
} {
  const [active, setActive] = useState(0)
  const current = Math.min(active, Math.max(0, count - 1))
  const onKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      if (!count) return
      const step = e.key === 'ArrowDown' ? 1 : -1
      setActive((current + step + count) % count)
      document
        .querySelectorAll('.overlay-item')
        [(current + step + count) % count]?.scrollIntoView({ block: 'nearest' })
    } else if (e.key === 'Enter' && count) {
      e.preventDefault()
      pick(current)
    }
  }
  return { active: current, setActive, onKeyDown }
}
