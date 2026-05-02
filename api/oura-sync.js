export default async function handler(request, response) {
  if (request.method !== "GET") {
    response.status(405).json({ error: "Method not allowed" });
    return;
  }

  const token = process.env.OURA_PERSONAL_ACCESS_TOKEN;
  if (!token) {
    response.status(503).json({ error: "OURA_PERSONAL_ACCESS_TOKEN is not configured" });
    return;
  }

  const days = clampDays(request.query?.days);
  const endDate = new Date();
  const startDate = new Date();
  startDate.setDate(endDate.getDate() - days + 1);
  const params = new URLSearchParams({
    start_date: toDate(startDate),
    end_date: toDate(endDate),
  });

  try {
    const [dailySleep, dailyReadiness, dailyActivity] = await Promise.all([
      fetchOura(`/v2/usercollection/daily_sleep?${params}`, token),
      fetchOura(`/v2/usercollection/daily_readiness?${params}`, token),
      fetchOura(`/v2/usercollection/daily_activity?${params}`, token),
    ]);

    response.status(200).json({
      startDate: toDate(startDate),
      endDate: toDate(endDate),
      records: normalizeRecords({
        dailySleep: dailySleep.data || [],
        dailyReadiness: dailyReadiness.data || [],
        dailyActivity: dailyActivity.data || [],
      }),
    });
  } catch (error) {
    response.status(error.status || 502).json({ error: error.message || "Oura request failed" });
  }
}

async function fetchOura(path, token) {
  const result = await fetch(`https://api.ouraring.com${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = await result.json().catch(() => ({}));
  if (!result.ok) {
    const message = data.detail || data.message || data.error || `Oura returned ${result.status}`;
    const error = new Error(message);
    error.status = result.status;
    throw error;
  }
  return data;
}

function normalizeRecords(groups) {
  const byDate = new Map();
  Object.entries(groups).forEach(([key, records]) => {
    records.forEach((record) => {
      const date = record.day || record.date;
      if (!date) return;
      const existing = byDate.get(date) || { date };
      existing[key] = record;
      byDate.set(date, existing);
    });
  });
  return Array.from(byDate.values()).sort((a, b) => a.date.localeCompare(b.date));
}

function clampDays(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 14;
  return Math.min(Math.max(Math.round(parsed), 1), 90);
}

function toDate(date) {
  const local = new Date(date);
  local.setMinutes(local.getMinutes() - local.getTimezoneOffset());
  return local.toISOString().slice(0, 10);
}
