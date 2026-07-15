import type { ConnectionFormValues } from './app-shared'
import type { DatabaseType } from './data-sources'

type ConnectionClipboardSource = Pick<
  ConnectionFormValues,
  'name' | 'database_type' | 'host' | 'port' | 'username' | 'password' | 'database' | 'sqlite_path'
>

const firstPort = (port?: number | string): string =>
  String(port ?? '')
    .split(',')[0]
    .trim()

const jdbcHost = (host?: string): string => {
  const value = host?.trim() ?? ''
  return value.includes(':') && !value.startsWith('[') ? `[${value}]` : value
}

const serverAddress = (source: ConnectionClipboardSource): string | undefined => {
  const host = jdbcHost(source.host)
  const port = firstPort(source.port)
  return host && port ? `${host}:${port}` : undefined
}

const withDatabase = (baseUrl: string, database?: string): string => {
  const value = database?.trim()
  return value ? `${baseUrl}/${encodeURIComponent(value)}` : baseUrl
}

export const supportsJdbcUrl = (databaseType: DatabaseType): boolean =>
  databaseType !== 'mongodb' && databaseType !== 'redis'

export const buildConnectionDetailsText = (source: ConnectionClipboardSource): string =>
  [
    `主机：${source.host ?? ''}`,
    `端口：${source.port ?? ''}`,
    `用户名：${source.username ?? ''}`,
    `密码：${source.password ?? ''}`,
    `数据库：${source.database ?? ''}`
  ].join('\n')

export const buildJdbcUrl = (source: ConnectionClipboardSource): string | undefined => {
  if (source.database_type === 'sqlite') {
    const sqlitePath = source.sqlite_path?.trim() || source.database?.trim()
    return sqlitePath ? `jdbc:sqlite:${sqlitePath}` : undefined
  }
  if (!supportsJdbcUrl(source.database_type)) {
    return undefined
  }

  const address = serverAddress(source)
  if (!address) {
    return undefined
  }

  switch (source.database_type) {
    case 'mysql':
      return withDatabase(`jdbc:mysql://${address}`, source.database)
    case 'postgresql':
      return withDatabase(`jdbc:postgresql://${address}`, source.database)
    case 'oracle':
      return withDatabase(`jdbc:oracle:thin:@//${address}`, source.database)
    case 'dm':
      return `jdbc:dm://${address}`
    case 'gaussdb':
      return withDatabase(`jdbc:opengauss://${address}`, source.database)
    case 'clickhouse':
      return withDatabase(`jdbc:clickhouse://${address}`, source.database)
    default:
      return undefined
  }
}
