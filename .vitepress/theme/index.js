import DefaultTheme from 'vitepress/theme'
import Layout from './Layout.vue'
import { useRouteLoading } from './composables/routeLoading'

export default {
  extends: DefaultTheme,
  // 用我们包装过的 Layout 替换默认 Layout（通过 layout-top 插槽注入加载条）
  Layout,
  enhanceApp({ router }) {
    // 路由钩子：VitePress 在切页时会动态加载该页的 markdown 数据 chunk，
    // onBeforeRouteChange 在其开始前触发，onAfterRouteChanged 在该页加载完成后触发。
    const { show, hide } = useRouteLoading()
    router.onBeforeRouteChange = () => show()
    router.onAfterRouteChanged = () => hide()
  },
}
