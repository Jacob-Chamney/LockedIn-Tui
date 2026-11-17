/**
 * Fake `@napi-rs/keyring` entry module for the `LOCKEDIN_KEYRING_ADDON` tests.
 *
 * It mirrors the real package's surface — `AsyncEntry` with
 * `getPassword` / `setPassword` / `deleteCredential` — and nothing else. It has
 * no keychain, no network and no disk: the store is a module-local `Map`, so a
 * test can only pass by actually loading this file as the addon.
 *
 * `__fake` is test-only bookkeeping: which keys were written, how many entries
 * were constructed and the options the adapter pinned. It is never read by
 * application code.
 */

const entries = new Map()

export const __fake = {
  entries,
  constructed: 0,
  options: [],
  reset() {
    entries.clear()
    this.constructed = 0
    this.options.length = 0
  },
}

export class AsyncEntry {
  constructor(service, username, options) {
    if (typeof service !== "string" || typeof username !== "string") {
      throw new TypeError("AsyncEntry needs a service and a username")
    }
    this.service = service
    this.username = username
    this.options = options
    __fake.constructed += 1
    __fake.options.push(options)
  }

  key() {
    return `${this.service}\u0000${this.username}`
  }

  async getPassword() {
    const value = entries.get(this.key())
    return value === undefined ? null : value
  }

  async setPassword(password) {
    if (typeof password !== "string") throw new TypeError("setPassword needs a string")
    entries.set(this.key(), password)
  }

  async deleteCredential() {
    return entries.delete(this.key())
  }
}

export default { AsyncEntry }
