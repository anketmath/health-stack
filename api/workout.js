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
            "You are a careful strength and conditioning coach. Generate practical home workouts using evidence-based hypertrophy/strength principles, recent training load, user goals, equipment, familiar exercises, and feedback. Avoid medical claims. Prefer safe progression: keep 1-3 reps in reserve, progress after stable performance, deload or bias upper body after long hikes or leg fatigue. Return only valid JSON.",
        },
        {
          role: "user",
          content: JSON.stringify(payload),
        },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "home_workout",
          schema: {
            type: "object",
            additionalProperties: false,
            properties: {
              title: { type: "string" },
              rationale: { type: "string" },
              exercises: {
                type: "array",
                items: {
                  type: "object",
                  additionalProperties: false,
                  properties: {
                    name: { type: "string" },
                    sets: { type: "number" },
                    reps: { type: "string" },
                    targetWeight: { type: "string" },
                    rest: { type: "string" },
                    notes: { type: "string" },
                  },
                  required: ["name", "sets", "reps", "targetWeight", "rest", "notes"],
                },
              },
              progression: { type: "string" },
            },
            required: ["title", "rationale", "exercises", "progression"],
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

  response.status(200).json({ workout: parseJsonOutput(data) });
}

function parseJsonOutput(data) {
  const text = data.output_text || data.output?.flatMap((item) => item.content || []).find((item) => item.type === "output_text")?.text;
  return JSON.parse(text || "{}");
}

async function readBody(request) {
  if (typeof request.body === "object" && request.body !== null) return request.body;
  return JSON.parse(request.body || "{}");
}
