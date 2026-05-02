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
  const dateTimeParams = new URLSearchParams({
    start_datetime: `${toDate(startDate)}T00:00:00-08:00`,
    end_datetime: `${toDate(endDate)}T23:59:59-08:00`,
  });

  try {
    const collections = await Promise.all([
      fetchOuraCollection("dailySleep", `/v2/usercollection/daily_sleep?${params}`, token),
      fetchOuraCollection("sleep", `/v2/usercollection/sleep?${params}`, token),
      fetchOuraCollection("dailyReadiness", `/v2/usercollection/daily_readiness?${params}`, token),
      fetchOuraCollection("dailyActivity", `/v2/usercollection/daily_activity?${params}`, token),
      fetchOuraCollection("dailySpo2", `/v2/usercollection/daily_spo2?${params}`, token),
      fetchOuraCollection("dailyStress", `/v2/usercollection/daily_stress?${params}`, token),
      fetchOuraCollection("sleepTime", `/v2/usercollection/sleep_time?${params}`, token),
      fetchOuraCollection("vo2Max", `/v2/usercollection/vo2_max?${params}`, token),
      fetchOuraCollection("workout", `/v2/usercollection/workout?${params}`, token),
      fetchOuraCollection("sessions", `/v2/usercollection/sessions?${params}`, token),
      fetchOuraCollection("heartrate", `/v2/usercollection/heartrate?${dateTimeParams}`, token),
    ]);
    const personalInfo = await fetchOuraOptional(`/v2/usercollection/personal_info`, token);
    const groups = Object.fromEntries(collections.map((item) => [item.key, item.data]));

    response.status(200).json({
      startDate: toDate(startDate),
      endDate: toDate(endDate),
      personalInfo: personalInfo.data || null,
      unavailable: collections.filter((item) => item.error).map((item) => ({ key: item.key, error: item.error })),
      records: normalizeRecords(groups),
    });
  } catch (error) {
    response.status(error.status || 502).json({ error: error.message || "Oura request failed" });
  }
}

async function fetchOuraCollection(key, path, token) {
  const result = await fetchOuraOptional(path, token);
  return { key, data: result.data?.data || [], error: result.error || null };
}

async function fetchOuraOptional(path, token) {
  try {
    return { data: await fetchOura(path, token), error: null };
  } catch (error) {
    return { data: null, error: error.message || "Unavailable" };
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
      const date = recordDay(record);
      if (!date) return;
      const existing = byDate.get(date) || { date };
      if (key.startsWith("daily")) existing[key] = record;
      else {
        existing[key] ||= [];
        existing[key].push(record);
      }
      byDate.set(date, existing);
    });
  });
  return Array.from(byDate.values()).sort((a, b) => a.date.localeCompare(b.date));
}

function recordDay(record) {
  const value = record.day || record.date || record.start_date || record.start_datetime || record.timestamp || record.bedtime_start;
  return typeof value === "string" ? value.slice(0, 10) : "";
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
