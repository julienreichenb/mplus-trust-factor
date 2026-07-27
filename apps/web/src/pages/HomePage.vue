<script setup lang="ts">
import { ref } from "vue";
import { useRouter } from "vue-router";

const router = useRouter();
const region = ref("EU");
const realm = ref("");
const name = ref("");

function search(): void {
  if (!realm.value.trim() || !name.value.trim()) return;
  void router.push({
    name: "character",
    params: {
      region: region.value,
      realm: realm.value.trim(),
      name: name.value.trim(),
    },
  });
}
</script>

<template>
  <section>
    <h1>Search a character</h1>
    <p>Look up a Retail character by region, realm, and name.</p>
    <form aria-label="Character search" @submit.prevent="search">
      <label>
        Region
        <input v-model="region" name="region" autocomplete="off" />
      </label>
      <label>
        Realm
        <input v-model="realm" name="realm" autocomplete="off" />
      </label>
      <label>
        Name
        <input v-model="name" name="name" autocomplete="off" />
      </label>
      <button type="submit">Search</button>
    </form>
  </section>
</template>

<style scoped>
form {
  display: grid;
  gap: 0.75rem;
  max-width: 24rem;
}

label {
  display: grid;
  gap: 0.25rem;
}

input,
button {
  padding: 0.5rem 0.65rem;
}
</style>
