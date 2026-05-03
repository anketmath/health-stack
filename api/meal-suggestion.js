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
            "You are a practical nutrition planning assistant. Estimate current-meal calories/protein/carbs/fat, day-so-far totals, and the next meal time/macros. Use only supplied profile, local time, prior nutrition, exercise, Oura readiness/activity context, goals, and logs. Make suggestions plausible for the user's day and goal, especially fat reduction or hypertrophy. If the latest meal is late evening or near bedtime, do not recommend another normal meal in 3-5 hours; prefer breakfast next or a small optional pre-bed snack only if hunger/recovery warrants it. If profile data is missing, say the guidance is rough. Return only valid JSON.",
        },
        {
          role: "user",
          content: JSON.stringify({
            profile: payload.profile,
            localTime: payload.localTime,
            timeContext: payload.timeContext,
            oura: payload.oura,
            latestMeal: payload.latestMeal,
            priorNutrition: payload.priorNutrition,
            today: payload.today,
            requestedOutput: {
              currentMeal: { calories: "number", protein: "grams", carbs: "grams", fat: "grams" },
              dayTotals: { calories: "number", protein: "grams", carbs: "grams", fat: "grams" },
              nextMeal: { time: "specific local time or breakfast tomorrow", calories: "number", protein: "grams", carbs: "grams", fat: "grams" },
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
              currentMeal: {
                type: "object",
                additionalProperties: false,
                properties: {
                  calories: { type: "number" },
                  protein: { type: "number" },
                  carbs: { type: "number" },
                  fat: { type: "number" },
                },
                required: ["calories", "protein", "carbs", "fat"],
              },
              dayTotals: {
                type: "object",
                additionalProperties: false,
                properties: {
                  calories: { type: "number" },
                  protein: { type: "number" },
                  carbs: { type: "number" },
                  fat: { type: "number" },
                },
                required: ["calories", "protein", "carbs", "fat"],
              },
              nextMeal: {
                type: "object",
                additionalProperties: false,
                properties: {
                  time: { type: "string" },
                  calories: { type: "number" },
                  protein: { type: "number" },
                  carbs: { type: "number" },
                  fat: { type: "number" },
                },
                required: ["time", "calories", "protein", "carbs", "fat"],
              },
              reasoning: { type: "string" },
              confidence: { type: "number" },
            },
            required: ["currentMeal", "dayTotals", "nextMeal", "reasoning", "confidence"],
          },
          strict: true,
        },
      },
    }),
  });

  const data = await result.json();
  if (!result.ok) {
    response.status(result.status).json({
      error: data.error?.message || "OpenAI request failed",
      code: data.error?.code || "",
      type: data.error?.type || "",
    });
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
