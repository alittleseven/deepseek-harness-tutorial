<script setup>
import DefaultTheme from 'vitepress/theme'
import RouteLoadingBar from './components/RouteLoadingBar.vue'
import { useRouteLoading } from './composables/routeLoading'

const { Layout } = DefaultTheme
const { loading } = useRouteLoading()
</script>

<template>
  <Layout>
    <!-- 居中加载转圈：仅在路由切换加载期间淡入，加载完成淡出 -->
    <template #layout-top>
      <RouteLoadingBar :active="loading" />
    </template>
  </Layout>
</template>
