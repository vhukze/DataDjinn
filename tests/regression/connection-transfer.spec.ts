import { expect, test } from '@playwright/test'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  buildDataDjinnImportCandidates,
  decryptConnectionTransferBundle,
  encryptConnectionTransferBundle,
  type DataDjinnConnectionTransferBundle
} from '../../src/renderer/src/app/connection-transfer'

test('DataDjinn 连接传输文件应加密保存密码并支持完整回读 @bug', async () => {
  const bundle: DataDjinnConnectionTransferBundle = {
    version: 1,
    exported_at: '2026-07-03T12:34:56.000Z',
    source_app_name: 'DataDjinn',
    source_app_version: '0.2.7',
    connections: [
      {
        export_id: 'mysql-main',
        payload: {
          name: '生产 MySQL',
          database_type: 'mysql',
          host: '10.0.0.8',
          port: 3306,
          username: 'root',
          password: 'db-secret',
          database: 'analytics',
          ssh_enabled: true,
          ssh_host: '10.0.0.2',
          ssh_port: 22,
          ssh_username: 'jump-user',
          ssh_auth_type: 'password',
          ssh_password: 'ssh-secret'
        }
      },
      {
        export_id: 'pg-report',
        payload: {
          name: '报表 PG',
          database_type: 'postgresql',
          host: '10.0.1.16',
          port: 5432,
          username: 'report',
          password: 'pg-secret',
          database: 'reporting',
          ssh_enabled: true,
          ssh_host: '10.0.1.3',
          ssh_port: 22,
          ssh_username: 'jump-key',
          ssh_auth_type: 'private_key',
          ssh_private_key_path: 'C:\\Users\\vhukze\\.ssh\\id_ed25519',
          ssh_passphrase: 'key-secret'
        }
      }
    ],
    folders: [
      { id: 'folder-prod', name: '生产' },
      { id: 'folder-report', name: '报表' }
    ],
    connection_folder_assignments: {
      'mysql-main': 'folder-prod',
      'pg-report': 'folder-report'
    },
    connection_folder_order: ['folder-report', 'folder-prod'],
    root_connection_order: [],
    root_item_order: ['folder:folder-report', 'folder:folder-prod'],
    folder_connection_order: {
      'folder-prod': ['mysql-main'],
      'folder-report': ['pg-report']
    }
  }

  const encrypted = await encryptConnectionTransferBundle(bundle, 'transfer-passphrase')
  expect(encrypted).not.toContain('生产 MySQL')
  expect(encrypted).not.toContain('db-secret')
  expect(encrypted).not.toContain('ssh-secret')
  expect(encrypted).not.toContain('key-secret')

  const decrypted = await decryptConnectionTransferBundle(encrypted, 'transfer-passphrase')
  expect(decrypted).toEqual(bundle)

  const candidates = buildDataDjinnImportCandidates(decrypted)
  expect(candidates).toHaveLength(2)
  expect(candidates[0]?.name).toBe('生产 MySQL')
  expect(candidates[0]?.payload?.password).toBe('db-secret')
  expect(candidates[1]?.payload?.ssh_passphrase).toBe('key-secret')
  expect(candidates[1]?.status).toBe('warning')
  expect(candidates[1]?.message).toContain('SSH 私钥路径')
})

test('DataDjinn 杩炴帴浼犺緭鏂囦欢搴旀敮鎸佺湡瀹炴枃浠跺洖璇诲拰 Unicode 鍙ｄ护褰掍竴鍖? @bug', async () => {
  const bundle: DataDjinnConnectionTransferBundle = {
    version: 1,
    exported_at: '2026-07-03T15:16:17.000Z',
    source_app_name: 'DataDjinn',
    source_app_version: '0.2.7',
    connections: [
      {
        export_id: 'sqlite-main',
        payload: {
          name: '鏈湴 SQLite',
          database_type: 'sqlite',
          sqlite_path: 'C:\\data\\demo.sqlite'
        }
      }
    ],
    folders: [],
    connection_folder_assignments: {},
    connection_folder_order: [],
    root_connection_order: ['sqlite-main'],
    root_item_order: ['connection:sqlite-main'],
    folder_connection_order: {}
  }
  const tempDir = await mkdtemp(join(tmpdir(), 'datadjinn-transfer-'))
  const filePath = join(tempDir, 'connections.ddj')

  try {
    const encrypted = await encryptConnectionTransferBundle(bundle, 'Cafe\u0301 杩炴帴 瀵嗙爜')
    await writeFile(filePath, `\uFEFF${encrypted}\n`, 'utf-8')
    const rawText = await readFile(filePath, 'utf-8')
    const decrypted = await decryptConnectionTransferBundle(rawText, 'Caf\u00e9 杩炴帴 瀵嗙爜')
    expect(decrypted).toEqual(bundle)
  } finally {
    await rm(tempDir, { recursive: true, force: true })
  }
})
