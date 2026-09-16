const normalizeOptionalModuleVersion = (version: string): string => version.trim().replace(/^v/i, '')

export const compareOptionalModuleVersion = (left: string, right: string): number => {
  const leftParts = normalizeOptionalModuleVersion(left)
    .split('.')
    .map((part) => Number.parseInt(part, 10) || 0)
  const rightParts = normalizeOptionalModuleVersion(right)
    .split('.')
    .map((part) => Number.parseInt(part, 10) || 0)
  const length = Math.max(leftParts.length, rightParts.length)

  for (let index = 0; index < length; index += 1) {
    const diff = (leftParts[index] ?? 0) - (rightParts[index] ?? 0)
    if (diff !== 0) {
      return diff > 0 ? 1 : -1
    }
  }

  return 0
}

export const isOptionalModuleUpdateAvailable = (
  installedVersion: string | undefined,
  pendingVersion: string | undefined,
  availableVersion: string
): boolean => {
  const latestLocalVersion = [installedVersion, pendingVersion]
    .filter((version): version is string => Boolean(version?.trim()))
    .reduce<string | undefined>(
      (latest, version) =>
        !latest || compareOptionalModuleVersion(version, latest) > 0 ? version : latest,
      undefined
    )

  return Boolean(
    latestLocalVersion && compareOptionalModuleVersion(availableVersion, latestLocalVersion) > 0
  )
}
