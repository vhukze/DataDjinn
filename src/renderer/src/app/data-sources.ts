export type DatabaseType = 'sqlite' | 'mysql' | 'postgresql' | 'dm' | 'gaussdb' | 'oracle' | 'mongodb' | 'redis' | 'clickhouse'

export const DATABASE_TYPE_LABELS: Record<DatabaseType, string> = {
  sqlite: 'SQLite',
  mysql: 'MySQL',
  postgresql: 'PG',
  dm: 'DM',
  gaussdb: 'Gauss',
  oracle: 'Oracle',
  mongodb: 'Mongo',
  redis: 'Redis',
  clickhouse: 'CK'
}

export type ImportConnectionSource = 'datagrip'
export type ImportConnectionCandidateStatus = 'ready' | 'warning' | 'error'

export type ConnectionFormValues = {
  name: string
  database_type: DatabaseType
  host?: string
  port?: number | string
  username?: string
  password?: string
  database?: string
  sqlite_path?: string
  driver_id?: string
  driver_path?: string
  dm_driver_id?: string
  dm_driver_path?: string
}

export type ImportConnectionCandidate = {
  key: string
  name: string
  database_type?: DatabaseType
  host?: string
  port?: number | string
  username?: string
  database?: string
  rawJdbcUrl?: string
  status: ImportConnectionCandidateStatus
  message?: string
  payload?: ConnectionFormValues
}

export type ImportConnectionResultItem = {
  name: string
  database_type?: DatabaseType
  message?: string
}

export type ImportConnectionResult = {
  success: ImportConnectionResultItem[]
  failed: ImportConnectionResultItem[]
}

export const IMPORT_CONNECTION_SOURCE_OPTIONS = [
  { label: 'DataGrip', value: 'datagrip' }
]

export const defaultPortForDatabaseType = (databaseType: DatabaseType): number | undefined => {
  if (databaseType === 'postgresql') {
    return 5432
  }
  if (databaseType === 'mysql') {
    return 3306
  }
  if (databaseType === 'dm') {
    return 5236
  }
  if (databaseType === 'gaussdb') {
    return 8000
  }
  if (databaseType === 'oracle') {
    return 1521
  }
  if (databaseType === 'mongodb') {
    return 27017
  }
  if (databaseType === 'redis') {
    return 6379
  }
  if (databaseType === 'clickhouse') {
    return 8123
  }
  return undefined
}

export const trimToUndefined = (value?: string | null): string | undefined => {
  const trimmed = value?.trim()
  return trimmed ? trimmed : undefined
}

export const sanitizeImportedXml = (xml: string): string =>
  xml.replace(/&(?!(?:amp|lt|gt|quot|apos|#\d+|#x[a-fA-F0-9]+);)/g, '&amp;')

export const inferDataGripDatabaseType = (params: {
  dbms?: string
  product?: string
  driverRef?: string
  jdbcDriver?: string
  jdbcUrl?: string
}): DatabaseType | undefined => {
  const fingerprint = [
    params.dbms,
    params.product,
    params.driverRef,
    params.jdbcDriver,
    params.jdbcUrl
  ]
    .filter((item): item is string => Boolean(item))
    .join(' ')
    .toLowerCase()

  if (fingerprint.includes('clickhouse')) {
    return 'clickhouse'
  }
  if (fingerprint.includes('postgres')) {
    return 'postgresql'
  }
  if (fingerprint.includes('gauss')) {
    return 'gaussdb'
  }
  if (fingerprint.includes('dm dbms') || fingerprint.includes('dm.jdbc.driver') || fingerprint.includes('jdbc:dm:')) {
    return 'dm'
  }
  if (fingerprint.includes('redis')) {
    return 'redis'
  }
  if (fingerprint.includes('oracle')) {
    return 'oracle'
  }
  if (fingerprint.includes('mysql')) {
    return 'mysql'
  }
  if (fingerprint.includes('mongo')) {
    return 'mongodb'
  }
  return undefined
}

export const parseJdbcUrlToConnectionFields = (jdbcUrl: string, databaseType: DatabaseType): Pick<ConnectionFormValues, 'host' | 'port' | 'database'> => {
  const normalized = jdbcUrl.trim()

  if (!normalized.toLowerCase().startsWith('jdbc:')) {
    throw new Error('不是有效的 JDBC URL')
  }

  const runtimeUrlValue = normalized.replace(/^jdbc:/i, '')
  let runtimeUrl: URL | null = null
  let host: string | undefined
  let port: number | string | undefined
  let pathname = ''
  let schema: string | undefined

  try {
    runtimeUrl = new URL(runtimeUrlValue)
    host = trimToUndefined(runtimeUrl.hostname)
    const parsedPort = runtimeUrl.port ? Number(runtimeUrl.port) : undefined
    port = Number.isFinite(parsedPort) ? parsedPort : undefined
    pathname = decodeURIComponent(runtimeUrl.pathname || '').replace(/^\/+/, '')
    schema = trimToUndefined(runtimeUrl.searchParams.get('schema'))
  } catch {
    const multiHostMatch = runtimeUrlValue.match(/^[a-z0-9+.-]+:\/\/([^/?#]+)(\/[^?#]*)?(?:\?([^#]*))?$/i)
    if (!multiHostMatch) {
      throw new Error('不是有效的 JDBC URL')
    }

    const hostList = multiHostMatch[1]
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean)
    const firstHost = hostList[0]
    if (!firstHost) {
      throw new Error('未解析到主机')
    }

    const firstHostMatch = firstHost.match(/^(?:\[([^\]]+)\]|([^:]+))(?:\:(\d+))?$/)
    if (!firstHostMatch) {
      throw new Error('未解析到主机')
    }

    host = trimToUndefined(firstHostMatch[1] || firstHostMatch[2])
    const portList = hostList
      .map((item) => {
        const match = item.match(/^(?:\[[^\]]+\]|[^:]+)(?:\:(\d+))?$/)
        return match?.[1]
      })
      .filter((item): item is string => Boolean(item))
    if (portList.length > 1 && databaseType === 'clickhouse') {
      port = portList.join(',')
    } else {
      const parsedPort = firstHostMatch[3] ? Number(firstHostMatch[3]) : undefined
      port = Number.isFinite(parsedPort) ? parsedPort : undefined
    }
    pathname = decodeURIComponent((multiHostMatch[2] || '').replace(/^\/+/, ''))
    const searchParams = new URLSearchParams(multiHostMatch[3] || '')
    schema = trimToUndefined(searchParams.get('schema'))
  }

  port = port ?? defaultPortForDatabaseType(databaseType)

  if (databaseType !== 'sqlite' && !host) {
    throw new Error('未解析到主机')
  }

  if (databaseType === 'dm') {
    return {
      host,
      port,
      database: schema ?? trimToUndefined(pathname)
    }
  }

  if (databaseType === 'redis') {
    return {
      host,
      port,
      database: trimToUndefined(pathname) ?? '0'
    }
  }

  return {
    host,
    port,
    database: trimToUndefined(pathname)
  }
}

export const parseDataGripImportText = (rawText: string): ImportConnectionCandidate[] => {
  const blockMatches = [...rawText.matchAll(/#LocalDataSource:\s*([^\r\n]+)[\r\n]+#BEGIN#([\s\S]*?)#END#/g)]
  const fallbackMatches = blockMatches.length === 0 ? [...rawText.matchAll(/#BEGIN#([\s\S]*?)#END#/g)] : []
  const blocks = blockMatches.length > 0
    ? blockMatches.map((match, index) => ({ key: `dg-${index}`, label: trimToUndefined(match[1]), xml: match[2] }))
    : fallbackMatches.map((match, index) => ({ key: `dg-${index}`, label: undefined, xml: match[1] }))

  return blocks.map<ImportConnectionCandidate>((block, index) => {
    try {
      const parsed = new DOMParser().parseFromString(sanitizeImportedXml(block.xml.trim()), 'application/xml')
      const parserError = parsed.querySelector('parsererror')
      if (parserError) {
        throw new Error('连接配置 XML 解析失败')
      }

      const dataSource = parsed.querySelector('data-source')
      if (!dataSource) {
        throw new Error('未找到 data-source 节点')
      }

      const databaseInfo = dataSource.querySelector('database-info')
      const jdbcUrl = trimToUndefined(dataSource.querySelector('jdbc-url')?.textContent)
      const username = trimToUndefined(dataSource.querySelector('user-name')?.textContent)
      const driverRef = trimToUndefined(dataSource.querySelector('driver-ref')?.textContent)
      const jdbcDriver = trimToUndefined(dataSource.querySelector('jdbc-driver')?.textContent)
      const product = trimToUndefined(databaseInfo?.getAttribute('product'))
      const dbms = trimToUndefined(databaseInfo?.getAttribute('dbms'))
      const databaseType = inferDataGripDatabaseType({
        dbms,
        product,
        driverRef,
        jdbcDriver,
        jdbcUrl
      })
      const name = trimToUndefined(dataSource.getAttribute('name')) ?? block.label ?? `导入连接 ${index + 1}`

      if (!jdbcUrl) {
        throw new Error('未解析到 JDBC URL')
      }
      if (!databaseType) {
        throw new Error('当前仅支持导入已识别的 DataGrip 数据源类型')
      }

      const jdbcFields = parseJdbcUrlToConnectionFields(jdbcUrl, databaseType)
      const payload: ConnectionFormValues = {
        name,
        database_type: databaseType,
        host: jdbcFields.host,
        port: jdbcFields.port,
        username,
        password: '',
        database: jdbcFields.database,
        driver_id: undefined,
        dm_driver_id: undefined
      }

      const warnings: string[] = []
      if (databaseType === 'dm' || databaseType === 'gaussdb') {
        warnings.push(`导入后仍需在编辑连接中选择${DATABASE_TYPE_LABELS[databaseType]}驱动`)
      }

      return {
        key: block.key,
        name,
        database_type: databaseType,
        host: payload.host,
        port: payload.port,
        username: payload.username,
        database: payload.database,
        rawJdbcUrl: jdbcUrl,
        status: warnings.length > 0 ? 'warning' : 'ready',
        message: warnings.join('；') || undefined,
        payload
      }
    } catch (error) {
      return {
        key: block.key,
        name: block.label ?? `导入连接 ${index + 1}`,
        rawJdbcUrl: undefined,
        status: 'error',
        message: error instanceof Error ? error.message : '解析失败'
      }
    }
  })
}

export const isDatabaseScopedType = (databaseType?: DatabaseType): databaseType is 'mysql' | 'mongodb' | 'redis' | 'clickhouse' =>
  databaseType === 'mysql' || databaseType === 'mongodb' || databaseType === 'redis' || databaseType === 'clickhouse'

export const isSchemaScopedType = (databaseType?: DatabaseType): databaseType is 'postgresql' | 'gaussdb' =>
  databaseType === 'postgresql' || databaseType === 'gaussdb'
