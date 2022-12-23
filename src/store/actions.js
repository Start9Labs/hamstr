import {encrypt} from 'nostr-tools/nip04'
import {queryName} from 'nostr-tools/nip05'
import {Notify, LocalStorage, debounce} from 'quasar'
import {pool, signAsynchronously} from '../pool'
import {
  dbSave,
  dbUserProfile,
  dbUserFollows,
  streamFeed,
  streamUserProfile,
  streamUserFollows,
  streamUser,
  dbQuery,
  setRelays,
  publish,
  prune
} from '../query'
import {getPubKeyTagWithRelay} from '../utils/helpers'
import {metadataFromEvent} from '../utils/event'

export function initKeys(store, keys) {
  // passing no arguments will cause a new seed to be generated
  store.commit('setKeys', keys)

  // also initialize the lastNotificationRead value
  store.commit('haveReadNotifications')
}

export async function launch(store) {
  console.log('launch for ', store.state.keys.pub)
  // if (!store.state.keys.pub) {
  //   store.commit('setKeys') // passing no arguments will cause a new seed to be generated

  //   // also initialize the lastNotificationRead value
  //   store.commit('haveReadNotifications')
  // }

  // if we have already have a private key
  if (store.state.keys.priv) {
    pool.setPrivateKey(store.state.keys.priv)
  } else {
    pool.registerSigningFunction(signAsynchronously)
  }

  let {relays, follows} = store.state
  if (!relays || !Object.keys(relays).length || !follows || !follows.length || follows === 'undefined') {
    let contactList = await dbUserFollows(store.state.keys.pub)
      if (!relays || !Object.keys(relays).length) {
      try {
        relays = JSON.parse(contactList.content)
        store.commit('setRelays', relays)
      } catch (err) {
        /***/
      }
    }
    if ((!follows || !follows.length || follows === 'undefined')) {
      try {
        follows = contactList.tags
          .filter(([t, v]) => t === 'p' && v)
          .map(([_, v]) => v)
        store.commit('setFollows', follows)
      } catch (err) {
        /***/
      }
    }
  }

  // // translate localStorage into a kind3 event -- or load relays and following from event
  // let contactList = await dbUserFollows(store.state.keys.pub)
  // var {relays, following} = store.state
  // if (contactList) {
  //   try {
  //     relays = JSON.parse(contactList.content)
  //   } catch (err) {
  //     /***/
  //   }
  //   following = contactList.tags
  //     .filter(([t, v]) => t === 'p' && v)
  //     .map(([_, v]) => v)
  // } else {
  //   // get stuff from localstorage and save to store -- which will trigger the eventize
  //   // plugin to create and publish a contactlist event
  //   relays = LocalStorage.getItem('relays') || relays
  //   following = LocalStorage.getItem('following') || following
  // }

  // // update store state
  // store.commit('setFollowing', following)
  // store.commit('setRelays', relays)

  // preload our own profile from the db
  store.dispatch('useProfile', {pubkey: store.state.keys.pub})

  // preload our follows profiles from the db
  for (let pubkey of follows) store.dispatch('useProfile', {pubkey})
  // start listening for nostr events
  // setTimeout(store.dispatch('restartMainSubscription'), 500)
  store.dispatch('restartMainSubscription')
}

export async function launchWithoutKey(store) {
  store.dispatch('restartMainSubscription')
}

let mainSub = {}
export async function restartMainSubscription(store) {
  // console.log('restart main subscription for', [store.state.keys.pub].concat(store.state.following), store.state.relays)

  // get lastUserMainSync
  let lastUserMainSync = LocalStorage.getItem('config')?.timestamps?.lastUserMainSync || 0

  // setup pool
  let relays = Object.keys(store.state.relays).length ? store.state.relays : store.state.defaultRelays
  await setRelays(relays, lastUserMainSync - (1 * 24 * 60 * 60))

  // sub to bot tracker follows (to filter out bots in feed)
  let botTracker = '29f63b70d8961835b14062b195fc7d84fa810560b36dde0749e4bc084f0f8952'
  let botTrackerSub = await streamUserFollows(botTracker)
  setTimeout(() => {
    botTrackerSub.cancel()
  }, 60 * 1000)

  // sub feed
  if (!mainSub.streamFeed) mainSub.streamFeed = await streamFeed(Math.round(Date.now() / 1000) - (1 * 24 * 60 * 60))

  // thats all if no pubkey entered
  if (!store.state.keys.pub) return

  //after 3 min prune old events and update lastUserMainSync
  setTimeout(() => {
    prune(store.state.keys.pub, [botTracker, store.state.keys.pub].concat(store.state.follows))

    let config = LocalStorage.getItem('config') || {}
    config.timestamps = {lastUserMainSync: Object.keys(store.state.relays).length ? Math.round(Date.now() / 1000) : 0 }
    LocalStorage.set('config', config)
  }, 5 * 60 * 1000)

  if (store.state.follows.length)
    store.state.follows.forEach(pubkey => store.dispatch('useProfile', {pubkey}))
  if (!mainSub.streamUser) mainSub.streamUser = await streamUser(
    store.state.keys.pub,
    async event => {
      if (event.kind === 3) {
        let result = await dbQuery(`
          SELECT json_extract(event,'$.created_at') created_at
          FROM nostr
          WHERE json_extract(event,'$.kind') = 3 AND
            json_extract(event,'$.pubkey') = '${store.state.keys.pub}'
          LIMIT 1
        `)
        if (result.length && event.created_at < result[0].created_at) return
        let relays = JSON.parse(event.content)
        store.commit('setRelays', relays)

        let follows = event.tags
          .filter(([t, v]) => t === 'p' && v)
          .map(([_, v]) => v)
        store.commit('setFollows', follows)
        store.dispatch('restartMainSubscription')
      } else if (event.kind === 0) {
        let result = await dbQuery(`
          SELECT json_extract(event,'$.created_at') created_at
          FROM nostr
          WHERE json_extract(event,'$.kind') = 0 AND
            json_extract(event,'$.pubkey') = '${store.state.keys.pub}'
          LIMIT 1
        `)
        if (result.length && event.created_at < result[0].created_at) return

        let metadata = metadataFromEvent(event)
        store.commit('addProfileToCache', metadata)
      }
    }
  )
}

export async function addEvent(store, {event, relay = null}) {
  await dbSave(event, relay)
}

export async function sendPost(store, {message, tags = [], kind = 1}) {
  if (message.length === 0) return
  tags.push(['client', 'hamstr'])

  try {
    const unpublishedEvent = {
      pubkey: store.state.keys.pub,
      created_at: Math.floor(Date.now() / 1000),
      kind,
      tags,
      content: message
    }

    let event = await pool.publish(unpublishedEvent)
    if (!event) throw new Error('could not create post for publishing')

    let publishResult = await publish(event)
    if (!publishResult) throw new Error('could not publish post')
    // console.log('sendPost', event, publishResult)

    store.dispatch('addEvent', {event})
    return event
  } catch (error) {
    Notify.create({
      message: `could not publish post: ${error}`,
      color: 'negative'
    })
    return
  }
}

export async function sendChatMessage(store, {now, pubkey, text, tags}) {
  if (text.length === 0) return
  tags.push(['client', 'hamstr'])

  let ciphertext = '???'
  try {
    if (store.state.keys.priv) {
      ciphertext = encrypt(store.state.keys.priv, pubkey, text)
    } else if (
      (await window?.nostr?.getPublicKey?.()) === store.state.keys.pub
    ) {
      ciphertext = await window.nostr.nip04.encrypt(pubkey, text)
    } else {
      throw new Error('no private key available to encrypt!')
    }

    let unpublishedEvent = {
      pubkey: store.state.keys.pub,
      created_at: now,
      kind: 4,
      tags,
      content: ciphertext
    }

    let event = await pool.publish(unpublishedEvent)
    if (!event) throw new Error('could not create message for publishing')

    let publishResult = await publish(event)
    if (!publishResult) throw new Error('could not publish message')

    store.dispatch('addEvent', {event})
    return event
  } catch (error) {
    Notify.create({
      message: `could not publish message: ${error}`,
      color: 'negative'
    })
    return
  }
}

export async function publishContactList(store) {
  // extend the existing tags
  let oldEvent = await dbUserFollows(store.state.keys.pub)
  var tags = oldEvent?.tags || []

  // check existing event because it might contain more data in the
  // tags that we don't want to replace, if so push existing event tag,
  // else push state.follows tag
  let newTags = []
  await Promise.all(
    store.state.follows.map(async pubkey => {
      let index = tags.findIndex(([t, v]) => t === 'p' && v === pubkey)
      if (index >= 0) {
        newTags.push(tags[index])
      } else {
        newTags.push(await getPubKeyTagWithRelay(pubkey))
      }
    })
  )

  try {
    let event = await pool.publish({
      pubkey: store.state.keys.pub,
      created_at: Math.floor(Date.now() / 1000),
      kind: 3,
      tags: newTags,
      content: JSON.stringify(store.state.relays)
    })

    if (!event) throw new Error('could not create updated list of followed keys and relays')

    let publishResult = await publish(event)
    if (!publishResult) throw new Error('could not publish updated list of followed keys and relays')

    let relays, follows
    relays = JSON.parse(event.content)
    follows = event.tags
      .filter(([t, v]) => t === 'p' && v)
      .map(([_, v]) => v)

    // update store state
    store.commit('setFollows', follows)
    store.commit('setRelays', relays)

    await store.dispatch('addEvent', {event})

    Notify.create({
      message: 'updated and published list of followed keys and relays.',
      color: 'positive'
    })
    return event
  } catch (error) {
    Notify.create({
      message: `could not publish updated list of followed keys and relays: ${error}`,
      color: 'negative'
    })
    return
  }
}

export async function setMetadata(store, metadata) {
  try {
    let event = await pool.publish({
      pubkey: store.state.keys.pub,
      created_at: Math.floor(Date.now() / 1000),
      kind: 0,
      tags: [],
      content: JSON.stringify(metadata)
    })
    if (!event) throw new Error('could not create updated profile event')

    let publishResult = await publish(event)
    if (!publishResult) throw new Error('could not publish update profile event')

    store.dispatch('addEvent', {event})
    store.commit('addProfileToCache', { pubkey: store.state.keys.pub, ...metadata })

    Notify.create({
      message: 'updated and published profile',
      color: 'positive'
    })
    return event
  } catch (error) {
    Notify.create({
      message: `could not publish updated profile: ${error}`,
      color: 'negative'
    })
    return
  }
}

export async function recommendRelay(store, url) {
  try {
    let event = await pool.publish({
      pubkey: store.state.keys.pub,
      created_at: Math.round(Date.now() / 1000),
      kind: 2,
      tags: [],
      content: url
    })
    if (!event) throw new Error('could not create recommend relay event')

    let publishResult = await publish(event)
    if (!publishResult) throw new Error('could not publish recommend relay event')

    store.dispatch('addEvent', {event})
    return event
  } catch (error) {
    Notify.create({
      message: `could not publish recommend relay event: ${error}`,
      color: 'negative'
    })
    return
  }
}

const debouncedStreamUserProfile = debounce(async (store, users) => {
  if (!mainSub.streamUserProfile) {
    mainSub.streamUserProfile = await streamUserProfile(
      users.slice(0, 500),
      async event => {
        if (event.pubkey in store.state.profilesCache) return
        let metadata = metadataFromEvent(event)
        store.commit('addProfileToCache', metadata)
        store.dispatch('useNip05', {metadata})
        store.dispatch('cancelUseProfile', {pubkey: event.pubkey})
      }
    )
  } else {
    mainSub.streamUserProfile.update(users.slice(0, 500))
  }
}, 3000)

let profilesInUse = {}
export async function useProfile(store, {pubkey}) {
  if (pubkey in store.state.profilesCache) {
    // we don't fetch again, but we do commit this so the LRU gets updated
    store.commit('addProfileToCache', {
      pubkey,
      ...store.state.profilesCache[pubkey]
    }) // (just the pubkey is enough)
  } else {
    // fetch from db and add to cache
    let event = await dbUserProfile(pubkey)
    if (event) {
      let metadata = metadataFromEvent(event)
      store.dispatch('useNip05', {metadata})
    } else {
      profilesInUse[pubkey] = profilesInUse[pubkey] || { count: 0, since: Date.now() }
      profilesInUse[pubkey].count++
      for (let pubkey of Object.keys(profilesInUse)) {
        if (profilesInUse[pubkey].since && profilesInUse[pubkey].since < Date.now() - (0.5 * 60 * 1000)) delete profilesInUse[pubkey]
      }
      if (profilesInUse[pubkey].count === 1) debouncedStreamUserProfile(store, Object.keys(profilesInUse))
    }
  }
}

export async function cancelUseProfile(store, {pubkey}) {
  if (!profilesInUse[pubkey]) return
  profilesInUse[pubkey].count--
  if (profilesInUse[pubkey].count <= 0) {
    delete profilesInUse[pubkey]
    debouncedStreamUserProfile(store, Object.keys(profilesInUse))
  }
}

export async function useNip05(store, {metadata}) {
  if (metadata.nip05 === '') delete metadata.nip05

  if (metadata.nip05) {
    let cached = store.state.nip05VerificationCache[metadata.nip05]
    if (cached && cached.when > Date.now() / 1000 - 60 * 60) {
      if (cached.pubkey !== metadata.pubkey) delete metadata.nip05
    } else {
      let checked = await queryName(metadata.nip05)
      store.commit('addToNIP05VerificationCache', {
        pubkey: checked,
        identifier: metadata.nip05
      })
      if (metadata.pubkey !== checked) delete metadata.nip05
    }
  }
  store.commit('addProfileToCache', metadata)
}
