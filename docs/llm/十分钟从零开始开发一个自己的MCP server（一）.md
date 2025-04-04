### 1 MCP为什么这么受欢迎

自从chatGPT发布以后，大家探索和应用大语言模型（`LLM`）的热情不断高涨，不同行业、不同应用领域都在积极尝试使用大语言模型的能力解决各自的问题，取得了惊人的效果。当前，大语言模型最基础的使用方式，就是像chatGPT那样，我们向它提问，然后它给我们一个答案。这个答案，可能是提供一些信息知识，生成sql查询语句，生成一段代码，制定一个行动计划等等。然后我们使用模型提供的sql语句去查询数据库，将代码集成到自己的项目中编译执行。于是，自然而然地，我们就可以想到让大语言模型应用程序自己用大语言模型生成的sql语句去查询数据库，自动编译执行模型生成的的代码，这样就形成一个自动闭环，无需人的参与（或许有的场景需要人的监督和决策，然后人工触发自动执行，但也只需要下发一个执行的指令即可）。初始的时候，大家提供一个函数接口（function call），让大语言模型应用程序在满足条件时自动调用。但是，不同的功能、不同的厂商各自独立定义自己的函数接口，这样函数接口的形式五花八门，不便于应用程序的集成，非常不利于大模型应用生态的发展。anthropic公司为大模型应用生态各组件的交互设计并实践了一个`MCP`（`Model Contex Protocol`）协议，规定了大模型应用组件间通信的通信机制、消息格式等，现在把它开源出来，获得了大家的一致认同。可以预见到，MCP协议可能会大大地促进大模型应用生态的发展和繁荣。这一现象在历史上屡见不鲜，如硬件领域的USB协议、PCIE协议，软件领域的TCP/IP协议等等。

### &#x20;2 MCP的架构和组件间交互机制

站在通信的角度，MCP将大模型生态各组件抽象为三个主要角色：`MCP hosts`、`MCP client`、`MCP server`。MCP官网说明MCP架构时，除了上述三大角色，还列出了`Local Data Source`和`Remote Service`两个角色，但这两个角色主要是详细说明MCP server支持的核心功能，不影响对MCP协议本身的理解，本文不做过多说明。同时，MCP官网将大模型与MCP host当做一个整体，没有进行区分。但是，考虑到MCP host与大模型往往是不同的独立实体，host与大模型间需要通过通信进行交互，且一个host可以连接多个大模型，为了描述方便，我将大模型独立出来作为一个单独的角色进行描述。

MCP官网给出的MCP架构图：

我梳理了一下MCP主要角色的交互机制序列图如下：

主要角色说明：

*   **Host**：就是LLM应用程序，如AI agent、Claude Desktop、Cursor、Trae等。往往通过LLM、MCP server等提供的能力，向最终用户提供具体的产品和服务。Host往往可以使用一个或多个LLM。Host可以持有多个Client。
*   **Client**：MCP协议是一个client-server架构的协议。Client请求Server执行某个功能，并从Server获取结果。当前定义的MCP架构中，Client和Server是一一对应的。Client往往是Host内部的一个组件，Host通过Client实现对Server的连接和请求Server实现某项功能。
*   **Server**：相对于LLM来说，Server往往是一个传统的应用或服务，是LLM应用程序为了弥补和增强LLM的功能而采用的一个措施。Server可以进一步使用外部的资源和服务来完成Client的请求。他可以提供各种各种的功能，如处理文件、查询数据库、编译执行代码、检索搜索引擎、订机票等等
*   **Local Data Sources/Remote Services**：本地或远程的资源和服务，如文件、数据库、搜索引擎等。

MCP典型的工作过程如下：

1.  MCP Host配置或发现了一个MCP server后，则创建一个对应的MCP Client，来负责与这个Server的通信

2.  Client向Server发送一个`Initialize Request`，请求中会包含Client的基本信息和支持的能力

3.  Server向Client回复一个`Initialize Response`，告诉Client自己支持的功能描述和每个功能的参数描述。我们需要仔细描述Server的功能和参数，LLM就是根据Server提供的功能和参数描述来决定如何调用Server的功能并提供具体的参数值的。当前MCP定义了多个类型的功能，如Resource、Prompt、Tool、Root、Sampling，他们的具体功能可以参考MCP官网资料

4.  Client再向Server发送一个`Initialized Notification`，通知Server Initialize完成了。Initialize阶段定义了Client与Server的协商和握手过程。这个过程与TCP的三次握手是不是很像？其实很多通信协议都有一个类似的握手协商的过程。当前的实现中，有些Client可能并没有Initialized Notification这一步，Server可能也没有实现处理Initialized Notification消息。

5.  Host向LLM发起问答请求时，会把它知道的所有Server的功能和参数描述作为Prompt的一部分，连同问题一起发送给LLM。Host向LLM发起的Prompt模板可能长下面这样：

    ```python
    system_message = (
             "You are a helpful assistant with access to these tools:\n\n"
             f"{tools_description}\n"
             "Choose the appropriate tool based on the user's question. "
             "If no tool is needed, reply directly.\n\n"
             "IMPORTANT: When you need to use a tool, you must ONLY respond with "
             "the exact JSON object format below, nothing else:\n"
             "{\n"
             '    "tool": "tool-name",\n'
             '    "arguments": {\n'
             '        "argument-name": "value"\n'
             "    }\n"
             "}\n\n"
             "After receiving a tool's response:\n"
             "1. Transform the raw data into a natural, conversational response\n"
             "2. Keep responses concise but informative\n"
             "3. Focus on the most relevant information\n"
             "4. Use appropriate context from the user's question\n"
             "5. Avoid simply repeating the raw data\n\n"
             "Please use only the tools that are explicitly defined above."
         )
         messages = [{"role": "system", "content": system_message}]
    ```

    上面的`system_message`的`f"{tools_description}\n"`部分会被渲染为Server在Initialize阶段提供的功能描述内容

6.  LLM响应问答时，决定是否需要调用某个Server工具。如果需要，则会根据调用工具的参数要求提供具体的参数值

7.  Host通知Client向Server发起具体的调用请求

8.  Client向Server真正发起调用请求

9.  Server在完成Client请求时，有可能会继续请求外部系统，如搜索引擎、RAG系统等

10. Server向Client回复请求的处理结果

11. Client将处理结果最终返回给Host

12. Host可能会使用Client的返回结果继续请求LLM，循环上面的步骤直到最终解决用户的需求，或者让LLM整理一下Client的返回结果，转换为自然语言的表达方式返回给用户。

### &#x20;3 MCP协议的消息格式

MCP Client和Server之间的通信消息使用`JSON-RPC 2.0`编码，这样我们知道：1）MCP消息都是JSON格式的；2）当Client或Server需要向对方描述功能和参数时（例如Initialize阶段），使用`JSON-RPC 2.0`语法来描述参数的名称和类型。

MCP协议包括三者类型的消息：

1.  **Request**

    请求消息的格式如下：

    ```json
    {
      jsonrpc: "2.0",
      id: number | string,
      method: string,
      params?: object
    }
    ```

    jsonrpc字段是每个MCP消息都有的一个公共字段，表示消息遵从的JSON-RPC版本。id字段用于标识一个Request，可以是一个数字或字符串。在Response中，这个id值会原封不动地透传回来，请求方通过id值确定是哪个Request的响应。method表示某项功能，例如：`tools/list`表示请求Server返回它支持的所有tools（功能），`tools/call`表示请求Server执行某个具体的动作。当前比较常用的method包括：`initialize`、`resources/list`、`resources/templates/list`、`resources/read`、`prompts/list`、`prompts/get`、`tools/list`、`tools/call`。当然，我们也可以定义自己的method。params字段表示method需要的参数，根据method不同提供不同的具体值，所以它是一个json对象。params后面的?表示参数字段可以不提供，例如tools/list不需要提供参数
2.  **Response**

    响应的消息格式如下：

    ```json
    {
      jsonrpc: "2.0",
      id: number | string,
      result?: object,
      error?: {
        code: number,
        message: string,
        data?: unknown
      }
    }
    ```

    `id`字段就是对应请求的`id`字段值。`result`字段表示响应的内容。如果出现错误，由`error`字段提供错误信息。MCP已经贴心的定义了error信息的具体格式。
3.  **Notification**

    通知用于Server主动向Client通知一个事件，当然也可以由Client向Server端发送。它的格式如下：

    ```json
    {
      jsonrpc: "2.0",
      method: string,
      params?: object
    }
    ```

    可见Notification与Request的格式差不多，只是Notification由于不需要对方响应，所有没有id字段

### 4 MCP的消息传递方式

上面描述了MCP消息的格式，但是Client需要一种具体通信手段将消息传递给Server。目前MCP官方定义了两种具体的方法：

1.  **stdio**

    这时Client和Server在同一台服务器上，Client通过向Server提供的`stdin`（标准输入）写入消息，从而将消息传递给Server。同样地，Client通过从Server提供的`stdout`（标准输出）、`stderr`（标准错误）读取消息，从而获取Server的响应。
2.  **http SSE**（`Server Side Event`）

    这时Client和Server可以不在同一台服务器上。他们通过http post进行消息传递
3.  其他

    其实其它的通信协议也都可以使用，如http、websocket，只要MCP生态中大家都支持，就可以方便的使用

### &#x20;5 MCP消息内容举例

上面描述了MCP消息的格式定义，可能还是有些抽象，下面举几个常用消息的例子，感受一下

#### &#x20;5.1 initialize请求消息

下面是Claude Desktop MCP Client发送的Initialize请求消息例子

```json
{
	"jsonrpc": "2.0",
	"id": 1,
	"method": "initialize",
	"params": {
		"protocolVersion": "2024-11-05",
		"clientInfo": {
			"name": "claude-ai",
			"version": "0.1.0"
		},
		"capabilities": {}
	}	
}
```

#### 5.2 Initialize响应消息

Server在Initialize响应消息的result字段中提供了Server的基本信息和支持的能力

```json
{
	"jsonrpc": "2.0",
	"id": 1,
	"result": {
		"protocolVersion": "2024-11-05",
		"capabilities": {
			"resources": {
				"subscribe": true,
				"listChanged": true
			},
			"tools": {
				"listChanged": true
			}
		},
		"serverInfo": {
			"name": "mcp-fs-server",
			"version": "0.0.1"
		}
	}
}
```

#### &#x20;5.3 initialize notification消息

下面的initialize notification消息也是Claude Desktop在Initialize阶段发送给Server端的

```json
{
	"jsonrpc": "2.0",
	"id": 1,
	"method": "notifications/initialized"
}
```

#### 5.4 tools/list请求消息

```json
{
	"jsonrpc": "2.0",
	"id": 2,
	"method": "tools/list"
}
```

#### 5.5 tools/list响应消息

这个消息表明这个Server提供了一个名字叫做write\_file的tool功能，它需要提供两个参数：文件的路径和写入文件的内容，这两个参数的类型都是字符串。tool的功能和参数的含义都通过description字段进行了准确描述

```json
{
	"jsonrpc": "2.0",
	"id": 2,
	"result": {
		"tools": [
			{
				"name": "write_file",
				"description": "Create a new file or overwrite an existing file with new content.",
				"inputSchema": {
					"type": "object",
					"properties": {
						"path": {
							"description": "Content to write to the file",
							"type": "string"
						},
						"content": {
							"description": "Content to write to the file",
							"type": "string"
						}
					},
					"required": [
						"path"
					]
				}
			}
		]
	}
}
```

#### 5.6 tools/call请求消息

通过tools/list获取了Server提供的tools，LLM就可以根据tool的功能决定是否需要调用，根据参数定义提供具体的参数。下面是Claude模型提供的调用参数，并由Claude Desktop的Client发送给mcp-fs-server Server端的tools/call请求调用消息

```json
{
	"jsonrpc": "2.0",
	"id": 3,
	"method": "tools/call",
	"params": {
		"name": "write_file",
		"arguments": {
			"path": "/var/mcp-fs-server/test.txt",
			"content": "hello mcp"
		}
	}
}
```

#### 5.7 tools/call响应消息

mcp-fs-server Server处理请求后的响应消息

```json
{
	"jsonrpc": "2.0",
	"id": 3,
	"result": {
		"content": [
			{
				"type": "text",
				"text": "Successfully wrote 9 bytes to /var/mcp-fs-server/test.txt"
			}
		]
	}
}
```

