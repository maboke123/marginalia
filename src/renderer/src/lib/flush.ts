// Things with an autosave delay register here, so closing the window can save them first.

const pending = new Set<() => Promise<void>>()

export function registerFlush(flush: () => Promise<void>): () => void {
  pending.add(flush)
  return () => pending.delete(flush)
}

export async function flushAll(): Promise<void> {
  await Promise.allSettled([...pending].map((flush) => flush()))
}
