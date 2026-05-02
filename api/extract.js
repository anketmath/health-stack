export default async function handler(request, response) {
  if (request.method !== "POST") {
    response.status(405).json({ error: "Method not allowed" });
    return;
  }

  if (!process.env.OPENAI_API_KEY) {
    response.status(503).json({ error: "OPENAI_API_KEY is not configured" });
    return;
  }

  const { entry } = await readBody(request);
  if (!entry?.type || !entry?.rawText) {
    response.status(400).json({ error: "Missing entry" });
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
          content: "Extract structured health log data. Return only valid JSON. Use null for unknown fields. Never provide medical advice.",
        },
        {
          role: "user",
          content: JSON.stringify({
            type: entry.type,
            date: entry.date,
            text: entry.rawText,
            requestedShape: {
              type: "exercise | meal | sleep | meditation | social",
              summary: "short summary",
              times: ["times mentioned"],
              durationMinutes: "number or null",
              intensity: "number 1-10 or null",
              foods: ["foods or ingredients"],
              supplements: ["pills or supplements"],
              sleepQuality: "number 1-10 or null",
              sleepNight: "date string or null",
              scoreEnteredOn: "date string or null",
              supplementTiming: "string or null",
              meditationMinutes: "number or null",
              socialAbstained: "boolean or null",
              socialDefinition: "string or null",
              confidence: "number 0-1",
            },
          }),
        },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "health_log_extraction",
          schema: {
            type: "object",
            additionalProperties: false,
            properties: {
              type: { type: "string" },
              summary: { type: "string" },
              times: { type: "array", items: { type: "string" } },
              durationMinutes: { type: ["number", "null"] },
              intensity: { type: ["number", "null"] },
              foods: { type: "array", items: { type: "string" } },
              supplements: { type: "array", items: { type: "string" } },
              sleepQuality: { type: ["number", "null"] },
              sleepNight: { type: ["string", "null"] },
              scoreEnteredOn: { type: ["string", "null"] },
              supplementTiming: { type: ["string", "null"] },
              meditationMinutes: { type: ["number", "null"] },
              socialAbstained: { type: ["boolean", "null"] },
              socialDefinition: { type: ["string", "null"] },
              confidence: { type: "number" },
            },
            required: ["type", "summary", "times", "durationMinutes", "intensity", "foods", "supplements", "sleepQuality", "sleepNight", "scoreEnteredOn", "supplementTiming", "meditationMinutes", "socialAbstained", "socialDefinition", "confidence"],
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

  response.status(200).json({ extraction: parseJsonOutput(data) });
}

function parseJsonOutput(data) {
  const text = data.output_text || data.output?.flatMap((item) => item.content || []).find((item) => item.type === "output_text")?.text;
  return JSON.parse(text || "{}");
}

async function readBody(request) {
  if (typeof request.body === "object" && request.body !== null) return request.body;
  return JSON.parse(request.body || "{}");
}
