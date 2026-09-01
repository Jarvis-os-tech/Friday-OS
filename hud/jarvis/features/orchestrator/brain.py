"""
Orchestrator Brain — from hermes SOUL.md:20 + hermes-agent/tools + orchestrator/brain.py
Decision layer: classifies intent, routes to memory/search/delegate/tool, manages proactive jobs.

Origin:
  - SOUL.md:20 ORCHESTRATOR NOT EXECUTOR, delegate via delegate_task, persist via memory, coordinate via cronjob
  - SOUL.md:46 Memory architecture WORKING/PERSISTENT/EPISODIC/SEMANTIC/PROCEDURAL
  - brain.py: classify_intent() + route_message() + PROACTIVE_JOBS 06:00-03:00 fleet

Present-dir: heuristic routing without LLM, RAG via features.memory.search
"""
import re
from typing import Dict, Any

MEMORY_WRITE=[r"remember (that|this)",r"don't forget",r"save (this|that)"]
SEARCH=[r"what did (we|you|i) (say|discuss)",r"remember when",r"search (for|my)"]
DELEGATE={"trading":["trade","portfolio","p&l"],"research":["research","paper","investigate"],"content":["write","blog","youtube"],"dev":["build","code","deploy","fix bug"],"infra":["server","backup","monitor"]}

def classify_intent(text:str)->Dict[str,Any]:
    t=text.lower()
    for pat in MEMORY_WRITE:
        if re.search(pat,t): return {"type":"memory_write","confidence":0.9}
    for pat in SEARCH:
        if re.search(pat,t): return {"type":"memory_search","confidence":0.85,"query":text}
    for agent,kws in DELEGATE.items():
        for kw in kws:
            if kw in t: return {"type":"delegate","confidence":0.8,"delegate":agent,"task":text}
    if any(k in t for k in ["run ","file","open ","list"]): return {"type":"tool","confidence":0.7}
    if "?" in text or text.lower().startswith(("what","how","why","can you")): return {"type":"question","confidence":0.7}
    return {"type":"chat","confidence":0.5}

def route_message(text:str, session_id="continuous"):
    intent=classify_intent(text); actions=[]
    if intent["type"]=="memory_write": actions.append({"tool":"write_memory","arguments":{"content":text,"target":"memory"}})
    elif intent["type"]=="memory_search": actions.append({"tool":"search_memory","arguments":{"query":intent.get("query",text),"limit":10}})
    elif intent["type"]=="delegate": actions.append({"tool":"delegate_task","arguments":{"task":intent["task"],"agent":intent["delegate"]}})
    elif intent["type"]=="question": actions.append({"tool":"search_memory","arguments":{"query":text,"limit":5}})
    return {"intent":intent,"actions":actions,"should_speak":intent["type"] in ("question","delegate","memory_search"),"session_id":session_id}

PROACTIVE_JOBS=[
 {"id":"morning_brief","schedule":"0 6 * * *","prompt":"Morning brief: P&L, fleet, calendar"},
 {"id":"vault_commit","schedule":"*/5 * * * *","prompt":"Vault git commit"},
 {"id":"daily_synthesis","schedule":"0 22 * * *","prompt":"Synthesize Conversations into Daily-Logs"},
]
def get_proactive_jobs(): return PROACTIVE_JOBS
