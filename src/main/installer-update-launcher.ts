import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { copyFile } from 'node:fs/promises'
import { CancellationToken } from 'builder-util-runtime'
import { NsisUpdater } from 'electron-updater'
import { findFile } from 'electron-updater/out/providers/Provider'

// Keep GitHub downloads on the working transport, but let electron-updater own
// its cache, NSIS arguments, elevation and quit/relaunch lifecycle.
export class InstallerUpdater extends NsisUpdater {
  async prepareDownloadedInstaller(installerPath: string): Promise<void> {
    const updateInfoAndProvider = this.updateInfoAndProvider
    if (!updateInfoAndProvider) {
      throw new Error('请先检查更新，再下载并安装')
    }
    const fileInfo = findFile(
      updateInfoAndProvider.provider.resolveFiles(updateInfoAndProvider.info),
      'exe'
    )
    if (!fileInfo || fileInfo.packageInfo || !fileInfo.info.sha512) {
      throw new Error('更新元数据无效：需要完整安装包及 SHA-512 校验值')
    }

    await this.executeDownload({
      fileExtension: 'exe',
      fileInfo,
      downloadUpdateOptions: {
        updateInfoAndProvider,
        requestHeaders: {},
        cancellationToken: new CancellationToken()
      },
      task: async (destinationFile) => {
        await copyFile(installerPath, destinationFile)
        const hash = createHash('sha512')
        for await (const chunk of createReadStream(destinationFile)) hash.update(chunk)
        if (hash.digest('base64') !== fileInfo.info.sha512) {
          throw new Error('安装包校验失败，请重新下载更新')
        }
      }
    })
  }
}
