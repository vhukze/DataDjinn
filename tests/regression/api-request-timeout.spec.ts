import { expect, test } from '@playwright/test'
import { withAbortTimeout } from '../../src/main/api-request'

test('API超时覆盖响应头返回后的响应体读取 @bug', async () => {
  let responseHeadersReceived = false
  const responseText = withAbortTimeout(20, async (signal) => {
    responseHeadersReceived = true
    return await new Promise<string>((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(new Error('body aborted')), { once: true })
    })
  })

  await expect(responseText).rejects.toThrow('请求超时（1 秒）')
  expect(responseHeadersReceived).toBe(true)
})
