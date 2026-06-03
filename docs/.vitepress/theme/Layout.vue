<script setup lang="ts">
import { onMounted } from "vue";
import DefaultLayout from "vitepress/dist/client/theme-default/Layout.vue";

// SW only in prod — HMR collides with the cache in dev.
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
  <a class="skip-link" href="#VPContent">Skip to main content</a>
  <DefaultLayout />
</template>
