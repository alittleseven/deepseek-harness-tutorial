<script setup>
// 章节（页面）切换时，居中显示一个转圈（Spinner）加载指示。
// 通过 <Teleport to="body"> 挂到 body；常驻挂载，用 active 控制淡入淡出，避免闪烁。
// pointer-events:none 不阻挡任何点击（即使异常时也不会卡住操作）。
defineProps({
  active: { type: Boolean, default: false },
})
</script>

<template>
  <Teleport to="body">
    <div class="route-loading" :class="{ 'is-active': active }" aria-hidden="true">
      <div class="route-loading__spinner" />
    </div>
  </Teleport>
</template>

<style scoped>
.route-loading {
  position: fixed;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 2147483000;
  pointer-events: none;
  opacity: 0;
  transition: opacity 0.22s ease;
}

.route-loading.is-active {
  opacity: 1;
}

.route-loading__spinner {
  width: 44px;
  height: 44px;
  border-radius: 50%;
  border: 4px solid rgba(62, 99, 221, 0.18);
  border-top-color: #3e63dd;
  animation: route-loading-spin 0.85s linear infinite;
}

@keyframes route-loading-spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
