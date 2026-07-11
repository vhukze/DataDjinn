import { DatabaseOutlined } from '@ant-design/icons'
import type { ReactNode } from 'react'
import dmIcon from '../assets/icons/dm.svg'
import type { DatabaseType } from './data-sources'

export const JDBC_COMPATIBLE_DATABASE_TYPES: DatabaseType[] = ['dm', 'gaussdb']

export type DriverDatabaseType = 'dm' | 'gaussdb'

export type DriverType = 'jdbc' | 'python' | 'whl'

export type DriverInfo = {
  id: string
  database_type: DriverDatabaseType
  driver_type: DriverType
  name: string
  source: 'auto' | 'manual'
  enabled: boolean
  path?: string | null
}

export const isDriverDatabaseType = (value: unknown): value is DriverDatabaseType =>
  value === 'dm' || value === 'gaussdb'
export const isDriverType = (value: unknown): value is DriverType =>
  value === 'jdbc' || value === 'python' || value === 'whl'
export const isDriverSource = (value: unknown): value is DriverInfo['source'] =>
  value === 'auto' || value === 'manual'

export const normalizeDriverInfo = (value: unknown): DriverInfo | null => {
  if (!value || typeof value !== 'object') {
    return null
  }

  const candidate = value as Partial<DriverInfo> & Record<string, unknown>
  if (typeof candidate.id !== 'string' || !candidate.id.trim()) {
    return null
  }

  return {
    id: candidate.id,
    database_type: isDriverDatabaseType(candidate.database_type) ? candidate.database_type : 'dm',
    driver_type: isDriverType(candidate.driver_type) ? candidate.driver_type : 'jdbc',
    name:
      typeof candidate.name === 'string' && candidate.name.trim() ? candidate.name : '未命名驱动',
    source: isDriverSource(candidate.source) ? candidate.source : 'manual',
    enabled: candidate.enabled !== false,
    path: typeof candidate.path === 'string' && candidate.path.trim() ? candidate.path : null
  }
}

export type DriverDatabaseMeta = {
  label: string
  shortLabel: string
  supportedDriverTypes: DriverType[]
  icon: ReactNode
}

export const DRIVER_DATABASE_ORDER: DriverDatabaseType[] = ['dm', 'gaussdb']

export const DRIVER_DATABASE_META: Record<DriverDatabaseType, DriverDatabaseMeta> = {
  dm: {
    label: '达梦 DM',
    shortLabel: '达梦',
    supportedDriverTypes: ['jdbc', 'python', 'whl'],
    icon: <img src={dmIcon} alt="" style={{ width: 16, height: 16 }} />
  },
  gaussdb: {
    label: '高斯数据库',
    shortLabel: '高斯',
    supportedDriverTypes: ['jdbc'],
    icon: <DatabaseOutlined />
  }
}

export type DriverFormValues = {
  database_type: DriverDatabaseType
  driver_type: DriverType
  name: string
  path?: string
  enabled: boolean
}

export type JavaRuntimeInfo = {
  home: string
  major?: number | null
  jvm_path: string
}

export type JavaDetectResponse = {
  runtimes: JavaRuntimeInfo[]
  preferred?: string | null
  configured?: string | null
  enabled: boolean
}

export type JavaRuntimeConfigResponse = {
  java_home?: string | null
  major?: number | null
  jvm_path?: string | null
  enabled: boolean
}
