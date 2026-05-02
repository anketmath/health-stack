export default async function handler(request, response) {
  if (request.method !== "POST") {
    response.status(405).json({ error: "Method not allowed" });
    return;
  }

  if (!process.env.OPENAI_API_KEY) {
    response.status(503).json({ error: "OPENAI_API_KEY is not configured" });
    return;
  }

  const { entries, date, profile, supplementContext } = await readBody(request);
  if (!Array.isArray(entries)) {
    response.status(400).json({ error: "Missing entries" });
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
            "You are a cautious personal health insight assistant. Use only the supplied logs, including social media abstinence when present. For sleep logs, supplements are pre-bed inputs taken on the sleepNight before the sleep being rated the following morning. Separate observations from hypotheses. Avoid diagnosis, medication instructions, or claims stronger than the data supports. Return only valid JSON.",
        },
        {
          role: "user",
          content: JSON.stringify({
            date,
            range: "last 7 days",
            profile,
            supplementContext,
            entries,
            outputShape: [
              { title: "short title", detail: "specific useful insight or suggestion", tone: "green | blue | gold | rose" },
            ],
          }),
        },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "health_insights",
          schema: {
            type: "object",
            additionalProperties: false,
            properties: {
              insights: {
                type: "array",
                items: {
                  type: "object",
                  additionalProperties: false,
                  properties: {
                    title: { type: "string" },
                    detail: { type: "string" },
                    tone: { type: "string", enum: ["green", "blue", "gold", "rose"] },
                  },
                  required: ["title", "detail", "tone"],
                },
              },
            },
            required: ["insights"],
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

  const parsed = parseJsonOutput(data);
  response.status(200).json({ insights: Array.isArray(parsed) ? parsed : parsed.insights || parsed.recommendations || [] });
}

function parseJsonOutput(data) {
  const text = data.output_text || data.output?.flatMap((item) => item.content || []).find((item) => item.type === "output_text")?.text;
  return JSON.parse(text || "{}");
}

async function readBody(request) {
  if (typeof request.body === "object" && request.body !== null) return request.body;
  return JSON.parse(request.body || "{}");
}
