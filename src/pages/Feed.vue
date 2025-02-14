<template>
  <q-page>
    <div class="page-header-container">
      <PageHeader>
        <div class="addon-menu">
          <div class="addon-menu-icon">
            <q-icon name="more_vert" size="sm" />
          </div>
          <q-menu target=".addon-menu-icon" anchor="top left" self="top right" class="addon-menu-popup">
            <div>
              <div v-for="tabName in availableTabs" :key="tabName" class="popup-header" @click="tab = tabName" v-close-popup>
                <p>{{ tabName }}</p>
                <div class="more" v-if="tab === tabName">
                  <BaseIcon icon="tick" />
                </div>
              </div>
            </div>
          </q-menu>
        </div>
      </PageHeader>
    </div>

    <div class="post-editor" v-if="$store.getters.isSignedIn">
      <PostEditor />
    </div>

    <div class="feed-tabs">
      <q-tabs
        v-model="tab"
        dense
        outline
        align="left"
        active-color="accent"
        :breakpoint="0"
      >
        <q-tab name="global" label="global" />
        <q-tab name="follows" label="follows" />
        <q-tab name="AI" label="AI" />
        <q-tab name="bots" label="bots" />
      </q-tabs>
    </div>

    <div v-if="tab === 'AI'" class="flex row no-wrap items-center" style="border: 1px solid var(--q-accent); border-radius: .5rem; padding: .5rem; margin: .5rem; gap: .5rem;">
      <q-icon name="info" color="accent" size="sm"/>
      <div>to chat with the AI bot create a new post and mention it by typing '@gpt3' and selecting the AI bot from the user list</div>
    </div>

    <div class="feed">
      <div class="load-more-container" :class="{'more-available': unreadFeed[tab].length}">
        <BaseButtonLoadMore
          v-if="unreadFeed[tab].length"
          :loading="loadingUnread"
          :label="'load ' + unreadFeed[tab].length + ' unread'"
          @click="loadUnread"
        />
      </div>
      <Thread v-for="item in items" :key="item[0].id" :events="item" class="full-width" @add-event="processEvent" />
      <BaseButtonLoadMore
        :loading="loadingMore"
        :label="items.length === feed[tab].length ? 'load another day' : 'load 100 more'"
        @click="loadMore"
      />
    </div>
  </q-page>
</template>

<script>
import { defineComponent } from 'vue'
import helpersMixin from '../utils/mixin'
import {addToThread} from '../utils/threads'
import {isValidEvent} from '../utils/event'
import {dbFeed, dbUserFollows} from '../query'
import BaseButtonLoadMore from 'components/BaseButtonLoadMore.vue'
import { createMetaMixin } from 'quasar'
import PageHeader from 'components/PageHeader.vue'
import PostEditor from 'components/CreatePost/PostEditor.vue'
import Thread from 'components/Post/Thread.vue'
import BaseIcon from 'components/BaseIcon/index.vue'

const metaData = {
  // sets document title
  title: 'hamstr',

  // meta tags
  meta: {
    description: { name: 'description', content: 'decentralized social media feed built on Nostr' },
    keywords: { name: 'keywords', content: 'nostr decentralized social media' },
    equiv: { 'http-equiv': 'Content-Type', content: 'text/html; charset=UTF-8' },
  },
}

export default defineComponent({
  name: 'Feed',
  mixins: [helpersMixin, createMetaMixin(metaData)],

  components: {
    BaseIcon,
    Thread,
    PageHeader,
    //Post,
    PostEditor,
    BaseButtonLoadMore,
  },

  watch: {
    lookingAround(curr, prev) {
      if (curr) {
        this.loadMore()
      }
    }
  },

  props: {
    lookingAround: {
      type: Boolean,
      default: false,
    }
  },

  data() {
    return {
      reachedEnd: false,
      feed: {
        follows: [],
        global: [],
        AI: [],
        bots: []
      },
      feedCounts: {
        follows: 100,
        global: 100,
        AI: 100,
        bots: 100
      },
      unreadCounts: {
        follows: 100,
        global: 100,
        AI: 100,
        bots: 100
      },
      unreadFeed: {
        follows: [],
        global: [],
        AI: [],
        bots: []
      },
      feedSet: new Set(),
      bots: [],
      follows: [],
      botTracker: '29f63b70d8961835b14062b195fc7d84fa810560b36dde0749e4bc084f0f8952',
      loadingMore: true,
      loadingUnread: false,
      tab: 'global',
      since: Math.round(Date.now() / 1000),
      profilesUsed: new Set(),
      // index: 0,
      lastLoaded: Math.round(Date.now() / 1000),
      refreshInterval: null,
      unsubscribe: null,
      availableTabs: ['global', 'follows'],
    }
  },

  computed: {
    items() {
      if (this.tab === 'follows') return this.feed.follows.slice(0, this.feedCounts['follows'])
      if (this.tab === 'global') return this.feed.global.slice(0, this.feedCounts['global'])
      if (this.tab === 'AI') return this.feed.AI.slice(0, this.feedCounts['AI'])
      if (this.tab === 'bots') return this.feed.bots.slice(0, this.feedCounts['bots'])
      return []
    }
  },

  async mounted() {
    this.bots = await this.getFollows(this.botTracker)
    this.follows = await this.getFollows(this.$store.state.keys.pub)

    await this.loadMore()

    this.unsubscribe = this.$store.subscribe((mutation, state) => {
      switch (mutation.type) {
        case 'setKeys': {
          this.loadingMore = true
          setTimeout(this.loadMore, 6)
          break
        }
      }
    })

    if (this.follows.length === 0) {
      this.tab = 'global'
    }
  },

  async beforeUnmount() {
    if (this.listener) this.listener.cancel()
    this.profilesUsed.forEach(pubkey => this.$store.dispatch('cancelUseProfile', {pubkey}))
    if (this.unsubscribe) this.unsubscribe()
  },

  methods: {
    async loadMore() {
      this.loadingMore = true

      if (this.items.length < this.feed[this.tab].length) {
        this.feedCounts[this.tab] += 100
        this.loadingMore = false
        return
      }

      let loadedFeed = {}
      for (let feed of Object.keys(this.feed)) {
        loadedFeed[feed] = []
      }

      this.since = this.since - (6 * 60 * 60)
      let results = await dbFeed(this.since)
      if (results) for (let event of results) this.processEvent(event, loadedFeed)
      for (let feed of Object.keys(this.feed)) {
        this.feed[feed] = this.feed[feed].concat(loadedFeed[feed])
      }

      this.refreshInterval = setInterval(async () => {
        let results = await dbFeed(this.lastLoaded)
        if (results) for (let event of results) this.processEvent(event, this.unreadFeed)
        for (let feed of Object.keys(this.feed)) {
          this.feed[feed] = this.feed[feed].concat(this.unreadFeed[feed])
        }
      }, 10000)

      this.loadingMore = false
    },

    loadUnread() {
      this.loadingUnread = true
      this.feed[this.tab] = this.unreadFeed[this.tab].concat(this.feed[this.tab])
      this.unreadFeed[this.tab] = []
      this.lastLoaded = Math.round(Date.now() / 1000)
      this.loadingUnread = false
    },

    processEvent(event, feed = this.feed) {
      if (!isValidEvent(event)) return
      if (this.feedSet.has(event.id)) return
      if (event.created_at < this.since) return
      this.feedSet.add(event.id)
      this.interpolateEventMentions(event)
      this.useProfile(event.pubkey)

      // this.debouncedAddToThread([event])
      if (this.follows.includes(event.pubkey)) addToThread(feed.follows, Object.assign({}, event), 'feed', event.pubkey !== this.$store.state.keys.pub)
      if (this.isBot(event)) addToThread(feed.bots, Object.assign({}, event), 'feed', event.pubkey !== this.$store.state.keys.pub)
      if (this.isAI(event)) addToThread(this.feed.AI, Object.assign({}, event), 'feed', event.pubkey !== this.$store.state.keys.pub)
      else addToThread(feed.global, Object.assign({}, event), 'feed', event.pubkey !== this.$store.state.keys.pub)
    },

    async getFollows(pubkey) {
      let event = await dbUserFollows(pubkey)
      if (!event) return []
      return event.tags
        .filter(([t, v]) => t === 'p' && v)
        .map(([_, v]) => v)
    },

    useProfile(pubkey) {
      if (this.profilesUsed.has(pubkey)) return

      this.profilesUsed.add(pubkey)
      this.$store.dispatch('useProfile', {pubkey})
    },

    isBot(event) {
      if (this.bots.includes(event.pubkey)) return true
      if (event.content.includes('https://www.minds.com/newsfeed/')) return true
      return false
    },

    isAI(event) {
      if (event.pubkey === '5c10ed0678805156d39ef1ef6d46110fe1e7e590ae04986ccf48ba1299cb53e2') return true
      if (event.tags.findIndex(([t, v]) => t === 'p' && v === '5c10ed0678805156d39ef1ef6d46110fe1e7e590ae04986ccf48ba1299cb53e2') >= 0) return true
      return false
    },
  }
})
</script>
<style lang="scss">
@import "assets/theme/colors.scss";
@import "assets/variables.scss";

.feed-tabs {
  //border-bottom: $border-dark;
  .q-tabs {
    display: none;
  }
  .q-page::-webkit-scrollbar {
    width: 0;
  }
}

.feed {
  .load-more-container {
    border-top: $border-dark;
    border-bottom: $border-dark;
    min-height: 6px;
  }
  > .load-more:last-child {
    border-bottom: 0;
  }
}

.addon-menu {
  display: flex;
  flex-direction: row-reverse;
  &-popup {
    min-width: 150px;
    border-radius: 1rem;
    padding: 10px;
    background-color: $color-bg;
    box-shadow: $shadow-white;
    .popup-header {
      display: flex;
      width: 100%;
      padding: 8px;
      cursor: pointer;
      border-radius: .5rem;
      p {
        margin: 0;
        flex-grow: 1;
        font-size: 1.1em;
        font-weight: bold;
        text-transform: capitalize;
      }
      &:hover {
        background-color: rgba($color: $color-dark-gray, $alpha: 0.3);
      }
      .more {
        width: 1.5rem;
        height: 1.5rem;
        svg {
          fill: $color-primary;
          width: 100%;
        }
      }
    }
  }
}

@media screen and (max-width: $phone) {
  .page-header-container {
    border-bottom: $border-dark;
  }
  .post-editor {
    display: none;
  }
  .feed {
    .load-more-container {
      border: 0;
      min-height: 0;
      &.more-available {
        border-bottom: $border-dark;
      }
    }
  }
}

</style>
