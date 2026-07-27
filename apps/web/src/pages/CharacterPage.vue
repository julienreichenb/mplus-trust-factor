<script setup lang="ts">
defineProps<{
  region: string;
  realm: string;
  name: string;
}>();
</script>

<template>
  <section>
    <h1>Character profile</h1>
    <p>
      {{ name }} — {{ realm }} ({{ region }})
    </p>
    <p>
      Profile data, Trust Factor, and red flags will be loaded from the API by Agent 6.
    </p>
  </section>
</template>
