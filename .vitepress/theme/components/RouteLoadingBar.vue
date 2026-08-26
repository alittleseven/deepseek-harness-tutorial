<script setup>
// 顶部不定长进度条，用于章节（页面）切换时提示“正在加载”。
// 通过 <Teleport to="body"> 挂到 body 下，position: fixed 恒贴视口顶部，不占布局高度。
</script>

<template>
  <Teleport to="body">
    <div class="route-loading-bar" aria-hidden="true">
      <div class="route-loading-bar__track" />
      <div class="route-loading-bar__fill" />
    </div>
  </Teleport>
</template>

<style scoped>
.route-loading-bar {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  height: 3px;
  z-index: 2147483000;
  overflow: hidden;
  pointer-events: none;
  background-color: rgba(62, 99, 221, 0.12);
}

.route-loading-bar__fill {
  position: absolute;
  top: 0;
  left: -40%;
  width: 40%;
  height: 100%;
  border-radius: 999px;
  background-color: #3e63dd;
  animation: route-loading-slide 1.1s ease-in-out infinite;
}

@keyframes route-loading-slide {
  0% {
    left: -40%;
    width: 40%;
  }
  50% {
    left: 35%;
    width: 30%;
  }
  100% {
    left: 100%;
    width: 45%;
  }
}
</style>
