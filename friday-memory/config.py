"""
Friday Memory System — Configuration
All paths, limits, and constants in one place.
"""

import os

# ─── Root Paths ──────────────────────────────────────────────────────────────
VAULT_ROOT = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(VAULT_ROOT, "memory.db")
HERMES_HOME = os.path.expanduser("~/.hermes")
HERMES_MEMORIES_DIR = os.path.join(HERMES_HOME, "memories")

# ─── Vault Subdirectories ────────────────────────────────────────────────────
CONVERSATIONS_DIR = os.path.join(VAULT_ROOT, "conversations")
EXECUTION_DIR = os.path.join(VAULT_ROOT, "execution")
FACTS_DIR = os.path.join(VAULT_ROOT, "facts")
KNOWLEDGE_DIR = os.path.join(VAULT_ROOT, "knowledge")
SKILLS_DIR = os.path.join(VAULT_ROOT, "skills")
RESEARCH_DIR = os.path.join(VAULT_ROOT, "Research")
SUMMARIES_DIR = os.path.join(VAULT_ROOT, "summaries")
DECISIONS_DIR = os.path.join(VAULT_ROOT, "decisions")
LESSONS_DIR = os.path.join(VAULT_ROOT, "lessons")
PATTERNS_DIR = os.path.join(VAULT_ROOT, "patterns")
CONTEXT_DIR = os.path.join(VAULT_ROOT, "context")
AGENTS_DIR = os.path.join(VAULT_ROOT, "agents")

# ─── Core Files ──────────────────────────────────────────────────────────────
MEMORY_MD = os.path.join(VAULT_ROOT, "MEMORY.md")
USER_MD = os.path.join(VAULT_ROOT, "USER.md")
INDEX_MD = os.path.join(VAULT_ROOT, "INDEX.md")

# ─── Agents ──────────────────────────────────────────────────────────────────
AGENT_IDS = ["friday-prime", "hermes", "prime-agent", "openclaw", "ultron"]

# ─── Content Limits (characters) ─────────────────────────────────────────────
MEMORY_CHAR_LIMIT = 12000
USER_CHAR_LIMIT = 6000
FACTS_CHAR_LIMIT = 8000
CONTEXT_CHAR_LIMIT = 16000

# ─── All vault directories (for bootstrap) ───────────────────────────────────
ALL_DIRS = [
    CONVERSATIONS_DIR, EXECUTION_DIR, FACTS_DIR, KNOWLEDGE_DIR,
    SKILLS_DIR, RESEARCH_DIR, SUMMARIES_DIR, DECISIONS_DIR,
    LESSONS_DIR, PATTERNS_DIR, CONTEXT_DIR, AGENTS_DIR,
]
