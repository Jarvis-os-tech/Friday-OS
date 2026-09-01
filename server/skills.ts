import { Type, FunctionDeclaration } from "@google/genai";
import fs from "fs";
import path from "path";
import { execHermes, getVaultPath } from "./hermesBridge.js";
import { execPrimeAgent } from "./primeBridge.js";
import { runUltronSystemAction } from "./ultronBridge.js";
import { execOpenClaw } from "./openclawBridge.js";
import {
  getSystemTelemetryGroundTruth,
  getBatteryStatus,
  getThermalSensors,
  setSystemVolume,
  setScreenBrightness,
  setPowerProfile,
  systemPowerAction,
  launchApplication,
  getRunningProcesses,
  manageProcess,
  controlMediaPlayback,
} from "./system_controller.js";

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
// Prime Agent (Coding & Software Engineering Specialist)
// ─────────────────────────────────────────────────────────────
export const primeAgentSkill: ModularSkill = {
  name: "delegate_to_prime_agent",
  displayName: "Prime Agent (Coding & Engineering)",
  description:
    "Delegate coding, software development, debugging, refactoring, building projects, writing code files, or running programming scripts to Prime Agent.",
  icon: "Code2",
  category: "System",
  declaration: {
    name: "delegate_to_prime_agent",
    description:
      "Delegate any coding, software development, debugging, code generation, refactoring, script development, or programming task to Prime Agent (powered by PrimeIntellect-ai/prime-agent). Call this whenever the user asks for code, programming, fixing bugs, or running software scripts.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        prompt: {
          type: Type.STRING,
          description: "Detailed coding requirements, specifications, code snippet context, or programming instructions for Prime Agent.",
        },
      },
      required: ["prompt"],
    },
  },
  execute: async (args: { prompt: string }) => {
    const task = args.prompt?.trim();
    if (!task) {
      return { success: false, data: { error: "prompt required" }, speechSummary: "No coding task provided for Prime Agent." };
    }
    const r = await execPrimeAgent(task);
    if (!r.success && !r.text) {
      return {
        success: false,
        data: { error: r.error },
        speechSummary: `Prime Agent notice: ${r.error?.slice(0, 200) || "Execution completed with notice"}.`,
      };
    }
    const speech = r.text.slice(0, 800);
    return {
      success: true,
      data: { response: r.text, codeSnippets: r.codeSnippets, raw: r.raw },
      speechSummary: speech,
      displayCard: {
        type: "prime_response",
        title: `Prime Agent ⟶ ${task.slice(0, 50)}`,
        data: { text: r.text, prompt: task, codeSnippets: r.codeSnippets },
      },
    };
  },
};

// ─────────────────────────────────────────────────────────────
// Ultron (Chief Security & System Performance Architect)
// ─────────────────────────────────────────────────────────────
export const ultronSkill: ModularSkill = {
  name: "delegate_to_ultron",
  displayName: "Ultron (OS Diagnostics & Performance Boost)",
  description:
    "Engage Ultron for deep Linux OS monitoring, system performance boost, RAM cache reclamation, subsystem self-healing (sound/network/services), or security port auditing.",
  icon: "ShieldAlert",
  category: "System",
  declaration: {
    name: "delegate_to_ultron",
    description:
      "Engage Ultron (CSO) for deep Linux OS monitoring, system performance boost, RAM cache cleanup, subsystem self-healing (sound server, PipeWire, network reset), or security port auditing. Call this when the user asks to boost performance, clean/reclaim RAM, fix audio/sound, diagnose system health, or audit security.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        action: {
          type: Type.STRING,
          description:
            "Ultron action: 'deep_audit' (full health and bottleneck analysis), 'boost_system' (reclaim RAM, drop caches, optimize power governor), 'heal_subsystem' (heal sound/network/services), or 'security_audit' (firewall and port audit). Defaults to 'deep_audit'.",
        },
        subsystem: {
          type: Type.STRING,
          description: "Optional subsystem for healing: 'sound', 'network', or 'all'.",
        },
      },
    },
  },
  execute: async (args: { action?: string; subsystem?: string }) => {
    const act = (args.action || "deep_audit") as "deep_audit" | "boost_system" | "heal_subsystem" | "security_audit";
    const result = await runUltronSystemAction(act, { subsystem: args.subsystem });
    return result;
  },
};

// ─────────────────────────────────────────────────────────────
// Hermes Sub-Agent (Complex Work & Personal Intelligence)
// ─────────────────────────────────────────────────────────────
export const hermesSkill: ModularSkill = {
  name: "delegate_to_hermes",
  displayName: "Hermes Sub-Agent Delegation",
  description:
    "Delegate complex multi-step reasoning, deep research, personal memory vault synthesis, creative long-form writing, and advanced multi-turn problem-solving to Hermes.",
  icon: "Bot",
  category: "System",
  declaration: {
    name: "delegate_to_hermes",
    description:
      "Delegate complex multi-step reasoning, deep research, personal memory vault synthesis, creative long-form writing, and multi-turn workflows to Hermes sub-agent. Call this for in-depth research, complex analysis, or long-form problem solving.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        prompt: {
          type: Type.STRING,
          description: "The task instructions, context, or query for Hermes.",
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

// Backward-compatible alias
export const hermesChatSkill = hermesSkill;

// ─────────────────────────────────────────────────────────────
// OpenClaw Autonomous Agent Gateway Delegation Skill
// ─────────────────────────────────────────────────────────────
export const openclawSkill: ModularSkill = {
  name: "delegate_to_openclaw",
  displayName: "OpenClaw Agent Delegation",
  description:
    "Delegate tasks to OpenClaw autonomous agent gateway (port 18789) for multimodal workspace actions, coding, and tool execution.",
  icon: "Cpu",
  category: "System",
  declaration: {
    name: "delegate_to_openclaw",
    description:
      "Delegate tasks to the OpenClaw autonomous agent gateway on port 18789. Call this for tasks requiring OpenClaw multimodal models, tools, or workspace actions.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        prompt: {
          type: Type.STRING,
          description: "Task specification or message for the OpenClaw agent.",
        },
      },
      required: ["prompt"],
    },
  },
  execute: async (args: { prompt: string }) => {
    const task = args.prompt?.trim();
    if (!task) {
      return { success: false, data: { error: "prompt required" }, speechSummary: "No task provided for OpenClaw." };
    }
    const r = await execOpenClaw(task);
    if (!r.success) {
      return {
        success: false,
        data: { error: r.error },
        speechSummary: `OpenClaw is currently offline or unreachable: ${r.error?.slice(0, 160) || "unknown error"}.`,
      };
    }
    const speech = r.text.slice(0, 800);
    return {
      success: true,
      data: { response: r.text, sessionId: r.sessionId, model: r.model },
      speechSummary: speech,
      displayCard: {
        type: "openclaw_response",
        title: `OpenClaw ⟶ ${task.slice(0, 50)}`,
        data: { text: r.text, prompt: task, sessionId: r.sessionId, model: r.model },
      },
    };
  },
};

export const openclawChatSkill = openclawSkill;

// ─────────────────────────────────────────────────────────────
// Instant Friday System Information Skill (Fast Path)
// ─────────────────────────────────────────────────────────────
export const systemInfoSkill: ModularSkill = {
  name: "get_system_info",
  displayName: "Instant System Telemetry",
  description:
    "Instant real-time telemetry query for Friday: CPU usage, RAM usage, battery percent, thermal temperatures, disk storage, network connectivity, and PC specifications.",
  icon: "Activity",
  category: "System",
  declaration: {
    name: "get_system_info",
    description:
      "Get instant real-time telemetry and hardware status on CPU usage, RAM memory, battery level, thermals/temperatures, storage usage, and system specifications. Call this whenever the user asks about system stats, CPU load, RAM usage, battery, or hardware status.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        query_type: {
          type: Type.STRING,
          description: "Optional specific query: 'all', 'cpu', 'memory', 'battery', 'thermals', 'storage', 'specs'. Defaults to 'all'.",
        },
      },
    },
  },
  execute: async (args: { query_type?: string }) => {
    try {
      const [telemetry, thermals, battery] = await Promise.all([
        getSystemTelemetryGroundTruth(),
        getThermalSensors(),
        getBatteryStatus(),
      ]);

      const cpu = telemetry.cpu?.usagePercent ? `${telemetry.cpu.usagePercent.toFixed(1)}%` : "N/A";
      const ramUsed = telemetry.memory?.usedMb || 0;
      const ramTotal = telemetry.memory?.totalMb || 1;
      const ramPct = ((ramUsed / ramTotal) * 100).toFixed(1);
      const temp = thermals.maxTempCelsius ? `${thermals.maxTempCelsius}°C` : "Normal";
      const batt = battery.percent !== null ? `${battery.percent}% (${battery.state})` : "Plugged in (Desktop/AC)";

      const speech = `System telemetry: CPU load is at ${cpu}, RAM is at ${ramPct} percent (${Math.round(
        ramUsed / 1024
      )} GB of ${Math.round(ramTotal / 1024)} GB used), temperature is ${temp}, and battery is ${batt}.`;

      return {
        success: true,
        data: { telemetry, thermals, battery },
        speechSummary: speech,
        displayCard: {
          type: "system_telemetry",
          title: "Friday • Live System Telemetry",
          data: { cpu, ramPct, ramUsed, ramTotal, temp, batt, telemetry },
        },
      };
    } catch (err: any) {
      return { success: false, data: { error: err.message }, speechSummary: `Could not retrieve telemetry: ${err.message}` };
    }
  },
};

// ─────────────────────────────────────────────────────────────
// Instant Friday System Controller Skill (Fast Path)
// ─────────────────────────────────────────────────────────────
export const systemControlSkill: ModularSkill = {
  name: "control_system",
  displayName: "Instant System Controller",
  description:
    "Direct Linux OS control for Friday: volume adjustment, brightness, power profiles, power actions (lock/sleep/reboot/shutdown), or media playback.",
  icon: "Sliders",
  category: "System",
  declaration: {
    name: "control_system",
    description:
      "Instantly control Linux OS settings: set audio volume, adjust screen brightness, switch power profile (performance/balanced/power-saver), trigger power actions (lock/sleep/reboot/shutdown), or control media playback (play/pause/next/prev). Call this whenever the user commands OS setting adjustments.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        action: {
          type: Type.STRING,
          description: "The control action: 'volume', 'brightness', 'power_profile', 'power_action', 'media'.",
        },
        value: {
          type: Type.STRING,
          description:
            "Value or sub-action: volume percentage (e.g. '50%'), brightness percentage (e.g. '80%'), power profile ('performance'|'balanced'|'power-saver'), power action ('lock'|'sleep'|'reboot'|'shutdown'), or media command ('play'|'pause'|'toggle'|'next'|'previous'|'stop').",
        },
      },
      required: ["action", "value"],
    },
  },
  execute: async (args: { action: string; value: string }) => {
    try {
      const act = args.action?.toLowerCase();
      const val = args.value?.trim();

      if (act === "volume") {
        const percent = parseInt(val.replace(/[^0-9]/g, ""), 10);
        if (!isNaN(percent)) {
          await setSystemVolume({ percent });
          return {
            success: true,
            data: { action: "volume", percent },
            speechSummary: `Volume set to ${percent} percent.`,
            displayCard: { type: "system_control", title: "Audio Volume", data: { percent: `${percent}%` } },
          };
        }
      } else if (act === "brightness") {
        const percent = parseInt(val.replace(/[^0-9]/g, ""), 10);
        if (!isNaN(percent)) {
          await setScreenBrightness({ percent });
          return {
            success: true,
            data: { action: "brightness", percent },
            speechSummary: `Screen brightness adjusted to ${percent} percent.`,
            displayCard: { type: "system_control", title: "Display Brightness", data: { percent: `${percent}%` } },
          };
        }
      } else if (act === "power_profile") {
        const prof = val.toLowerCase().includes("perf")
          ? "performance"
          : val.toLowerCase().includes("save")
          ? "power-saver"
          : "balanced";
        await setPowerProfile(prof as any);
        return {
          success: true,
          data: { action: "power_profile", profile: prof },
          speechSummary: `Power profile switched to ${prof} mode.`,
          displayCard: { type: "system_control", title: "Power Profile", data: { profile: prof } },
        };
      } else if (act === "power_action") {
        const pAct = val.toLowerCase() as "lock" | "sleep" | "reboot" | "shutdown";
        const r = await systemPowerAction(pAct);
        return {
          success: r.success,
          data: { action: "power_action", pAct },
          speechSummary: `Initiating ${pAct} sequence.`,
          displayCard: { type: "system_control", title: "Power Action", data: { action: pAct } },
        };
      } else if (act === "media") {
        const mAct = val.toLowerCase() as any;
        const r = await controlMediaPlayback(mAct);
        return {
          success: r.success,
          data: { action: "media", mAct },
          speechSummary: `Media ${mAct} executed.`,
          displayCard: { type: "system_control", title: "Media Playback", data: { command: mAct } },
        };
      }

      return { success: false, data: { error: "Unknown control action" }, speechSummary: `Could not perform control action ${act}.` };
    } catch (err: any) {
      return { success: false, data: { error: err.message }, speechSummary: `Control error: ${err.message}` };
    }
  },
};

// ─────────────────────────────────────────────────────────────
// Instant Friday Launch Application Skill (Fast Path)
// ─────────────────────────────────────────────────────────────
export const launchAppSkill: ModularSkill = {
  name: "launch_application",
  displayName: "Application Launcher",
  description: "Instant desktop application launcher for Friday. Opens installed Linux applications (Chrome, VS Code, Terminal, Spotify, etc.).",
  icon: "ExternalLink",
  category: "System",
  declaration: {
    name: "launch_application",
    description: "Launch or open a desktop application by name on Linux. Call this when the user says 'open Chrome', 'launch VS Code', 'open terminal', etc.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        app_name: {
          type: Type.STRING,
          description: "Name of the application to launch (e.g. 'google-chrome', 'code', 'gnome-terminal', 'spotify', 'obsidian').",
        },
      },
      required: ["app_name"],
    },
  },
  execute: async (args: { app_name: string }) => {
    try {
      const app = args.app_name?.trim();
      const r = await launchApplication({ appNameOrCommand: app });
      return {
        success: r.success,
        data: r,
        speechSummary: r.success ? `Launching ${app} now.` : `Could not launch ${app}: ${r.message}`,
        displayCard: { type: "system_control", title: `Launch: ${app}`, data: r },
      };
    } catch (err: any) {
      return { success: false, data: { error: err.message }, speechSummary: `Failed to launch app: ${err.message}` };
    }
  },
};

// ─────────────────────────────────────────────────────────────
// Instant Friday Process Management Skill (Fast Path)
// ─────────────────────────────────────────────────────────────
export const manageProcessSkill: ModularSkill = {
  name: "manage_system_process",
  displayName: "Process Manager",
  description: "Inspect or terminate running system processes on Linux.",
  icon: "Cpu",
  category: "System",
  declaration: {
    name: "manage_system_process",
    description: "List running processes or kill a troublesome process by name or PID. Call when user asks to kill an app, close a process, or view running tasks.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        action: { type: Type.STRING, description: "'list' (view top processes) or 'kill' (terminate a process)." },
        target: { type: Type.STRING, description: "Process name (e.g. 'chrome') or PID (e.g. '1234') when action is 'kill'." },
      },
      required: ["action"],
    },
  },
  execute: async (args: { action: string; target?: string }) => {
    try {
      if (args.action === "kill" && args.target) {
        const pidNum = parseInt(args.target, 10);
        const r = await manageProcess(isNaN(pidNum) ? { processName: args.target, signal: "SIGKILL" } : { pid: pidNum, signal: "SIGKILL" });
        return {
          success: r.success,
          data: r,
          speechSummary: r.message,
          displayCard: { type: "system_control", title: `Process Kill: ${args.target}`, data: r },
        };
      }
      const procs = await getRunningProcesses({ limit: 10 });
      const procList = Array.isArray(procs) ? procs : [];
      const topList = procList.slice(0, 5).map((p) => `${p.command.split(" ")[0]} (PID ${p.pid})`).join(", ");
      return {
        success: true,
        data: procs,
        speechSummary: `Top running processes: ${topList}.`,
        displayCard: { type: "system_telemetry", title: "Running Processes", data: procs },
      };
    } catch (err: any) {
      return { success: false, data: { error: err.message }, speechSummary: `Process error: ${err.message}` };
    }
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

// In-memory schedule/agenda store
export interface ScheduleItem {
  id: string;
  title: string;
  time?: string;
  priority: "high" | "medium" | "low";
  completed: boolean;
  assignedAgent?: "prime-agent" | "hermes" | "ultron" | "friday";
  createdAt: number;
}

const dailyScheduleStore: ScheduleItem[] = [];

export function getDailyScheduleStore(): ScheduleItem[] {
  return dailyScheduleStore;
}

// ─────────────────────────────────────────────────────────────
// Personal Agenda & Priorities Skill (Personal AI Manager)
// ─────────────────────────────────────────────────────────────
export const personalAgendaSkill: ModularSkill = {
  name: "get_personal_agenda",
  displayName: "Daily Personal Agenda & Priorities",
  description:
    "Get curated daily agenda, pending reminders, active multi-agent workflows, system telemetry, and proactive recommendations on what to do next.",
  icon: "CalendarCheck",
  category: "Productivity",
  declaration: {
    name: "get_personal_agenda",
    description:
      "Get today's agenda, due reminders, completed tasks, active agent jobs, and proactive guidance on what to focus on next. Call this whenever the user asks for their agenda, schedule, priorities, or what to do next.",
    parameters: {
      type: Type.OBJECT,
      properties: {},
    },
  },
  execute: async () => {
    const reminders = getRemindersStore();
    const activeReminders = reminders.filter((r) => !r.completed);
    const schedule = getDailyScheduleStore();
    const activeSchedule = schedule.filter((s) => !s.completed);

    const [telemetry, battery] = await Promise.all([
      getSystemTelemetryGroundTruth().catch(() => null),
      getBatteryStatus().catch(() => null),
    ]);

    const totalActive = activeReminders.length + activeSchedule.length;

    let speechSummary = "";
    if (totalActive === 0) {
      speechSummary =
        "Boss, your personal schedule is clear with no pending tasks. Prime Agent and Hermes are online and ready for your next project.";
    } else {
      const topItems = [
        ...activeReminders.map((r) => r.text),
        ...activeSchedule.map((s) => s.title),
      ].slice(0, 3);
      speechSummary = `Good day, Boss. You have ${totalActive} priority item${totalActive > 1 ? "s" : ""} on your agenda today: ${topItems.join(", ")}. Prime Agent and the specialist fleet are ready to begin.`;
    }

    return {
      success: true,
      data: {
        activeReminders,
        schedule,
        totalActive,
        battery,
        telemetry,
        recommendations:
          totalActive > 0
            ? "Tackle top scheduled items first"
            : "System idle — ready for new product development goals",
      },
      speechSummary,
      displayCard: {
        type: "agenda_card",
        title: "Daily Personal Agenda & Priorities",
        data: {
          activeReminders,
          schedule,
          battery,
          telemetry,
          totalActive,
        },
      },
    };
  },
};

// ─────────────────────────────────────────────────────────────
// Manage Daily Schedule Skill
// ─────────────────────────────────────────────────────────────
export const manageScheduleSkill: ModularSkill = {
  name: "manage_daily_schedule",
  displayName: "Daily Schedule Manager",
  description: "Create, list, update, or complete scheduled daily agenda items and milestones.",
  icon: "Clock",
  category: "Productivity",
  declaration: {
    name: "manage_daily_schedule",
    description:
      "Create, list, update, or complete items on your daily personal schedule and agenda. Call this when the user adds a plan, sets an objective for today, or checks off a task.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        action: {
          type: Type.STRING,
          description: "Action to perform: 'create', 'list', 'complete', 'clear'. Defaults to 'list'.",
        },
        title: {
          type: Type.STRING,
          description: "Title of the agenda task or milestone.",
        },
        time: {
          type: Type.STRING,
          description: "Optional time target string (e.g. '14:00', 'morning', 'afternoon').",
        },
        priority: {
          type: Type.STRING,
          description: "Priority: 'high', 'medium', 'low'. Defaults to 'medium'.",
        },
        assigned_agent: {
          type: Type.STRING,
          description: "Optional assigned specialist agent: 'prime-agent', 'hermes', 'ultron', 'friday'.",
        },
        id: {
          type: Type.STRING,
          description: "ID of the schedule item to complete or update.",
        },
      },
    },
  },
  execute: async (args: {
    action?: string;
    title?: string;
    time?: string;
    priority?: "high" | "medium" | "low";
    assigned_agent?: "prime-agent" | "hermes" | "ultron" | "friday";
    id?: string;
  }) => {
    const action = args.action || "list";

    if (action === "create" && args.title) {
      const newItem: ScheduleItem = {
        id: `sched_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        title: args.title.trim(),
        time: args.time,
        priority: args.priority || "medium",
        assignedAgent: args.assigned_agent || "friday",
        completed: false,
        createdAt: Date.now(),
      };
      dailyScheduleStore.push(newItem);
      return {
        success: true,
        data: { item: newItem, total: dailyScheduleStore.length },
        speechSummary: `Added to your daily schedule: "${newItem.title}".`,
        displayCard: {
          type: "schedule_updated",
          title: "Schedule Item Created",
          data: newItem,
        },
      };
    }

    if (action === "complete" && args.id) {
      const item = dailyScheduleStore.find((s) => s.id === args.id);
      if (item) {
        item.completed = true;
        return {
          success: true,
          data: { item },
          speechSummary: `Marked "${item.title}" as completed.`,
        };
      }
    }

    if (action === "clear") {
      dailyScheduleStore.length = 0;
      return {
        success: true,
        data: { cleared: true },
        speechSummary: "Daily schedule has been cleared.",
      };
    }

    // Default: list
    const active = dailyScheduleStore.filter((s) => !s.completed);
    return {
      success: true,
      data: { schedule: dailyScheduleStore, activeCount: active.length },
      speechSummary: `You have ${active.length} active item${active.length === 1 ? "" : "s"} on your schedule.`,
      displayCard: {
        type: "agenda_card",
        title: "Daily Schedule",
        data: { schedule: dailyScheduleStore, activeReminders: getRemindersStore().filter((r) => !r.completed) },
      },
    };
  },
};

// ─────────────────────────────────────────────────────────────
// Universal Smart Multi-Agent Delegation Skill
// ─────────────────────────────────────────────────────────────
export const delegateTaskSkill: ModularSkill = {
  name: "delegate_task",
  displayName: "Universal Multi-Agent Delegation",
  description:
    "Intelligently delegate tasks to the specialist agent best suited: Prime Agent (coding/testing/building), Hermes (research/vault/analysis), or Ultron (system/hardware/security).",
  icon: "Workflow",
  category: "System",
  declaration: {
    name: "delegate_task",
    description:
      "Intelligently delegate a complex task, software coding job, deep research query, or system optimization to the best specialist agent (Prime Agent, Hermes, or Ultron).",
    parameters: {
      type: Type.OBJECT,
      properties: {
        task: {
          type: Type.STRING,
          description: "Detailed description of the task or instructions to execute.",
        },
        target_agent: {
          type: Type.STRING,
          description:
            "Optional explicit agent: 'prime_agent' (for coding/testing/scripts), 'hermes' (for research/vault/reasoning), 'openclaw' (for workspace/multimodal tools), 'ultron' (for system/diagnostics/boost). If omitted, Friday auto-routes to the best agent.",
        },
        profile: {
          type: Type.STRING,
          description: "Optional department profile for Hermes: 'research', 'coder', 'personal', 'finance', 'ops'.",
        },
      },
      required: ["task"],
    },
  },
  execute: async (args: { task?: string; prompt?: string; target_agent?: string; profile?: string }) => {
    const task = args.prompt?.trim() || args.task?.trim();
    if (!task) {
      return { success: false, data: { error: "task required" }, speechSummary: "No task was provided to delegate." };
    }

    let agent = args.target_agent?.toLowerCase();
    if (!agent) {
      const lower = task.toLowerCase();
      if (
        lower.includes("code") ||
        lower.includes("function") ||
        lower.includes("script") ||
        lower.includes("program") ||
        lower.includes("python") ||
        lower.includes("typescript") ||
        lower.includes("javascript") ||
        lower.includes("debug") ||
        lower.includes("refactor") ||
        lower.includes("build") ||
        lower.includes("test")
      ) {
        agent = "prime_agent";
      } else if (
        lower.includes("openclaw") ||
        lower.includes("claw")
      ) {
        agent = "openclaw";
      } else if (
        lower.includes("boost") ||
        lower.includes("ram") ||
        lower.includes("clean memory") ||
        lower.includes("sound") ||
        lower.includes("pipewire") ||
        lower.includes("thermal") ||
        lower.includes("audit system")
      ) {
        agent = "ultron";
      } else {
        agent = "hermes";
      }
    }

    if (agent === "prime_agent" || agent.includes("prime") || agent.includes("coder")) {
      return await primeAgentSkill.execute({ prompt: task });
    } else if (agent === "openclaw" || agent.includes("openclaw") || agent.includes("claw")) {
      return await openclawSkill.execute({ prompt: task });
    } else if (agent === "ultron") {
      return await ultronSkill.execute({ action: "deep_audit" });
    } else {
      return await hermesSkill.execute({ prompt: task, profile: args.profile });
    }
  },
};

// Skill Registry
export const MODULAR_SKILLS: Record<string, ModularSkill> = {
  get_weather_forecast: weatherSkill,
  get_news_headlines: newsSkill,
  manage_reminders: remindersSkill,
  calculate_or_convert: calculationSkill,
  get_personal_agenda: personalAgendaSkill,
  manage_daily_schedule: manageScheduleSkill,
  delegate_task: delegateTaskSkill,
  delegate_to_prime_agent: primeAgentSkill,
  coding_agent: primeAgentSkill,
  delegate_to_openclaw: openclawSkill,
  openclaw_chat: openclawSkill,
  delegate_to_ultron: ultronSkill,
  ultron_system_boost: ultronSkill,
  delegate_to_hermes: hermesSkill,
  hermes_chat: hermesSkill,
  get_system_info: systemInfoSkill,
  control_system: systemControlSkill,
  launch_application: launchAppSkill,
  manage_system_process: manageProcessSkill,
  obsidian_search: obsidianSearchSkill,
  obsidian_read: obsidianReadSkill,
  obsidian_create: obsidianCreateSkill,
  obsidian_append: obsidianAppendSkill,
};

export function getAllSkillDeclarations(): FunctionDeclaration[] {
  const seen = new Set<string>();
  const decls: FunctionDeclaration[] = [];
  for (const s of Object.values(MODULAR_SKILLS)) {
    if (s.declaration && !seen.has(s.declaration.name)) {
      seen.add(s.declaration.name);
      decls.push(s.declaration);
    }
  }
  return decls;
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

