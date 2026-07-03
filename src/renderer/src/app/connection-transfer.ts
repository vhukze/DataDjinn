import type { ConnectionFolder } from './tree-model'
import type { ConnectionFormValues, ImportConnectionCandidate, ImportConnectionCandidateStatus } from './app-shared'

const TRANSFER_FILE_FORMAT = 'datadjinn-connections'
const TRANSFER_FILE_VERSION = 1
const PBKDF2_ITERATIONS = 210_000
const SALT_BYTES = 16
const IV_BYTES = 12
const ENCRYPTION_AAD = Uint8Array.from(new TextEncoder().encode('DataDjinn::ConnectionTransfer::v1'))
const textEncoder = new TextEncoder()
const textDecoder = new TextDecoder()
const normalizeTransferPassphrase = (value: string): string => value.normalize('NFC').trim()
const sanitizeTransferFileText = (value: string): string => value.replace(/^\uFEFF/, '').trim()

export type DataDjinnConnectionTransferConnection = {
  export_id: string
  payload: ConnectionFormValues
}

export type DataDjinnConnectionTransferBundle = {
  version: 1
  exported_at: string
  source_app_name?: string
  source_app_version?: string
  connections: DataDjinnConnectionTransferConnection[]
  folders: ConnectionFolder[]
  connection_folder_assignments: Record<string, string>
  connection_folder_order: string[]
  root_connection_order: string[]
  root_item_order: string[]
  folder_connection_order: Record<string, string[]>
}

type EncryptedConnectionTransferEnvelope = {
  format: typeof TRANSFER_FILE_FORMAT
  version: typeof TRANSFER_FILE_VERSION
  kdf: {
    algorithm: 'PBKDF2'
    hash: 'SHA-256'
    iterations: number
    salt: string
  }
  cipher: {
    algorithm: 'AES-GCM'
    iv: string
  }
  payload: string
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)

const toStringArray = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []

const getCrypto = (): Crypto => {
  if (!globalThis.crypto?.subtle) {
    throw new Error('当前环境不支持连接导入导出的加密能力')
  }
  return globalThis.crypto
}

const bytesToBase64 = (bytes: Uint8Array): string => {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(bytes).toString('base64')
  }

  let binary = ''
  bytes.forEach((value) => {
    binary += String.fromCharCode(value)
  })
  return btoa(binary)
}

const base64ToBytes = (value: string): Uint8Array => {
  const normalizedValue = value.replace(/\s+/g, '').replace(/-/g, '+').replace(/_/g, '/')
  if (typeof Buffer !== 'undefined') {
    return new Uint8Array(Buffer.from(normalizedValue, 'base64'))
  }

  const binary = atob(normalizedValue)
  return Uint8Array.from(binary, (char) => char.charCodeAt(0))
}

const randomBytes = (length: number): Uint8Array => {
  const cryptoApi = getCrypto()
  const bytes = new Uint8Array(length)
  cryptoApi.getRandomValues(bytes)
  return bytes
}

const toCryptoBuffer = (value: Uint8Array): Uint8Array<ArrayBuffer> => Uint8Array.from(value)

const deriveKey = async (passphrase: string, salt: Uint8Array, usage: KeyUsage[]): Promise<CryptoKey> => {
  const cryptoApi = getCrypto()
  const baseKey = await cryptoApi.subtle.importKey(
    'raw',
    textEncoder.encode(passphrase),
    'PBKDF2',
    false,
    ['deriveKey']
  )

  return await cryptoApi.subtle.deriveKey(
    {
      name: 'PBKDF2',
      hash: 'SHA-256',
      iterations: PBKDF2_ITERATIONS,
      salt: toCryptoBuffer(salt)
    },
    baseKey,
    {
      name: 'AES-GCM',
      length: 256
    },
    false,
    usage
  )
}

const normalizeFolderConnectionOrder = (value: unknown): Record<string, string[]> => {
  if (!isRecord(value)) {
    return {}
  }

  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => Boolean(key))
      .map(([key, item]) => [key, toStringArray(item)])
  )
}

const normalizeTransferConnection = (value: unknown): DataDjinnConnectionTransferConnection => {
  if (!isRecord(value)) {
    throw new Error('连接导入文件中的连接数据结构无效')
  }
  if (typeof value.export_id !== 'string' || !value.export_id.trim()) {
    throw new Error('连接导入文件中的连接标识缺失')
  }
  if (!isRecord(value.payload) || typeof value.payload.name !== 'string' || typeof value.payload.database_type !== 'string') {
    throw new Error('连接导入文件中的连接配置无效')
  }

  return {
    export_id: value.export_id,
    payload: value.payload as ConnectionFormValues
  }
}

export const normalizeDataDjinnConnectionTransferBundle = (value: unknown): DataDjinnConnectionTransferBundle => {
  if (!isRecord(value)) {
    throw new Error('连接导入文件内容无效')
  }
  if (value.version !== 1) {
    throw new Error('当前暂不支持该版本的 DataDjinn 连接导入文件')
  }

  const connections = Array.isArray(value.connections)
    ? value.connections.map((item) => normalizeTransferConnection(item))
    : []
  if (connections.length === 0) {
    throw new Error('连接导入文件中没有可导入的连接')
  }

  const folders = Array.isArray(value.folders)
    ? value.folders
        .filter((item): item is ConnectionFolder => (
          isRecord(item) &&
          typeof item.id === 'string' &&
          typeof item.name === 'string' &&
          item.id.trim().length > 0 &&
          item.name.trim().length > 0
        ))
        .map((item) => ({ id: item.id, name: item.name }))
    : []

  const folderIdSet = new Set(folders.map((folder) => folder.id))
  const connectionIdSet = new Set(connections.map((connection) => connection.export_id))
  const connectionFolderAssignments = Object.fromEntries(
    Object.entries(isRecord(value.connection_folder_assignments) ? value.connection_folder_assignments : {})
      .filter(([connectionId, folderId]) => (
        connectionIdSet.has(connectionId) &&
        typeof folderId === 'string' &&
        folderIdSet.has(folderId)
      ))
      .map(([connectionId, folderId]) => [connectionId, folderId as string])
  )

  return {
    version: 1,
    exported_at: typeof value.exported_at === 'string' ? value.exported_at : new Date().toISOString(),
    source_app_name: typeof value.source_app_name === 'string' ? value.source_app_name : undefined,
    source_app_version: typeof value.source_app_version === 'string' ? value.source_app_version : undefined,
    connections,
    folders,
    connection_folder_assignments: connectionFolderAssignments,
    connection_folder_order: toStringArray(value.connection_folder_order).filter((folderId) => folderIdSet.has(folderId)),
    root_connection_order: toStringArray(value.root_connection_order).filter((connectionId) => connectionIdSet.has(connectionId)),
    root_item_order: toStringArray(value.root_item_order).filter((itemId) => {
      if (itemId.startsWith('folder:')) {
        return folderIdSet.has(itemId.slice('folder:'.length))
      }
      if (itemId.startsWith('connection:')) {
        return connectionIdSet.has(itemId.slice('connection:'.length))
      }
      return false
    }),
    folder_connection_order: Object.fromEntries(
      Object.entries(normalizeFolderConnectionOrder(value.folder_connection_order))
        .filter(([folderId]) => folderIdSet.has(folderId))
        .map(([folderId, connectionIds]) => [
          folderId,
          connectionIds.filter((connectionId) => connectionIdSet.has(connectionId))
        ])
    )
  }
}

const buildImportWarnings = (payload: ConnectionFormValues): string[] => {
  const warnings: string[] = []

  if (payload.database_type === 'dm' || payload.database_type === 'gaussdb') {
    warnings.push('导入后请确认驱动配置在当前设备上仍然有效')
  }
  if (payload.ssh_enabled && payload.ssh_auth_type === 'private_key' && payload.ssh_private_key_path) {
    warnings.push('导入后请确认 SSH 私钥路径在当前设备上仍然存在')
  }

  return warnings
}

export const buildDataDjinnImportCandidates = (bundle: DataDjinnConnectionTransferBundle): ImportConnectionCandidate[] =>
  bundle.connections.map<ImportConnectionCandidate>((connection) => {
    const warnings = buildImportWarnings(connection.payload)
    const status: ImportConnectionCandidateStatus = warnings.length > 0 ? 'warning' : 'ready'

    return {
      key: connection.export_id,
      name: connection.payload.name,
      database_type: connection.payload.database_type,
      host: connection.payload.host,
      port: connection.payload.port,
      username: connection.payload.username,
      database: connection.payload.database,
      status,
      message: warnings.join('；') || undefined,
      payload: connection.payload
    }
  })

export const encryptConnectionTransferBundle = async (
  bundle: DataDjinnConnectionTransferBundle,
  passphrase: string
): Promise<string> => {
  const normalizedPassphrase = normalizeTransferPassphrase(passphrase)
  if (!normalizedPassphrase) {
    throw new Error('导出口令不能为空')
  }

  const salt = randomBytes(SALT_BYTES)
  const iv = randomBytes(IV_BYTES)
  const key = await deriveKey(normalizedPassphrase, salt, ['encrypt'])
  const encrypted = await getCrypto().subtle.encrypt(
    {
      name: 'AES-GCM',
      iv: toCryptoBuffer(iv),
      additionalData: ENCRYPTION_AAD
    },
    key,
    textEncoder.encode(JSON.stringify(bundle))
  )

  const payload: EncryptedConnectionTransferEnvelope = {
    format: TRANSFER_FILE_FORMAT,
    version: TRANSFER_FILE_VERSION,
    kdf: {
      algorithm: 'PBKDF2',
      hash: 'SHA-256',
      iterations: PBKDF2_ITERATIONS,
      salt: bytesToBase64(salt)
    },
    cipher: {
      algorithm: 'AES-GCM',
      iv: bytesToBase64(iv)
    },
    payload: bytesToBase64(new Uint8Array(encrypted))
  }

  return JSON.stringify(payload, null, 2)
}

export const decryptConnectionTransferBundle = async (
  rawText: string,
  passphrase: string
): Promise<DataDjinnConnectionTransferBundle> => {
  const normalizedPassphrase = normalizeTransferPassphrase(passphrase)
  if (!normalizedPassphrase) {
    throw new Error('导入口令不能为空')
  }

  const normalizedRawText = sanitizeTransferFileText(rawText)
  let parsed: unknown
  try {
    parsed = JSON.parse(normalizedRawText)
  } catch {
    throw new Error('连接导入文件不是有效的 JSON')
  }

  if (!isRecord(parsed) || parsed.format !== TRANSFER_FILE_FORMAT || parsed.version !== TRANSFER_FILE_VERSION) {
    throw new Error('不是有效的 DataDjinn 连接导入文件')
  }

  const iterations = isRecord(parsed.kdf) && typeof parsed.kdf.iterations === 'number'
    ? parsed.kdf.iterations
    : PBKDF2_ITERATIONS
  if (iterations !== PBKDF2_ITERATIONS) {
    throw new Error('当前暂不支持该加密参数的连接导入文件')
  }

  try {
    const salt = base64ToBytes(String(isRecord(parsed.kdf) ? parsed.kdf.salt ?? '' : ''))
    const iv = base64ToBytes(String(isRecord(parsed.cipher) ? parsed.cipher.iv ?? '' : ''))
    const payloadBytes = base64ToBytes(String(parsed.payload ?? ''))
    const key = await deriveKey(normalizedPassphrase, salt, ['decrypt'])
    const decrypted = await getCrypto().subtle.decrypt(
      {
        name: 'AES-GCM',
        iv: toCryptoBuffer(iv),
        additionalData: ENCRYPTION_AAD
      },
      key,
      toCryptoBuffer(payloadBytes)
    )

    return normalizeDataDjinnConnectionTransferBundle(JSON.parse(textDecoder.decode(decrypted)))
  } catch {
    throw new Error('导入口令错误，或连接导入文件已损坏')
  }
}
