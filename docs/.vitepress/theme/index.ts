import DefaultTheme from 'vitepress/theme'
import Layout from './Layout.vue'
import './custom.css'

export default {
  extends: DefaultTheme,
  // Wrap with a Layout that adds <main> landmark and other a11y improvements
  Layout,
}
