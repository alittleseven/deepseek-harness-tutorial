import { readonly, ref } from 'vue'

// 全局唯一的加载状态（模块级单例），配合路由钩子显示/隐藏顶部加载条。
// 加入“延迟显示 + 最小显示时长”，避免快速切换时进度条一闪而过。
const visible = ref(false)

let showTimer = null
let hideTimer = null
let shownAt = 0

const SHOW_DELAY = 160 // 打开前等待：极快(已缓存)的切换不显示，避免闪烁
const MIN_VISIBLE = 260 // 最小可见时长：保证用户能看清，避免闪断

function show() {
  if (hideTimer) {
    clearTimeout(hideTimer)
    hideTimer = null
  }
  if (showTimer) return // 已在“即将显示”等待中
  showTimer = setTimeout(() => {
    showTimer = null
    visible.value = true
    shownAt = Date.now()
  }, SHOW_DELAY)
}

function hide() {
  if (showTimer) {
    // 还没到显示时间就结束了：取消，始终不显示
    clearTimeout(showTimer)
    showTimer = null
    return
  }
  if (!visible.value) return
  if (hideTimer) clearTimeout(hideTimer)
  const elapsed = Date.now() - shownAt
  const remaining = Math.max(0, MIN_VISIBLE - elapsed)
  hideTimer = setTimeout(() => {
    hideTimer = null
    visible.value = false
  }, remaining)
}

export function useRouteLoading() {
  return { loading: readonly(visible), show, hide }
}
