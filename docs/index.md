---
# https://vitepress.dev/reference/default-theme-home-page
layout: home

hero:
  name: "朋友，你好！"
  text: ""
  tagline: 请坐下，我们聊聊技术与生活
  actions:
    - theme: brand
      text: AI文集
      link: /ai/十分钟从零开始开发一个自己的MCP server
    - theme: brand
      text: RDMA文集
      link: /rdma/一台低配云主机也能轻松愉快地玩RDMA

features:
  - title: 十分钟从零开始开发一个自己的MCP server
    details: 本文详细介绍了从零开发一个实现了创建文件和向文件写入数据功能的MCP server，并详细介绍了如何在Claude Desktop中通过Claude大模型使用这个MCP server。
    link: /ai/十分钟从零开始开发一个自己的MCP server
  - title: 一文读懂MCP协议
    details: 本文介绍了MCP(Model Contex Protocol)协议为什么这么受欢迎。详细介绍了MCP的架构，LLM应用程序、LLM、MCP Client、MCP Server间相互通信的过程和消息格式
    link: /ai/一文读懂MCP协议
  - title: 基于本地deepseek搭建一个无需联网也可使用的个人知识库
    details: 基于ollama、deepseek、page assist在macbook上搭建了一个个人知识库应用，详细介绍了大模型应用的基本搭建和应用过程
    link: /ai/基于本地deepseek搭建一个无需联网也可使用的个人知识库
  - title: 一台低配云主机也能轻松愉快地玩RDMA
    details: RDMA是目前linux网络数据传输效率最高的方式，同时成本也非常高昂。本文通过结合使用veth 和 SoftRoCE 技术，使我们能够在无RDMA网卡的普通服务器上方便地学习、开发和测试RDMA。
    link: /rdma/一台低配云主机也能轻松愉快地玩RDMA
---

