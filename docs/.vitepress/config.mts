import { defineConfig } from 'vitepress'
import { nav } from './navbar';
import { sidebar } from './sidebar';
import { chineseSearchOptimize, pagefindPlugin } from 'vitepress-plugin-pagefind'

// https://vitepress.dev/reference/site-config
export default defineConfig({
  title: "程序员阿丙的客厅",
  description: "A VitePress Site",
  themeConfig: {
    outlineTitle:"文章目录",
    outline:[1,6],// 定义标题级别,字符串"deep"相当于是[2,6] 
    // https://vitepress.dev/reference/default-theme-config
    nav: nav,

    sidebar,

    socialLinks: [
      { icon: 'gitee', link: 'https://github.com/movee8' }
    ],

    footer: {
      copyright: "@ 程序员阿丙",
    },
  },
  markdown: {
    toc: {
      level: [1, 6]
    }
  },
  lang: 'zh-cn',
  vite:{
    plugins: [pagefindPlugin({
      customSearchQuery: chineseSearchOptimize,
      btnPlaceholder: '搜索',
      placeholder: '搜索文档',
      emptyText: '空空如也',
      heading: '共: {{searchResult}} 条结果',
      excludeSelector: ['img', 'a.header-anchor'],
    })],
  }
})
