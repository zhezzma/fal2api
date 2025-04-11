## openai请求格式转fal
输入限制： System prompt 和 prompt 分别最长为 5000 字符（不是 token）。
输出长度： 测试了下输出长篇小说，出了 5W 多 token。
上下文： 不支持。

于是用 gemini 糊了个 openaiToFal 的服务，模拟上下文以 5000 字符为分界线，分别塞到 System prompt 和 prompt，这样可以把输入扩展到 1W 字符，太早的聊天记录会被顶掉。github 地址是一个 docker compose 包，把你的 key 填入 docker-compose.yml，一键启动 docker compose up -d 即可。默认端口 13000。

## 部署步骤
1、修改docker-compose.yml填入fal的api key
2、`docker compose up -d`启动

## 重要
我是搭配newapi管理使用，所以**没有鉴权**，有需要自己加。
