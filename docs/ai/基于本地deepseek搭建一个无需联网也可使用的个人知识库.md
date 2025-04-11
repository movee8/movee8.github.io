以chatGPT为代表的LLM产品，极大地提高了大家在编程、ppt制作、内容摘要、文档写作等语言文字相关工作的效率。但是由于高昂的成本和极高的技术要求，大家只能通过网络服务使用几家大语言模型公司提供的产品服务。这种情况下，一些工作需要充分利用LLM产品的优势，就需要将自己的一些资料提供给这些公司的LLM产品，而这些资料往往是大家不愿意也不能提供的。Deepseek发布并开源以后，以极低的部署成本和优秀的推理性能，获得了普罗大众的追捧。一台H20 AI服务器就能部署deepseek R1满血版，获得与chatGPT o1相当的性能。即使一台普通的笔记本电脑，也能部署相应的Deepseek版本。今天，我们就尝试在一台macbook上搭建一个使用本地deepseek的专属自己的知识库。

### 1 安装ollama

`ollama`是一个开源且被广泛使用的管理、部署和运行大语言模型的工具，与ollama功能类似且比较流行的工具还有`vLLM`。网络上有人对它们做的比较如下：

| 对比维度  | Ollama                                        | vLLM                                |
| :---- | :-------------------------------------------- | :---------------------------------- |
| 核心定位  | 轻量级本地大模型运行工具（适合个人开发/实验）                       | 生产级大模型推理框架（适合企业/高并发场景）              |
| 部署难度  | 简单：一键安装，支持 Mac/Linux/Windows（WSL）             | 较复杂：依赖 Python 环境，需手动配置 GPU 驱动和 CUDA |
| 硬件要求  | 低：CPU 可用（推荐 16GB+ 内存），可选 GPU 加速               | 高：必须 NVIDIA GPU（显存越大越好），依赖 CUDA 计算  |
| 模型支持  | 内置主流开源模型（Llama2、Mistral、DeepSeek 等），自动下载预训练模型 | 支持 HuggingFace 格式模型，需手动下载和转换模型文件    |
| 运行性能  | 中等：适合单次问答、小规模交互                               | 极高：优化了显存管理和批处理，支持千级别并发请求            |
| 使用场景  | 个人学习、本地测试、快速原型开发                              | 企业级 API 服务、高并发推理、云端部署               |
| 交互方式  | 命令行直接对话，支持类似 ChatGPT 的交互界面                    | 需通过 API 调用（OpenAI 兼容接口），无内置对话界面     |
| 资源占用  | 灵活：可调整 CPU/内存占用，适合低配电脑                        | 固定：显存占用量大，需预留资源应对峰值负载               |
| 扩展性   | 有限：专注于单机本地化运行                                 | 强：支持分布式部署、动态批处理、多 GPU 并行            |
| 新手友好度 | 极高：开箱即用，无需代码基础                                | 中等：需了解 Python 和 API 开发基础            |
| 社区支持  | 活跃的开发者社区，文档清晰                                 | 学术团队维护，更新频繁但偏向技术文档                  |
| 典型用途  | 写代码、翻译、文案生成等个人任务                              | 构建智能客服、批量文档处理、AI 赋能业务系统             |

我们去 [ollama官网下载页](https://ollama.com/download) 即能下载ollama。
![ollama-download](/images/ai/ollama-download.png)

下载安装后，我们可以打开ollama，继续安装 ollama命令，这样就能在shell终端工具中使用ollama了。
![ollama-install](/images/ai/ollama-install.png)
最后点击`Finish`，完成ollam命令的安装和启动
![ollama-install-finish](/images/ai/ollama-install-finish.png)
我们先看看ollama命令提供的功能

```bash
% ollama -h
Large language model runner

Usage:
  ollama [flags]
  ollama [command]

Available Commands:
  serve       Start ollama
  create      Create a model from a Modelfile
  show        Show information for a model
  run         Run a model
  stop        Stop a running model
  pull        Pull a model from a registry
  push        Push a model to a registry
  list        List models
  ps          List running models
  cp          Copy a model
  rm          Remove a model
  help        Help about any command

Flags:
  -h, --help      help for ollama
  -v, --version   Show version information

Use "ollama [command] --help" for more information about a command.

% ollama -v
ollama version is 0.6.0
```

### 2 下载并运行deepseek-r1

在 [ollama官网模型页面](https://ollama.com/search) 我们可以看到ollama支持的所有LLM模型，进入 [deepseek-r1页面](https://ollama.com/library/deepseek-r1) 可以查看deepseek-r1的详细信息。deepseek-r1有参数规模不同的多个版本，随着参数规模的增长，模型性能也随着增长，对部署机器的要求也更高。

不同版本的性能对比如下：
![deepseek-evalue](/images/ai/deepseek-evalue.png)

不同版本对硬件的要求如下：

| 模型名称                      | 模型大小  | CPU                 | 内存     | 存储空间  | 显卡要求                                         | 适用场景                  |
| ------------------------- | ----- | ------------------- | ------ | ----- | -------------------------------------------- | --------------------- |
| **DeepSeek-R1-Qwen-1.5B** | 1.1GB | 4 核 (Intel/AMD)     | 8GB+   | ≥3GB  | 纯 CPU 可行；GPU ≥4GB（GTX 1650）                  | 低资源设备、实时文本生成、嵌入式或物联网  |
| **DeepSeek-R1-Qwen-7B**   | 4.7GB | 8 核                 | 16GB+  | ≥8GB  | GPU ≥8GB（RTX 3060, RTX 3070）                 | 本地开发、测试、中等复杂度 NLP 任务  |
| **DeepSeek-R1-Llama-8B**  | 4.9GB | 8 核                 | 16GB+  | 4-6GB | GPU ≥8GB（RTX 3060 Ti, RTX 3070）              | 低资源占用，适用于响应速度要求较高的任务  |
| **DeepSeek-R1-Qwen-14B**  | 9.0GB | 12 核                | 32GB+  | ≥15GB | GPU ≥16GB（RTX 3080, RTX 4090）                | 企业级任务，长文本理解、报告生成、代码推理 |
| **DeepSeek-R1-Qwen-32B**  | 20GB  | 16 核 (Ryzen 9 / i9) | 64GB+  | ≥30GB | GPU ≥24GB（RTX 3090, A100, 多卡并行）              | 高精度任务，如医疗、法律咨询、多模态任务  |
| **DeepSeek-R1-Llama-70B** | 43GB  | 32 核 (多路 Xeon/EPYC) | 128GB+ | ≥70GB | 2×A100 80GB 或 4×RTX 4090，需 NVLink/InfiniBand | 高复杂度任务，如金融预测、大规模数据分析  |
| **DeepSeek-R1-671B**      | 404GB | 32 核 (多路 Xeon/EPYC) | 512GB+ | ≥2TB  | 4×A100 80GB，需 NVLink/InfiniBand              | 高复杂度任务，如金融预测、大规模数据分析  |

由于本人的macbook是`8核16G`的，所以选择`deepseek-r1-8B`的版本。

用一个命令即可安装deepseek

```bash
% ollama pull deepseek-r1:8B
pulling manifest
pulling 6340dc3229b0... 100%  4.9 GB
pulling 369ca498f347... 100%   387 B
pulling 6e4c38e1172f... 100%  1.1 KB
pulling f4d24e9138dd... 100%   148 B
pulling 0cb05c6e4e02... 100%   487 B
verifying sha256 digest
writing manifest
success

# 查看已安装的模型
% ollama list
NAME              ID              SIZE      MODIFIED
deepseek-r1:8B    28f8fd6cdc67    4.9 GB    About an hour ago

# 查看模型的信息
% ollama show deepseek-r1:8B
  Model
    architecture        llama
    parameters          8.0B
    context length      131072
    embedding length    4096
    quantization        Q4_K_M
```

deepseek模型的下载时间可能比较长，静心等待。断开了也不要紧，ollama支持下载断点续传。你如果觉得下载实在太慢了，也可以主动停止下载，重新连接进行下载。

然后就可以通过`ollama run`命令启动并使用deepseek了（其实也可以不用执行前面的`ollama pull`命令，执行`ollama run`时，ollama如果发现模型本地还不存在，也会先下载模型，然后启动模型）

```bash
% ollama run deepseek-r1:8B
>>> /?
Available Commands:
  /set            Set session variables
  /show           Show model information
  /load <model>   Load a session or model
  /save <model>   Save your current session
  /clear          Clear session context
  /bye            Exit
  /?, /help       Help for a command
  /? shortcuts    Help for keyboard shortcuts

Use """ to begin a multi-line message.

>>> /show info
  Model
    architecture        llama
    parameters          8.0B
    context length      131072
    embedding length    4096
    quantization        Q4_K_M

# 查看正在运行的模型
% ollama ps
NAME              ID              SIZE      PROCESSOR    UNTIL
deepseek-r1:8B    28f8fd6cdc67    7.0 GB    100% GPU     17 seconds from now
```

问它几个问题：

````bash
>>> 请讲一个笑话
<think>
好的，用户让我讲一个笑话。首先，我得想一下有什么经典的或者容易理解的笑话可以适合不同的年龄层。

考虑到笑话可能有不同类型，比如数学、动物、日常生活等方面。我觉得生活中的趣事通常比较容易引起共鸣，所以或许可以从这个角度入手。

比如说，学生和老师之间的互动，这样既贴近生活，又不失幽默。再加上一些反转或者意想不到的结局，笑话才会更有趣。

另外，要注意语言简单明了，不要太复杂，让听众都能轻松理解和笑出来。

嗯，或许可以编一个学生因为数学不好而被老师点批的故事，然后用机智的话回应，这样既有情节又有出乎意料的部分。

好的，准备好了，就从这个角度来构思吧。
</think>

当然可以！以下是一个经典的笑话：

有一天，一位小学生在数学课上发挥失常，老师问他2+3是多少，他回答说：“4个点。”
老师有些困惑，问他为什么会说“4个点”，他解释道：“因为2加3等于5，然后我记错了，只能想到了4个点。”
老师听完，忍不住笑出声来。
这时，小学生不好意思地补充道：“不过，其实2+3=5，我只是把5误说成了4个点，因为4更容易让人数数对不对嘛！”
全班同学都笑作一团。

>>> 请使用python语言实现在字符串中查找是否存在deepseek子串的功能
<think>
嗯，我现在想用Python来实现一个在字符串中检查是否存在“deepseek”这个子串的功能。首先，我应该怎么做呢？我记得Python里有字符串处理的方法，比如说in关键字。这可能就是直接的解决办法。

那我是不是只需要把目标字符串和“deepseek”放在一起用in来判断就可以了？比如，字符串s = "deepseek"，然后if "deepseek" in s: print("存在")。这样应该没问题吧。那如果字符串比较长的话，这样做效率会不会有问题呢？不过对于大多数情况来说，这样的方法应该足够用了。

另外，我是不是还可以反过来考虑，如果我要查找的是一个特定的子串，比如说在更大的文本中寻找“deepseek”，这个方法也一样适用。比如，s = "深度求索"，然后检查“深度”和“求索”是否存在于其中。这时候，我需要确保字符串是统一编码的，不会有问题。

再想想，有没有其他方法呢？比如说使用正则表达式，这可能更适合复杂的情况。比如，用re模块来查找，这样可以对子串的位置进行更多的控制，比如忽略大小写或者多个位置。但对于简单的检查，in关键字已经足够了，而且效率也高。

那如果我需要更高效地处理呢？在Python中，字符串有内置的方法，可以直接检查是否包含特定的子串。所以，还是用in比较合适。另外，如果要考虑性能问题，比如非常长的字符串，那么可能需要优化，但这种情况下，通常已经超出了普通应用的需求范围。

总结一下，我应该使用“deepseek”这个字符串作为目标，然后使用in关键字来检查是否存在于原字符串中。这样代码简单且直接。比如：

s = "这是一个测试字符串，包含深度求索吗？"
if 'deepseek' in s:
    print("是的，包含了deepseek子串。")
else:
    print("没有找到deepseek子串。")

这样就能实现需求了。
</think>

为了检查字符串中是否存在“deepseek”这个子串，可以使用Python的内置 `in` 关键字，该方法简单且高效。

**步骤如下：**

1. **定义目标字符串**：创建一个包含待查找子串的原始字符串。
2. **使用 `in` 关键字进行检查**：将“deepseek”与目标字符串结合使用 `in` 关键字，判断是否存在。
3. **输出结果**：根据布尔值输出相应的信息。

以下是实现代码：

```python
s = "这是一个测试字符串，包含深度求索吗？"
if 'deepseek' in s:
    print("是的，包含了deepseek子串。")
else:
    print("没有找到deepseek子串。")
```

**解释：**

- `s = "这是一个测试字符串，包含深度求索吗？"`：定义了一段文本。
- `if 'deepseek' in s`：检查“deepseek”是否存在于字符串 `s` 中。
  - 如果是，执行打印含有“是的，包含了deepseek子串。”的信息。
  - 否则，打印“没有找到deepseek子串。”。

这个方法简单直观，适用于大多数情况，并且效率高。

>>> 请问9.11与9.8比哪个比较大？
<think>
今天我在做一个数学题目，问题是要比较两个数字：9.11和9.8。我对浮点数的比较有些困惑，因为它们的小数位数不同，所以需要仔细思考一下怎么正确地进行比较。

首先，我回忆起，在比较两个浮点数的时候，可以把它们转换成相同的小数位数，或者直接用计算器来计算它们的值。不过，这里我想试着自己理解这个过程。

9.11 是九又十一分之一，而 9.8 是九又八分之一。显然，从小数部分来看，0.11 小于 0.8，所以 9.11 应该比 9.8 小。但是，这只是我的直觉，我需要用更严谨的方法来验证这一点。

首先，我可以把两个数字都转换成分数的形式。这样可以避免小数运算带来的误差。

对于 9.11，可以写成：
\[ 9.11 = 9 + \frac{11}{100} = 9 + \frac{11}{100} = \frac{911}{100} \]

对于 9.8，可以写成：
\[ 9.8 = 9 + \frac{8}{10} = 9 + \frac{40}{50} = \frac{98}{10} \]
或者
\[ 9.8 = \frac{98}{10} = \frac{490}{100} \]

现在，我需要比较这两个分数的大小。由于它们的分母不同，最好是找到相同的分母来进行比较。

对于 \(\frac{911}{100}\) 和 \(\frac{490}{100}\)，显然，490 小于 911，所以：
\[ \frac{490}{100} < \frac{911}{100} \]
这意味着：
\[ 9.8 < 9.11 \]

但是，这看起来有些奇怪，因为通常我们会认为 9.8 更大。然而，这里的结果显示 9.11 实际上更大。这让我感到困惑，可能哪里出了问题。

为了进一步确认，我可以把这两个数都转换成百分比来比较：
\[ 9.11 \times 100 = 911\% \]
\[ 9.8 \times 100 = 980\% \]

现在，明显地看出，980 小于 911 是不可能的，这说明我的计算有误。

回到分数转换部分，让我重新检查一下：
对于 9.11：
\[ 9.11 = 9 + \frac{11}{100} = \frac{900}{100} + \frac{11}{100} = \frac{911}{100} \]
这是正确的。

对于 9.8：
\[ 9.8 = 9 + \frac{8}{10} = \frac{90}{10} + \frac{8}{10} = \frac{98}{10} \]
为了让分母与前面的相同，转换为100：
\[ \frac{98}{10} = \frac{980}{100} \]

现在，比较：
\[ \frac{911}{100} < \frac{980}{100} \]
这意味着：
\[ 9.11 < 9.8 \]

哦，我之前犯了一个错误，把9.8转换成的分数写错了。我正确地将其转换为980/100，而不是490/100。因此，9.11确实小于9.8。

为了进一步验证，我可以使用计算器来确认：
\[ 9.11 < 9.8 \]
计算结果也是如此，所以我的结论是正确的。

总结一下，当比较两个浮点数时，把它们转换成相同的小数位数或者分数形式，可以帮助更准确地进行比较。直接从小数部分看，0.11 小于 0.8，因此 9.11 小于 9.8。
</think>

**答案：**

9.11 比 9.8 更小，即：

\[ 9.11 < 9.8 \]
````

可见deepseek不仅会输出答案，还会在`<think></think>`块中输出自己思考的过程，看了它比较9.11和9.8大小问题的思考过程，真是让人不禁莞尔一笑啊！

我们不仅可以通过命令行的方式与deepseek交互，上面的所有功能都可以通过ollama的`REST API`接口进行访问，ollama默认监听`11434`端口

```bash
% curl http://localhost:11434
Ollama is running

% curl http://localhost:11434/api/generate -d '{
  "model": "deepseek-r1:8B",
  "prompt": "为什么草是绿的？",
  "stream": false
}'

{"model":"deepseek-r1:8B","created_at":"2025-03-16T08:23:42.383254Z","response":"\u003cthink\u003e\n嗯，为什么草是绿色的呢？这个问题听起来简单，但其实背后可能有很多科学原理在起作用。首先，我应该考虑草的颜色与它叶片的结构和成分有关。草的叶子表面有一层叫做叶肉细胞，这些细胞含有色素，也就是叶绿体中的色素，比如叶绿素和类胡萝卜素。\n\n这些色素吸收光能，尤其是红光和蓝紫光，这些被吸收的光能会转化为化学能。随后，这些能量会转化成热能和有机物，如葡萄糖，这是通过光合作用实现的。叶片中的叶绿体不仅制造能量，还负责将二氧化碳转化为氧气，作为呼吸作用的一部分。\n\n另外，草的颜色可能还与其生长环境有关。在直接阳光下，叶片会反射大部分红光和蓝紫光，而对中波段的绿光进行较高的反射，这样看起来更绿。植物体内的结构，如茎秆和叶片，也有助于不同的颜色分布，因为它们可能在吸收或反射不同的光谱。\n\n此外，草作为一种经过长期进化的物种，其颜色不仅是为了进行光合作用，还与其生存环境中的竞争、掩护等因素有关。绿色可以帮助草更好地隐藏自己，以避免被捕食者发现，或者在竞争资源时占据优势。\n\n总结一下，草呈现绿色主要是由于叶片中的叶绿体含有色素，这些色素能够吸收和反射特定波长的光，从而实现光合作用，同时通过颜色与环境适应。当然，我可能忽略了一些细节，比如不同种类的草是否都有相同的颜色原因，或者是否存在其他因素影响草的颜色。\n\u003c/think\u003e\n\n草呈现绿色主要由于其叶片中的叶绿体含有色素，这些色素能够反射和吸收特定波长的光，用于光合作用，同时为植物提供能量和氧气。这种颜色不仅帮助草在自然环境中更好地进行光合作用，还有助于它们隐藏自己，从而在竞争资源或躲避捕食者的过程中获得优势。","done":true,"done_reason":"stop","context":[],"total_duration":36338067708,"load_duration":998924000,"prompt_eval_count":9,"prompt_eval_duration":4658000000,"eval_count":531,"eval_duration":30678000000}
```

也可以将上一轮的回答放入下一轮问题中，进行多轮会话

```bash
% curl http://localhost:11434/api/chat -d '{
  "model": "deepseek-r1:8B",
  "messages": [
    {
      "role": "user",
      "content": "为什么草是绿色的？"
    },
    {
      "role": "assistant",
      "content": "草呈现绿色主要由于其叶片中的叶绿体含有色素，这些色素能够反射和吸收特定波长的光，用于光合作用，同时为植物提供能量和氧气。这种颜色不仅帮助草在自然环境中更好地进行光合作用，还有助于它们隐藏自己，从而在竞争资源或躲避捕食者的过程中获得优势。"
    },
    {
      "role": "user",
      "content": "为什么叶绿素让草看起来是绿色的？"
    }
  ],
  "stream": false
}'
```

更详细的API接口可以参考：[ollama rest api](https://www.postman.com/postman-student-programs/ollama-api/collection/suc47x8/ollama-rest-api)

### 3 通过AI客户端使用deepseek

上面通过命令行和裸API使用deepseek的方式太麻烦了，我们可以使用AI客户端。当前这个领域正处于蓬勃发展中，不断有新的产品涌现出来，比如page assist、、RAGFlow、FastGPT、Dify.ai、AnythingLLM、cherry studio、chatbox、MaxKB、Open WebUI等等。由于只是在macbook上体验一下，为了简单方便，我这里使用page assist。

page assist是一个chrome插件，所以直接从chrome应用商店添加即可。
![page-assist-install](/images/ai/page-assist-install.png)
添加后，打开page assist插件，根据自己的需要进行一些配置：

点击右上侧的`配置`图标
![ollama-assist-config](/images/ai/ollama-assist-config.jpg)
配置语言和搜索引擎
![ollama-assist-config-base](/images/ai/ollama-assist-config-base.jpg)
![ollama-assist-config-search](/images/ai/ollama-assist-config-search.jpg)
RAG的文本输入模型选择deepseek-r1:8B
![ollama-assist-config-rag](/images/ai/ollama-assist-config-rag.jpg)
配置ollama的API地址
![ollama-assist-config-ollama](/images/ai/ollama-assist-config-ollama.jpg)
然后就可以对话了。
![page-assist-example](/images/ai/page-assist-example.png)

也可以添加本地文档，维护一个本地知识库，然后就可以通过deepseek使用本地知识库。 添加本地文档
![ollama-assist-config-knowledge](/images/ai/ollama-assist-config-knowledge.jpg)

然后就可以对自己的本地文档进行提问了：
![ollama-assist-use](/images/ai/ollama-assist-use.jpg)
