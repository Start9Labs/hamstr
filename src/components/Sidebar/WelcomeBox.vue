<template>
  <div class="welcome" v-if="!$store.getters.isSignedIn">
    <div class="welcome-header">
      <h3>New to Nostr?</h3>
    </div>
    <div class="welcome-content">
      <button class="btn btn-primary" @click="signUp">Create Account</button>
      <button class="btn" @click="signIn">Log in</button>
    </div>
  </div>
</template>

<script>
export default {
  name: 'WelcomeBox',
  methods: {
    signUp() {
      this.$store.dispatch('signIn', {fragment: 'sign-up'}).catch(() => {})
    },
    signIn() {
      this.$store.dispatch('signIn', {fragment: 'sign-in'}).catch(() => {})
    },
  }
}
</script>

<style lang="scss" scoped>
@import "assets/theme/colors.scss";

.welcome {
  background-color: rgba($color: $color-dark-gray, $alpha: 0.1);
  border-radius: 1rem;
  margin-bottom: 1rem;
  &-header {
    padding: 1rem;
    h3 {
      margin: 0;
      font-size: 1.4rem;
      color: #fff;
    }
  }
  &-content {
    border-top: $border-dark;
    padding: 1rem;
    button {
      width: 100%;
      padding: .5rem;
      &:first-child {
        margin-bottom: 1rem;
      }
    }
  }
}

</style>
