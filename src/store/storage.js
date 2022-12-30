import {LocalStorage} from 'quasar'

export default function (store) {
  store.subscribe(({type, payload}, state) => {
    switch (type) {
      case 'setKeys':
        LocalStorage.set('keys', state.keys)
        break
      case 'addOrUpdateAccount':
      case 'removeAccount':
        LocalStorage.set('accounts', state.accounts)
        break
      case 'setFollows':
        LocalStorage.set('follows', state.follows)
        break
      case 'setRelays':
        LocalStorage.set('relays', state.relays)
        break
      case 'haveReadNotifications':
        LocalStorage.set('lastNotificationRead', state.lastNotificationRead)
        break
      case 'haveReadMessage':
        LocalStorage.set('lastMessageRead', state.lastMessageRead)
        break
    }
  })
}
