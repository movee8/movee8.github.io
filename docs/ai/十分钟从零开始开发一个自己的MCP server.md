本来计划一篇文章介绍完如何开发一个自己的MCP server，写完[一文读懂MCP协议](一文读懂MCP协议.md) 后，发现虽然很多内容没有介绍，篇幅还是比较长的，所以分成两篇来介绍。这一篇通过一个写文件功能的例子来介绍如何开发一个具体的MCP server

### 1 MCPServer设计与实现

#### 1.1 MCPServer结构体定义

根据MCP官网的介绍，我们很容易定义一个MCPServer的结构体，来封装和表示MCP server的内容。

```go
type MCPServer struct {
	name         string      // server名称
	version      string      // server版本
	initialized  atomic.Bool // 是否完成Initialize协商
	capabilities ServerCapabilities  // server提供的能力
	tools        map[string]*ToolHandler  // tools注册表，key为tool的名字
	// resources            map[string]*ResourceHandler
	// resourceTemplates    map[string]*ResourceTemplateHandler
	// prompts              map[string]*PromptHandler
	// notifications map[string]*NotificationHandlerFunc
}
```

`name`和`version`提供server的标识，在`Initialize`阶段，server会把这些信息返回给client。`initialized`表示协商已经完成，可以接收和处理client的请求了。

`capabilities`存储了server支持的能力。由于我们这里只演示`tools`的功能，只定义了tools的capability。`ToolCapabilities`中的`ListChanged`为`true`，表示Client可以通过`tools/list` method获取Server提供的tools列表。在`Initialize`阶段，server会把`apabilities`字段的值返回给client。它的具体定义如下

```go
type ServerCapabilities struct {
	Tools ToolCapabilities `json:"tools,omitempty"`
	// resources *resourceCapabilities
	// prompts   *promptCapabilities
}

type ToolCapabilities struct {
	ListChanged bool `json:"listChanged"`
}
```

`tools`字段是一个Server的tools注册表，注册的`key`就是`tool的名字`，`ToolHandler`的定义如下

```go
type ToolHandler struct {
	Tool    Tool               // tool信息，作为tools/list method的响应内容返回给Client
	Handler ToolHandlerFunc    // tool处理函数，tools/call method会调用这个函数
}

type Tool struct {
	Name        string          `json:"name"`    // tool的名字，tools/call method通过这个值确定调用哪个tool
	Description string          `json:"description,omitempty"` // 描述tool的功能，LLM根据它确定是否需要调用这个tool
	InputSchema ToolInputSchema `json:"inputSchema"`   // tool的参数描述，如果需要提供参数的话
}

// tool的参数，具体描述语法请参考JSON-RPC协议
type ToolInputSchema struct {
	Type       string         `json:"type"`      // 参数类型，例如对象、数组、字符串、整形、浮点数等等
	Properties map[string]any `json:"properties,omitempty"` // 对象或数组时，描述它包含的属性字段的名字和类型等信息
	Required   []string       `json:"required,omitempty"`   // 哪些字段是必填的
}

type ToolHandlerFunc func(request *Request) (*ToolResponse, error)

type Request struct {
	Method string `json:"method"`
	Params struct {
		Name      string         `json:"name"`     // tool的名字，与Tool结构体中的名字对应
		Arguments map[string]any `json:"arguments,omitempty"`  // tool的参数的具体值。需要符合Tool结构体中的InputSchema定义
	} `json:"params"`
}

type ToolResponse struct {
	Content any `json:"content"`  // 具体的tool，会有具体的Content结构定义
}
```

tools注册表中的每一个tool，都需要包含两个信息，tool字段提供这个tool的名字、功能描述、以及参数定义。当Client调用Server的`tools/list`方法时，Server会把注册表的所有注册表项的tool字段信息提供给Client。我们需要准确提供tool的功能描述和参数定义，因为Host最终会把这些信息作为Prompt的一部分提供给LLM，LLM才能正确决定是否调用该工具，并提供准确的参数。`Handler`字段则是tool的响应处理函数，它接收`tools/call` method提供的参数，并产生相应的输出。

#### 1.2 MCPServer方法实现

定了好了MCPServer结构体，我们就来实现它提供的方法。`HandleMessage`是Server处理Client请求的总入口，它主要根据请求的method值调用对应的处理函数进行处理。这里只实现了`initialize`、`tools/list`、`tools/call`几个基本的功能，其它的功能可以依葫芦画瓢进行添加。

```go
// 处理Client请求的总入口
func (s *MCPServer) HandleMessage(message []byte) JSONRPCMessage {

	var baseMessage struct {
		JSONRPC string `json:"jsonrpc"`
		Method  string `json:"method"`
		ID      any    `json:"id,omitempty"`
	}

	// 根据method名字分发请求
	_ = json.Unmarshal(message, &baseMessage)
	switch baseMessage.Method {
	case "initialize":
		return s.handleInitialize(baseMessage.ID)
	case "tools/list":
		return s.handleListTools(baseMessage.ID)
	case "tools/call":
		var request Request
		_ = json.Unmarshal(message, &request)
		return s.handleToolCall(baseMessage.ID, &request)
	default:
		return createErrorResponse(
			baseMessage.ID,
			METHOD_NOT_FOUND,
			fmt.Sprintf("Method %s not found", baseMessage.Method),
		)
	}
}

// 处理initialize method请求
func (s *MCPServer) handleInitialize(id any) JSONRPCMessage {
	result := InitializeResult{
		ProtocolVersion: "2024-11-05",
		ServerInfo: ServerInfo{
			Name:    s.name,
			Version: s.version,
		},
		Capabilities: s.capabilities,
	}

	s.initialized.Store(true)
	return createResponse(id, result)
}

// 处理tools/list method请求
func (s *MCPServer) handleListTools(id any) JSONRPCMessage {
	tools := make([]Tool, 0, len(s.tools))
	for _, toolHandler := range s.tools {
		tools = append(tools, toolHandler.Tool)
	}
	result := ToolListResult{
		Tools: tools,
	}
	return createResponse(id, result)
}

// 处理tools/call method请求
func (s *MCPServer) handleToolCall(id interface{}, request *Request) JSONRPCMessage {
	tool, ok := s.tools[request.Params.Name]
	if !ok {
		return createErrorResponse(
			id,
			INVALID_PARAMS,
			fmt.Sprintf("Tool not found: %s", request.Params.Name),
		)
	}

	result, err := tool.Handler(request)
	if err != nil {
		return createErrorResponse(id, INTERNAL_ERROR, err.Error())
	}

	return createResponse(id, result)
}
```

#### 1.3 Server服务实例设计

MCPServer设计完成了，我们就可以构建一个具体的实例，并向Client开放相应的功能

##### 1.3.1 注册MCPServer信息

下面的代码创建了一个MCPServer实例，并注册了一个`write_file` tool，提供了write\_file tool的处理函数。这个函数有两个参数：`path`和`content`，函数实现就是将content写入path指定的文件中。如果文件不存在，会创建一个新文件。

```go
func NewMCPServer(name, version string) *MCPServer {

	type Property struct {
		Type        string `json:"type"`
		Description string `json:"description"`
	}

	// 注册的tool信息
	tool := Tool{
		Name:        "write_file",
		Description: "Create a new file or overwrite an existing file with new content.",
		InputSchema: ToolInputSchema{
			Type: "object",
			Properties: map[string]any{
				"path":    Property{Type: "string", Description: "Path where to write the file"},
				"content": Property{Type: "string", Description: "Content to write to the file"},
			},
			Required: []string{"path", "content"},
		},
	}

	toolHandler := &ToolHandler{
		Tool:    tool,
		Handler: handleWriteFile,
	}

	// server实例
	s := &MCPServer{
		name:    name,
		version: version,
		capabilities: ServerCapabilities{
			Tools: ToolCapabilities{ListChanged: true},
		},
		tools: map[string]*ToolHandler{"write_file": toolHandler},
	}

	return s
}

// 实现write_file tool的具体功能
func handleWriteFile(request *Request) (*ToolResponse, error) {
	path, _ := request.Params.Arguments["path"].(string)
	content, _ := request.Params.Arguments["content"].(string)

	path = "/var/mcp-fs-server/" + path
	parentDir := filepath.Dir(path)
	_ = os.MkdirAll(parentDir, 0755)
	_ = os.WriteFile(path, []byte(content), 0644)

	type TextContent struct {
		Type string `json:"type"`
		Text string `json:"text"`
	}

	text := TextContent{
		Type: "text",
		Text: fmt.Sprintf("Successfully wrote %d bytes to %s", len(content), path),
	}

	return &ToolResponse{
		Content: []TextContent{text},
	}, nil
}
```

##### 1.3.2 以stdio方式向Client提供功能

这个例子以`stdio`的方式向Client提供相应的功能，具体代码如下。它会打开一个`stdin`，在一个for循环中不断尝试从`stdin`读取请求，当遇到一个`\n`键时，就表示获取到了一个完整的请求，然后调用`server.HandleMessage`函数进行处理，将处理结果写入`stdout`。

```go
func main() {
	log.Printf("start mcp-fs-server\n")
	file, _ := os.OpenFile("/var/mcp-fs-server/app.log", os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0666)
	log.SetOutput(file)

	// server实例
	server := NewMCPServer("mcp-fs-server", "0.0.1")

	sigChan := make(chan os.Signal, 1)
	signal.Notify(sigChan, syscall.SIGTERM, syscall.SIGINT)

	// 打开stdin，获取输入请求
	reader := bufio.NewReader(os.Stdin)
	readChan := make(chan string, 1)
	errChan := make(chan error, 1)

	go func() {
		for {
			line, err := reader.ReadString('\n')
			if err != nil {
				errChan <- err
				return
			}
			readChan <- line
		}
	}()

	for {
		select {
		case <-sigChan:
			log.Printf("exit mcp-fs-server\n")
			return
		case <-errChan:
			log.Printf("exit mcp-fs-server for read error\n")
			return
		case line := <-readChan:
			log.Printf("request: %s\n", line)
			// 处理请求
			response := server.HandleMessage([]byte(line))
			// 将响应写入stdout
			responseBytes, _ := json.Marshal(response)
			log.Printf("response: %s\n", string(responseBytes))
			fmt.Fprintf(os.Stdout, "%s\n", responseBytes)
		}
	}

}
```

#### 1.4 本地测试

我们本地编译测试一下

```bash
% go build -o mcp-fs-server main.go server.go
% ./mcp-fs-server
{"jsonrpc": "2.0","id": 1,"method": "initialize","params": {"protocolVersion": "2024-11-05","clientInfo": {"name": "example-client","version": "1.0.0"},"capabilities": {}}}

{"jsonrpc":"2.0","id":1,"result":{"protocolVersion":"2024-11-05","capabilities":{"tools":{"listChanged":true}},"serverInfo":{"name":"mcp-fs-server","version":"0.0.1"}}}

{"jsonrpc": "2.0","id": 2,"method": "tools/call","params":{"name":"write_file","arguments":{"path":"/var/mcp-fs-server/test.txt","content":"hello mcp"}}}

{"jsonrpc":"2.0","id":2,"result":{"content":[{"type":"text","text":"Successfully wrote 9 bytes to /var/mcp-fs-server/test.txt"}]}}
```

执行完上面的`initialize`和`tools/call`方法后，在`/var/mcp-fs-server`目录下可以发现多了一个`test.txt`文件，文件内容为：

```bash
% cat /var/mcp-fs-server/test.txt
hello mcp
```

### 2 在LLM应用程序中使用MCP server

当前有许多LLM应用程序支持MCP协议了，如Claude Desktop、Cline、Continue、LibreChat、mcp-agent等等。这里通过Claude Desktop来演示一下如何使用上面开发的mcp-fs-server。

#### 2.1 配置添加MCP Server

在`Claude Desktop`的`Setting`中点击`Developer`，然后点击`Edit Config`。
![claude-settings](/images/ai/claude-settings.png)
![claude-edit-config](/images/ai/claude-edit-config.png)

然后在配置文件中添加一下配置（如果是Macbook，也可以直接编辑配置文件`~/Library/Application\ Support/Claude/claude_desktop_config.json`）。配置中的`cammand`就是我们编译的二进制文件的绝对路径（不要填相对路径），`args`是命令的参数。Claude Desktop在启动时会执行这个命令，从而启动相应的MCP server。

```json
{
  "mcpServers": {
    "mcp_fs_server": {
      "command": "/usr/bin/mcp-fs-server",
      "args": [
        "/var/mcp-fs-server"
      ]
    }
  }
}
```

#### 2.2 使用MCP Server

添加完MCP Server配置后，重新启动Claude Desktop，可以发现在对话框的右下角多了一个锤子的图标，并显示了加载的MCP Server的数量，点击这个图标，可以查看MCP Server注册的name、version、功能描述等信息
![claude-load-mcp](/images/ai/claude-load-mcp.png)

我们向Claude发送一个写文件的指令，可以发现Claude Desktop成功执行了指令。
![claude-command](/images/ai/claude-command.png)

我们在相应的文件目录，可以发现创建了一个`test1.txt`文件，文件内容就是我们要求Claude写入的内容。我们再打开日志文件，可以查看Claude与我们的MCP Server的详细交互过程。

```text
2025/03/23 15:12:36 request: {"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"claude-ai","version":"0.1.0"}},"jsonrpc":"2.0","id":0}
2025/03/23 15:12:36 response: {"jsonrpc":"2.0","id":0,"result":{"protocolVersion":"2024-11-05","capabilities":{"tools":{"listChanged":true}},"serverInfo":{"name":"mcp-fs-server","version":"0.0.1"}}}

2025/03/23 15:12:36 request: {"method":"notifications/initialized","jsonrpc":"2.0"}
2025/03/23 15:12:36 response: {"jsonrpc":"2.0","id":null,"error":{"code":-32601,"message":"Method notifications/initialized not found"}}

2025/03/23 15:12:36 request: {"method":"tools/list","params":{},"jsonrpc":"2.0","id":1}
2025/03/23 15:12:36 response: {"jsonrpc":"2.0","id":1,"result":{"tools":[{"name":"write_file","description":"Create a new file or overwrite an existing file with new content.","inputSchema":{"type":"object","properties":{"content":{"type":"string","description":"Path where to write the file"},"path":{"type":"string","description":"Content to write to the file"}},"required":["path","content"]}}]}}

2025/03/23 15:12:38 request: {"method":"resources/list","params":{},"jsonrpc":"2.0","id":2}
2025/03/23 15:12:38 response: {"jsonrpc":"2.0","id":2,"error":{"code":-32601,"message":"Method resources/list not found"}}

2025/03/23 15:12:54 request: {"method":"tools/call","params":{"name":"write_file","arguments":{"path":"test1.txt","content":"hello mcp"}},"jsonrpc":"2.0","id":10}
2025/03/23 15:12:54 response: {"jsonrpc":"2.0","id":10,"result":{"content":[{"type":"text","text":"Successfully wrote 9 bytes to /var/mcp-fs-server/test1.txt"}]}}
```

