import { DefaultTheme } from 'vitepress';
export const nav: DefaultTheme.NavItem[] = [
    {
        text: '首页',
        link: '/' // 表示docs/index.md
    },
    {
        text: '文集',
        items: [
            {
                text: 'AI文集',
                link: '/ai/十分钟从零开始开发一个自己的MCP server' // 表示docs/column/Travel/index.md
            },
            {
                text: 'rdma文集',
                link: '/rdma/一台低配云主机也能轻松愉快地玩RDMA' // 表示docs/column/Growing/index.md
            }
        ]
    },
    {
        text: '关于我',
        items: [
            {
                items:[
                    { text: 'Gitee', link: 'https://gitee.com/movee' },
                ]
            },
            {
                items:[
                    { text: '掘金', link: 'https://juejin.cn/user/2571092875558030' },
                ]
            },
            {
                items:[
                    { text: '简书', link: 'https://www.jianshu.com/u/90a2db37a85a' },
                ]
            },
            {
                items:[
                    { text: 'Github', link: 'https://github.com/movee8' },
                ]
            }
        ]
    }
];