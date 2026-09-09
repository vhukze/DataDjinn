export type AtomRelease = {
  tagName: string
  name: string
  body?: string
}

const MAIN_RELEASE_TAG_PATTERN = /^v\d+(?:\.\d+){2,3}(?:[-+].*)?$/i

const decodeXmlEntities = (value: string): string =>
  value.replace(/&(#x[0-9a-f]+|#\d+|amp|apos|quot|lt|gt);/gi, (entity, token: string) => {
    const normalized = token.toLowerCase()
    if (normalized === 'amp') return '&'
    if (normalized === 'apos') return "'"
    if (normalized === 'quot') return '"'
    if (normalized === 'lt') return '<'
    if (normalized === 'gt') return '>'
    const codePoint = normalized.startsWith('#x')
      ? Number.parseInt(normalized.slice(2), 16)
      : Number.parseInt(normalized.slice(1), 10)
    return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : entity
  })

const extractXmlText = (entry: string, tag: string): string | undefined => {
  const match = entry.match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'))
  return match ? decodeXmlEntities(match[1]).trim() : undefined
}

export const extractLatestMainReleaseFromAtom = (feed: string): AtomRelease | undefined => {
  const entries = feed.match(/<entry\b[^>]*>[\s\S]*?<\/entry>/gi) ?? []

  for (const entry of entries) {
    const tagName = entry.match(/\/releases\/tag\/(v\d+(?:\.\d+){2,3}(?:[-+][^"'<\s]*)?)/i)?.[1]
    if (!tagName || !MAIN_RELEASE_TAG_PATTERN.test(tagName)) {
      continue
    }

    const body = extractXmlText(entry, 'content')
    return {
      tagName,
      name: extractXmlText(entry, 'title') || `DataDjinn ${tagName}`,
      body: body || undefined
    }
  }

  return undefined
}
