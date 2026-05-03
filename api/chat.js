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
  if (!payload?.question) {
    response.status(400).json({ error: "Missing question" });
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
            "You are a cautious personal health assistant. Use the supplied context plan, profile, goals, settings, selected logs, and Oura sleep/readiness/activity summaries. The app sends only the dates and categories likely needed for the user's question; if the context plan is too narrow, say what broader range or category would help. For sleep logs, supplements are pre-bed inputs taken on the sleepNight before the sleep being rated the following morning. Do not diagnose, prescribe, or override medical advice. Be concrete, explain uncertainty, and ask for missing data when needed.",
        },
        {
          role: "user",
          content: JSON.stringify({
            question: payload.question,
            date: payload.date,
            contextPlan: payload.contextPlan,
            profile: payload.profile,
            settings: payload.settings,
            recentEntries: payload.recentEntries,
            oura: payload.oura,
            supplementContext: payload.supplementContext,
            chatHistory: payload.chatHistory,
          }),
        },
      ],
    }),
  });

  const data = await result.json();
  if (!result.ok) {
    response.status(result.status).json({ error: data.error?.message || "OpenAI request failed" });
    return;
  }

  response.status(200).json({ answer: outputText(data) });
}

function outputText(data) {
  return data.output_text || data.output?.flatMap((item) => item.content || []).find((item) => item.type === "output_text")?.text || "";
}

async function readBody(request) {
  if (typeof request.body === "object" && request.body !== null) return request.body;
  return JSON.parse(request.body || "{}");
}
