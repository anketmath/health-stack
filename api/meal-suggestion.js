export default async function handler(request, response) {
  if (request.method !== "POST") {
    response.status(405).json({ error: "Method not allowed" });
    return;
  }

  if (!process.env.OPENAI_API_KEY) {
    response.status(503).json({ error: "OPENAI_API_KEY is not configured" });
    return;
  }

  const payload = await readBody(request);
  if (!payload?.latestMeal || !payload?.today) {
    response.status(400).json({ error: "Missing meal context" });
    return;
  }

  const result = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL || "gpt-4.1-mini",
      input: [
        {
          role: "system",
          content:
            "You are a practical nutrition planning assistant. Use only supplied profile and logs. Suggest meal timing and rough macros, not diagnosis or medical treatment. If profile data is missing, say the guidance is rough. Return only valid JSON.",
        },
        {
          role: "user",
          content: JSON.stringify({
            profile: payload.profile,
            latestMeal: payload.latestMeal,
            today: payload.today,
            requestedOutput: {
              nextMealTiming: "short timing suggestion",
              macros: "rough protein/carbs/fats grams",
              reasoning: "brief explanation tied to today's meals/exercise/goals",
              confidence: "number 0-1",
            },
          }),
        },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "meal_suggestion",
          schema: {
            type: "object",
            additionalProperties: false,
            properties: {
              nextMealTiming: { type: "string" },
              macros: { type: "string" },
              reasoning: { type: "string" },
              confidence: { type: "number" },
            },
            required: ["nextMealTiming", "macros", "reasoning", "confidence"],
          },
          strict: true,
        },
      },
    }),
  });

  const data = await result.json();
  if (!result.ok) {
    response.status(result.status).json({ error: data.error?.message || "OpenAI request failed" });
    return;
  }

  response.status(200).json({ suggestion: parseJsonOutput(data) });
}

function parseJsonOutput(data) {
  const text = data.output_text || data.output?.flatMap((item) => item.content || []).find((item) => item.type === "output_text")?.text;
  return JSON.parse(text || "{}");
}

async function readBody(request) {
  if (typeof request.body === "object" && request.body !== null) return request.body;
  return JSON.parse(request.body || "{}");
}
