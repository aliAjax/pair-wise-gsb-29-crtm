<script setup lang="ts">
defineProps<{
  metrics: { label: string; value: string | number }[];
}>();
</script>

<template>
  <section class="metrics-bar">
    <article v-for="item in metrics" :key="item.label" class="metric-card">
      <span>{{ item.label }}</span>
      <strong>{{ item.value }}</strong>
    </article>
  </section>
</template>
