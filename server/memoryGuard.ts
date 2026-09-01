/**
 * Friday-OS Memory Guard
 * Enforces write-scoping: only owning department + Friday can write to a department's memory folder.
 * Reads are cross-department allowed.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join, relative, resolve } from "path";
import { randomUUID } from "crypto";

const MEMORY_ROOT = resolve("/home/gopi/Downloads/Friday-OS/friday-memory");
const DEPARTMENTS = ["research", "coder", "personal", "finance", "creative", "ops", "default"];

export type MemoryEntry = {
  id: string;
  type: "note" | "decision" | "fact" | "pattern" | "summary";
  title: string;
  tags: string[];
  path: string;
  created: string;
  updated: string;
  owner: string;
  content?: string;
};

export type DepartmentIndex = {
  department: string;
  version: number;
  updated: string;
  entries: MemoryEntry[];
  schema: {
    id: string;
    type: string;
    title: string;
    tags: string;
    path: string;
    created: string;
    updated: string;
    owner: string;
  };
};

function getDeptIndexPath(dept: string): string {
  return join(MEMORY_ROOT, dept, "_index.json");
}

function loadIndex(dept: string): DepartmentIndex {
  const path = getDeptIndexPath(dept);
  if (!existsSync(path)) {
    return {
      department: dept,
      version: 1,
      updated: new Date().toISOString(),
      entries: [],
      schema: {
          id: "string (uuid)",
          type: "note|decision|fact|pattern|summary",
          title: "string",
          tags: "string[]",
          path: "relative path from department root",
          created: "ISO timestamp",
          updated: "ISO timestamp",
          owner: "dept|friday",
        },
    };
  }
  try {
    return JSON.parse(readFileSync(path, "utf-8"));
  } catch {
    return {
      department: dept,
      version: 1,
      updated: new Date().toISOString(),
      entries: [],
      schema: {
          id: "string (uuid)",
          type: "note|decision|fact|pattern|summary",
          title: "string",
          tags: "string[]",
          path: "relative path from department root",
          created: "ISO timestamp",
          updated: "ISO timestamp",
          owner: "dept|friday",
        },
    };
  }
}

function saveIndex(dept: string, index: DepartmentIndex): void {
  const path = getDeptIndexPath(dept);
  index.updated = new Date().toISOString();
  writeFileSync(path, JSON.stringify(index, null, 2), "utf-8");
}

function ensureDeptDir(dept: string): void {
  const dir = join(MEMORY_ROOT, dept);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

/**
 * Check if a write is allowed.
 * - Caller must be "friday" OR the owning department.
 * - Throws if not allowed.
 */
export function assertWriteAllowed(department: string, caller: "friday" | string): void {
  if (!DEPARTMENTS.includes(department)) {
    throw new Error(`Unknown department: ${department}`);
  }
  if (caller !== "friday" && caller !== department) {
    throw new Error(`Write denied: ${caller} cannot write to ${department} memory. Only ${department} or friday may write.`);
  }
}

/**
 * Write a memory entry to a department's folder.
 * Creates the markdown file and updates the index.
 */
export function writeMemoryEntry(
  department: string,
  caller: "friday" | string,
  entry: Omit<MemoryEntry, "id" | "created" | "updated" | "path">
): MemoryEntry {
  assertWriteAllowed(department, caller);
  ensureDeptDir(department);

  const now = new Date().toISOString();
  const id = randomUUID();
  const filename = `${id}.md`;
  const filePath = join(MEMORY_ROOT, department, filename);
  const relativePath = join(department, filename);

  const fullEntry: MemoryEntry = {
    ...entry,
    id,
    path: relativePath,
    created: now,
    updated: now,
    owner: caller,
  };

  // Write the markdown file with frontmatter
  const frontmatter = `---
id: ${id}
type: ${entry.type}
title: ${entry.title}
tags: ${JSON.stringify(entry.tags)}
department: ${department}
owner: ${caller}
created: ${now}
updated: ${now}
---
`;
  writeFileSync(filePath, frontmatter + "\n" + (entry.title || ""), "utf-8");

  // Update index
  const index = loadIndex(department);
  index.entries.push(fullEntry);
  saveIndex(department, index);

  return fullEntry;
}

/**
 * Read a memory entry (cross-department allowed).
 */
export function readMemoryEntry(department: string, entryId: string): MemoryEntry | null {
  if (!DEPARTMENTS.includes(department)) {
    return null;
  }
  const index = loadIndex(department);
  const entry = index.entries.find((e) => e.id === entryId);
  if (!entry) return null;

  const filePath = join(MEMORY_ROOT, entry.path);
  if (!existsSync(filePath)) return null;

  const content = readFileSync(filePath, "utf-8");
  return { ...entry, content };
}

/**
 * Search memory entries within a department (or all if department="all").
 */
export function searchMemory(
  query: { tags?: string[]; type?: string; text?: string },
  department?: string
): MemoryEntry[] {
  const depts = department && department !== "all" ? [department] : DEPARTMENTS;
  const results: MemoryEntry[] = [];

  for (const dept of depts) {
    const index = loadIndex(dept);
    for (const entry of index.entries) {
      if (query.type && entry.type !== query.type) continue;
      if (query.tags && query.tags.length > 0) {
        const hasTag = query.tags.some((t) => entry.tags.includes(t));
        if (!hasTag) continue;
      }
      if (query.text) {
        const filePath = join(MEMORY_ROOT, entry.path);
        if (existsSync(filePath)) {
          const content = readFileSync(filePath, "utf-8");
          if (!content.toLowerCase().includes(query.text.toLowerCase())) continue;
        } else {
          continue;
        }
      }
      results.push(entry);
    }
  }

  return results.sort((a, b) => new Date(b.updated).getTime() - new Date(a.updated).getTime());
}

/**
 * List all departments with entry counts.
 */
export function listDepartments(): { department: string; count: number }[] {
  return DEPARTMENTS.map((dept) => ({
    department: dept,
    count: loadIndex(dept).entries.length,
  }));
}

export { MEMORY_ROOT, DEPARTMENTS, loadIndex };