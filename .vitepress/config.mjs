import { defineConfig } from 'vitepress'

// 站点部署到子路径时改成你的 base，例如 "/docs/"；根域部署则保持 '/'
// base: '/',

export default defineConfig({
  lang: 'zh-CN',
  title: 'DeepSeek Harness 源码教程',
  description: '插件式 Agent 运行时的架构、机制与源码走读',
  cleanUrls: true,
  lastUpdated: true,

  // 这本书是源码走读，正文里大量字面 `{{ }}`、泛型 `<>`，会被 Vue/HTML
  // 误当成模板插值或标签解析。关闭 markdown 的原始 HTML 放行，
  // 并把花括号转成实体，保证显示原样、又不被编译层解读。
  markdown: {
    html: false,
    config(md) {
      md.options.html = false
      const defaultRender = md.renderer.render.bind(md.renderer)
      md.renderer.render = (tokens, options, env) => {
        const html = defaultRender(tokens, options, env)
        return html
          .replace(/\{\{/g, '&#123;&#123;')
          .replace(/\}\}/g, '&#125;&#125;')
      }
    },
  },

  head: [
    ['link', { rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' }],
    ['meta', { name: 'theme-color', content: '#3e63dd' }],
    ['meta', { name: 'author', content: 'PenguinHarness' }],
  ],

  themeConfig: {
    logo: null,

    nav: [
      { text: '首页', link: '/' },
      { text: '正文', link: '/chapters/01-从一条命令到一棵插件树' },
      { text: '附录', link: '/appendix-a-glossary' },
      { text: '习题解答', link: '/answers' },
    ],

    sidebar: [
      {
        text: '开始',
        items: [
          { text: '书籍首页', link: '/' },
          { text: '学习路线与目录', link: '/' },
        ],
      },
      {
        text: '正文 · 十七章',
        collapsed: false,
        items: [
          { text: '01 · 从一条命令到一棵插件树：dsh 全景', link: '/chapters/01-从一条命令到一棵插件树' },
          { text: '02 · Context 与 Service：Cordis 的依赖容器', link: '/chapters/02-Context与Service' },
          { text: '03 · 插件与可逆副作用：Fiber 状态机与 effect', link: '/chapters/03-插件与可逆副作用-Fiber与effect' },
          { text: '04 · 事件即扩展点：五种分发模式', link: '/chapters/04-事件即扩展点-五种分发模式' },
          { text: '05 · cordis.yml 与 Loader', link: '/chapters/05-cordis.yml与Loader' },
          { text: '06 · Profile 组装：从 dsh 命令到插件树', link: '/chapters/06-Profile组装' },
          { text: '07 · 组合包与内置 bundle', link: '/chapters/07-组合包与内置bundle' },
          { text: '08 · 会话日志：仅追加事件流', link: '/chapters/08-会话日志' },
          { text: '09 · Agent Loop：一次轮次的一生', link: '/chapters/09-Agent-Loop-一次轮次的一生' },
          { text: '10 · 提示词组装与 LLM 适配器', link: '/chapters/10-提示词组装与LLM适配器' },
          { text: '11 · 工具系统与执行流水线', link: '/chapters/11-工具系统与执行流水线' },
          { text: '12 · 能力 Seam 全景', link: '/chapters/12-能力Seam全景' },
          { text: '13 · 多智能体与任务组织', link: '/chapters/13-多智能体与任务组织' },
          { text: '14 · 长程会话治理', link: '/chapters/14-长程会话治理' },
          { text: '15 · 持久化与设置', link: '/chapters/15-持久化与设置' },
          { text: '16 · Web 与远程协议', link: '/chapters/16-Web与远程协议' },
          { text: '17 · 扩展实战：从 0 到 1 写插件', link: '/chapters/17-扩展实战' },
        ],
      },
      {
        text: '附录',
        collapsed: true,
        items: [
          { text: 'A · 术语表（中英对照）', link: '/appendix-a-glossary' },
          { text: 'B · API 与配置速查', link: '/appendix-b-api-config' },
          { text: 'C · 源码文件清单与参考文献', link: '/appendix-c-source' },
        ],
      },
      {
        text: '习题解答',
        collapsed: false,
        items: [
          { text: '分层练习参考答案', link: '/answers' },
        ],
      },
    ],

    // 中文本地化文案
    outline: { level: [2, 3], label: '本页目录' },
    docFooter: { prev: '上一章', next: '下一章' },
    lastUpdated: { text: '最后更新', formatOptions: { dateStyle: 'short', timeStyle: 'short' } },
    returnToTopLabel: '回到顶部',
    sidebarMenuLabel: '目录',
    darkModeSwitchLabel: '主题',
    lightModeSwitchTitle: '切换到浅色模式',
    darkModeSwitchTitle: '切换到深色模式',
    search: {
      provider: 'local',
      options: {
        translations: {
          button: { buttonText: '搜索', buttonAriaLabel: '搜索' },
          modal: {
            noResultsText: '未找到相关结果',
            resetButtonTitle: '清除查询条件',
            footer: {
              selectText: '选择',
              navigateText: '切换',
              closeText: '关闭',
            },
          },
        },
      },
    },
  },
})
