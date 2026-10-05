// Things with an autosave delay register here, so closing the window can save them first.

const pending = new Set<() => Promise<void>>()

export function registerFlush(flush: () => Promise<void>): () => void {
  pending.add(flush)
  return () => pending.delete(flush)
}

export async function flushAll(): Promise<void> {
  // A text box being typed in only saves its text when it loses focus.
  if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
  await Promise.allSettled([...pending].map((flush) => flush()))
}
