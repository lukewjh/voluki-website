import type { APIRoute } from "astro";
import { getEnv } from "../../../lib/env";
import { getErrorMessage, readJsonBody } from "../../../lib/readJsonBody";

export const prerender = false;

const extractOutputText = (data: any) => {
  if (typeof data.output_text === "string") return data.output_text;
  if (typeof data.choices?.[0]?.message?.content === "string") {
    return data.choices[0].message.content;
  }

  return "";
};

export const POST: APIRoute = async ({ request, locals }) => {
  const apiKey = getEnv(locals, "DEEPSEEK_API_KEY") ?? getEnv(locals, "OPENAI_API_KEY");
  const model = getEnv(locals, "OPENAI_MODEL") ?? "deepseek-v4-pro";
  const apiBaseUrl = getEnv(locals, "AI_BASE_URL") ?? "https://api.deepseek.com";

  if (!apiKey) {
    return new Response(JSON.stringify({ error: "Missing DEEPSEEK_API_KEY" }), {
      status: 500,
      headers: { "Content-Type": "application/json" }
    });
  }

  let body;

  try {
    body = await readJsonBody(request);
  } catch (error) {
    return new Response(JSON.stringify({ error: getErrorMessage(error) }), {
      status: 400,
      headers: { "Content-Type": "application/json" }
    });
  }

  const { sentences } = body;

  if (!Array.isArray(sentences) || sentences.length === 0) {
    return new Response(JSON.stringify({ error: "Sentences are required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" }
    });
  }

  let response;

  try {
    response = await fetch(`${apiBaseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: "system",
            content:
              '你是一位资深雅思写作考官，同时也是一位擅长帮助中国学生提升英文表达的写作教练。你会收到多组句子，每组都包含【高质量参考原文】english_text、【对应的中文原意】chinese_text、【用户的英文翻译】user_text。你的任务是：第一步，先生成一版适合雅思 6.5–7.0 水平的自然英文表达。第二步，再将这版表达与用户原句进行深度对比分析，包括语法问题、地道表达差异、句子结构、词块收集、句型收集和多版本重写。请注意：1.【对应的中文原意】是判断用户想表达什么的主要依据。2.【用户的英文翻译】是分析和纠错的主要对象。3.【高质量参考原文】只作为表达参考，不要机械照抄；如果原文表达过于高级或与用户当前水平跨度太大，请优先生成更适合雅思 6.5–7.0 的表达。4.生成的 6.5–7.0 改写句应尽量保留用户原本想表达的意思，但要修正语法、搭配、用词、句式和中式直译问题。5.分析重点不是简单纠错，而是解释：为什么用户原句不够自然，以及更自然的英文是如何组织信息的。6.所有解释必须使用中文。7.输出必须是严格 JSON，不要添加任何 JSON 以外的解释文字。8.如果某一类内容没有明显问题，也不要留空，请用简短说明代替。9.JSON 中除了 grammar_markdown 字段外，不要出现 markdown、代码块或多余注释。grammar_markdown 必须是 Markdown 文本，用二级标题、列表、粗体和 fenced code block 展示语法错误分析；不要在 grammar_markdown 里写 HTML。请严格返回 JSON，格式为：{"analyses":[{"score":"6.0","level_rewrite":{"target_band":"6.5-7.0","sentence":"根据中文原意和用户翻译改写出的自然、准确、适合雅思写作 Task 2 的英文句子","comment":"说明这句话为什么比用户原句更自然，以及它为什么适合雅思 6.5-7.0 水平"},"overall_comment":"整体评价用户原句的主要问题。","grammar_markdown":"## 语法问题\\n\\n- **错误片段**：...\\n\\n```text\\n建议改法：...\\n```","grammar_errors":[{"error":"用户原句中的错误片段","reason":"解释为什么这里有语法问题","correction":"修改后的正确表达"}],"expression_comparison":[{"user_exp":"用户使用的表达","better_exp":"level_rewrite 中更自然的表达","original_exp":"高质量参考原文中的相关表达","nuance_difference":"解释三者之间的语感差异。"}],"logic_and_sentence_structure":{"user_structure":"概括用户原句的句子结构","better_structure":"概括 level_rewrite 的句子结构","analysis":"分析用户句子在逻辑连接、主谓结构、从句安排、信息顺序方面的问题"},"chunks":[{"english":"值得积累的英文词块","chinese":"对应中文意思","note":"说明这个词块适合在哪类雅思写作语境中使用"}],"sentence_patterns":[{"structure":"可复用句型结构","usage":"适用场景","example":"基于相似雅思话题造一个新例句"}],"rewrites":{"basic":"基础改法：只修正语法和明显错误，尽量保留用户原句结构","idiomatic":"地道改法：表达更自然，更符合英文母语者习惯，适合雅思 6.5-7.0","advanced":"学术升级：更正式、更凝练，适合冲刺 7.0+，但不要过度复杂"},"learning_focus":["总结用户这句话最应该掌握的学习重点1","总结用户这句话最应该掌握的学习重点2","总结用户这句话最应该掌握的学习重点3"]}]}。analyses 的顺序必须和用户输入数组一致。'
          },
          {
            role: "user",
            content: JSON.stringify(sentences)
          }
        ],
        response_format: { type: "json_object" },
        max_tokens: 6000,
        stream: false
      })
    });
  } catch (error) {
    return new Response(
      JSON.stringify({ error: `AI connection failed: ${getErrorMessage(error)}` }),
      {
        status: 502,
        headers: { "Content-Type": "application/json" }
      }
    );
  }

  const data = await response.json();

  if (!response.ok) {
    return new Response(
      JSON.stringify({ error: data.error?.message ?? "OpenAI request failed" }),
      {
        status: response.status,
        headers: { "Content-Type": "application/json" }
      }
    );
  }

  const outputText = extractOutputText(data);

  if (!outputText) {
    return new Response(JSON.stringify({ error: "OpenAI returned empty output" }), {
      status: 502,
      headers: { "Content-Type": "application/json" }
    });
  }

  const parsed = JSON.parse(outputText);
  const analyses = Array.isArray(parsed)
    ? parsed
    : Array.isArray(parsed.analyses)
      ? parsed.analyses
      : [parsed];

  return new Response(JSON.stringify({ analyses }), {
    headers: { "Content-Type": "application/json" }
  });
};
