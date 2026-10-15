import { createServerFn } from "@tanstack/react-start";

const MAX_CONTEXT = 12000;
const MAX_QUESTION = 800;

type Doc = { name: string; body: string };

export const askNotes = createServerFn({ method: "POST" })
  .validator((input: { question: string; docs: Doc[] }) => {
    const question = String(input?.question ?? "").trim().slice(0, MAX_QUESTION);
    const docs = Array.isArray(input?.docs) ? input.docs.slice(0, 20) : [];
    return {
      question,
      docs: docs.map((d) => ({
        name: String(d?.name ?? "未命名").slice(0, 80),
        body: String(d?.body ?? "").slice(0, 8000),
      })),
    };
  })
  .handler(async ({ data }) => {
    if (!data.question) return { ok: false as const, error: "请先输入问题。" };
    if (data.docs.length === 0) return { ok: false as const, error: "没有可检索的笔记。" };

    const apiKey = process.env.XAI_API_KEY;
    if (!apiKey) {
      return { ok: false as const, error: "当前环境还不能调用模型。" };
    }

    let budget = MAX_CONTEXT;
    const blocks: string[] = [];
    for (const doc of data.docs) {
      if (budget <= 0) break;
      const chunk = doc.body.slice(0, budget);
      budget -= chunk.length;
      blocks.push(`【文件：${doc.name}】\n${chunk}`);
    }

    const res = await fetch("https://api.x.ai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "grok-4.5",
        temperature: 0.2,
        max_tokens: 700,
        messages: [
          {
            role: "system",
            content:
              "你是小说整理助手。只根据提供的正文回顾情节、人物和细节。用中文，点明篇名和文件名。正文里没有的情节要明确说还没写到，不要编造，也不要自作主张编章号。回答简洁。",
          },
          {
            role: "user",
            content: `文件内容：\n\n${blocks.join("\n\n")}\n\n问题：${data.question}`,
          },
        ],
      }),
    });

    if (!res.ok) {
      return { ok: false as const, error: `模型请求失败（${res.status}）` };
    }

    const body = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const text = body.choices?.[0]?.message?.content?.trim() ?? "";
    if (!text) return { ok: false as const, error: "模型没有返回内容。" };
    return { ok: true as const, text };
  });
