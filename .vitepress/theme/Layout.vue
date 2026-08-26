<script setup>
import DefaultTheme from 'vitepress/theme'
import RouteLoadingBar from './components/RouteLoadingBar.vue'
import { useRouteLoading } from './composables/routeLoading'

const { Layout } = DefaultTheme
const { loading } = useRouteLoading()
</script>

<template>
  <Layout>
    <!-- 顶部进度条：仅在路由切换加载期间显示 -->
    <template #layout-top>
      <RouteLoadingBar v-if="loading" />
    </template>
  </Layout>
</template>
