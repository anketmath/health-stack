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
            "You calculate practical daily nutrition target ranges for a personal health dashboard. Use profile, goals, selected-day exercise, current nutrition, and Oura context if present. Return realistic calorie and protein ranges, not exact prescriptions. If profile data is missing, make a conservative estimate and state uncertainty. Return only valid JSON.",
        },
        {
          role: "user",
          content: JSON.stringify({
            date: payload.date,
            profile: payload.profile,
            exercise: payload.exercise,
            nutrition: payload.nutrition,
            oura: payload.oura,
            requestedOutput: {
              calories: { min: "number", max: "number" },
              protein: { min: "grams", max: "grams" },
              reasoning: "brief explanation tied to profile, goal, and exercise",
            },
          }),
        },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "diet_target",
          schema: {
            type: "object",
            additionalProperties: false,
            properties: {
              calories: {
                type: "object",
                additionalProperties: false,
                properties: {
                  min: { type: "number" },
                  max: { type: "number" },
                },
                required: ["min", "max"],
              },
              protein: {
                type: "object",
                additionalProperties: false,
                properties: {
                  min: { type: "number" },
                  max: { type: "number" },
                },
                required: ["min", "max"],
              },
              reasoning: { type: "string" },
            },
            required: ["calories", "protein", "reasoning"],
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

  response.status(200).json({ target: { source: "LLM target", ...parseJsonOutput(data) } });
}

function parseJsonOutput(data) {
  const text = data.output_text || data.output?.flatMap((item) => item.content || []).find((item) => item.type === "output_text")?.text;
  return JSON.parse(text || "{}");
}

async function readBody(request) {
  if (typeof request.body === "object" && request.body !== null) return request.body;
  return JSON.parse(request.body || "{}");
}
