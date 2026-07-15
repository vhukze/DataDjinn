import { expect, test } from '@playwright/test'
import {
  buildConnectionDetailsText,
  buildJdbcUrl
} from '../../src/renderer/src/app/connection-clipboard'

test('connection details should include database after the requested credentials @smoke', () => {
  expect(
    buildConnectionDetailsText({
      name: '生产库',
      database_type: 'postgresql',
      host: '10.41.27.166',
      port: 5432,
      username: 'admin',
      password: '123',
      database: 'aidb'
    })
  ).toBe('主机：10.41.27.166\n端口：5432\n用户名：admin\n密码：123\n数据库：aidb')
})

test('jdbc urls should follow each supported database format @smoke', () => {
  expect(
    buildJdbcUrl({
      name: 'MySQL',
      database_type: 'mysql',
      host: 'db.example.com',
      port: 3306,
      database: 'orders'
    })
  ).toBe('jdbc:mysql://db.example.com:3306/orders')
  expect(
    buildJdbcUrl({
      name: 'PostgreSQL',
      database_type: 'postgresql',
      host: 'db.example.com',
      port: 5432,
      database: 'orders'
    })
  ).toBe('jdbc:postgresql://db.example.com:5432/orders')
  expect(
    buildJdbcUrl({
      name: 'Oracle',
      database_type: 'oracle',
      host: 'db.example.com',
      port: 1521,
      database: 'orclpdb1'
    })
  ).toBe('jdbc:oracle:thin:@//db.example.com:1521/orclpdb1')
  expect(
    buildJdbcUrl({
      name: '达梦',
      database_type: 'dm',
      host: 'db.example.com',
      port: 5236,
      database: 'SYSDBA'
    })
  ).toBe('jdbc:dm://db.example.com:5236')
  expect(
    buildJdbcUrl({
      name: '高斯',
      database_type: 'gaussdb',
      host: 'db.example.com',
      port: 8000,
      database: 'postgres'
    })
  ).toBe('jdbc:opengauss://db.example.com:8000/postgres')
  expect(
    buildJdbcUrl({
      name: 'ClickHouse',
      database_type: 'clickhouse',
      host: 'db.example.com',
      port: '8123,8124',
      database: 'default'
    })
  ).toBe('jdbc:clickhouse://db.example.com:8123/default')
  expect(
    buildJdbcUrl({
      name: 'SQLite',
      database_type: 'sqlite',
      sqlite_path: 'C:\\data\\demo.db'
    })
  ).toBe('jdbc:sqlite:C:\\data\\demo.db')
})

test('mongodb and redis should not expose a fake jdbc url @smoke', () => {
  expect(buildJdbcUrl({ name: 'MongoDB', database_type: 'mongodb' })).toBeUndefined()
  expect(buildJdbcUrl({ name: 'Redis', database_type: 'redis' })).toBeUndefined()
})
