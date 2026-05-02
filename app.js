const STORAGE_KEY = "health-signals-v2";
const LEGACY_KEY = "health-signals-v1";
const DEFAULT_SOCIAL_DEFINITION = "No X, YT, FB, IG, TikTok, News sites (1 YT podcast or 1 article OK)";

const initialState = {
  entries: [],
  chat: [],
  workoutDraft: null,
  oura: { lastSync: "", lastSyncAt: "", lastSyncAttemptAt: "", records: [] },
  settings: {
    socialDefinition: DEFAULT_SOCIAL_DEFINITION,
    reminders: { sleep: "08:00", midday: "13:00", dinner: "19:00", endOfDay: "21:30" },
    oura: { autoSync: true, intervalHours: 6, days: 14 },
  },
  profile: {
    age: "",
    sex: "",
    height: "",
    weight: "",
    bodyFat: "",
    activityLevel: "",
    goal: "",
    dietPreferences: "",
    sleepPillStack: "",
    homeEquipment: "",
    familiarExercises: "",
    profileNotes: "",
  },
  cloud: { supabaseUrl: "", supabaseAnonKey: "" },
};

let state = loadState();
let activeFilter = "all";
let selectedDashboardDate = today();
let supabaseClient = null;
let authUser = null;
let authSubscription = null;
let supabaseCacheKey = "";
let ouraSyncTimer = null;

const views = {
  dashboard: document.querySelector("#dashboardView"),
  log: document.querySelector("#logView"),
  records: document.querySelector("#recordsView"),
  chat: document.querySelector("#chatView"),
  insights: document.querySelector("#insightsView"),
  settings: document.querySelector("#settingsView"),
};

function loadState() {
  const current = readJson(STORAGE_KEY);
  if (current?.entries) return normalizeState(current);

  const legacy = readJson(LEGACY_KEY);
  if (legacy) {
    const migrated = migrateLegacyState(legacy);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(migrated));
    return migrated;
  }

  return JSON.parse(JSON.stringify(initialState));
}

function readJson(key) {
  try {
    return JSON.parse(localStorage.getItem(key));
  } catch {
    return null;
  }
}

function migrateLegacyState(legacy) {
  const entries = [];
  ["exercise", "diet", "sleep", "meditation"].forEach((kind) => {
    (legacy[kind] || []).forEach((item) => {
      const type = kind === "diet" ? "meal" : kind;
      entries.push({
        id: item.id || createId(),
        type,
        date: item.date || today(),
        createdAt: item.createdAt || new Date().toISOString(),
        rawText: legacyText(type, item),
        fields: normalizeFields(type, item),
        extraction: item,
      });
    });
  });
  return normalizeState({ entries, oura: legacy.oura || initialState.oura });
}

function normalizeState(saved) {
  return {
    ...initialState,
    ...saved,
    chat: Array.isArray(saved.chat) ? saved.chat : [],
    workoutDraft: saved.workoutDraft || null,
    oura: { ...initialState.oura, ...(saved.oura || {}) },
    settings: {
      ...initialState.settings,
      ...(saved.settings || {}),
      reminders: { ...initialState.settings.reminders, ...(saved.settings?.reminders || {}) },
      oura: { ...initialState.settings.oura, ...(saved.settings?.oura || {}) },
    },
    profile: { ...initialState.profile, ...(saved.profile || {}) },
    cloud: { ...initialState.cloud, ...(saved.cloud || {}) },
  };
}

function legacyText(type, item) {
  if (type === "exercise") return [item.activity, item.minutes && `${item.minutes} min`, item.intensity && `intensity ${item.intensity}`, item.notes].filter(Boolean).join(", ");
  if (type === "meal") return [item.meal, item.time, item.foods].filter(Boolean).join(": ");
  if (type === "sleep") return [`Sleep quality ${item.quality}/10`, item.pills && `pills: ${item.pills}`, item.notes].filter(Boolean).join(", ");
  if (type === "social") return [item.abstained ? "Abstained from social media" : "Did not abstain from social media", item.notes].filter(Boolean).join(", ");
  return [item.minutes && `${item.minutes} min`, item.time, item.style, item.notes].filter(Boolean).join(", ");
}

function normalizeFields(type, item) {
  if (type === "exercise") return { minutes: Number(item.minutes) || null, intensity: Number(item.intensity) || null };
  if (type === "meal") return { time: item.time || null, protein: Number(item.protein) || null };
  if (type === "sleep") return { quality: Number(item.quality) || null, pills: item.pills || "" };
  if (type === "meditation") return { minutes: Number(item.minutes) || null, time: item.time || null };
  if (type === "social") return { abstained: Boolean(item.abstained), definition: item.definition || DEFAULT_SOCIAL_DEFINITION };
  return {};
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function today() {
  const date = new Date();
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
  return date.toISOString().slice(0, 10);
}

function nowTime() {
  return new Date().toTimeString().slice(0, 5);
}

function createId() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function showToast(message) {
  const toast = document.querySelector("#toast");
  toast.textContent = message;
  toast.classList.add("is-visible");
  window.setTimeout(() => toast.classList.remove("is-visible"), 2200);
}

function setupNavigation() {
  document.querySelectorAll(".nav-tab").forEach((button) => {
    button.addEventListener("click", () => {
      document.querySelectorAll(".nav-tab").forEach((tab) => tab.classList.toggle("is-active", tab === button));
      Object.entries(views).forEach(([key, view]) => view.classList.toggle("is-visible", key === button.dataset.view));
      render();
    });
  });

  document.querySelectorAll(".table-tab").forEach((button) => {
    button.addEventListener("click", () => {
      activeFilter = button.dataset.filter;
      document.querySelectorAll(".table-tab").forEach((tab) => tab.classList.toggle("is-active", tab === button));
      renderRecords();
    });
  });

  document.querySelector("#dashboardDayScroller").addEventListener("click", (event) => {
    const button = event.target.closest(".day-tile");
    if (!button) return;
    selectedDashboardDate = button.dataset.date;
    renderDashboard();
  });
}

function setupForms() {
  document.querySelectorAll(".log-card").forEach((form) => {
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const entry = createEntry(form);
      state.entries.push(entry);
      saveState();
      render();
      form.reset();
      prepareDefaults();
      showToast(`${labelFor(entry.type)} saved`);
      syncEntryToCloud(entry);
      const extractedEntry = await extractEntry(entry);
      if (extractedEntry.type === "meal") generateMealSuggestion(extractedEntry.id);
    });
  });

  document.querySelector("#ouraForm").addEventListener("submit", (event) => {
    event.preventDefault();
    saveOuraSettings(event.currentTarget);
    syncOura(state.settings.oura.days, { force: true });
  });

  document.querySelector("#ouraForm").addEventListener("change", (event) => {
    saveOuraSettings(event.currentTarget);
    showToast("Oura sync settings saved");
  });

  document.querySelector("#socialDefinitionForm").addEventListener("submit", (event) => {
    event.preventDefault();
    const formData = Object.fromEntries(new FormData(event.currentTarget).entries());
    state.settings.socialDefinition = formData.socialDefinition.trim() || DEFAULT_SOCIAL_DEFINITION;
    saveState();
    prepareDefaults();
    render();
    syncProfileToCloud();
    showToast("Social definition saved");
  });

  document.querySelector("#profileForm").addEventListener("submit", (event) => {
    event.preventDefault();
    state.profile = Object.fromEntries(new FormData(event.currentTarget).entries());
    saveState();
    render();
    syncProfileToCloud();
    showToast("Profile saved");
  });

  document.querySelector("#authForm").addEventListener("submit", handleAuthSubmit);
  document.querySelector("#logoutButton").addEventListener("click", signOut);
}

function createEntry(form) {
  const type = form.dataset.type;
  const formData = Object.fromEntries(new FormData(form).entries());
  const entry = {
    id: createId(),
    type,
    date: today(),
    createdAt: new Date().toISOString(),
    rawText: rawTextFor(type, formData),
    fields: fieldsFor(type, formData),
    extractionStatus: "pending",
    extraction: null,
  };
  entry.extraction = heuristicExtraction(entry);
  return entry;
}

function rawTextFor(type, data) {
  if (type === "sleep") {
    const pills = data.pills?.trim() ? ` Pre-bed supplements taken the previous night: ${data.pills.trim()}.` : "";
    return `Subjective sleep quality for last night, entered the following morning: ${data.quality}/10.${pills}`;
  }
  if (type === "meditation") return `${data.minutes} minutes at ${data.time}.`;
  if (type === "social") {
    const status = data.abstained === "yes" ? "Abstained from social media all day." : "Did not abstain from social media all day.";
    const notes = data.notes?.trim() ? ` Notes: ${data.notes.trim()}` : "";
    return `${status} Definition: ${state.settings.socialDefinition}.${notes}`;
  }
  return data.text.trim();
}

function fieldsFor(type, data) {
  if (type === "sleep") {
    return {
      quality: Number(data.quality),
      pills: data.pills?.trim() || "",
      sleepNight: previousDate(today()),
      scoreEnteredOn: today(),
      supplementTiming: "Taken before bed on the sleepNight, before the sleep being rated the following morning.",
    };
  }
  if (type === "meditation") return { minutes: Number(data.minutes), time: data.time };
  if (type === "social") return { abstained: data.abstained === "yes", definition: state.settings.socialDefinition, notes: data.notes?.trim() || "" };
  return {};
}

async function extractEntry(entry) {
  try {
    const response = await fetch("/api/extract", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ entry }),
    });
    if (!response.ok) throw new Error(await response.text());
    const data = await response.json();
    return applyExtraction(entry.id, data.extraction, "complete");
  } catch {
    return applyExtraction(entry.id, heuristicExtraction(entry), "local");
  }
}

function applyExtraction(id, extraction, status) {
  const entry = state.entries.find((item) => item.id === id);
  if (!entry) return;
  entry.extraction = extraction;
  entry.extractionStatus = status;
  saveState();
  render();
  syncEntryToCloud(entry);
  return entry;
}

function heuristicExtraction(entry) {
  const text = entry.rawText;
  if (entry.type === "sleep") {
    return {
      type: "sleep",
      quality: entry.fields.quality,
      pills: entry.fields.pills || null,
      sleepNight: entry.fields.sleepNight,
      scoreEnteredOn: entry.fields.scoreEnteredOn,
      supplementTiming: entry.fields.supplementTiming,
    };
  }
  if (entry.type === "meditation") {
    return { type: "meditation", minutes: entry.fields.minutes, time: entry.fields.time };
  }
  if (entry.type === "social") {
    return {
      type: "social",
      abstained: entry.fields.abstained,
      definition: entry.fields.definition,
      notes: entry.fields.notes || null,
    };
  }
  const minutes = text.match(/(\d+)\s*(min|minute|minutes|hr|hour|hours)/i);
  const clock = text.match(/\b([01]?\d|2[0-3]):[0-5]\d\s*(am|pm)?\b/i) || text.match(/\b([1-9]|1[0-2])\s*(am|pm)\b/i);
  return {
    type: entry.type,
    possibleMinutes: minutes ? minutes[0] : null,
    possibleTime: clock ? clock[0] : null,
    summary: text.slice(0, 180),
  };
}

function setupDataActions() {
  document.querySelector("#recordsList").addEventListener("click", (event) => {
    const editButton = event.target.closest(".edit-button");
    if (editButton) {
      renderEditForm(editButton.dataset.id);
      return;
    }

    const cancelButton = event.target.closest(".cancel-edit-button");
    if (cancelButton) {
      renderRecords();
      return;
    }

    const button = event.target.closest(".delete-button");
    if (!button) return;
    if (!window.confirm("Delete this log from this device and cloud sync if available?")) return;
    state.entries = state.entries.filter((entry) => entry.id !== button.dataset.id);
    saveState();
    deleteEntryFromCloud(button.dataset.id);
    render();
    showToast("Entry deleted");
  });

  document.querySelector("#recordsList").addEventListener("submit", handleEditSubmit);

  document.querySelector("#exportButton").addEventListener("click", () => {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `health-signals-${today()}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  });

  document.querySelector("#importInput").addEventListener("change", async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const imported = JSON.parse(await file.text());
      state = imported.entries ? normalizeState(imported) : migrateLegacyState(imported);
      saveState();
      render();
      syncAllToCloud();
      showToast("Data imported");
    } catch {
      showToast("Import failed");
    } finally {
      event.target.value = "";
    }
  });

  document.querySelector("#generateInsightsButton").addEventListener("click", generateInsights);
  document.querySelector("#chatForm").addEventListener("submit", handleChatSubmit);
  document.querySelector("#topAskForm").addEventListener("submit", handleTopAskSubmit);
  document.querySelector("#workoutForm").addEventListener("submit", handleWorkoutSubmit);
  document.querySelector("#reminderForm").addEventListener("submit", handleReminderSubmit);
  document.querySelector("#enableNotificationsButton").addEventListener("click", enableNotifications);
  document.querySelector("#workoutPanel").addEventListener("submit", handleWorkoutFeedback);
  document.querySelector("#workoutPanel").addEventListener("click", handleWorkoutClick);
}

function handleTopAskSubmit(event) {
  event.preventDefault();
  const question = Object.fromEntries(new FormData(event.currentTarget).entries()).question.trim();
  if (!question) return;
  event.currentTarget.reset();
  showView("chat");
  askChatQuestion(question);
}

async function handleChatSubmit(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const question = Object.fromEntries(new FormData(form).entries()).question.trim();
  if (!question) return;
  form.reset();
  askChatQuestion(question);
}

async function askChatQuestion(question) {
  addChatMessage("user", question);
  const pendingId = addChatMessage("assistant", "Thinking with your recent logs...");

  try {
    const response = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(buildChatPayload(question)),
    });
    if (!response.ok) throw new Error(await response.text());
    const data = await response.json();
    updateChatMessage(pendingId, data.answer || "I could not form an answer.");
  } catch (error) {
    updateChatMessage(pendingId, `${localChatAnswer(question)}\n\nLLM endpoint status: ${friendlyApiError(error)}`);
  }
}

function friendlyApiError(error) {
  const message = String(error?.message || error || "");
  if (message.includes("429")) {
    return "deployed, but OpenAI returned 429. This usually means the API key hit a rate limit, quota limit, or billing/usage cap.";
  }
  if (message.includes("OPENAI_API_KEY")) {
    return "deployed, but OPENAI_API_KEY is missing or unavailable in Vercel.";
  }
  if (message.includes("401")) {
    return "deployed, but OpenAI rejected the API key.";
  }
  return message || "unavailable; using local fallback.";
}

function showView(key) {
  document.querySelectorAll(".nav-tab").forEach((tab) => tab.classList.toggle("is-active", tab.dataset.view === key));
  Object.entries(views).forEach(([viewKey, view]) => view.classList.toggle("is-visible", viewKey === key));
  render();
}

function buildChatPayload(question) {
  return {
    date: today(),
    question,
    profile: state.profile,
    settings: state.settings,
    recentEntries: entriesFromLastDays(14),
    oura: ouraContext(14),
    supplementContext: supplementContext(30),
    chatHistory: state.chat.slice(-8),
    instruction: "Answer using the user's profile, goals, settings, and recent health logs. Be practical and cautious, and clearly state uncertainty.",
  };
}

function addChatMessage(role, text) {
  const message = { id: createId(), role, text, createdAt: new Date().toISOString() };
  state.chat.push(message);
  state.chat = state.chat.slice(-30);
  saveState();
  renderChat();
  return message.id;
}

function updateChatMessage(id, text) {
  const message = state.chat.find((item) => item.id === id);
  if (!message) return;
  message.text = text;
  saveState();
  renderChat();
}

function localChatAnswer(question) {
  const recent = entriesFromLastDays(14);
  const byType = ["exercise", "meal", "sleep", "meditation", "social"].map((type) => `${labelFor(type)}: ${recent.filter((entry) => entry.type === type).length}`).join(", ");
  const goal = state.profile.goal ? ` Your saved goal is: ${state.profile.goal}.` : "";
  return `I can answer more specifically once the LLM endpoint is deployed. Locally, I can see the last 14 days include ${byType}.${goal}\n\nYour question was: "${question}"`;
}

async function handleWorkoutSubmit(event) {
  event.preventDefault();
  const request = Object.fromEntries(new FormData(event.currentTarget).entries()).workoutRequest.trim();
  await generateWorkout(request);
}

async function handleWorkoutFeedback(event) {
  if (!event.target.matches("#workoutFeedbackForm")) return;
  event.preventDefault();
  const feedback = Object.fromEntries(new FormData(event.target).entries()).feedback.trim();
  if (!feedback) return;
  await generateWorkout(state.workoutDraft?.request || "", feedback);
}

function handleWorkoutClick(event) {
  if (event.target.id !== "finalizeWorkoutButton") return;
  const rows = Array.from(document.querySelectorAll(".workout-row"));
  const completed = rows.map((row) => ({
    name: row.dataset.name,
    done: row.querySelector("[name='done']").checked,
    weight: row.querySelector("[name='weight']").value,
    reps: row.querySelector("[name='reps']").value,
  }));
  const entry = {
    id: createId(),
    type: "exercise",
    date: today(),
    createdAt: new Date().toISOString(),
    rawText: `Home workout: ${state.workoutDraft?.title || "Generated workout"}`,
    fields: { workout: state.workoutDraft, completed },
    extractionStatus: "complete",
    extraction: { type: "exercise", workout: state.workoutDraft, completed },
  };
  state.entries.push(entry);
  state.workoutDraft = null;
  saveState();
  syncEntryToCloud(entry);
  render();
  showToast("Workout logged");
}

function handleReminderSubmit(event) {
  event.preventDefault();
  state.settings.reminders = { ...state.settings.reminders, ...Object.fromEntries(new FormData(event.currentTarget).entries()) };
  saveState();
  renderSettings();
  scheduleReminders();
  showToast("Reminders saved");
}

async function enableNotifications() {
  if (!("Notification" in window)) {
    showToast("Notifications are not supported in this browser");
    return;
  }
  const permission = await Notification.requestPermission();
  showToast(permission === "granted" ? "Notifications enabled" : "Notifications not enabled");
  if (permission === "granted") scheduleReminders();
}

let reminderTimers = [];

function scheduleReminders() {
  reminderTimers.forEach((id) => window.clearTimeout(id));
  reminderTimers = [];
  if (!("Notification" in window) || Notification.permission !== "granted") return;
  const reminders = state.settings.reminders || {};
  [
    ["sleep", reminders.sleep, "Log sleep quality", "How was last night's sleep?"],
    ["midday", reminders.midday, "Log breakfast and lunch", dailySummaryText()],
    ["dinner", reminders.dinner, "Log dinner", dailySummaryText()],
    ["endOfDay", reminders.endOfDay, "Daily HealthStack summary", dailySummaryText()],
  ].forEach(([key, time, title, body]) => {
    const delay = delayUntil(time);
    reminderTimers.push(
      window.setTimeout(() => {
        new Notification(title, { body });
        scheduleReminders();
      }, delay),
    );
  });
}

function delayUntil(time) {
  const [hour, minute] = String(time || "09:00").split(":").map(Number);
  const target = new Date();
  target.setHours(hour || 9, minute || 0, 0, 0);
  if (target <= new Date()) target.setDate(target.getDate() + 1);
  return target.getTime() - Date.now();
}

function dailySummaryText() {
  const todayEntries = state.entries.filter((entry) => entry.date === today());
  const meals = todayEntries.filter((entry) => entry.type === "meal");
  const totals = nutritionTotals(meals);
  const medMinutes = todayEntries.filter((entry) => entry.type === "meditation").reduce((sum, entry) => sum + (Number(entry.fields?.minutes) || 0), 0);
  const exerciseBurn = estimateExerciseCalories(todayEntries.filter((entry) => entry.type === "exercise"));
  const ouraToday = ouraRecordFor(today());
  const ouraBurn = Number(ouraToday?.dailyActivity?.total_calories) || Number(ouraToday?.dailyActivity?.active_calories) || 0;
  const burnText = ouraBurn ? `${Math.round(ouraBurn)} Oura cal` : `~${exerciseBurn} cal exercise`;
  return `${totals.calories} cal eaten · ${burnText} · ${totals.protein}g protein · ${medMinutes} meditation min`;
}

function estimateExerciseCalories(entries) {
  return entries.reduce((sum, entry) => {
    const text = `${entry.rawText} ${JSON.stringify(entry.extraction || {})}`;
    const minutes = Number(text.match(/(\d+)\s*(min|minute|minutes)/i)?.[1]) || 30;
    const hard = /hard|rpe\s*[78-9]|intensity\s*[78-9]|run|hike|interval/i.test(text);
    return sum + Math.round(minutes * (hard ? 8 : 5));
  }, 0);
}

async function generateWorkout(request = "", feedback = "") {
  const panel = document.querySelector("#workoutPanel");
  panel.innerHTML = `<div class="definition-note">Generating workout...</div>`;
  try {
    const response = await fetch("/api/workout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(buildWorkoutPayload(request, feedback)),
    });
    if (!response.ok) throw new Error(await response.text());
    const data = await response.json();
    state.workoutDraft = { ...data.workout, request, feedback };
  } catch {
    state.workoutDraft = localWorkoutSuggestion(request, feedback);
  }
  saveState();
  renderWorkoutPanel();
}

function buildWorkoutPayload(request, feedback) {
  return {
    date: today(),
    request,
    feedback,
    priorDraft: state.workoutDraft,
    profile: state.profile,
    oura: ouraContext(14),
    recentExercise: entriesFromLastDays(21).filter((entry) => entry.type === "exercise"),
    recentSleep: entriesFromLastDays(7).filter((entry) => entry.type === "sleep"),
    instruction: "Generate a useful home workout using goals, available equipment, familiar exercises, recent exercise load, recent hikes/leg fatigue, and past weights/reps when present. Support hypertrophy progression with sensible reps/sets/weights.",
  };
}

function localWorkoutSuggestion(request = "", feedback = "") {
  const recentExerciseText = entriesFromLastDays(7).filter((entry) => entry.type === "exercise").map((entry) => entry.rawText).join(" ");
  const avoidLegs = /hike|long walk|legs|squat|deadlift/i.test(recentExerciseText) || /upper|avoid legs|tired legs/i.test(`${request} ${feedback}`);
  const equipment = state.profile.homeEquipment || "bodyweight";
  const exercises = avoidLegs
    ? [
        { name: "Push-up or DB bench press", sets: 3, reps: "8-12", targetWeight: "bodyweight or a weight leaving 1-3 reps in reserve", rest: "90s", notes: "Add load/reps when all sets reach top of range." },
        { name: "One-arm DB row", sets: 3, reps: "10-12/side", targetWeight: "recent comfortable row weight", rest: "90s", notes: "Control eccentric." },
        { name: "DB shoulder press", sets: 3, reps: "8-10", targetWeight: "moderate", rest: "90s", notes: "Stop shy of form breakdown." },
      ]
    : [
        { name: "Goblet squat", sets: 3, reps: "8-12", targetWeight: "moderate-heavy", rest: "120s", notes: "Progress after hitting 12s cleanly." },
        { name: "DB Romanian deadlift", sets: 3, reps: "8-10", targetWeight: "moderate-heavy", rest: "120s", notes: "Hip hinge, slow lowering." },
        { name: "Push-up or DB bench press", sets: 3, reps: "8-12", targetWeight: "moderate", rest: "90s", notes: "Hypertrophy range." },
      ];
  return {
    title: avoidLegs ? "Upper-body home hypertrophy" : "Full-body home hypertrophy",
    rationale: `Local fallback using equipment: ${equipment}. ${avoidLegs ? "Recent logs/request suggest sparing legs." : "No clear reason to avoid legs."}`,
    exercises,
    progression: "When all prescribed sets hit the top of the rep range with good form, increase weight next time by the smallest available jump; otherwise repeat until stable.",
  };
}

function renderWorkoutPanel() {
  const panel = document.querySelector("#workoutPanel");
  const workout = state.workoutDraft;
  if (!workout) {
    panel.innerHTML = "";
    return;
  }
  panel.innerHTML = `<div class="workout-draft">
    <h4>${escapeHtml(workout.title || "Suggested workout")}</h4>
    <p>${escapeHtml(workout.rationale || "")}</p>
    <div class="workout-list">
      ${(workout.exercises || [])
        .map(
          (exercise) => `<div class="workout-row" data-name="${escapeHtml(exercise.name)}">
            <label class="check-row"><input type="checkbox" name="done" checked /><span>${escapeHtml(exercise.name)}</span></label>
            <span>${escapeHtml(`${exercise.sets || ""} sets · ${exercise.reps || ""} reps · ${exercise.rest || ""}`)}</span>
            <span>${escapeHtml(exercise.targetWeight || "")}</span>
            <input name="weight" placeholder="Weight used" />
            <input name="reps" placeholder="Reps done" />
          </div>`,
        )
        .join("")}
    </div>
    <p>${escapeHtml(workout.progression || "")}</p>
    <form id="workoutFeedbackForm" class="stacked-form">
      <textarea name="feedback" placeholder="Ask for changes: swap an exercise, shorter workout, more upper body..."></textarea>
      <div class="button-row">
        <button type="submit">Revise workout</button>
        <button id="finalizeWorkoutButton" class="secondary-button" type="button">Log workout</button>
      </div>
    </form>
  </div>`;
}

async function generateMealSuggestion(entryId) {
  const entry = state.entries.find((item) => item.id === entryId);
  if (!entry) return;
  const panel = document.querySelector("#mealSuggestionPanel");
  panel.innerHTML = `<strong>Next meal suggestion</strong><p>Generating...</p>`;

  const payload = buildMealSuggestionPayload(entry);
  try {
    const response = await fetch("/api/meal-suggestion", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!response.ok) throw new Error(await response.text());
    const data = await response.json();
    entry.mealSuggestion = data.suggestion;
    saveState();
    syncEntryToCloud(entry);
    renderMealSuggestion(data.suggestion, "Generated by LLM");
  } catch {
    const suggestion = localMealSuggestion(payload);
    entry.mealSuggestion = suggestion;
    saveState();
    syncEntryToCloud(entry);
    renderMealSuggestion(suggestion, "Local fallback");
  }
}

function buildMealSuggestionPayload(mealEntry) {
  const todayEntries = state.entries.filter((entry) => entry.date === today()).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const priorMeals = todayEntries.filter((entry) => entry.type === "meal" && entry.id !== mealEntry.id);
  return {
    date: today(),
    localTime: nowTime(),
    timeContext: {
      lateMealCutoff: "20:30",
      lateNight: "21:00 or later",
      assumption: "If a meal or snack is logged around 9 PM or later, the user is likely approaching sleep and should usually not be told to eat another normal meal in 3-5 hours.",
    },
    profile: state.profile,
    oura: ouraContext(14),
    latestMeal: mealEntry,
    priorNutrition: nutritionTotals(priorMeals),
    today: {
      meals: todayEntries.filter((entry) => entry.type === "meal"),
      exercise: todayEntries.filter((entry) => entry.type === "exercise"),
      sleep: todayEntries.filter((entry) => entry.type === "sleep"),
      meditation: todayEntries.filter((entry) => entry.type === "meditation"),
    },
    instruction: "Suggest when to eat the next meal and rough protein, carbs, and fats based on profile/goals, current local time, latest meal timing, today's meals, and today's exercise. If it is late evening, consider sleep timing and avoid suggesting another normal meal before bed unless there is a clear reason.",
  };
}

function renderMealSuggestion(suggestion, status) {
  const panel = document.querySelector("#mealSuggestionPanel");
  const current = suggestion.currentMeal || {};
  const totals = suggestion.dayTotals || {};
  const next = suggestion.nextMeal || {};
  panel.innerHTML = `<strong>Meal analysis · ${escapeHtml(status)}</strong>
    <p>${escapeHtml(formatMacroLine("This meal", current))}</p>
    <p>${escapeHtml(formatMacroLine("Today so far", totals))}</p>
    <p>${escapeHtml(`Next meal: ${next.time || suggestion.nextMealTiming || "TBD"} · ${formatMacroLine("", next).replace(/^: /, "")}`)}</p>
    <p>${escapeHtml(suggestion.reasoning || "")}</p>`;
}

function localMealSuggestion(payload) {
  const latestMealText = `${payload.latestMeal.rawText} ${JSON.stringify(payload.latestMeal.extraction || {})}`;
  const latestMealMinutes = extractMealMinutes(latestMealText) ?? timeToMinutes(payload.localTime);
  const isLateEvening = latestMealMinutes >= 20 * 60 + 30;
  const isLateNight = latestMealMinutes >= 21 * 60;
  const exerciseText = payload.today.exercise.map((entry) => `${entry.rawText} ${JSON.stringify(entry.extraction || {})}`).join(" ");
  const hardTraining = /intensity\s*[78-9]|rpe\s*[78-9]|run|lift|strength|interval|hard/i.test(exerciseText);
  const goal = `${payload.profile.goal || ""} ${payload.profile.profileNotes || ""}`.toLowerCase();
  const protein = goal.includes("bulk") || hardTraining ? "35-50g protein" : "25-40g protein";
  const carbs = hardTraining ? "50-90g carbs" : goal.includes("fat loss") || goal.includes("cut") ? "25-50g carbs" : "35-70g carbs";
  const fats = goal.includes("fat loss") || goal.includes("cut") ? "10-20g fats" : "15-30g fats";

  if (isLateEvening) {
    return {
      currentMeal: estimateMealFromText(payload.latestMeal.rawText),
      dayTotals: addMacros(payload.priorNutrition, estimateMealFromText(payload.latestMeal.rawText)),
      nextMeal: {
        time: "Breakfast tomorrow",
        calories: hardTraining ? 450 : 350,
        protein: hardTraining ? 35 : 25,
        carbs: hardTraining ? 55 : 35,
        fat: hardTraining ? 15 : 12,
      },
      reasoning: "Local estimate noticed the meal was logged late. Eating another full meal in 3-5 hours would likely collide with sleep.",
    };
  }

  const currentMeal = estimateMealFromText(payload.latestMeal.rawText);
  return {
    currentMeal,
    dayTotals: addMacros(payload.priorNutrition, currentMeal),
    nextMeal: {
      time: addHoursToTime(payload.localTime, hardTraining ? 2 : 4),
      calories: hardTraining ? 650 : 500,
      protein: Number(protein.match(/\d+/)?.[0]) || 30,
      carbs: Number(carbs.match(/\d+/)?.[0]) || 45,
      fat: Number(fats.match(/\d+/)?.[0]) || 15,
    },
    reasoning: "Local estimate based on your logged meal, today's exercise text, and saved goal. The LLM version will use richer extraction when deployed.",
  };
}

function estimateMealFromText(text) {
  const lower = text.toLowerCase();
  let calories = 450;
  let protein = 25;
  let carbs = 45;
  let fat = 15;
  if (/snack|yogurt|fruit|bar|shake/i.test(lower)) {
    calories = 250;
    protein = 15;
    carbs = 30;
    fat = 8;
  }
  if (/chicken|fish|salmon|beef|eggs|tofu|protein|turkey/i.test(lower)) protein += 15;
  if (/rice|bread|pasta|potato|oats|cereal|tortilla|noodle/i.test(lower)) carbs += 30;
  if (/avocado|oil|butter|nuts|cheese|cream|salmon/i.test(lower)) fat += 12;
  calories = Math.round(protein * 4 + carbs * 4 + fat * 9);
  return { calories, protein, carbs, fat };
}

function nutritionTotals(entries) {
  return entries.reduce((total, entry) => addMacros(total, entry.mealSuggestion?.currentMeal || entry.mealSuggestion?.nutritionEstimate || {}), { calories: 0, protein: 0, carbs: 0, fat: 0 });
}

function addMacros(a = {}, b = {}) {
  return {
    calories: Math.round((Number(a.calories) || 0) + (Number(b.calories) || 0)),
    protein: Math.round((Number(a.protein) || 0) + (Number(b.protein) || 0)),
    carbs: Math.round((Number(a.carbs) || 0) + (Number(b.carbs) || 0)),
    fat: Math.round((Number(a.fat) || 0) + (Number(b.fat) || 0)),
  };
}

function formatMacroLine(label, macros = {}) {
  const prefix = label ? `${label}: ` : "";
  return `${prefix}${Math.round(Number(macros.calories) || 0)} cal · P ${Math.round(Number(macros.protein) || 0)}g · C ${Math.round(Number(macros.carbs) || 0)}g · F ${Math.round(Number(macros.fat) || 0)}g`;
}

function addHoursToTime(time, hours) {
  const minutes = timeToMinutes(time) + hours * 60;
  const h = Math.floor((minutes % 1440) / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function extractMealMinutes(text) {
  const lower = text.toLowerCase();
  const clock = lower.match(/\b([01]?\d|2[0-3]):([0-5]\d)\s*(am|pm)?\b/);
  if (clock) {
    let hour = Number(clock[1]);
    const minute = Number(clock[2]);
    const period = clock[3];
    if (period === "pm" && hour < 12) hour += 12;
    if (period === "am" && hour === 12) hour = 0;
    return hour * 60 + minute;
  }
  const simple = lower.match(/\b(1[0-2]|[1-9])\s*(am|pm)\b/);
  if (simple) {
    let hour = Number(simple[1]);
    if (simple[2] === "pm" && hour < 12) hour += 12;
    if (simple[2] === "am" && hour === 12) hour = 0;
    return hour * 60;
  }
  return null;
}

function timeToMinutes(value) {
  const [hour, minute] = String(value || "12:00").split(":").map(Number);
  return (Number.isFinite(hour) ? hour : 12) * 60 + (Number.isFinite(minute) ? minute : 0);
}

async function generateInsights() {
  const recentEntries = entriesFromLastDays(7);
  document.querySelector("#insightStatus").textContent = "Generating...";
  document.querySelector("#llmPayload").value = JSON.stringify(buildInsightPayload(recentEntries), null, 2);

  try {
    const response = await fetch("/api/insights", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(buildInsightPayload(recentEntries)),
    });
    if (!response.ok) throw new Error(await response.text());
    const data = await response.json();
    renderInsightText(data.insights, "Generated by LLM");
  } catch {
    renderInsightText(localInsights(recentEntries), "Local fallback");
  }
}

function buildInsightPayload(entries) {
  return {
    date: today(),
    range: "last 7 days",
    entries,
    profile: state.profile,
    oura: ouraContext(30),
    supplementContext: supplementContext(30),
    instruction: "Find useful patterns across exercise, meals, subjective sleep quality, pills/supplements, meditation, social media abstinence, and available extracted fields.",
  };
}

function renderInsightText(insights, status) {
  document.querySelector("#insightStatus").textContent = status;
  const items = Array.isArray(insights) ? insights : [{ title: "Insight", detail: String(insights) }];
  document.querySelector("#recommendations").innerHTML = items
    .map(
      (item) => `<article class="recommendation-card" data-tone="${escapeHtml(item.tone || "green")}">
        <h4>${escapeHtml(item.title || "Insight")}</h4>
        <p>${escapeHtml(item.detail || item.body || "")}</p>
      </article>`,
    )
    .join("");
}

function localInsights(entries) {
  if (!entries.length) {
    return [{ tone: "gold", title: "No recent logs", detail: "There are no saved entries in the last 7 days yet." }];
  }

  const sleep = entries.filter((entry) => entry.type === "sleep");
  const meals = entries.filter((entry) => entry.type === "meal");
  const exercise = entries.filter((entry) => entry.type === "exercise");
  const meditation = entries.filter((entry) => entry.type === "meditation");
  const social = entries.filter((entry) => entry.type === "social");
  const avgSleep = average(sleep.map((entry) => entry.fields?.quality));
  const abstainedDays = social.filter((entry) => entry.fields?.abstained).length;
  const supplementChanges = supplementContext(30).changes.length;

  return [
    {
      tone: "green",
      title: "Logging coverage",
      detail: `Last 7 days: ${exercise.length} exercise, ${meals.length} meal, ${sleep.length} sleep, ${meditation.length} meditation, and ${social.length} social media entries.`,
    },
    {
      tone: avgSleep && avgSleep < 6.5 ? "rose" : "blue",
      title: "Sleep baseline",
      detail: avgSleep ? `Your average subjective sleep score is ${formatNumber(avgSleep)}/10. The LLM endpoint can compare this against meals, exercise, pills, and meditation once configured.` : "Add sleep scores to make correlations possible.",
    },
    {
      tone: "gold",
      title: "Next useful variable",
      detail: "For meals and exercise, include timing in the free text when you can. The extractor will turn that into structure for better insights.",
    },
    {
      tone: social.length && abstainedDays === social.length ? "green" : "blue",
      title: "Social media signal",
      detail: social.length ? `You abstained on ${abstainedDays} of ${social.length} logged social media days. Compare those days against sleep quality and meditation consistency.` : "Add social media abstinence logs to compare against sleep and focus.",
    },
    {
      tone: supplementChanges ? "gold" : "green",
      title: "Supplement stack",
      detail: supplementChanges ? `${supplementChanges} supplement stack change${supplementChanges === 1 ? "" : "s"} detected in the last 30 days. Sleep insights should compare nights before and after those changes.` : "No recent supplement stack changes detected in logged sleep entries.",
    },
  ];
}

function supplementContext(days = 30) {
  const sleepEntries = entriesFromLastDays(days)
    .filter((entry) => entry.type === "sleep")
    .sort((a, b) => a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt));
  const timeline = sleepEntries.map((entry) => ({
    date: entry.date,
    sleepNight: entry.fields?.sleepNight || previousDate(entry.date),
    scoreEnteredOn: entry.fields?.scoreEnteredOn || entry.date,
    sleepQuality: entry.fields?.quality ?? entry.extraction?.quality ?? entry.extraction?.sleepQuality ?? null,
    pills: normalizeStack(entry.fields?.pills || entry.extraction?.pills || entry.extraction?.supplements?.join(", ") || ""),
    supplementTiming: entry.fields?.supplementTiming || "Taken before bed on sleepNight.",
  }));
  const changes = [];
  let previous = null;
  timeline.forEach((item) => {
    if (previous !== null && item.pills !== previous) {
      changes.push({
        date: item.date,
        from: previous || "none logged",
        to: item.pills || "none logged",
        sleepQuality: item.sleepQuality,
      });
    }
    previous = item.pills;
  });
  return {
    currentStack: timeline.at(-1)?.pills || "",
    interpretation: "Each stack belongs to the sleepNight and represents supplements taken before bed before the sleep quality score was entered the next morning.",
    timeline,
    changes,
  };
}

function previousDate(dateString) {
  const date = new Date(`${dateString}T12:00:00`);
  date.setDate(date.getDate() - 1);
  return date.toISOString().slice(0, 10);
}

function normalizeStack(value) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

function entriesFromLastDays(days) {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - days + 1);
  return state.entries.filter((entry) => new Date(`${entry.date}T00:00:00`) >= start).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

function recentDays(days = 14) {
  return daysEndingAt(today(), days);
}

function daysEndingAt(endDate, days = 14) {
  const end = new Date(`${endDate}T12:00:00`);
  return Array.from({ length: days }, (_, index) => {
    const date = new Date(end);
    date.setDate(date.getDate() - days + 1 + index);
    return date.toISOString().slice(0, 10);
  });
}

function ouraContext(days = 14) {
  const allowedDates = new Set(recentDays(days));
  const records = (state.oura.records || []).filter((record) => allowedDates.has(record.date)).sort((a, b) => a.date.localeCompare(b.date));
  return {
    lastSync: state.oura.lastSync || "",
    records,
    averageSleepScore: average(records.map((record) => record.dailySleep?.score)),
    averageReadiness: average(records.map((record) => record.dailyReadiness?.score)),
    averageSteps: average(records.map((record) => record.dailyActivity?.steps)),
  };
}

function ouraRecordFor(date) {
  return (state.oura.records || []).find((record) => record.date === date);
}

function renderDashboard() {
  const timelineDays = recentDays(30);
  if (!timelineDays.includes(selectedDashboardDate)) selectedDashboardDate = today();
  renderDashboardDayScroller(timelineDays);

  const selectedEntries = state.entries.filter((entry) => entry.date === selectedDashboardDate).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const byType = groupByType(selectedEntries);
  const selectedOura = ouraRecordFor(selectedDashboardDate);
  const meals = byType.meal || [];
  const nutrition = nutritionTotals(meals);
  const medMinutes = (byType.meditation || []).reduce((total, entry) => total + (Number(entry.fields?.minutes) || 0), 0);
  const sleep = (byType.sleep || [])[0];
  const social = (byType.social || []).find((entry) => entry.fields?.abstained) || (byType.social || [])[0];
  const exerciseLogged = (byType.exercise || []).length > 0;
  const dietStatus = dietStatusFor(nutrition, meals, selectedDashboardDate);
  const sleepStatus = sleepStatusFor(sleep, selectedOura);
  const readinessStatus = readinessStatusFor(selectedOura);

  const inputs = [
    {
      title: "Exercise",
      status: exerciseLogged ? "green" : "red",
      metric: sessionMetric((byType.exercise || []).length),
      streak: streakAsOf(selectedDashboardDate, (date) => hasEntryOnDate(date, "exercise")),
      items: rawItems(byType.exercise),
    },
    {
      title: "Diet",
      status: dietStatus.status,
      metric: `${nutrition.calories || 0} cal · ${nutrition.protein || 0}g protein`,
      streak: streakAsOf(selectedDashboardDate, (date) => dietStatusFor(nutritionTotals(state.entries.filter((entry) => entry.date === date && entry.type === "meal")), state.entries.filter((entry) => entry.date === date && entry.type === "meal"), date).status === "green"),
      items: [`${nutrition.protein || 0}g protein`, `${nutrition.carbs || 0}g carbs`, `${nutrition.fat || 0}g fat`],
    },
    {
      title: "Meditation",
      status: medMinutes > 0 ? "green" : "red",
      metric: `${medMinutes || 0} min`,
      streak: streakAsOf(selectedDashboardDate, (date) => hasEntryOnDate(date, "meditation")),
      items: rawItems(byType.meditation),
    },
    {
      title: "Digital Minimalism",
      status: social?.fields?.abstained ? "green" : social ? "red" : "yellow",
      metric: social?.fields?.abstained ? "Abstained" : social ? "Used" : "Not set",
      streak: streakAsOf(selectedDashboardDate, (date) => hasSocialAbstainedOnDate(date)),
      items: social?.fields?.abstained ? ["Abstained"] : social ? ["Not abstained"] : [],
    },
  ];

  const outcomes = [
    {
      title: "Sleep Quality",
      status: sleepStatus.status,
      metric: `${sleepStatus.metric} ${sleepStatus.metricLabel}`,
      streak: streakAsOf(selectedDashboardDate, (date) => hasEntryOnDate(date, "sleep")),
      items: sleepItems(sleep, selectedOura),
    },
    {
      title: "Readiness",
      status: readinessStatus.status,
      metric: `${readinessStatus.metric} ${readinessStatus.metricLabel}`,
      streak: streakAsOf(selectedDashboardDate, (date) => Boolean(ouraRecordFor(date)?.dailyReadiness?.score)),
      items: readinessStatus.items,
    },
  ];

  document.querySelector("#dashboardGrid").innerHTML = `
    ${profileIsSparse() ? renderDashboardNotice() : ""}
    <section class="dashboard-section">
      <div class="dashboard-section-rule"></div>
      <div class="dashboard-card-row">${sortDashboardCards(inputs).map(renderDashboardCard).join("")}</div>
    </section>
    <section class="dashboard-section">
      <div class="dashboard-section-rule"></div>
      <div class="dashboard-card-row dashboard-card-row-outcomes">${sortDashboardCards(outcomes).map(renderDashboardCard).join("")}</div>
    </section>`;
}

function profileIsSparse() {
  return !state.profile.age || !state.profile.goal || !state.profile.weight || !state.profile.homeEquipment;
}

function renderDashboardDayScroller(days) {
  const scroller = document.querySelector("#dashboardDayScroller");
  scroller.innerHTML = days
    .map((date) => {
      const dayEntries = state.entries.filter((entry) => entry.date === date);
      const label = date === today() ? "Today" : new Date(`${date}T12:00:00`).toLocaleDateString(undefined, { weekday: "short" });
      const dayNumber = new Date(`${date}T12:00:00`).getDate();
      return `<button class="day-tile ${date === selectedDashboardDate ? "is-selected" : ""}" type="button" data-date="${escapeHtml(date)}" title="${escapeHtml(date)}">
        <span>${escapeHtml(label)}</span>
        <strong>${dayNumber}</strong>
        <small>${dayEntries.length || ""}</small>
      </button>`;
    })
    .join("");

  window.requestAnimationFrame(() => {
    const selected = scroller.querySelector(".day-tile.is-selected");
    selected?.scrollIntoView({ inline: "end", block: "nearest" });
  });
}

function groupByType(entries) {
  return entries.reduce((groups, entry) => {
    groups[entry.type] ||= [];
    groups[entry.type].push(entry);
    return groups;
  }, {});
}

function hasEntryOnDate(date, type) {
  return state.entries.some((entry) => entry.date === date && entry.type === type);
}

function hasSocialAbstainedOnDate(date) {
  return state.entries.some((entry) => entry.date === date && entry.type === "social" && entry.fields?.abstained);
}

function streakAsOf(date, isActive) {
  let streak = 0;
  const cursor = new Date(`${date}T12:00:00`);
  for (let index = 0; index < 365; index += 1) {
    const day = cursor.toISOString().slice(0, 10);
    if (!isActive(day)) break;
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

function rawItems(entries = []) {
  return entries.map((entry) => entry.rawText);
}

function sessionMetric(count) {
  return `${count || 0} ${count === 1 ? "session" : "sessions"}`;
}

function sortDashboardCards(cards) {
  const rank = { green: 0, yellow: 1, red: 2 };
  return cards
    .map((card, index) => ({ ...card, index }))
    .sort((a, b) => (rank[a.status] ?? 3) - (rank[b.status] ?? 3) || (b.streak || 0) - (a.streak || 0) || a.index - b.index);
}

function dietStatusFor(nutrition, meals, date) {
  if (!meals.length) return { status: isEarlyToday(date) ? "yellow" : "red", label: "Open" };
  const proteinTarget = proteinTargetGrams();
  const calorieTarget = calorieTargetEstimate();
  const expectedProtein = date === today() ? proteinTarget * dayProgress() : proteinTarget * 0.75;
  const proteinGood = nutrition.protein >= expectedProtein * 0.85;
  const caloriesHigh = nutrition.calories > calorieTarget * 1.12;
  const caloriesLow = date !== today() && nutrition.calories < calorieTarget * 0.55;
  if (proteinGood && !caloriesHigh && !caloriesLow) return { status: "green", label: "On track" };
  if (caloriesHigh || caloriesLow) return { status: "red", label: "Check" };
  return { status: "yellow", label: "Partial" };
}

function proteinTargetGrams() {
  const weight = Number(state.profile.weight);
  if (Number.isFinite(weight) && weight > 0) return Math.round(weight * 0.75);
  return 120;
}

function calorieTargetEstimate() {
  const weight = Number(state.profile.weight);
  const base = Number.isFinite(weight) && weight > 0 ? weight * 13 : 2100;
  const goal = `${state.profile.goal || ""}`.toLowerCase();
  if (/fat|cut|loss|lean/i.test(goal)) return Math.round(base * 0.88);
  if (/gain|bulk|hypertrophy|muscle/i.test(goal)) return Math.round(base * 1.08);
  return Math.round(base);
}

function dayProgress() {
  const now = new Date();
  const hour = now.getHours() + now.getMinutes() / 60;
  return Math.min(Math.max((hour - 7) / 15, 0.2), 1);
}

function isEarlyToday(date) {
  return date === today() && new Date().getHours() < 13;
}

function sleepStatusFor(sleep, oura) {
  const subjective = Number(sleep?.fields?.quality);
  if (Number.isFinite(subjective)) {
    return {
      status: subjective >= 7 ? "green" : subjective >= 5 ? "yellow" : "red",
      label: subjective >= 7 ? "Rested" : subjective >= 5 ? "Mixed" : "Low",
      metric: `${subjective}/10`,
      metricLabel: "subjective",
    };
  }
  const ouraScore = Number(oura?.dailySleep?.score);
  if (Number.isFinite(ouraScore)) {
    return {
      status: ouraScore >= 80 ? "green" : ouraScore >= 65 ? "yellow" : "red",
      label: ouraScore >= 80 ? "Strong" : ouraScore >= 65 ? "Mixed" : "Low",
      metric: `${ouraScore}`,
      metricLabel: "Oura",
    };
  }
  return { status: "yellow", label: "Unset", metric: "-", metricLabel: "score" };
}

function readinessStatusFor(oura) {
  const score = Number(oura?.dailyReadiness?.score);
  if (!Number.isFinite(score)) return { status: "yellow", label: "Unset", metric: "-", metricLabel: "readiness", items: [] };
  return {
    status: score >= 80 ? "green" : score >= 65 ? "yellow" : "red",
    label: score >= 80 ? "Ready" : score >= 65 ? "Steady" : "Recover",
    metric: `${score}`,
    metricLabel: "Oura",
    items: [],
  };
}

function sleepItems(sleep, oura) {
  const items = [];
  if (sleep) {
    items.push(`Subjective ${sleep.fields?.quality || "-"} / 10`);
    if (sleep.fields?.pills) items.push("Pre-bed supplement stack logged");
  }
  if (oura?.dailySleep) items.push(`Oura sleep score ${oura.dailySleep.score || "-"}`);
  return items;
}

function renderDashboardNotice() {
  return `<article class="dashboard-notice">
    <strong>Profile setup</strong>
    <span>Add body metrics, goals, equipment, and sleep stack for sharper suggestions.</span>
  </article>`;
}

function renderDashboardCard(card) {
  return `<article class="dashboard-card" data-status="${escapeHtml(card.status)}">
    <div class="dashboard-card-top">
      <span class="status-mark" aria-label="${escapeHtml(card.status === "green" ? "Complete" : card.status)}">${card.status === "green" ? "✓" : ""}</span>
      <span class="streak-chip"><small>Streak</small><b>${escapeHtml(card.streak || 0)}d</b></span>
    </div>
    <h3>${escapeHtml(card.title)}</h3>
    <div class="dashboard-metric">${escapeHtml(card.metric)}</div>
    ${(card.items || []).length ? `<ul class="dashboard-list">${card.items.slice(0, 3).map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>` : ""}
  </article>`;
}

function renderRecords() {
  const entries = state.entries
    .filter((entry) => activeFilter === "all" || entry.type === activeFilter)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  if (!entries.length) {
    const emptyLabel = activeFilter === "all" ? "records" : `${labelFor(activeFilter).toLowerCase()} records`;
    document.querySelector("#recordsList").innerHTML = `<article class="record-card"><h3>No ${escapeHtml(emptyLabel)} yet</h3><p>Saved logs will appear here immediately.</p></article>`;
    return;
  }

  document.querySelector("#recordsList").innerHTML = entries
    .map(
      (entry) => `<article class="record-card">
        <div class="record-header">
          <div>
            <span class="record-type">${escapeHtml(labelFor(entry.type))}</span>
            <h3>${escapeHtml(entry.date)} · ${escapeHtml(timeLabel(entry.createdAt))}</h3>
          </div>
          <div class="button-row">
            <button class="secondary-button edit-button" data-id="${escapeHtml(entry.id)}" type="button">Edit</button>
            <button class="delete-button" data-id="${escapeHtml(entry.id)}" type="button">Delete</button>
          </div>
        </div>
        <p class="raw-log">${escapeHtml(entry.rawText)}</p>
        <details>
          <summary>Structured data</summary>
          <pre>${escapeHtml(JSON.stringify(entry.extraction || entry.fields || {}, null, 2))}</pre>
        </details>
        ${
          entry.mealSuggestion
            ? `<details>
                <summary>Meal suggestion</summary>
                <pre>${escapeHtml(JSON.stringify(entry.mealSuggestion, null, 2))}</pre>
              </details>`
            : ""
        }
      </article>`,
    )
    .join("");
}

function renderEditForm(id) {
  const entry = state.entries.find((item) => item.id === id);
  if (!entry) return;
  document.querySelector("#recordsList").innerHTML = `<article class="record-card">
    <div class="record-header">
      <div>
        <span class="record-type">Edit ${escapeHtml(labelFor(entry.type))}</span>
        <h3>${escapeHtml(entry.date)}</h3>
      </div>
    </div>
    <form class="edit-form" data-id="${escapeHtml(entry.id)}">
      <label>Date <input type="date" name="date" value="${escapeHtml(entry.date)}" required /></label>
      ${editFieldsFor(entry)}
      <label>Raw log <textarea name="rawText" required>${escapeHtml(entry.rawText)}</textarea></label>
      <div class="button-row">
        <button type="submit">Save changes</button>
        <button class="secondary-button cancel-edit-button" type="button">Cancel</button>
      </div>
    </form>
  </article>`;
}

function editFieldsFor(entry) {
  if (entry.type === "sleep") {
    return `<div class="two-col">
      <label>Quality <input type="number" name="quality" min="1" max="10" value="${escapeHtml(entry.fields?.quality || "")}" /></label>
      <label>Pre-bed supplements <input name="pills" value="${escapeHtml(entry.fields?.pills || "")}" /></label>
    </div>`;
  }
  if (entry.type === "meditation") {
    return `<div class="two-col">
      <label>Minutes <input type="number" name="minutes" min="1" value="${escapeHtml(entry.fields?.minutes || "")}" /></label>
      <label>Time <input type="time" name="time" value="${escapeHtml(entry.fields?.time || "")}" /></label>
    </div>`;
  }
  if (entry.type === "social") {
    return `<label class="check-row">
      <input type="checkbox" name="abstained" value="yes" ${entry.fields?.abstained ? "checked" : ""} />
      <span>Abstained all day</span>
    </label>
    <label>Notes <textarea name="notes">${escapeHtml(entry.fields?.notes || "")}</textarea></label>`;
  }
  return "";
}

async function handleEditSubmit(event) {
  if (!event.target.matches(".edit-form")) return;
  event.preventDefault();
  const entry = state.entries.find((item) => item.id === event.target.dataset.id);
  if (!entry) return;
  const data = Object.fromEntries(new FormData(event.target).entries());
  entry.date = data.date;
  entry.rawText = data.rawText.trim();
  entry.fields = editedFieldsFor(entry, data);
  entry.updatedAt = new Date().toISOString();
  entry.extractionStatus = "pending";
  entry.mealSuggestion = null;
  saveState();
  render();
  showToast("Entry updated");
  const extracted = await extractEntry(entry);
  if (extracted.type === "meal") await generateMealSuggestion(extracted.id);
}

function editedFieldsFor(entry, data) {
  if (entry.type === "sleep") {
    return {
      ...entry.fields,
      quality: Number(data.quality),
      pills: data.pills?.trim() || "",
      sleepNight: entry.fields?.sleepNight || previousDate(data.date),
      scoreEnteredOn: data.date,
      supplementTiming: "Taken before bed on the sleepNight, before the sleep being rated the following morning.",
    };
  }
  if (entry.type === "meditation") return { minutes: Number(data.minutes), time: data.time };
  if (entry.type === "social") return { abstained: data.abstained === "yes", definition: state.settings.socialDefinition, notes: data.notes?.trim() || "" };
  return entry.fields || {};
}

function renderTodaySummary() {
  const count = state.entries.filter((entry) => entry.date === today()).length;
  document.querySelector("#todaySummary").textContent = `${count} ${count === 1 ? "entry" : "entries"}`;
  document.querySelector("#todayHint").textContent = `${state.entries.length} total saved ${state.entries.length === 1 ? "record" : "records"}.`;
}

function renderPayload() {
  document.querySelector("#llmPayload").value = JSON.stringify(buildInsightPayload(entriesFromLastDays(7)), null, 2);
}

function renderChat() {
  const container = document.querySelector("#chatMessages");
  const messages = state.chat.length ? state.chat : [{ role: "assistant", text: "Ask about training, meals, sleep, meditation, social media, or how your recent logs relate to your profile and goals." }];
  container.innerHTML = messages
    .map(
      (message) => `<article class="chat-message ${escapeHtml(message.role)}">
        <p>${escapeHtml(message.text)}</p>
      </article>`,
    )
    .join("");
  container.scrollTop = container.scrollHeight;
}

function renderSettings() {
  const form = document.querySelector("#ouraForm");
  form.lastSync.value = state.oura.lastSync || "";
  form.days.value = state.settings.oura?.days || 14;
  form.intervalHours.value = state.settings.oura?.intervalHours || 6;
  form.autoSync.checked = state.settings.oura?.autoSync !== false;
  const profileForm = document.querySelector("#profileForm");
  Object.entries(state.profile).forEach(([key, value]) => {
    if (profileForm.elements[key]) profileForm.elements[key].value = value || "";
  });
  const reminderForm = document.querySelector("#reminderForm");
  Object.entries(state.settings.reminders || {}).forEach(([key, value]) => {
    if (reminderForm.elements[key]) reminderForm.elements[key].value = value || "";
  });
  document.querySelector("#socialDefinitionInput").value = state.settings.socialDefinition || DEFAULT_SOCIAL_DEFINITION;
}

function saveOuraSettings(form) {
  const data = Object.fromEntries(new FormData(form).entries());
  state.settings.oura = {
    autoSync: data.autoSync === "yes",
    intervalHours: Math.min(Math.max(Number(data.intervalHours) || 6, 1), 24),
    days: Math.min(Math.max(Number(data.days) || 14, 1), 90),
  };
  saveState();
  syncProfileToCloud();
  scheduleOuraAutoSync();
}

async function syncOura(days = 14, options = {}) {
  const safeDays = Math.min(Math.max(Number(days) || 14, 1), 90);
  if (!isHostedApp()) {
    if (!options.silent) showToast("Oura sync runs on the deployed app");
    return;
  }
  if (!options.silent) showToast("Syncing Oura...");
  try {
    state.oura.lastSyncAttemptAt = new Date().toISOString();
    saveState();
    const response = await fetch(`/api/oura-sync?days=${safeDays}`);
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "Oura sync failed");
    state.oura = {
      lastSync: today(),
      lastSyncAt: new Date().toISOString(),
      records: mergeOuraRecords(state.oura.records || [], data.records || []),
    };
    saveState();
    render();
    await syncProfileToCloud();
    if (!options.silent) showToast(`Oura synced: ${data.records?.length || 0} days`);
  } catch (error) {
    if (!options.silent) showToast(error.message);
  } finally {
    scheduleOuraAutoSync();
  }
}

function mergeOuraRecords(existing, incoming) {
  const byDate = new Map(existing.map((record) => [record.date, record]));
  incoming.forEach((record) => byDate.set(record.date, record));
  return Array.from(byDate.values()).sort((a, b) => a.date.localeCompare(b.date)).slice(-180);
}

function scheduleOuraAutoSync() {
  window.clearTimeout(ouraSyncTimer);
  ouraSyncTimer = null;
  const settings = state.settings.oura || initialState.settings.oura;
  if (!settings.autoSync || !isHostedApp()) return;
  const intervalMs = Math.min(Math.max(Number(settings.intervalHours) || 6, 1), 24) * 60 * 60 * 1000;
  const lastSyncTime = Date.parse(state.oura.lastSyncAt || state.oura.lastSyncAttemptAt || "");
  const delay = Number.isFinite(lastSyncTime) ? Math.max(lastSyncTime + intervalMs - Date.now(), 0) : 0;
  ouraSyncTimer = window.setTimeout(() => {
    syncOura(settings.days || 14, { silent: true });
  }, delay);
}

function isHostedApp() {
  return location.protocol === "http:" || location.protocol === "https:";
}

function render() {
  renderTodaySummary();
  renderDashboard();
  renderRecords();
  renderChat();
  renderWorkoutPanel();
  renderPayload();
  renderSettings();
  renderAuth();
}

function prepareDefaults() {
  document.querySelector("#currentDateLabel").textContent = new Date().toLocaleDateString(undefined, {
    weekday: "long",
    month: "short",
    day: "numeric",
  });
  document.querySelector('#meditationForm input[name="time"]').value = nowTime();
  const previousSleep = [...state.entries].reverse().find((entry) => entry.type === "sleep" && entry.fields?.pills);
  document.querySelector("#sleepPillsInput").value = previousSleep?.fields?.pills || "";
}

function labelFor(type) {
  return { exercise: "Exercise", meal: "Meal", sleep: "Sleep", meditation: "Meditation", social: "Social media" }[type] || type;
}

function timeLabel(iso) {
  return new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

function average(values) {
  const clean = values.map(Number).filter((value) => Number.isFinite(value));
  if (!clean.length) return null;
  return clean.reduce((total, value) => total + value, 0) / clean.length;
}

function formatNumber(value) {
  return Number(value).toFixed(1).replace(/\.0$/, "");
}

function hasSupabaseConfig() {
  return Boolean(state.cloud.supabaseUrl && state.cloud.supabaseAnonKey);
}

async function initializeSupabase() {
  if (!hasSupabaseConfig()) {
    renderAuth("Login is unavailable. App configuration is missing.");
    return;
  }

  if (!window.supabase?.createClient) {
    renderAuth("Login could not load. Refresh and try again.");
    return;
  }

  const cacheKey = `${state.cloud.supabaseUrl}|${state.cloud.supabaseAnonKey}`;
  if (!supabaseClient || cacheKey !== supabaseCacheKey) {
    authSubscription?.unsubscribe?.();
    try {
      supabaseClient = window.supabase.createClient(state.cloud.supabaseUrl, state.cloud.supabaseAnonKey, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
        },
      });
    } catch (error) {
      renderAuth(`Login configuration error: ${error.message}`);
      return;
    }
    supabaseCacheKey = cacheKey;
    const {
      data: { subscription },
    } = supabaseClient.auth.onAuthStateChange((_event, session) => {
      authUser = session?.user || null;
      renderAuth();
      if (authUser) syncWithCloud();
    });
    authSubscription = subscription;
  }

  const {
    data: { session },
  } = await supabaseClient.auth.getSession();
  authUser = session?.user || null;
  renderAuth();
  if (authUser) await syncWithCloud();
}

async function handleAuthSubmit(event) {
  event.preventDefault();
  if (!supabaseClient) {
    await initializeSupabase();
    if (!supabaseClient) {
      renderAuth("Login is unavailable. App configuration is missing.");
      showToast("Login unavailable");
      return;
    }
  }

  const action = event.submitter?.dataset.authAction || "signin";
  const formData = Object.fromEntries(new FormData(event.currentTarget).entries());
  const credentials = { email: formData.email.trim(), password: formData.password };
  if (!credentials.email || !credentials.password) {
    renderAuth("Enter an email and password.");
    return;
  }

  renderAuth(action === "signup" ? "Creating account..." : "Logging in...");
  const signupOptions = location.origin.startsWith("http") ? { options: { emailRedirectTo: location.origin } } : {};
  let data;
  let error;
  try {
    const result = await withTimeout(
      action === "signup" ? supabaseClient.auth.signUp({ ...credentials, ...signupOptions }) : supabaseClient.auth.signInWithPassword(credentials),
      15000,
      "Login request timed out. Check deployment configuration and auth settings.",
    );
    data = result.data;
    error = result.error;
  } catch (requestError) {
    renderAuth(requestError.message);
    showToast(requestError.message);
    return;
  }

  if (error) {
    renderAuth(error.message);
    showToast(error.message);
    return;
  }

  authUser = data.session?.user || data.user || authUser;
  event.currentTarget.reset();
  renderAuth(action === "signup" && !data.session ? "Check your email to confirm signup." : "");
  if (authUser) await syncWithCloud();
  showToast(action === "signup" && !data.session ? "Check your email to confirm signup" : "Logged in");
}

function withTimeout(promise, ms, message) {
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      window.setTimeout(() => reject(new Error(message)), ms);
    }),
  ]);
}

async function signOut() {
  if (!supabaseClient) return;
  const { error } = await supabaseClient.auth.signOut();
  if (error) {
    showToast(error.message);
    return;
  }
  authUser = null;
  renderAuth();
  showToast("Logged out");
}

function renderAuth(message = "") {
  const status = document.querySelector("#authStatus");
  const form = document.querySelector("#authForm");
  const logoutButton = document.querySelector("#logoutButton");
  if (!hasSupabaseConfig()) {
    status.textContent = message || "Login unavailable";
    form.classList.remove("is-hidden");
    logoutButton.classList.add("is-hidden");
    return;
  }

  if (authUser) {
    status.textContent = authUser.email || "Logged in";
    form.classList.add("is-hidden");
    logoutButton.classList.remove("is-hidden");
  } else {
    status.textContent = message || "Not logged in";
    form.classList.remove("is-hidden");
    logoutButton.classList.add("is-hidden");
  }
}

async function syncWithCloud() {
  if (!supabaseClient || !authUser) return;
  try {
    await loadProfileFromCloud();
    const { data, error } = await supabaseClient.from("health_entries").select("*").order("created_at", { ascending: true });
    if (error) throw error;
    const cloudEntries = (data || []).map(fromCloudRow);
    mergeCloudEntries(cloudEntries);
    await syncAllToCloud();
    showToast("Synced");
  } catch (error) {
    showToast(`Sync failed: ${error.message}`);
  }
}

function mergeCloudEntries(cloudEntries) {
  const byId = new Map(state.entries.map((entry) => [entry.id, entry]));
  cloudEntries.forEach((entry) => {
    if (!byId.has(entry.id)) byId.set(entry.id, entry);
  });
  state.entries = Array.from(byId.values()).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  saveState();
  render();
}

async function syncAllToCloud() {
  if (!supabaseClient || !authUser || !state.entries.length) return;
  const { error } = await supabaseClient.from("health_entries").upsert(state.entries.map(toCloudRow), { onConflict: "id" });
  if (error) showToast(`Cloud save failed: ${error.message}`);
}

async function syncEntryToCloud(entry) {
  if (!supabaseClient || !authUser) return;
  const { error } = await supabaseClient.from("health_entries").upsert(toCloudRow(entry), { onConflict: "id" });
  if (error) showToast(`Cloud save failed: ${error.message}`);
}

async function deleteEntryFromCloud(id) {
  if (!supabaseClient || !authUser) return;
  const { error } = await supabaseClient.from("health_entries").delete().eq("id", id);
  if (error) showToast(`Cloud delete failed: ${error.message}`);
}

function toCloudRow(entry) {
  return {
    id: entry.id,
    user_id: authUser.id,
    type: entry.type,
    entry_date: entry.date,
    created_at: entry.createdAt,
    raw_text: entry.rawText,
    fields: entry.fields || {},
    extraction: entry.extraction || null,
    extraction_status: entry.extractionStatus || null,
    meal_suggestion: entry.mealSuggestion || null,
    updated_at: entry.updatedAt || new Date().toISOString(),
  };
}

function fromCloudRow(row) {
  return {
    id: row.id,
    type: row.type,
    date: row.entry_date,
    createdAt: row.created_at,
    rawText: row.raw_text,
    fields: row.fields || {},
    extraction: row.extraction || null,
    extractionStatus: row.extraction_status || null,
    mealSuggestion: row.meal_suggestion || null,
    updatedAt: row.updated_at || null,
  };
}

async function syncProfileToCloud() {
  if (!supabaseClient || !authUser) return;
  const { error } = await supabaseClient
    .from("health_profiles")
    .upsert(
      {
        user_id: authUser.id,
        profile: state.profile,
        settings: state.settings,
        oura: state.oura,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id" },
    );
  if (error) showToast(`Profile cloud save failed: ${error.message}`);
}

async function loadProfileFromCloud() {
  if (!supabaseClient || !authUser) return;
  const { data, error } = await supabaseClient.from("health_profiles").select("*").eq("user_id", authUser.id).maybeSingle();
  if (error) {
    showToast(`Profile sync failed: ${error.message}`);
    return;
  }
  if (data) {
    state.profile = { ...initialState.profile, ...(data.profile || {}) };
    state.settings = { ...state.settings, ...(data.settings || {}) };
    state.oura = { ...initialState.oura, ...(data.oura || state.oura || {}) };
    saveState();
    render();
  } else {
    await syncProfileToCloud();
  }
}

async function loadRemoteConfig() {
  if (hasSupabaseConfig()) return;
  try {
    const response = await fetch("/api/config");
    if (!response.ok) return;
    const config = await response.json();
    if (config.supabaseUrl && config.supabaseAnonKey) {
      state.cloud.supabaseUrl = config.supabaseUrl;
      state.cloud.supabaseAnonKey = config.supabaseAnonKey;
      saveState();
    }
  } catch {
    // file:// and offline usage land here.
  }
}

async function bootstrapCloud() {
  await loadRemoteConfig();
  render();
  await initializeSupabase();
  scheduleOuraAutoSync();
}

setupNavigation();
setupForms();
setupDataActions();
prepareDefaults();
render();
scheduleReminders();
scheduleOuraAutoSync();
bootstrapCloud();
