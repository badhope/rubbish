<script setup lang="ts">
import { onMounted } from "vue";
import DefaultLayout from "vitepress/dist/client/theme-default/Layout.vue";

// Register the service worker for PWA support. Skipped in dev so HMR
// isn't fighting the SW cache.
onMounted(() => {
  if (import.meta.env.DEV) return;
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;

  const register = () => {
    navigator.serviceWorker
      .register("/ScholarLib/sw.js", { scope: "/ScholarLib/" })
      .then((reg) => {
        setInterval(() => reg.update().catch(() => {}), 60 * 60 * 1000);
      })
      .catch(() => {
        // PWA is progressive enhancement; site must work without it.
      });
  };

  if (document.readyState === "complete") {
    register();
  } else {
    window.addEventListener("load", register, { once: true });
  }
});
</script>

<template>
  <DefaultLayout />
</template>
