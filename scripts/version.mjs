// Semantic versions from Conventional Commits: the last release tag plus what changed since.

/** `v1.4.2` -> [1, 4, 2]; null for anything else. */
export function parseTag(tag) {
  const match = /^v(\d+)\.(\d+)\.(\d+)$/.exec(tag)
  return match ? match.slice(1).map(Number) : null
}

/**
 * The version after `last` for these commit messages (subject, then body): a breaking change
 * (`feat!:` or a BREAKING CHANGE line) is major, a feat is minor, anything else a patch.
 * No commits means the same version again.
 */
export function nextVersion(last, messages) {
  const [major, minor, patch] = last
  if (messages.length === 0) return `${major}.${minor}.${patch}`
  const breaking = messages.some(
    (m) => /^[a-z]+(\([^)]*\))?!:/.test(m) || /^BREAKING[ -]CHANGE:/m.test(m)
  )
  if (breaking) return `${major + 1}.0.0`
  if (messages.some((m) => /^feat(\([^)]*\))?:/.test(m))) return `${major}.${minor + 1}.0`
  return `${major}.${minor}.${patch + 1}`
}
