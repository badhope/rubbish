<script setup lang="ts">
import { useRoute } from 'vitepress'
import DefaultLayout from 'vitepress/dist/client/theme-default/Layout.vue'

const route = useRoute()
</script>

<template>
  <!--
    Custom layout: adds a skip-link to satisfy
    WCAG 2.1 'landmark-one-main' and 'bypass-blocks'.
  -->
  <a class="skip-link" href="#VPContent">Skip to main content</a>
  <DefaultLayout>
    <template #doc-before v-if="route.path !== '/'">
      <nav aria-label="Breadcrumb" class="VPSBreadcrumb" v-if="false" />
    </template>
  </DefaultLayout>
</template>

<style>
/* Skip link styling — moved from custom.css for proximity */
.skip-link {
  position: fixed;
  top: -100px;
  left: 8px;
  background: var(--vp-c-brand-1);
  color: #fff;
  padding: 12px 20px;
  z-index: 10000;
  border-radius: 0 0 6px 6px;
  text-decoration: none;
  font-weight: 600;
  transition: top 0.2s ease;
  box-shadow: 0 4px 12px rgba(59, 130, 246, 0.4);
}
.skip-link:focus {
  top: 0;
  outline: 3px solid #fbbf24;
  outline-offset: 2px;
}
</style>
