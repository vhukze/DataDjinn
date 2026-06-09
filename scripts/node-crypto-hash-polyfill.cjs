const crypto = require('node:crypto')

if (typeof crypto.hash !== 'function') {
  crypto.hash = function hash(algorithm, data, outputEncoding) {
    const digest = crypto.createHash(algorithm).update(data).digest()
    return outputEncoding ? digest.toString(outputEncoding) : digest
  }
}
