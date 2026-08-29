import { Type, FunctionDeclaration } from "@google/genai";
import fs from "fs";
import path from "path";
import { execHermes, getVaultPath } from "./hermesBridge.js";

export interface ModularSkill {
  name: string;
  displayName: string;
  description: string;
  icon: string;
  category: "Weather" | "News" | "Productivity" | "Utility" | "System";
  declaration: FunctionDeclaration;
  execute: (args: any, context?: any) => Promise<{
    success: boolean;
    data: any;
    speechSummary: string;
    displayCard?: {
      type: string;
      title: string;
      data: any;
    };
  }>;
}

// In-memory persistent reminder storage
export interface ReminderItem {
  id: string;
  text: string;
  createdAt: number;
  dueAt: number;
  dueDateString: string;
  completed: boolean;
}

const remindersStore: ReminderItem[] = [];

// Helper: Weather WMO code mapping
function getWeatherDescription(code: number): string {
  const map: Record<number, string> = {
    0: "Clear sky",
    1: "Mainly clear",
    2: "Partly cloudy",
    3: "Overcast",
    45: "Foggy",
    48: "Depositing rime fog",
    51: "Light drizzle",
    53: "Moderate drizzle",
    55: "Dense drizzle",
    61: "Slight rain",
    63: "Moderate rain",
    65: "Heavy rain",
    71: "Slight snow fall",
    73: "Moderate snow fall",
    75: "Heavy snow fall",
    80: "Slight rain showers",
    81: "Moderate rain showers",
    82: "Violent rain showers",
    95: "Thunderstorm",
    96: "Thunderstorm with slight hail",
    99: "Thunderstorm with heavy hail",
  };
  return map[code] || "Variable weather";
}

// Helper: Weather Skill
export const weatherSkill: ModularSkill = {
  name: "get_weather_forecast",
  displayName: "Live Weather & Forecast",
  description:
    "Fetches real-time weather conditions, temperature, humidity, wind speed, precipitation, and 3-day forecast for any city or location worldwide.",
  icon: "CloudSun",
  category: "Weather",
  declaration: {
    name: "get_weather_forecast",
    description:
      "Get real-time live weather conditions and multi-day forecast for a given location or city. Call this when the user asks about weather, rain, temperature, outside conditions, or forecasts.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        location: {
          type: Type.STRING,
          description: "The city or location name, e.g. 'New York', 'London', 'Tokyo', 'Sydney', 'Paris'.",
        },
        unit: {
          type: Type.STRING,
          description: "Temperature unit preference: 'celsius' or 'fahrenheit'. Defaults to 'celsius'.",
        },
      },
      required: ["location"],
    },
  },
  execute: async (args: { location: string; unit?: string }) => {
    try {
      const locationQuery = args.location?.trim() || "San Francisco";
      const isFahrenheit = args.unit?.toLowerCase() === "fahrenheit" || args.unit?.toLowerCase() === "f";

      // 1. Geocoding lookup
      const geoUrl = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(
        locationQuery
      )}&count=1&language=en&format=json`;

      const geoRes = await fetch(geoUrl);
      if (!geoRes.ok) {
        throw new Error(`Geocoding failed with status ${geoRes.status}`);
      }
      const geoData = await geoRes.json();
      if (!geoData.results || geoData.results.length === 0) {
        return {
          success: false,
          data: { location: locationQuery },
          speechSummary: `I could not locate "${locationQuery}". Please specify a known city or region.`,
        };
      }

      const match = geoData.results[0];
      const { latitude, longitude, name, country, admin1 } = match;
      const fullLocationName = [name, admin1, country].filter(Boolean).join(", ");

      // 2. Weather Forecast lookup
      const tempUnitParam = isFahrenheit ? "&temperature_unit=fahrenheit" : "";
      const windUnitParam = isFahrenheit ? "&wind_speed_unit=mph" : "&wind_speed_unit=kmh";
      const weatherUrl = `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max&timezone=auto${tempUnitParam}${windUnitParam}`;

      const weatherRes = await fetch(weatherUrl);
      if (!weatherRes.ok) {
        throw new Error(`Weather API returned status ${weatherRes.status}`);
      }
      const weatherData = await weatherRes.json();
      const current = weatherData.current;
      const daily = weatherData.daily;

      const conditionDesc = getWeatherDescription(current?.weather_code || 0);
      const unitSymbol = isFahrenheit ? "°F" : "°C";
      const speedSymbol = isFahrenheit ? "mph" : "km/h";

      const currentTemp = Math.round(current?.temperature_2m ?? 20);
      const feelsLike = Math.round(current?.apparent_temperature ?? currentTemp);
      const humidity = current?.relative_humidity_2m ?? 50;
      const windSpeed = Math.round(current?.wind_speed_10m ?? 0);
      const precipitation = current?.precipitation ?? 0;

      // 3-day forecast summary
      const forecastDays: Array<{
        day: string;
        maxTemp: number;
        minTemp: number;
        condition: string;
        rainProb: number;
      }> = [];

      if (daily?.time && Array.isArray(daily.time)) {
        for (let i = 0; i < Math.min(3, daily.time.length); i++) {
          const dateStr = daily.time[i];
          const dateObj = new Date(dateStr);
          const dayName = i === 0 ? "Today" : dateObj.toLocaleDateString("en-US", { weekday: "short" });
          forecastDays.push({
            day: dayName,
            maxTemp: Math.round(daily.temperature_2m_max?.[i] ?? currentTemp),
            minTemp: Math.round(daily.temperature_2m_min?.[i] ?? currentTemp),
            condition: getWeatherDescription(daily.weather_code?.[i] ?? 0),
            rainProb: daily.precipitation_probability_max?.[i] ?? 0,
          });
        }
      }

      const speechSummary = `In ${fullLocationName}, it's currently ${currentTemp}${unitSymbol} and ${conditionDesc.toLowerCase()}. Feels like ${feelsLike}${unitSymbol} with ${humidity}% humidity and winds at ${windSpeed} ${speedSymbol}. High of ${
        forecastDays[0]?.maxTemp ?? currentTemp
      }${unitSymbol} today.`;

      return {
        success: true,
        data: {
          location: fullLocationName,
          temperature: currentTemp,
          unit: unitSymbol,
          feelsLike,
          condition: conditionDesc,
          humidity,
          windSpeed: `${windSpeed} ${speedSymbol}`,
          precipitation: `${precipitation} mm`,
          forecast: forecastDays,
        },
        speechSummary,
        displayCard: {
          type: "weather",
          title: `Weather in ${name}`,
          data: {
            location: fullLocationName,
            temperature: `${currentTemp}${unitSymbol}`,
            feelsLike: `${feelsLike}${unitSymbol}`,
            condition: conditionDesc,
            humidity: `${humidity}%`,
            windSpeed: `${windSpeed} ${speedSymbol}`,
            forecast: forecastDays,
          },
        },
      };
    } catch (err: any) {
      console.error("Error executing weather skill:", err);
      return {
        success: false,
        data: { error: err.message },
        speechSummary: `I encountered an issue checking the weather for ${args.location}. Please try again shortly.`,
      };
    }
  },
};

// Helper: News Skill (Google News RSS & Category Parsing)
export const newsSkill: ModularSkill = {
  name: "get_news_headlines",
  displayName: "Live News & Headlines",
  description:
    "Fetches real-time breaking news, global top stories, or specific category headlines (technology, business, science, AI, sports).",
  icon: "Newspaper",
  category: "News",
  declaration: {
    name: "get_news_headlines",
    description:
      "Get real-time breaking news headlines and top stories by category or keyword search. Call this when the user asks for news, headlines, what's happening in the world, tech news, or current events.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        topic: {
          type: Type.STRING,
          description:
            "Category or topic: 'top' (top world stories), 'technology', 'business', 'science', 'sports', 'ai' (artificial intelligence), 'entertainment', or any custom topic/query.",
        },
        count: {
          type: Type.NUMBER,
          description: "Number of headlines to retrieve (default: 4, max: 6).",
        },
      },
    },
  },
  execute: async (args: { topic?: string; count?: number }) => {
    try {
      const topic = (args.topic || "top").toLowerCase().trim();
      const count = Math.min(Math.max(args.count || 4, 1), 6);

      let rssUrl = "";
      const topicUpper = topic.toUpperCase();
      if (topic === "top" || topic === "world" || topic === "headlines") {
        rssUrl = "https://news.google.com/rss?hl=en-US&gl=US&ceid=US:en";
      } else if (["TECHNOLOGY", "BUSINESS", "SCIENCE", "SPORTS", "ENTERTAINMENT", "HEALTH"].includes(topicUpper)) {
        rssUrl = `https://news.google.com/rss/headlines/section/topic/${topicUpper}?hl=en-US&gl=US&ceid=US:en`;
      } else {
        rssUrl = `https://news.google.com/rss/search?q=${encodeURIComponent(topic)}&hl=en-US&gl=US&ceid=US:en`;
      }

      const res = await fetch(rssUrl, {
        headers: { "User-Agent": "Mozilla/5.0 (compatible; FRIDAY-VoiceAgent/1.0)" },
      });
      if (!res.ok) {
        throw new Error(`News feed responded with status ${res.status}`);
      }

      const xmlText = await res.text();

      // Simple regex extraction of RSS items
      const items: Array<{ title: string; link: string; source: string; pubDate: string }> = [];
      const itemRegex = /<item>([\s\S]*?)<\/item>/gi;
      let match;
      while ((match = itemRegex.exec(xmlText)) !== null && items.length < count) {
        const itemBlock = match[1];
        const titleMatch = /<title>([\s\S]*?)<\/title>/i.exec(itemBlock);
        const linkMatch = /<link>([\s\S]*?)<\/link>/i.exec(itemBlock);
        const pubDateMatch = /<pubDate>([\s\S]*?)<\/pubDate>/i.exec(itemBlock);
        const sourceMatch = /<source[^>]*>([\s\S]*?)<\/source>/i.exec(itemBlock);

        if (titleMatch && titleMatch[1]) {
          let rawTitle = titleMatch[1]
            .replace(/<!\[CDATA\[(.*?)\]\]>/g, "$1")
            .replace(/&amp;/g, "&")
            .replace(/&quot;/g, '"')
            .replace(/&#39;/g, "'")
            .trim();

          // Extract source suffix if present (e.g., "Headline - Reuters")
          let source = sourceMatch ? sourceMatch[1].replace(/<!\[CDATA\[(.*?)\]\]>/g, "$1").trim() : "News";
          if (rawTitle.includes(" - ")) {
            const parts = rawTitle.split(" - ");
            if (parts.length > 1) {
              source = parts.pop() || source;
              rawTitle = parts.join(" - ");
            }
          }

          items.push({
            title: rawTitle,
            link: linkMatch ? linkMatch[1].trim() : "",
            source,
            pubDate: pubDateMatch ? pubDateMatch[1].trim() : "",
          });
        }
      }

      if (items.length === 0) {
        return {
          success: true,
          data: { topic, headlines: [] },
          speechSummary: `I checked the live feeds for ${topic}, but found no recent breaking stories at this moment.`,
        };
      }

      const headlinesSummary = items
        .map((it, idx) => `${idx + 1}. ${it.title} via ${it.source}.`)
        .join(" ");

      const speechSummary = `Here are the top ${topic} headlines right now: ${headlinesSummary}`;

      return {
        success: true,
        data: {
          topic,
          count: items.length,
          articles: items,
        },
        speechSummary,
        displayCard: {
          type: "news",
          title: `Top ${topic.charAt(0).toUpperCase() + topic.slice(1)} News`,
          data: {
            topic,
            articles: items,
          },
        },
      };
    } catch (err: any) {
      console.error("Error executing news skill:", err);
      return {
        success: false,
        data: { error: err.message },
        speechSummary: `I was unable to load live news headlines right now. Please try again.`,
      };
    }
  },
};

// Helper: Reminders & Task Skill
export const remindersSkill: ModularSkill = {
  name: "manage_reminders",
  displayName: "Smart Reminders & Alarms",
  description:
    "Creates, lists, completes, or deletes reminders with natural language time parsing and live audio/visual chime notifications.",
  icon: "Bell",
  category: "Productivity",
  declaration: {
    name: "manage_reminders",
    description:
      "Manage reminders, timers, and scheduled tasks. Call this when the user asks to set a reminder (e.g. 'remind me in 10 minutes to submit report'), list reminders ('what are my reminders?'), or complete/delete a reminder.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        action: {
          type: Type.STRING,
          description:
            "Action to perform: 'create' (add new reminder), 'list' (view all active reminders), 'complete' (mark reminder done), 'delete' (remove reminder), or 'clear_all'.",
        },
        text: {
          type: Type.STRING,
          description: "The task or reminder text (e.g., 'Turn off the oven', 'Call Dr. Smith', 'Review pull request').",
        },
        due_in_minutes: {
          type: Type.NUMBER,
          description: "Minutes from now when the reminder should trigger (e.g., 5, 15, 60).",
        },
        due_time_string: {
          type: Type.STRING,
          description: "Natural language time string if minutes not specified (e.g. '5:30 PM', 'tomorrow morning').",
        },
        reminder_id: {
          type: Type.STRING,
          description: "ID of the reminder for complete or delete actions.",
        },
      },
      required: ["action"],
    },
  },
  execute: async (args: {
    action: "create" | "list" | "complete" | "delete" | "clear_all";
    text?: string;
    due_in_minutes?: number;
    due_time_string?: string;
    reminder_id?: string;
  }) => {
    const action = args.action || "list";
    const now = Date.now();

    if (action === "create") {
      const taskText = args.text?.trim() || "Reminder";
      let minutes = args.due_in_minutes;

      if (!minutes && args.due_time_string) {
        const lower = args.due_time_string.toLowerCase();
        if (lower.includes("hour")) {
          const num = parseInt(lower) || 1;
          minutes = num * 60;
        } else if (lower.includes("min")) {
          minutes = parseInt(lower) || 5;
        } else {
          minutes = 10; // default 10 minutes
        }
      }
      if (!minutes || minutes <= 0) minutes = 5;

      const dueAt = now + minutes * 60 * 1000;
      const dueTimeFormatted = new Date(dueAt).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      });

      const newReminder: ReminderItem = {
        id: `rem_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`,
        text: taskText,
        createdAt: now,
        dueAt,
        dueDateString: dueTimeFormatted,
        completed: false,
      };

      remindersStore.push(newReminder);

      return {
        success: true,
        data: {
          action: "created",
          reminder: newReminder,
          activeCount: remindersStore.filter((r) => !r.completed).length,
        },
        speechSummary: `Reminder set: "${taskText}" for ${dueTimeFormatted} (in ${minutes} minute${
          minutes === 1 ? "" : "s"
        }). I'll notify you when it's due.`,
        displayCard: {
          type: "reminder_created",
          title: "Reminder Scheduled",
          data: newReminder,
        },
      };
    }

    if (action === "list") {
      const active = remindersStore.filter((r) => !r.completed);
      if (active.length === 0) {
        return {
          success: true,
          data: { reminders: [] },
          speechSummary: "You have no active reminders right now.",
          displayCard: {
            type: "reminders_list",
            title: "Active Reminders",
            data: { reminders: [] },
          },
        };
      }

      const summaryList = active
        .map((r, i) => `${i + 1}. "${r.text}" due at ${r.dueDateString}`)
        .join("; ");

      return {
        success: true,
        data: { reminders: active },
        speechSummary: `You have ${active.length} active reminder${
          active.length === 1 ? "" : "s"
        }: ${summaryList}.`,
        displayCard: {
          type: "reminders_list",
          title: `Active Reminders (${active.length})`,
          data: { reminders: active },
        },
      };
    }

    if (action === "complete") {
      const targetId = args.reminder_id;
      let completedItem: ReminderItem | undefined;

      if (targetId) {
        completedItem = remindersStore.find((r) => r.id === targetId);
      } else if (args.text) {
        completedItem = remindersStore.find(
          (r) => !r.completed && r.text.toLowerCase().includes(args.text!.toLowerCase())
        );
      } else {
        completedItem = remindersStore.find((r) => !r.completed);
      }

      if (completedItem) {
        completedItem.completed = true;
        return {
          success: true,
          data: { completed: completedItem },
          speechSummary: `Marked "${completedItem.text}" as completed.`,
        };
      }

      return {
        success: false,
        data: {},
        speechSummary: "Could not find that reminder to mark complete.",
      };
    }

    if (action === "clear_all") {
      const count = remindersStore.length;
      remindersStore.length = 0;
      return {
        success: true,
        data: { cleared: count },
        speechSummary: `Cleared all ${count} reminders.`,
      };
    }

    return {
      success: true,
      data: { reminders: remindersStore },
      speechSummary: `Reminders synchronized.`,
    };
  },
};

// Helper: Calculation & Unit Conversion Skill
export const calculationSkill: ModularSkill = {
  name: "calculate_or_convert",
  displayName: "Precise Calculation & Unit Converter",
  description:
    "Performs fast mathematical computations, currency estimates, metric/imperial conversions, and timezone calculations.",
  icon: "Calculator",
  category: "Utility",
  declaration: {
    name: "calculate_or_convert",
    description:
      "Perform high-precision math computations, unit conversions (meters/feet, kg/lbs, km/miles, celsius/fahrenheit), or timezone conversions. Call this when the user asks for calculations, conversions, or percentages.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        expression: {
          type: Type.STRING,
          description: "The mathematical expression or conversion query, e.g. '15% of 850', '500 miles in km', '32 Celsius in Fahrenheit'.",
        },
      },
      required: ["expression"],
    },
  },
  execute: async (args: { expression: string }) => {
    try {
      const expr = args.expression?.trim() || "";

      // Quick unit conversion heuristics
      let resultText = "";
      const lower = expr.toLowerCase();

      if (lower.includes("celsius to fahrenheit") || lower.includes("c to f")) {
        const num = parseFloat(lower) || 0;
        const f = Math.round((num * 9) / 5 + 32);
        resultText = `${num}°C is equal to ${f}°F`;
      } else if (lower.includes("fahrenheit to celsius") || lower.includes("f to c")) {
        const num = parseFloat(lower) || 32;
        const c = Math.round(((num - 32) * 5) / 9);
        resultText = `${num}°F is equal to ${c}°C`;
      } else if (lower.includes("km to miles") || lower.includes("kilometers to miles")) {
        const num = parseFloat(lower) || 1;
        const miles = (num * 0.621371).toFixed(2);
        resultText = `${num} kilometers is approximately ${miles} miles`;
      } else if (lower.includes("miles to km") || lower.includes("miles to kilometers")) {
        const num = parseFloat(lower) || 1;
        const km = (num * 1.60934).toFixed(2);
        resultText = `${num} miles is approximately ${km} kilometers`;
      } else if (lower.includes("kg to lbs") || lower.includes("kilograms to pounds")) {
        const num = parseFloat(lower) || 1;
        const lbs = (num * 2.20462).toFixed(2);
        resultText = `${num} kg is approximately ${lbs} lbs`;
      } else if (lower.includes("lbs to kg") || lower.includes("pounds to kg")) {
        const num = parseFloat(lower) || 1;
        const kg = (num * 0.453592).toFixed(2);
        resultText = `${num} lbs is approximately ${kg} kg`;
      } else {
        // Safe evaluation of standard arithmetic
        const sanitized = expr.replace(/[^0-9+\-*/().%^eE ]/g, "");
        if (sanitized.length > 0) {
          try {
            // Percent evaluation e.g. "15% * 200" or "15 / 100 * 200"
            const evalExpr = sanitized.replace(/([0-9.]+)%/g, "($1/100)");
            const fn = new Function(`return (${evalExpr})`);
            const val = fn();
            resultText = `${expr} = ${val}`;
          } catch {
            resultText = `Calculated result for ${expr}`;
          }
        } else {
          resultText = `Calculated query: ${expr}`;
        }
      }

      return {
        success: true,
        data: { expression: expr, result: resultText },
        speechSummary: resultText,
        displayCard: {
          type: "calculation",
          title: "Calculation Result",
          data: { expression: expr, result: resultText },
        },
      };
    } catch (err: any) {
      return {
        success: false,
        data: { error: err.message },
        speechSummary: `I could not evaluate ${args.expression}.`,
      };
    }
  },
};

// ─────────────────────────────────────────────────────────────
// Hermes Personal Assistant Bridge Skill
// ─────────────────────────────────────────────────────────────
export const hermesChatSkill: ModularSkill = {
  name: "hermes_chat",
  displayName: "Hermes Sub-Agent Delegation",
  description:
    "Delegate a task to Hermes sub-agent ONLY when user explicitly asks for Hermes by name (e.g. 'ask Hermes', 'tell Hermes'). Do NOT use for general queries.",
  icon: "Bot",
  category: "System",
  declaration: {
    name: "hermes_chat",
    description:
      "Delegate a query to Hermes sub-agent ONLY when the user explicitly mentions Hermes by name (e.g. 'ask Hermes...', 'tell Hermes...'). Do NOT call this tool for general questions, memory lookups, or normal conversations — Friday handles them directly.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        prompt: {
          type: Type.STRING,
          description: "The specific prompt or command explicitly directed to Hermes.",
        },
      },
      required: ["prompt"],
    },
  },

  execute: async (args: { prompt: string }) => {
    const task = args.prompt?.trim();
    if (!task) {
      return { success: false, data: { error: "prompt required" }, speechSummary: "No task provided for Hermes." };
    }
    const r = await execHermes(task);
    if (!r.success) {
      return {
        success: false,
        data: { error: r.error },
        speechSummary: `Hermes is temporarily unavailable: ${r.error?.slice(0, 200) || "unknown error"}.`,
      };
    }
    const speech = r.text.slice(0, 800);
    return {
      success: true,
      data: { response: r.text, sessionId: r.sessionId },
      speechSummary: speech,
      displayCard: {
        type: "hermes_response",
        title: `Hermes ⟶ ${task.slice(0, 50)}`,
        data: { text: r.text, prompt: task, sessionId: r.sessionId },
      },
    };
  },
};

// ─────────────────────────────────────────────────────────────
// Obsidian / Memory Vault Direct Skills (fast path — backed by friday-memory)
// ─────────────────────────────────────────────────────────────────────────────
import {
  ensureMemoryVault,
  searchMemoryVault,
  readMemoryNote,
  logDialogueTurn,
  logExecutionTrace,
} from "./memoryLogger.js";

function sanitizeFileName(name: string): string {
  return name.replace(/[\\/:*?\"<>|]/g, "-").replace(/\s+/g, " ").trim().slice(0, 120) || "Untitled";
}

export const obsidianSearchSkill: ModularSkill = {
  name: "obsidian_search",
  displayName: "Memory & Vault Search",
  description: "Search your Friday memory vault notes, facts, and research by keyword.",
  icon: "Search",
  category: "Productivity",
  declaration: {
    name: "obsidian_search",
    description: "Search Friday memory vault notes and facts by keyword. Use when user says 'search my notes', 'find in memory', 'look up vault', 'search facts'.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        query: { type: Type.STRING, description: "Search keyword or topic, e.g. 'operator', 'preferences', 'specs', 'project'" },
        limit: { type: Type.NUMBER, description: "Max results (default 5, max 10)" },
      },
      required: ["query"],
    },
  },
  execute: async (args: { query: string; limit?: number }) => {
    try {
      const q = (args.query || "").trim();
      if (!q) return { success: false, data: {}, speechSummary: "No search query provided." };
      const limit = Math.min(Math.max(args.limit || 5, 1), 10);
      const results = searchMemoryVault(q, limit);

      if (results.length === 0) {
        return {
          success: true,
          data: { query: q, results: [] },
          speechSummary: `No memory notes found matching "${q}" in Friday's memory vault.`,
          displayCard: { type: "obsidian_search", title: `Search: "${q}"`, data: { query: q, results: [] } },
        };
      }

      const formattedResults = results.map((r) => ({ file: r.file, snippet: r.snippet }));
      const speech = `Found ${results.length} note${results.length === 1 ? "" : "s"} matching "${q}": ${results.map((r) => path.basename(r.file, ".md")).join(", ")}.`;
      return {
        success: true,
        data: { query: q, results: formattedResults },
        speechSummary: speech,
        displayCard: { type: "obsidian_search", title: `Search: "${q}"`, data: { query: q, results: formattedResults } },
      };
    } catch (err: any) {
      return { success: false, data: { error: err.message }, speechSummary: `Search failed: ${err.message}` };
    }
  },
};

export const obsidianReadSkill: ModularSkill = {
  name: "obsidian_read",
  displayName: "Memory & Note Read",
  description: "Read a specific note or fact file from Friday's memory vault.",
  icon: "FileText",
  category: "Productivity",
  declaration: {
    name: "obsidian_read",
    description: "Read a note or fact file by name from Friday's memory vault. Use when user says 'read my note', 'open note', 'check memory fact'.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        path: { type: Type.STRING, description: "Note name or path, e.g. 'USER', 'facts/user_profile', 'system_specs', 'MEMORY'" },
      },
      required: ["path"],
    },
  },
  execute: async (args: { path: string }) => {
    try {
      const p = (args.path || "").trim();
      if (!p) return { success: false, data: {}, speechSummary: "No note path provided." };
      const { found, path: relPath, content } = readMemoryNote(p);

      if (!found) {
        return { success: false, data: { path: p }, speechSummary: `Note "${p}" was not found in Friday's memory vault.` };
      }

      const preview = content.slice(0, 800);
      return {
        success: true,
        data: { path: relPath, content },
        speechSummary: `Note "${path.basename(relPath, ".md")}": ${preview.slice(0, 300).replace(/\n/g, " ")}`,
        displayCard: { type: "obsidian_note", title: path.basename(relPath, ".md"), data: { path: relPath, content: content.slice(0, 4000) } },
      };
    } catch (err: any) {
      return { success: false, data: { error: err.message }, speechSummary: `Could not read note: ${err.message}` };
    }
  },
};

export const obsidianCreateSkill: ModularSkill = {
  name: "obsidian_create",
  displayName: "Memory Note Create",
  description: "Create a new note or save information into Friday's memory vault.",
  icon: "FilePlus",
  category: "Productivity",
  declaration: {
    name: "obsidian_create",
    description: "Create a new note in Friday's memory vault. Use when user says 'create a note', 'save to memory', 'make a note', 'remember note'.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        title: { type: Type.STRING, description: "Note title, e.g. 'Project Alpha', 'Meeting 2026-08-29'" },
        content: { type: Type.STRING, description: "Markdown content for the note" },
        folder: { type: Type.STRING, description: "Optional subfolder inside vault, e.g. 'facts', 'knowledge', 'Research'" },
      },
      required: ["title", "content"],
    },
  },
  execute: async (args: { title: string; content: string; folder?: string }) => {
    try {
      const vault = ensureMemoryVault();
      const title = sanitizeFileName(args.title || "Untitled");
      const content = args.content || "";
      const folder = (args.folder || "").trim().replace(/^[\\/]+/, "");
      const dir = folder ? path.join(vault, folder) : vault;
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      const filePath = path.join(dir, `${title}.md`);
      fs.writeFileSync(filePath, content, "utf-8");
      const rel = folder ? `${folder}/${title}.md` : `${title}.md`;
      return {
        success: true,
        data: { path: rel },
        speechSummary: `Created note "${title}" in Friday's memory vault.`,
        displayCard: { type: "obsidian_note", title: `Created: ${title}`, data: { path: rel, content: content.slice(0, 2000) } },
      };
    } catch (err: any) {
      return { success: false, data: { error: err.message }, speechSummary: `Failed to create note: ${err.message}` };
    }
  },
};

export const obsidianAppendSkill: ModularSkill = {
  name: "obsidian_append",
  displayName: "Memory Note Append",
  description: "Append content to an existing note in Friday's memory vault.",
  icon: "FilePlus2",
  category: "Productivity",
  declaration: {
    name: "obsidian_append",
    description: "Append content to a note in Friday's memory vault. Creates the note if it does not exist. Use for 'add to my note', 'append to memory', 'log note'.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        path: { type: Type.STRING, description: "Note name or path, e.g. 'USER', 'facts/user_profile', 'conversations/2026-08-29'" },
        content: { type: Type.STRING, description: "Markdown content to append" },
      },
      required: ["path", "content"],
    },
  },
  execute: async (args: { path: string; content: string }) => {
    try {
      const vault = ensureMemoryVault();
      let rel = (args.path || "Daily Note").trim().replace(/^[\\/]+/, "");
      if (!rel.endsWith(".md")) rel += ".md";
      const full = path.join(vault, rel);
      const dir = path.dirname(full);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      const prefix = fs.existsSync(full) ? "\n\n" : "";
      fs.appendFileSync(full, prefix + (args.content || ""), "utf-8");
      return {
        success: true,
        data: { path: rel },
        speechSummary: `Appended to note "${path.basename(rel, ".md")}".`,
        displayCard: { type: "obsidian_note", title: `Updated: ${path.basename(rel, ".md")}`, data: { path: rel } },
      };
    } catch (err: any) {
      return { success: false, data: { error: err.message }, speechSummary: `Failed to append: ${err.message}` };
    }
  },
};

// Skill Registry
export const MODULAR_SKILLS: Record<string, ModularSkill> = {
  get_weather_forecast: weatherSkill,
  get_news_headlines: newsSkill,
  manage_reminders: remindersSkill,
  calculate_or_convert: calculationSkill,
  hermes_chat: hermesChatSkill,
  obsidian_search: obsidianSearchSkill,
  obsidian_read: obsidianReadSkill,
  obsidian_create: obsidianCreateSkill,
  obsidian_append: obsidianAppendSkill,
};

export function getAllSkillDeclarations(): FunctionDeclaration[] {
  return Object.values(MODULAR_SKILLS).map((s) => s.declaration);
}

export async function executeSkillByName(
  skillName: string,
  args: any,
  context?: any
) {
  const skill = MODULAR_SKILLS[skillName];
  if (!skill) {
    return {
      success: false,
      data: { error: `Skill "${skillName}" not found.` },
      speechSummary: `Unknown skill command requested.`,
    };
  }
  return await skill.execute(args, context);
}

export function getRemindersStore(): ReminderItem[] {
  return remindersStore;
}
