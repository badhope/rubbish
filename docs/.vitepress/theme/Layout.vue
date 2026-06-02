<script setup lang="ts">
import { onMounted } from 'vue'
import { useRoute } from 'vitepress'
import DefaultLayout from 'vitepress/dist/client/theme-default/Layout.vue'

const route = useRoute()

onMounted(() => {
  // Register service worker for PWA support
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker
        .register('/ScholarLib/sw.js', { scope: '/ScholarLib/' })
        .then((reg) => {
          // Periodic update check (every 60 min)
          setInterval(() => reg.update().catch(() => {}), 60 * 60 * 1000)
        })
        .catch(() => {
          // Silent: PWA is a progressive enhancement
        })
    })
  }
})
</script>

<template>
  <a class="skip-link" href="#VPContent">Skip to main content</a>
  <DefaultLayout />
</template>
