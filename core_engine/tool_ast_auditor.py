"""
Tool AST Security Auditor & Contract Validator for J.A.R.V.I.S. Capability Forge.
Acts as the ULTRON Security Gate to statically inspect dynamically synthesized Python tools.
Enforces security invariants, blocks dangerous system calls, and verifies the Ada-SI tool contract.
"""

import ast
import json
import re
from typing import Dict, Any, List, Optional, Set, Tuple

FORBIDDEN_MODULES: Set[str] = {
    "ctypes",
    "winreg",
    "msvcrt",
    "spwd",
    "pwd",
    "grp",
    "crypt",
}

FORBIDDEN_CALLS: Set[str] = {
    "eval",
    "exec",
    "compile",
    "__import__",
}

FORBIDDEN_PATH_SUBSTRINGS: List[str] = [
    "/etc/shadow",
    "/etc/gshadow",
    "/etc/passwd",
    "/root",
    "/.ssh",
    "/dev/sd",
    "/dev/nvme",
    "/dev/mem",
    "/dev/kmem",
    "/proc/kcore",
]

DANGEROUS_ATTRIBUTES: Set[str] = {
    "__subclasses__",
    "__globals__",
    "__code__",
    "__closure__",
    "__bases__",
}


class ToolASTAuditor:
    def __init__(self):
        pass

    def audit_tool_code(self, code: str) -> Dict[str, Any]:
        """
        Statically audit Python tool code before execution.
        Returns:
            {
                "valid": bool,
                "errors": List[str],
                "warnings": List[str],
                "has_schema": bool,
                "has_run": bool,
                "schema": Optional[Dict[str, Any]],
                "function_name": Optional[str],
                "parameters": List[str]
            }
        """
        errors: List[str] = []
        warnings: List[str] = []

        if not code or not code.strip():
            return {
                "valid": False,
                "errors": ["Tool code is empty."],
                "warnings": [],
                "has_schema": False,
                "has_run": False,
                "schema": None,
                "function_name": None,
                "parameters": [],
            }

        # 1. Parse AST
        try:
            tree = ast.parse(code)
        except SyntaxError as e:
            return {
                "valid": False,
                "errors": [f"SyntaxError in generated code at line {e.lineno}: {e.msg}"],
                "warnings": [],
                "has_schema": False,
                "has_run": False,
                "schema": None,
                "function_name": None,
                "parameters": [],
            }

        has_schema = False
        has_run = False
        schema_dict: Optional[Dict[str, Any]] = None
        function_name: Optional[str] = None
        run_parameters: List[str] = []

        # 2. Walk AST and inspect nodes
        for node in ast.walk(tree):
            # Check Imports
            if isinstance(node, ast.Import):
                for alias in node.names:
                    root_pkg = alias.name.split(".")[0]
                    if root_pkg in FORBIDDEN_MODULES:
                        errors.append(f"Forbidden module import: '{alias.name}' (line {node.lineno})")

            elif isinstance(node, ast.ImportFrom):
                if node.module:
                    root_pkg = node.module.split(".")[0]
                    if root_pkg in FORBIDDEN_MODULES:
                        errors.append(f"Forbidden from-import module: '{node.module}' (line {node.lineno})")

            # Check Calls
            elif isinstance(node, ast.Call):
                call_name = self._get_call_name(node)
                if call_name in FORBIDDEN_CALLS:
                    errors.append(f"Forbidden dynamic evaluation call: '{call_name}()' (line {node.lineno})")

                if call_name == "os.system" or call_name.startswith("os.popen"):
                    errors.append(f"Forbidden raw system command execution: '{call_name}()' (line {node.lineno})")

            # Check Attribute Access
            elif isinstance(node, ast.Attribute):
                if node.attr in DANGEROUS_ATTRIBUTES:
                    errors.append(f"Forbidden reflection attribute access: '{node.attr}' (line {node.lineno})")

            # Check String Constants for sensitive paths
            elif isinstance(node, ast.Constant) and isinstance(node.value, str):
                for bad_sub in FORBIDDEN_PATH_SUBSTRINGS:
                    if bad_sub in node.value:
                        errors.append(f"Access to sensitive path detected: '{node.value}' (line {node.lineno})")

            # Check Function Definitions
            elif isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                if node.name == "get_tool_schema":
                    has_schema = True
                    schema_dict = self._extract_schema_from_func(node)
                elif node.name == "run":
                    has_run = True
                    run_parameters = [arg.arg for arg in node.args.args if arg.arg != "self"]

        if not has_schema:
            errors.append("Missing required function: 'get_tool_schema() -> dict'")
        if not has_run:
            errors.append("Missing required function: 'run(**kwargs)'")

        if schema_dict:
            fn_decl = schema_dict.get("function", schema_dict)
            function_name = fn_decl.get("name")
            if not function_name:
                warnings.append("Schema does not specify a function name.")

        is_valid = len(errors) == 0
        return {
            "valid": is_valid,
            "errors": errors,
            "warnings": warnings,
            "has_schema": has_schema,
            "has_run": has_run,
            "schema": schema_dict,
            "function_name": function_name,
            "parameters": run_parameters,
        }

    def _get_call_name(self, node: ast.Call) -> str:
        if isinstance(node.func, ast.Name):
            return node.func.id
        elif isinstance(node.func, ast.Attribute):
            val_name = self._get_expr_name(node.func.value)
            return f"{val_name}.{node.func.attr}" if val_name else node.func.attr
        return ""

    def _get_expr_name(self, node: ast.AST) -> str:
        if isinstance(node, ast.Name):
            return node.id
        elif isinstance(node, ast.Attribute):
            val = self._get_expr_name(node.value)
            return f"{val}.{node.attr}" if val else node.attr
        return ""

    def _extract_schema_from_func(self, node: ast.FunctionDef | ast.AsyncFunctionDef) -> Optional[Dict[str, Any]]:
        """Attempt to extract literal dict return from get_tool_schema."""
        for item in node.body:
            if isinstance(item, ast.Return) and item.value is not None:
                try:
                    # Safely evaluate literal dict AST
                    return ast.literal_eval(item.value)
                except Exception:
                    return None
        return None


tool_ast_auditor = ToolASTAuditor()
