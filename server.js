import express from 'express';
import { fal } from '@fal-ai/client';



const app = express();
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

const PORT = process.env.PORT || 3000;

// === 全局定义限制 ===
const PROMPT_LIMIT = 4800;
const SYSTEM_PROMPT_LIMIT = 4800;
// === 限制定义结束 ===


// 定义 fal-ai/any-llm 支持的模型列表
const FAL_SUPPORTED_MODELS = [
    "anthropic/claude-3.7-sonnet",
    "anthropic/claude-3.5-sonnet",
    "anthropic/claude-3-5-haiku",
    "anthropic/claude-3-haiku",
    "google/gemini-pro-1.5",
    "google/gemini-flash-1.5",
    "google/gemini-flash-1.5-8b",
    "google/gemini-2.0-flash-001",
    "meta-llama/llama-3.2-1b-instruct",
    "meta-llama/llama-3.2-3b-instruct",
    "meta-llama/llama-3.1-8b-instruct",
    "meta-llama/llama-3.1-70b-instruct",
    "openai/gpt-4o-mini",
    "openai/gpt-4o",
    "deepseek/deepseek-r1",
    "meta-llama/llama-4-maverick",
    "meta-llama/llama-4-scout"
];

// Helper function to get owner from model ID
const getOwner = (modelId) => {
    if (modelId && modelId.includes('/')) {
        return modelId.split('/')[0];
    }
    return 'fal-ai';
}

// GET /v1/models endpoint
app.get('/v1/models', (req, res) => {
    console.log("Received request for GET /v1/models");
    try {
        const modelsData = FAL_SUPPORTED_MODELS.map(modelId => ({
            id: modelId, object: "model", created: 1700000000, owned_by: getOwner(modelId)
        }));
        res.json({ object: "list", data: modelsData });
        console.log("Successfully returned model list.");
    } catch (error) {
        console.error("Error processing GET /v1/models:", error);
        res.status(500).json({ error: "Failed to retrieve model list." });
    }
});

 

 /**
 * 将 OpenAI 格式的消息转换为 Fal AI 格式的 prompt 和 system_prompt
 * 
 * 核心逻辑：倒序遍历 messages，至多取 3 条 user/assistant 消息放到 prompt 部分，
 * chat_history 最多包含 2 条消息（user + assistant），最后一个用户消息是最新提问，不属于对话历史
 * 
 * @param messages - OpenAI 格式的消息数组
 * @returns 包含 system_prompt、prompt 和可选错误信息的对象
 * 
 * @example
 * // 基本用法：系统消息 + 用户消息
 * const messages = [
 *   { role: 'system', content: 'You are a helpful assistant.' },
 *   { role: 'user', content: 'Hello, how are you?' }
 * ];
 * const result = convertMessagesToFalPrompt(messages);
 * // result.system_prompt: 'You are a helpful assistant.'
 * // result.prompt: 'Hello, how are you?'
 * 
 * @example
 * // 多轮对话：最后一条是用户消息
 * const messages = [
 *   { role: 'system', content: 'You are helpful.' },
 *   { role: 'user', content: 'What is AI?' },
 *   { role: 'assistant', content: 'AI is artificial intelligence.' },
 *   { role: 'user', content: 'Tell me more.' }
 * ];
 * const result = convertMessagesToFalPrompt(messages);
 * // result.system_prompt: 'You are helpful.\n<chat_history>'
 * // result.prompt: 'What is AI?\nAssistant: AI is artificial intelligence.\n</chat_history>\nTell me more.'
 * 
 * @example
 * // 多轮对话：最后一条不是用户消息
 * const messages = [
 *   { role: 'user', content: 'Hello' },
 *   { role: 'assistant', content: 'Hi there!' }
 * ];
 * const result = convertMessagesToFalPrompt(messages);
 * // result.system_prompt: '<chat_history>\nHuman: Hello\nAssistant: Hi there!\n</chat_history>'
 * // result.prompt: ''
 * 
 * @description
 * 实现逻辑：
 * 1. **系统消息处理**：只使用最后一个非空系统消息，如果超出 SYSTEM_PROMPT_LIMIT 则返回错误
 * 2. **消息过滤**：自动过滤空内容消息（null、undefined、空字符串或纯空格）
 * 3. **倒序遍历**：取最后 3 条消息，根据最后一条消息类型分两种情况：
 * 
 *    **情况 A - 最后一条是用户消息**：
 *    - 取倒数第 3、第 2 条作为 chat_history（最多 2 条：user + assistant）
 *    - system_prompt: `系统消息\n<chat_history>`
 *    - prompt: `<user message>\nAssistant: <assistant message>\n</chat_history>\n<最新用户消息>`
 * 
 *    **情况 B - 最后一条不是用户消息**：
 *    - 取最后 2 条消息作为 chat_history，放在 system_prompt 中
 *    - system_prompt: `系统消息\n<chat_history>\nHuman: <user message>\nAssistant: <assistant message>\n</chat_history>`
 *    - prompt: `""`（空字符串）
 * 
 * 4. **格式约定**：
 *    - prompt 中会自动拼接 Human 消息，所以 user 消息不需要 "Human:" 前缀
 *    - system_prompt 中的 user 消息需要 "Human:" 前缀
 *    - assistant 消息始终使用 "Assistant:" 前缀
 * 
 * @note
 * - 字符限制：系统消息长度不能超过 SYSTEM_PROMPT_LIMIT (4800) 字符
 * - 消息数量：最多处理最近的 3 条对话消息（倒数第 1、2、3 条）
 * - 历史限制：chat_history 最多包含 2 条消息，避免 prompt 过长
 * - 错误处理：系统消息超限时返回错误，其他情况尽力处理
 */
function convertMessagesToFalPrompt(messages) {
	// 第一步：过滤空内容消息，分离系统消息和对话消息
	const filtered_messages = [];
	let system_message_content = "";
	
	for (const message of messages) {
		const content = (message.content === null || message.content === undefined) ? "" : String(message.content).trim();
		if (content.length > 0) {
			if (message.role === 'system') {
				system_message_content = content; // 只保留最后一个非空系统消息
			} else {
				filtered_messages.push({
					...message,
					content: content
				});
			}
		}
	}
	
	// 检查系统消息长度限制
	if (system_message_content.length > SYSTEM_PROMPT_LIMIT) {
		system_message_content = system_message_content.substring(0,SYSTEM_PROMPT_LIMIT)
	}
	
	// 如果没有对话消息，直接返回
	if (filtered_messages.length === 0) {
		return {
			system_prompt: system_message_content,
			prompt: ""
		};
	}
	
	// 第二步：倒序遍历messages，至多取3条user/assistant消息放到prompt部分
	const prompt_messages = filtered_messages.slice(-3); // 取最后3条消息
	const remaining_messages = filtered_messages.slice(0, -3); // 剩余的消息
	
	// 第三步：构建prompt部分
	let prompt_parts = [];
	
	for (const message of prompt_messages) {
		if (message.role === 'user') {
			prompt_parts.push(String(message.content));
		} else if (message.role === 'assistant') {
			prompt_parts.push(`Assistant: ${String(message.content)}`);
		}
	}
	
	const final_prompt = prompt_parts.join('\n');
	
	// 第四步：构建system_prompt部分
	let system_prompt_parts = [];
	
	// 添加系统消息（如果存在）
	if (system_message_content.length > 0) {
		system_prompt_parts.push(system_message_content);
	}
	
	// 添加剩余的对话消息
	for (const message of remaining_messages) {
		if (message.role === 'user') {
			system_prompt_parts.push(`Human: ${String(message.content)}`);
		} else if (message.role === 'assistant') {
			system_prompt_parts.push(`Assistant: ${String(message.content)}`);
		}
	}
	
	let final_system_prompt = system_prompt_parts.join('\n');
	
	// 第五步：检查system_prompt字符限制并截断
	if (final_system_prompt.length > SYSTEM_PROMPT_LIMIT) {
		// 优先保留系统消息，然后从最新的对话开始截断
		const system_part = system_message_content;
		let remaining_space = SYSTEM_PROMPT_LIMIT - system_part.length - 1; // -1 for newline
		
		if (remaining_space <= 0) {
			final_system_prompt = system_part;
		} else {
			const conversation_parts = [];
			
			// 倒序添加剩余对话，确保不超过字符限制
			for (let i = remaining_messages.length - 1; i >= 0; i--) {
				const message = remaining_messages[i];
				let message_text = "";
				
				if (message.role === 'user') {
					message_text = `Human: ${String(message.content)}`;
				} else if (message.role === 'assistant') {
					message_text = `Assistant: ${String(message.content)}`;
				}
				
				if (message_text.length + 1 <= remaining_space) { // +1 for newline
					conversation_parts.unshift(message_text);
					remaining_space -= (message_text.length + 1);
				} else {
					break; // 无法添加更多消息
				}
			}
			
			if (system_part.length > 0 && conversation_parts.length > 0) {
				final_system_prompt = system_part + '\n' + conversation_parts.join('\n');
			} else if (system_part.length > 0) {
				final_system_prompt = system_part;
			} else {
				final_system_prompt = conversation_parts.join('\n');
			}
		}
	}
	
	return {
		system_prompt: final_system_prompt,
		prompt: final_prompt
	};
}

function convertMessagesToFalPrompt1(messages) {
	let system_message_content = "";
	let prompt ="";
	for (const message of messages) {
		const content = (message.content === null || message.content === undefined) ? "" : String(message.content).trim();
		if (content.length > 0) {
			if (message.role === 'system') {
				system_message_content = content; // 只保留最后一个非空系统消息
			} else if (message.role === 'user') {
			 	prompt = content;
			}
		}
	}

	return {
		system_prompt: system_message_content,
		prompt: prompt
	};
}
// POST /v1/chat/completions endpoint (保持不变)
app.post('/v1/chat/completions', async (req, res) => {

    let authKey = null;
    let authHeader = req.headers.authorization;
    if(!authHeader)
    {
        authHeader = req.headers["x-app-token"];
    }
    if (authHeader) {
        const parts = authHeader.split(' ');
        if (parts.length === 2) {
            const scheme = parts[0];
            const credentials = parts[1];

            if (scheme === 'Bearer') {
                authKey = credentials; // JWT 或其他 token
            } else if (scheme === 'Basic') {
                // Basic 认证解码
                const decoded = Buffer.from(credentials, 'base64').toString('utf8');
                const [username, password] = decoded.split(':');
                req.auth = { username, password };
                authKey = decoded; // 或者只保存 username
            } else if (scheme === 'ApiKey' || scheme === 'Key') {
                authKey = credentials;
            }
        }
    }

    fal.config({
        credentials: authKey,
    });

    const { model, messages, stream = false, reasoning = false, ...restOpenAIParams } = req.body;

    console.log(`Received chat completion request for model: ${model}, stream: ${stream}`);

    if (!FAL_SUPPORTED_MODELS.includes(model)) {
        console.warn(`Warning: Requested model '${model}' is not in the explicitly supported list.`);
    }
    if (!model || !messages || !Array.isArray(messages) || messages.length === 0) {
        console.error("Invalid request parameters:", { model, messages: Array.isArray(messages) ? messages.length : typeof messages });
        return res.status(400).json({ error: 'Missing or invalid parameters: model and messages array are required.' });
    }

    try {
        // *** 使用更新后的转换函数 ***
        const { prompt, system_prompt } = convertMessagesToFalPrompt1(messages);

        const falInput = {
            model: model,
            prompt: prompt,
            ...(system_prompt && { system_prompt: system_prompt }),
            reasoning: !!reasoning,
        };
        console.log("Fal Input:", JSON.stringify(falInput, null, 2));
        console.log("Forwarding request to fal-ai with system-priority + separator + recency input:");
        console.log("System Prompt Length:", system_prompt?.length || 0);
        console.log("Prompt Length:", prompt?.length || 0);
        // 调试时取消注释可以查看具体内容
        console.log("--- System Prompt Start ---");
        console.log(system_prompt);
        console.log("--- System Prompt End ---");
        console.log("--- Prompt Start ---");
        console.log(prompt);
        console.log("--- Prompt End ---");


        // --- 流式/非流式处理逻辑 (保持不变) ---
        if (stream) {
            // ... 流式代码 ...
            res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
            res.setHeader('Cache-Control', 'no-cache');
            res.setHeader('Connection', 'keep-alive');
            res.setHeader('Access-Control-Allow-Origin', '*');
            res.flushHeaders();

            let previousOutput = '';

            const falStream = await fal.stream("fal-ai/any-llm", { input: falInput });

            try {
                for await (const event of falStream) {
                    const currentOutput = (event && typeof event.output === 'string') ? event.output : '';
                    const isPartial = (event && typeof event.partial === 'boolean') ? event.partial : true;
                    const errorInfo = (event && event.error) ? event.error : null;

                    if (errorInfo) {
                        console.error("Error received in fal stream event:", errorInfo);
                        const errorChunk = { id: `chatcmpl-${Date.now()}-error`, object: "chat.completion.chunk", created: Math.floor(Date.now() / 1000), model: model, choices: [{ index: 0, delta: {}, finish_reason: "error", message: { role: 'assistant', content: `Fal Stream Error: ${JSON.stringify(errorInfo)}` } }] };
                        res.write(`data: ${JSON.stringify(errorChunk)}\n\n`);
                        break;
                    }

                    let deltaContent = '';
                    if (currentOutput.startsWith(previousOutput)) {
                        deltaContent = currentOutput.substring(previousOutput.length);
                    } else if (currentOutput.length > 0) {
                        console.warn("Fal stream output mismatch detected. Sending full current output as delta.", { previousLength: previousOutput.length, currentLength: currentOutput.length });
                        deltaContent = currentOutput;
                        previousOutput = '';
                    }
                    previousOutput = currentOutput;

                    if (deltaContent || !isPartial) {
                        const openAIChunk = { id: `chatcmpl-${Date.now()}`, object: "chat.completion.chunk", created: Math.floor(Date.now() / 1000), model: model, choices: [{ index: 0, delta: { content: deltaContent }, finish_reason: isPartial === false ? "stop" : null }] };
                        res.write(`data: ${JSON.stringify(openAIChunk)}\n\n`);
                    }
                }
                res.write(`data: [DONE]\n\n`);
                res.end();
                console.log("Stream finished.");

            } catch (streamError) {
                console.error('Error during fal stream processing loop:', streamError);
                try {
                    const errorDetails = (streamError instanceof Error) ? streamError.message : JSON.stringify(streamError);
                    res.write(`data: ${JSON.stringify({ error: { message: "Stream processing error", type: "proxy_error", details: errorDetails } })}\n\n`);
                    res.write(`data: [DONE]\n\n`);
                    res.end();
                } catch (finalError) {
                    console.error('Error sending stream error message to client:', finalError);
                    if (!res.writableEnded) { res.end(); }
                }
            }
        } else {
            // --- 非流式处理 (保持不变) ---
            console.log("Executing non-stream request...");
            const result = await fal.subscribe("fal-ai/any-llm", { input: falInput, logs: true });
            console.log("Received non-stream result from fal-ai:", JSON.stringify(result, null, 2));

            if (result && result.error) {
                console.error("Fal-ai returned an error in non-stream mode:", result.error);
                return res.status(500).json({ object: "error", message: `Fal-ai error: ${JSON.stringify(result.error)}`, type: "fal_ai_error", param: null, code: null });
            }

            const openAIResponse = {
                id: `chatcmpl-${result.requestId || Date.now()}`, object: "chat.completion", created: Math.floor(Date.now() / 1000), model: model,
                choices: [{ index: 0, message: { role: "assistant", content: result.output || "" }, finish_reason: "stop" }],
                usage: { prompt_tokens: null, completion_tokens: null, total_tokens: null }, system_fingerprint: null,
                ...(result.reasoning && { fal_reasoning: result.reasoning }),
            };
            res.json(openAIResponse);
            console.log("Returned non-stream response.");
        }

    } catch (error) {
        console.error('Unhandled error in /v1/chat/completions:', error);
        if (!res.headersSent) {
            const errorMessage = (error instanceof Error) ? error.message : JSON.stringify(error);
            res.status(500).json({ error: 'Internal Server Error in Proxy', details: errorMessage });
        } else if (!res.writableEnded) {
            console.error("Headers already sent, ending response.");
            res.end();
        }
    }
});

// 启动服务器 (更新启动信息)
app.listen(PORT, () => {
    console.log(`===================================================`);
    console.log(` Fal OpenAI Proxy Server (System Top + Separator + Recency)`); // 更新策略名称
    console.log(` Listening on port: ${PORT}`);
    console.log(` Using Limits: System Prompt=${SYSTEM_PROMPT_LIMIT}, Prompt=${PROMPT_LIMIT}`);
    console.log(` Chat Completions Endpoint: POST http://localhost:${PORT}/v1/chat/completions`);
    console.log(` Models Endpoint: GET http://localhost:${PORT}/v1/models`);
    console.log(`===================================================`);
});

// 根路径响应 (更新信息)
app.get('/', (req, res) => {
    res.send('Fal OpenAI Proxy (System Top + Separator + Recency Strategy) is running.');
});
