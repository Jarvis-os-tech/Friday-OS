import { executeSkillByName, MODULAR_SKILLS } from "./skills";
import { WebSocket } from "ws";
import { logExecutionTrace } from "./memoryLogger.js";

export type TaskStatus = "queued" | "running" | "completed" | "failed" | "cancelled";

export type TaskCategory =
  | "weather"
  | "news"
  | "research"
  | "productivity"
  | "hermes"
  | "obsidian"
  | "calculation"
  | "data_fetch"
  | "system";

export interface BackgroundTask {
  id: string;
  type: TaskCategory;
  title: string;
  prompt?: string;
  status: TaskStatus;
  startTime: number;
  completedTime?: number;
  durationMs?: number;
  progressPercent?: number;
  progressMessage?: string;
  verbalAcknowledgment?: string;
  speechSummary?: string;
  result?: any;
  displayCard?: {
    type: string;
    title: string;
    data: any;
  };
  sources?: any[];
  error?: string;
}

export function generateVerbalAcknowledgment(category: TaskCategory, target?: string): string {
  switch (category) {
    case "weather":
      return target
        ? `Checking live weather conditions and forecast for ${target} now.`
        : "Scanning real-time weather and forecast data now.";
    case "news":
      return target
        ? `Fetching top ${target} headlines from live feeds.`
        : "Pulling the latest breaking news and headlines now.";
    case "productivity":
      return "Updating your scheduled reminders in the background.";
    case "obsidian":
      return target
        ? `Searching your Obsidian vault for "${target}".`
        : "Looking up notes in your Obsidian vault.";
    case "hermes":
      return "Routing request to Hermes personal intelligence.";
    case "research":
      return target
        ? `Investigating web intelligence for "${target}".`
        : "Grounding research with live web sources.";
    case "calculation":
      return "Evaluating calculation in parallel.";
    default:
      return "Processing your request in the background.";
  }
}

export function inferCategoryFromSkill(skillName: string): TaskCategory {
  if (skillName.includes("weather")) return "weather";
  if (skillName.includes("news")) return "news";
  if (skillName.includes("reminder")) return "productivity";
  if (skillName.includes("obsidian")) return "obsidian";
  if (skillName.includes("hermes")) return "hermes";
  if (skillName.includes("calculate")) return "calculation";
  return "data_fetch";
}

class ParallelTaskManager {
  private activeTasks: Map<string, BackgroundTask> = new Map();
  private completedTasks: BackgroundTask[] = [];
  private maxHistory: number = 50;
  private subscribers: Set<WebSocket> = new Set();

  public subscribe(ws: WebSocket) {
    this.subscribers.add(ws);
    ws.on("close", () => {
      this.subscribers.delete(ws);
    });
  }

  public unsubscribe(ws: WebSocket) {
    this.subscribers.delete(ws);
  }

  private broadcast(payload: any, targetWs?: WebSocket) {
    const raw = JSON.stringify(payload);
    if (targetWs && targetWs.readyState === WebSocket.OPEN) {
      targetWs.send(raw);
    }
    // Also notify active subscribers
    for (const ws of this.subscribers) {
      if (ws !== targetWs && ws.readyState === WebSocket.OPEN) {
        try {
          ws.send(raw);
        } catch (e) {
          // ignore dead socket
        }
      }
    }
  }

  public getActiveTasks(): BackgroundTask[] {
    return Array.from(this.activeTasks.values());
  }

  public getCompletedTasks(): BackgroundTask[] {
    return [...this.completedTasks];
  }

  public getTask(id: string): BackgroundTask | undefined {
    return this.activeTasks.get(id) || this.completedTasks.find((t) => t.id === id);
  }

  public cancelTask(id: string): boolean {
    const task = this.activeTasks.get(id);
    if (!task) return false;
    task.status = "cancelled";
    task.completedTime = Date.now();
    task.durationMs = task.completedTime - task.startTime;
    task.progressMessage = "Task cancelled by user.";
    this.activeTasks.delete(id);
    this.completedTasks.unshift(task);
    this.broadcast({
      type: "task_cancelled",
      taskId: id,
      task,
      timestamp: Date.now(),
    });
    return true;
  }

  /**
   * Run a background task with parallel execution and immediate verbal + UI notifications
   */
  public async executeParallelTask(options: {
    skillName?: string;
    args?: any;
    category?: TaskCategory;
    title?: string;
    prompt?: string;
    clientWs?: WebSocket;
    customExecution?: (updateProgress: (msg: string, pct?: number) => void) => Promise<{
      success: boolean;
      data: any;
      speechSummary?: string;
      displayCard?: any;
      sources?: any[];
    }>;
  }): Promise<BackgroundTask> {
    const taskId = `task_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const category: TaskCategory =
      options.category || (options.skillName ? inferCategoryFromSkill(options.skillName) : "data_fetch");

    let title = options.title;
    if (!title) {
      if (options.skillName === "get_weather_forecast") {
        title = `Live Weather: ${options.args?.location || "Current Location"}`;
      } else if (options.skillName === "get_news_headlines") {
        title = `News Headlines: ${options.args?.topic || "Top Stories"}`;
      } else if (options.skillName === "manage_reminders") {
        title = `Reminders: ${options.args?.action || "manage"}`;
      } else if (options.skillName?.startsWith("obsidian")) {
        title = `Obsidian: ${options.args?.query || options.args?.path || options.args?.title || "Vault Query"}`;
      } else if (options.skillName === "hermes_chat") {
        // Show the ACTUAL command FRIDAY delegated to Hermes, not a generic label.
        const hp = options.args?.prompt || options.prompt;
        title = hp ? `Hermes ⟶ ${hp.slice(0, 60)}` : "Hermes Delegation";
      } else {
        title = options.prompt ? options.prompt.slice(0, 40) : "Parallel Data Fetch";
      }
    }

    const verbalAcknowledgment = generateVerbalAcknowledgment(
      category,
      options.args?.location || options.args?.topic || options.args?.query || options.prompt
    );

    const task: BackgroundTask = {
      id: taskId,
      type: category,
      title,
      prompt: options.prompt,
      status: "running",
      startTime: Date.now(),
      progressPercent: 10,
      progressMessage: "Initiating parallel data fetch...",
      verbalAcknowledgment,
    };

    this.activeTasks.set(taskId, task);

    // 1. Immediately emit task_started event with immediate verbal acknowledgment to client UI
    this.broadcast(
      {
        type: "task_started",
        taskId,
        task,
        verbalAcknowledgment,
        timestamp: Date.now(),
      },
      options.clientWs
    );

    const updateProgress = (msg: string, pct?: number) => {
      if (task.status !== "running") return;
      task.progressMessage = msg;
      if (pct !== undefined) task.progressPercent = pct;
      this.broadcast(
        {
          type: "task_progress",
          taskId,
          progressMessage: msg,
          progressPercent: task.progressPercent,
          timestamp: Date.now(),
        },
        options.clientWs
      );
    };

    // 2. Execute concurrently without blocking caller
    (async () => {
      try {
        let executionResult: {
          success: boolean;
          data: any;
          speechSummary?: string;
          displayCard?: any;
          sources?: any[];
        };

        if (options.customExecution) {
          executionResult = await options.customExecution(updateProgress);
        } else if (options.skillName) {
          updateProgress("Querying live service...", 50);
          executionResult = await executeSkillByName(options.skillName, options.args || {});
        } else {
          throw new Error("No skill or execution function provided");
        }

        task.status = executionResult.success ? "completed" : "failed";
        task.completedTime = Date.now();
        task.durationMs = task.completedTime - task.startTime;
        task.progressPercent = 100;
        task.progressMessage = executionResult.success ? "Completed successfully" : "Execution failed";
        task.result = executionResult.data;
        task.speechSummary = executionResult.speechSummary;
        task.displayCard = executionResult.displayCard;
        task.sources = executionResult.sources;

        // Automatically log execution to friday-memory/execution/YYYY-MM-DD.md
        logExecutionTrace(
          options.skillName || task.title,
          options.args || options.prompt || {},
          executionResult,
          task.durationMs,
          executionResult.success
        );

        this.activeTasks.delete(taskId);
        this.completedTasks.unshift(task);
        if (this.completedTasks.length > this.maxHistory) {
          this.completedTasks.pop();
        }

        // 3. Emit task_completed with rich result & display card dynamically
        this.broadcast(
          {
            type: "task_completed",
            taskId,
            task,
            displayCard: task.displayCard,
            result: task.result,
            speechSummary: task.speechSummary,
            sources: task.sources,
            durationMs: task.durationMs,
            timestamp: Date.now(),
          },
          options.clientWs
        );
      } catch (err: any) {
        console.error(`Parallel task ${taskId} error:`, err);
        task.status = "failed";
        task.completedTime = Date.now();
        task.durationMs = task.completedTime - task.startTime;
        task.error = err?.message || String(err);
        task.progressMessage = `Failed: ${task.error}`;

        // Log failed execution trace
        logExecutionTrace(
          options.skillName || task.title,
          options.args || options.prompt || {},
          { error: task.error },
          task.durationMs,
          false
        );

        this.activeTasks.delete(taskId);
        this.completedTasks.unshift(task);
        if (this.completedTasks.length > this.maxHistory) {
          this.completedTasks.pop();
        }

        this.broadcast(
          {
            type: "task_failed",
            taskId,
            task,
            error: task.error,
            durationMs: task.durationMs,
            timestamp: Date.now(),
          },
          options.clientWs
        );
      }
    })();

    return task;
  }
}

export const parallelTaskManager = new ParallelTaskManager();
