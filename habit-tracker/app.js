(() => {
  const STORAGE_KEY = "habit-tracker-v1";
  const BACKUP_KEY = "habit-tracker-v1-backup";
  const SCHEMA_VERSION = 2;
  const CHECK_SVG =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4.5 12.5l4.6 4.6L19.5 6.8"/></svg>';
  const REMOVE_SVG =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';

  const ICON_RULES = [
    [/水|喝水|饮/, "💧"],
    [/运动|跑步|健身|锻炼|瑜伽|散步|走路|拉伸/, "🏃"],
    [/读书|阅读|看书|书/, "📖"],
    [/冥想|静坐|深呼吸/, "🧘"],
    [/早睡|睡觉|睡眠|休息/, "🌙"],
    [/日记|写作|记录/, "✍️"],
    [/英语|单词|学习|背|课程/, "📚"],
    [/早餐|饮食|蔬菜|水果|健康吃/, "🥗"],
    [/药|维生素/, "💊"],
    [/音乐|练琴|钢琴|吉他/, "🎵"],
    [/画|绘画|设计/, "🎨"],
    [/整理|打扫|收拾/, "🧹"],
    [/花|植物|浇/, "🪴"],
  ];

  const els = {
    todayText: document.getElementById("todayText"),
    doneCount: document.getElementById("doneCount"),
    progressHint: document.getElementById("progressHint"),
    allDoneBadge: document.getElementById("allDoneBadge"),
    ringValue: document.getElementById("ringValue"),
    ringPercent: document.getElementById("ringPercent"),
    ringTotal: document.getElementById("ringTotal"),
    progressCard: document.querySelector(".progress-card"),
    addForm: document.getElementById("addForm"),
    habitInput: document.getElementById("habitInput"),
    habitList: document.getElementById("habitList"),
    habitsCount: document.getElementById("habitsCount"),
    emptyState: document.getElementById("emptyState"),
    historyCount: document.getElementById("historyCount"),
    historyList: document.getElementById("historyList"),
    historyEmpty: document.getElementById("historyEmpty"),
    toast: document.getElementById("toast"),
    toastText: document.getElementById("toastText"),
    toastAction: document.getElementById("toastAction"),
  };

  const RING_LENGTH = 2 * Math.PI * 50;
  const WEEKDAYS = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];

  const loadedState = loadState();
  let state = loadedState.state;
  const stateNeedsSave = loadedState.migrated;
  let currentDay = dayKey(new Date());
  const openHistoryDays = new Set([currentDay]);
  let toastTimer = 0;
  let toastAction = null;

  function makeId() {
    if (window.crypto && typeof window.crypto.randomUUID === "function") {
      return window.crypto.randomUUID();
    }
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function dayKey(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }

  function shiftDay(key, offset) {
    const [y, m, d] = key.split("-").map(Number);
    const date = new Date(y, m - 1, d);
    date.setDate(date.getDate() + offset);
    return dayKey(date);
  }

  function isDayKey(value) {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      return false;
    }
    const [year, month, day] = value.split("-").map(Number);
    const date = new Date(year, month - 1, day);
    return (
      date.getFullYear() === year &&
      date.getMonth() === month - 1 &&
      date.getDate() === day
    );
  }

  function sanitizeCompleted(raw, habitIds) {
    const completed = {};
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return completed;

    for (const [day, ids] of Object.entries(raw)) {
      if (!isDayKey(day) || !Array.isArray(ids)) continue;
      const clean = [
        ...new Set(
          ids.filter((id) => typeof id === "string" && habitIds.has(id))
        ),
      ];
      if (clean.length > 0) completed[day] = clean;
    }
    return completed;
  }

  function sanitizeCheckins(raw, habitIds) {
    if (!Array.isArray(raw)) return [];
    const checkins = [];
    const seenIds = new Set();

    for (const item of raw) {
      if (!item || typeof item !== "object") continue;
      const { habitId, date } = item;
      if (!habitIds.has(habitId) || !isDayKey(date)) continue;

      let id = typeof item.id === "string" && item.id ? item.id : makeId();
      if (seenIds.has(id)) id = makeId();
      seenIds.add(id);

      const at =
        typeof item.at === "number" && Number.isFinite(item.at) && item.at > 0
          ? item.at
          : null;
      checkins.push({ id, habitId, date, at });
    }
    return checkins;
  }

  function loadState() {
    const empty = {
      schemaVersion: SCHEMA_VERSION,
      habits: [],
      completed: {},
      checkins: [],
    };

    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return { state: empty, migrated: false };

      const parsed = JSON.parse(raw);
      if (!parsed || !Array.isArray(parsed.habits)) {
        return { state: empty, migrated: false };
      }

      const habits = [];
      const habitIds = new Set();
      for (const habit of parsed.habits) {
        if (
          !habit ||
          typeof habit.id !== "string" ||
          typeof habit.name !== "string" ||
          !habit.name.trim() ||
          habitIds.has(habit.id)
        ) {
          continue;
        }
        habitIds.add(habit.id);
        habits.push({
          id: habit.id,
          name: displayName(habit.name.trim()),
          icon:
            typeof habit.icon === "string" && habit.icon
              ? habit.icon
              : iconFor(habit.name),
          createdAt:
            typeof habit.createdAt === "number"
              ? habit.createdAt
              : Date.now(),
        });
      }

      const hasLegacyCheckins =
        parsed.checkins &&
        typeof parsed.checkins === "object" &&
        !Array.isArray(parsed.checkins);
      const isCurrentSchema =
        !hasLegacyCheckins &&
        (parsed.schemaVersion === SCHEMA_VERSION ||
          Array.isArray(parsed.checkins));

      if (isCurrentSchema) {
        return {
          state: {
            schemaVersion: SCHEMA_VERSION,
            habits,
            completed: sanitizeCompleted(parsed.completed, habitIds),
            checkins: sanitizeCheckins(parsed.checkins, habitIds),
          },
          migrated: false,
        };
      }

      const completed = sanitizeCompleted(parsed.checkins, habitIds);
      const checkins = [];
      if (parsed.checkins && typeof parsed.checkins === "object") {
        for (const [day, ids] of Object.entries(parsed.checkins)) {
          if (!isDayKey(day) || !Array.isArray(ids)) continue;
          for (const habitId of new Set(ids)) {
            if (!habitIds.has(habitId)) continue;
            checkins.push({
              id: makeId(),
              habitId,
              date: day,
              at: null,
            });
          }
        }
      }

      try {
        if (!localStorage.getItem(BACKUP_KEY)) {
          localStorage.setItem(BACKUP_KEY, raw);
        }
      } catch (err) {
        console.warn("无法备份旧版数据：", err);
      }

      return {
        state: {
          schemaVersion: SCHEMA_VERSION,
          habits,
          completed,
          checkins,
        },
        migrated: true,
      };
    } catch (err) {
      console.warn("无法读取本地数据：", err);
      return { state: empty, migrated: false };
    }
  }

  function saveState() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (err) {
      console.warn("无法保存本地数据：", err);
      showToast("保存失败，请检查浏览器存储权限", null);
    }
  }

  function checkedFor(key) {
    const list = state.completed[key];
    return new Set(Array.isArray(list) ? list : []);
  }

  function setChecked(key, ids) {
    state.completed[key] = Array.from(ids);
    if (state.completed[key].length === 0) delete state.completed[key];
  }

  function iconFor(name) {
    for (const [pattern, icon] of ICON_RULES) {
      if (pattern.test(name)) return icon;
    }
    return "🌿";
  }

  function displayName(name) {
    return name.length > 24 ? name.slice(0, 24) : name;
  }

  function formatClock(at) {
    const date = new Date(at);
    return `${String(date.getHours()).padStart(2, "0")}:${String(
      date.getMinutes()
    ).padStart(2, "0")}`;
  }

  function latestCheckinsForDay(day) {
    const latest = new Map();
    for (const event of state.checkins) {
      if (event.date !== day) continue;
      const previous = latest.get(event.habitId);
      if (!previous || (event.at ?? -1) >= (previous.at ?? -1)) {
        latest.set(event.habitId, event);
      }
    }
    return latest;
  }

  function parseDayKey(key) {
    const [year, month, day] = key.split("-").map(Number);
    return new Date(year, month - 1, day);
  }

  function historyDayLabel(key) {
    const date = parseDayKey(key);
    const base = `${date.getMonth() + 1}月${date.getDate()}日 ${
      WEEKDAYS[date.getDay()]
    }`;
    if (key === currentDay) return `今天 · ${base}`;
    if (key === shiftDay(currentDay, -1)) return `昨天 · ${base}`;
    const today = parseDayKey(currentDay);
    if (date.getFullYear() !== today.getFullYear()) {
      return `${date.getFullYear()}年${base}`;
    }
    return base;
  }

  function streakFor(habitId) {
    let key = dayKey(new Date());
    let checked = checkedFor(key);
    if (!checked.has(habitId)) {
      key = shiftDay(key, -1);
      checked = checkedFor(key);
      if (!checked.has(habitId)) return 0;
    }

    let streak = 0;
    for (let i = 0; i < 3650; i += 1) {
      if (checkedFor(key).has(habitId)) {
        streak += 1;
        key = shiftDay(key, -1);
      } else {
        break;
      }
    }
    return streak;
  }

  function updateToday() {
    const now = new Date();
    els.todayText.textContent = `${now.getMonth() + 1}月${now.getDate()}日 · ${
      WEEKDAYS[now.getDay()]
    }`;
  }

  function renderProgress() {
    const checked = checkedFor(currentDay);
    const total = state.habits.length;
    let done = 0;
    for (const habit of state.habits) {
      if (checked.has(habit.id)) done += 1;
    }

    const percent = total === 0 ? 0 : Math.round((done / total) * 100);
    els.doneCount.textContent = String(done);
    els.ringPercent.textContent = `${percent}%`;
    els.ringTotal.textContent = `共 ${total} 项`;
    els.ringValue.style.strokeDashoffset = String(
      RING_LENGTH - (RING_LENGTH * percent) / 100
    );

    let hint = "添加第一个习惯，开始今天的打卡。";
    if (total > 0 && done === 0) {
      hint = `今天有 ${total} 件小事等你完成。`;
    } else if (total > 0 && done < total) {
      hint = `还差 ${total - done} 项，今天的目标就达成了。`;
    } else if (total > 0) {
      hint = "今天全部完成，给自己一点掌声。";
    }
    els.progressHint.textContent = hint;

    const isComplete = total > 0 && done === total;
    els.allDoneBadge.hidden = !isComplete;
    els.progressCard.classList.toggle("is-complete", isComplete);
  }

  function buildHabitItem(habit, checked, latestEvent) {
    const li = document.createElement("li");
    li.className = "habit" + (checked ? " is-done" : "");
    li.dataset.id = habit.id;

    const timeLabel =
      latestEvent && latestEvent.at
        ? `${formatClock(latestEvent.at)} 打卡`
        : "已打卡 · 未记录时间";

    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "habit-toggle";
    toggle.setAttribute("aria-pressed", String(checked));
    toggle.setAttribute(
      "aria-label",
      `${checked ? "取消完成" : "完成"}：${habit.name}${
        checked ? `，${timeLabel}` : ""
      }`
    );
    toggle.dataset.action = "toggle";

    const check = document.createElement("span");
    check.className = "check";
    check.setAttribute("aria-hidden", "true");
    check.innerHTML = CHECK_SVG;

    const name = document.createElement("span");
    name.className = "habit-name";
    name.textContent = habit.name;

    const copy = document.createElement("span");
    copy.className = "habit-copy";
    copy.append(name);

    if (checked) {
      const time = document.createElement("span");
      time.className = "habit-time";
      time.textContent = timeLabel;
      copy.append(time);
    }

    toggle.append(check, copy);

    const streak = streakFor(habit.id);
    if (streak >= 2) {
      const badge = document.createElement("span");
      badge.className = "streak";
      badge.textContent = `${habit.icon || iconFor(habit.name)} 连续 ${streak} 天`;
      toggle.append(badge);
    }

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "habit-remove";
    remove.dataset.action = "remove";
    remove.setAttribute("aria-label", `删除习惯：${habit.name}`);
    remove.innerHTML = REMOVE_SVG;

    li.append(toggle, remove);
    return li;
  }

  function renderHabits() {
    const checked = checkedFor(currentDay);
    const latest = latestCheckinsForDay(currentDay);
    els.habitList.replaceChildren();

    for (const habit of state.habits) {
      els.habitList.append(
        buildHabitItem(habit, checked.has(habit.id), latest.get(habit.id))
      );
    }

    els.habitsCount.textContent = `${state.habits.length} 项`;
    els.emptyState.hidden = state.habits.length > 0;
  }

  function renderHistory() {
    const habitMap = new Map(state.habits.map((habit) => [habit.id, habit]));
    const days = new Map();
    let total = 0;

    for (const event of state.checkins) {
      if (!habitMap.has(event.habitId)) continue;
      if (!days.has(event.date)) days.set(event.date, []);
      days.get(event.date).push(event);
      total += 1;
    }

    els.historyList.replaceChildren();
    els.historyCount.textContent = `${total} 次`;
    els.historyEmpty.hidden = total > 0;
    if (total === 0) return;

    for (const day of [...days.keys()].sort((a, b) => b.localeCompare(a))) {
      const events = days.get(day);
      const details = document.createElement("details");
      details.className = "history-day";
      details.open = openHistoryDays.has(day);
      details.addEventListener("toggle", () => {
        if (details.open) openHistoryDays.add(day);
        else openHistoryDays.delete(day);
      });

      const summary = document.createElement("summary");
      const date = document.createElement("span");
      date.className = "history-date";
      date.textContent = historyDayLabel(day);
      const dayCount = document.createElement("span");
      dayCount.className = "history-day-count";
      dayCount.textContent = `${events.length} 次`;
      const chevron = document.createElement("span");
      chevron.className = "history-chevron";
      chevron.setAttribute("aria-hidden", "true");
      summary.setAttribute(
        "aria-label",
        `${historyDayLabel(day)}，${events.length} 条打卡记录`
      );
      summary.append(date, dayCount, chevron);

      const list = document.createElement("ol");
      list.className = "history-events";
      const sorted = events
        .slice()
        .sort((a, b) => (b.at ?? -1) - (a.at ?? -1));

      for (const event of sorted) {
        const habit = habitMap.get(event.habitId);
        const item = document.createElement("li");
        item.className = "history-event";

        const icon = document.createElement("span");
        icon.className = "history-event-icon";
        icon.setAttribute("aria-hidden", "true");
        icon.textContent = habit.icon || iconFor(habit.name);

        const name = document.createElement("span");
        name.className = "history-event-name";
        name.textContent = habit.name;

        const time = document.createElement("span");
        time.className =
          "history-event-time" + (event.at ? "" : " is-unknown");
        time.textContent = event.at ? formatClock(event.at) : "未记录时间";

        item.append(icon, name, time);
        list.append(item);
      }

      details.append(summary, list);
      els.historyList.append(details);
    }
  }

  function render() {
    updateToday();
    renderProgress();
    renderHabits();
    renderHistory();
  }

  function addHabit(name) {
    const trimmed = name.trim().replace(/\s+/g, " ");
    if (!trimmed) {
      els.habitInput.focus();
      return;
    }

    const exists = state.habits.some(
      (h) => h.name.toLowerCase() === trimmed.toLowerCase()
    );
    if (exists) {
      showToast("这个习惯已经在列表里了", null);
      els.habitInput.select();
      return;
    }

    state.habits.push({
      id: makeId(),
      name: displayName(trimmed),
      icon: iconFor(trimmed),
      createdAt: Date.now(),
    });
    saveState();
    els.habitInput.value = "";
    render();
    els.habitInput.focus();
  }

  function toggleHabit(id) {
    const habit = state.habits.find((h) => h.id === id);
    if (!habit) return;

    const checked = checkedFor(currentDay);
    if (checked.has(id)) {
      checked.delete(id);
    } else {
      checked.add(id);
      state.checkins.push({
        id: makeId(),
        habitId: id,
        date: currentDay,
        at: Date.now(),
      });
    }
    setChecked(currentDay, checked);
    saveState();
    renderProgress();
    renderHabits();
    renderHistory();

    const item = els.habitList.querySelector(`.habit[data-id="${id}"]`);
    const toggle = item && item.querySelector('[data-action="toggle"]');
    if (toggle) toggle.focus({ preventScroll: true });
  }

  function removeHabit(id) {
    const habit = state.habits.find((h) => h.id === id);
    if (!habit) return;

    const snapshot = JSON.parse(JSON.stringify(state));
    state.habits = state.habits.filter((h) => h.id !== id);
    for (const key of Object.keys(state.completed)) {
      state.completed[key] = state.completed[key].filter((item) => item !== id);
      if (state.completed[key].length === 0) delete state.completed[key];
    }
    state.checkins = state.checkins.filter((event) => event.habitId !== id);
    saveState();
    render();
    showToast(`已删除「${habit.name}」`, () => {
      state = snapshot;
      saveState();
      render();
    });
  }

  function showToast(message, action) {
    window.clearTimeout(toastTimer);
    els.toastText.textContent = message;
    toastAction = action;
    els.toast.hidden = false;
    els.toastAction.hidden = typeof action !== "function";

    requestAnimationFrame(() => {
      els.toast.classList.add("is-visible");
    });

    toastTimer = window.setTimeout(hideToast, 4200);
  }

  function hideToast() {
    window.clearTimeout(toastTimer);
    els.toast.classList.remove("is-visible");
    toastTimer = window.setTimeout(() => {
      els.toast.hidden = true;
    }, 260);
  }

  els.addForm.addEventListener("submit", (event) => {
    event.preventDefault();
    addHabit(els.habitInput.value);
  });

  els.habitList.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-action]");
    if (!button) return;
    const item = button.closest(".habit");
    if (!item) return;
    if (button.dataset.action === "toggle") {
      toggleHabit(item.dataset.id);
    } else if (button.dataset.action === "remove") {
      removeHabit(item.dataset.id);
    }
  });

  els.toastAction.addEventListener("click", () => {
    if (typeof toastAction === "function") {
      const action = toastAction;
      toastAction = null;
      hideToast();
      action();
    }
  });

  function checkDayChange() {
    const today = dayKey(new Date());
    if (today !== currentDay) {
      currentDay = today;
      openHistoryDays.add(today);
      render();
    } else {
      updateToday();
    }
  }

  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) checkDayChange();
  });

  window.addEventListener("storage", (event) => {
    if (event.key === STORAGE_KEY) {
      state = loadState().state;
      currentDay = dayKey(new Date());
      openHistoryDays.add(currentDay);
      render();
    }
  });

  window.setInterval(checkDayChange, 30000);

  render();
  if (stateNeedsSave) saveState();
})();
