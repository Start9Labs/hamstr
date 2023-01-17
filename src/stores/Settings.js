import {defineStore} from 'pinia'
import {Account} from 'src/nostr/Account'

export const RELAYS = [
  'wss://nostr-pub.wellorder.net',
  // 'wss://nostr-relay.wlvs.space',
  // 'wss://nostr.bitcoiner.social',
  // 'wss://nostr.zebedee.cloud',
  // 'wss://relay.nostr.info',
  // 'wss://nostr-pub.semisol.dev',
  'wss://relay.snort.social',
]

export const useSettingsStore = defineStore('settings', {
  state: () => ({
    accounts: {},
    pubkey: null,
    relays: RELAYS,
    // TODO move somewhere else?
    notificationsLastRead: 0,
    messagesLastRead: 0,
  }),
  getters: {
    activeAccount(state) {
      const account = state.accounts[state.pubkey]
      if (!account) return
      return new Account(account)
    },
    hasAccount(state) {
      return pubkey => !!state.accounts[pubkey]
    },
  },
  actions: {
    addAccount(opts) {
      const account = new Account(opts)
      this.accounts[account.pubkey] = account
      if (!this.pubkey) {
        this.pubkey = account.pubkey
      }
      return account
    },
    removeAccount(pubkey) {
      delete this.accounts[pubkey]
      if (this.pubkey === pubkey) {
        const accounts = Object.keys(this.accounts)
        if (accounts.length) {
          this.pubkey = accounts[0]
        } else {
          this.pubkey = null
        }
      }
    },
    switchAccount(pubkey) {
      if (!this.accounts[pubkey]) throw new Error(`unknown account ${pubkey}`)
      this.pubkey = pubkey
    },
    addRelay(url) {
      if (this.hasRelay(url)) return
      this.relays.push(url)
    },
    removeRelay(url) {
      const idx = this.relays.indexOf(url)
      if (idx < 0) return
      this.relays.splice(idx, 1)
    },
    hasRelay(url) {
      return this.relays.indexOf(url) >= 0
    },
  },
  persist: true,
})
