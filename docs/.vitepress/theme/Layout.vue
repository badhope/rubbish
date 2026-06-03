<script setup lang="ts">
import { onMounted } from 'vue'
import DefaultLayout from 'vitepress/dist/client/theme-default/Layout.vue'

/**
 * Register the service worker for PWA support.
 *
 * - Only registers in production builds (skips dev/HMR).
 * - Defers registration until window.load so it doesn't compete with
 *   initial page render for bandwidth.
 * - Silently no-ops if registration fails (PWA is a progressive
 *   enhancement; the site must still work without it).
 * - Checks for an updated SW hourly so users get fresh content
 *   without manual reload.
 */
onMounted(() => {
  if (typeof window === 'undefined') return
  if (!('serviceWorker' in navigator)) return
  // Skip in dev — VitePress HMR conflicts with service worker caching.
  if (import.meta.env.DEV) return

  const register = () => {
    navigator.serviceWorker
      .register('/ScholarLib/sw.js', { scope: '/ScholarLib/' })
      .then((reg) => {
        // Periodic update check (hourly)
        setInterval(() => reg.update().catch(() => {}), 60 * 60 * 1000)
      })
      .catch(() => {
        // Silent: PWA is optional
      })
  }

  if (document.readyState === 'complete') {
    register()
  } else {
    window.addEventListener('load', register, { once: true })
  }
})
</script>

<template>
  <a class="skip-link" href="#VPContent">Skip to main content</a>
  <DefaultLayout />
</template>
