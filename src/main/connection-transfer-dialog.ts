export type ConnectionTransferImportSource = 'datadjinn' | 'dbeaver'

export interface ConnectionTransferImportDialogOptions {
  title: string
  filters: Array<{
    name: string
    extensions: string[]
  }>
}

export function buildConnectionTransferImportDialogOptions(
  source?: ConnectionTransferImportSource
): ConnectionTransferImportDialogOptions {
  const normalizedSource: ConnectionTransferImportSource = source === 'dbeaver' ? 'dbeaver' : 'datadjinn'

  if (normalizedSource === 'dbeaver') {
    return {
      title: '选择 DBeaver 连接文件',
      filters: [
        { name: 'DBeaver JSON 文件', extensions: ['json'] },
        { name: '所有文件', extensions: ['*'] }
      ]
    }
  }

  return {
    title: '选择导入文件',
    filters: [
      { name: 'DataDjinn 连接文件', extensions: ['ddj'] },
      { name: 'JSON 文件', extensions: ['json'] },
      { name: '所有文件', extensions: ['*'] }
    ]
  }
}
