import type { APIRoute } from "astro";
import { getEnv } from "../../../lib/env";
import { getErrorMessage, readJsonBody } from "../../../lib/readJsonBody";

export const prerender = false;

const essayCategories = [
  { value: "Education", label: "教育" },
  { value: "Technology", label: "科技" },
  { value: "Work & Economy", label: "工作与经济" },
  { value: "Environment", label: "环境" },
  { value: "Government & Law", label: "政府与法律" },
  { value: "Family & Children", label: "家庭与儿童" },
  { value: "Social Issues", label: "社会问题" },
  { value: "Media & Advertising", label: "媒体与广告" },
  { value: "Culture & Tradition", label: "文化与传统" },
  { value: "Globalisation", label: "国际化与全球化" },
  { value: "Health & Lifestyle", label: "健康与生活方式" }
];

const findEssayCategory = (category: unknown) => {
  if (typeof category !== "string" || !category.trim()) return null;
  return essayCategories.find((item) => item.value === category.trim()) ?? null;
};

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

  let body: Record<string, unknown> = {};

  try {
    body = await readJsonBody(request);
  } catch (error) {
    const message = getErrorMessage(error);

    if (message !== "Request body is empty") {
      return new Response(JSON.stringify({ error: message }), {
        status: 400,
        headers: { "Content-Type": "application/json" }
      });
    }
  }

  const selectedCategory = findEssayCategory(body.category);

  if (typeof body.category === "string" && body.category.trim() && !selectedCategory) {
    return new Response(JSON.stringify({ error: "Invalid essay category" }), {
      status: 400,
      headers: { "Content-Type": "application/json" }
    });
  }

  const categoryInstruction = selectedCategory
    ? `请使用以下指定分类生成题目和范文：${selectedCategory.value}（${selectedCategory.label}）。不要再随机选择其他分类。`
    : "请从以下 11 个分类中随机选择一个分类（每个分类被选中的概率完全相同）：";

  const categoryRule = selectedCategory
    ? `1. category 必须为指定分类名称：${selectedCategory.value}。`
    : "1. category 必须为随机选中的分类名称。";

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
            content: `你是一位资深雅思写作考官（IELTS Examiner）和雅思写作教师。

${categoryInstruction}

1. Education（教育）
2. Technology（科技）
3. Work & Economy（工作与经济）
4. Environment（环境）
5. Government & Law（政府与法律）
6. Family & Children（家庭与儿童）
7. Social Issues（社会问题）
8. Media & Advertising（媒体与广告）
9. Culture & Tradition（文化与传统）
10. Globalisation（国际化与全球化）
11. Health & Lifestyle（健康与生活方式）

然后：

Step 1：
根据选中的分类，生成一道符合真实 IELTS Academic Writing Task 2 风格的题目。

Step 2：
针对该题目，撰写一篇 Band 7.5 水平的范文。

要求：

* 字数 280–330 词
* 使用标准四段结构（Introduction + Body 1 + Body 2 + Conclusion）
* 语言自然流畅，不刻意堆砌高级词汇
* 体现 Band 7.5 水平应有的：

  * 多样句型
  * 准确语法
  * 合理衔接
  * 清晰逻辑
* 论证充分但不过度学术化
* 风格接近剑桥雅思官方范文
* 不要解释写作思路
* 不要分析语言点
* 不要提供中文翻译

最终仅返回合法 JSON。

返回格式：

{
"category": "Technology",
"question": "Some people believe that...",
"essay": "完整范文内容..."
}

严格遵守以下规则：

${categoryRule}
2. question 必须为完整 IELTS Academic Writing Task 2 题目。
3. essay 必须为完整英文范文。
4. essay 必须为单行字符串，不允许出现换行符。
5. 四段内容之间使用两个空格进行分隔。
6. 不要返回 Markdown。
7. 不要返回代码块。
8. 不要返回额外解释文字。
9. 不要返回字段说明。
10. 不要返回思考过程。
11. 输出内容必须是可直接被 JSON.parse() 解析的合法 JSON。
12. JSON 中所有字符串必须符合标准 JSON 规范。
13. JSON 中不要出现未转义的双引号（"）。
14. 不允许输出 JSON 之外的任何字符。
15. category、question、essay 三个字段必须全部存在且不能为空。
16. essay 字段必须保持完整，不允许截断或省略。
17. 请确保 essay 为纯文本字符串，不包含 Markdown 标记。

请确保最终输出为单个、完整、合法的 JSON 对象，并且可以直接被前端程序解析，无需任何额外处理。`
          }
        ],
        response_format: { type: "json_object" },
        max_tokens: 3000,
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

  let parsed;

  try {
    parsed = JSON.parse(outputText);
  } catch (error) {
    console.error("Failed to parse generated IELTS essay JSON", {
      error: getErrorMessage(error),
      outputPreview: outputText.slice(0, 600)
    });

    return new Response(
      JSON.stringify({
        error: "AI 返回的范文内容不完整，暂时无法解析。请重新生成一次。"
      }),
      {
        status: 502,
        headers: { "Content-Type": "application/json" }
      }
    );
  }

  return new Response(
    JSON.stringify({
      category: parsed.category ?? "",
      question: parsed.question ?? "",
      essay: parsed.essay ?? ""
    }),
    {
      headers: { "Content-Type": "application/json" }
    }
  );
};
