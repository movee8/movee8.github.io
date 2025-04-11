import { defineConfig } from 'vitepress'
import { nav } from './navbar';
import { sidebar } from './sidebar';
import { chineseSearchOptimize, pagefindPlugin } from 'vitepress-plugin-pagefind'

// https://vitepress.dev/reference/site-config
export default defineConfig({
  lang: 'zh-cn',
  head: [['link', { rel: 'icon', href: '/favicon.ico' }]],
  title: "程序员阿丙的客厅",
  description: "A VitePress Site",

  // lastUpdated: true,
  themeConfig: {
    // logo: "/favicon.ico",
    logo: "/android-chrome-t-192x192.png",
    // https://vitepress.dev/reference/default-theme-config
    nav: nav,

    sidebar,

    // markdown页面
    lastUpdated: {
      text: '最后更新',
      formatOptions: {
        dateStyle: 'full',
        timeStyle: 'medium'
      }
    },
    // lastUpdatedText: "最后更新",
    outlineTitle:"文章目录",
    outline:[1,6],// 定义标题级别,字符串"deep"相当于是[2,6] 

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
