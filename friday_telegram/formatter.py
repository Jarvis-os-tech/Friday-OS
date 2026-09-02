"""
Friday-OS — Telegram Message Formatter & Chunk Splitter
Converts Markdown to Telegram HTML format safely without entity errors.
Converts tables into structured lists.
Splits long messages into UTF-16 bounded chunks (max 4096 code units) with (1/N) indicators.
"""

import re
import html
from typing import List

MAX_MSG_UTF16 = 4096


def get_utf16_length(s: str) -> int:
    """Return character length in UTF-16 code units (as counted by Telegram)."""
    return len(s.encode("utf-16-le")) // 2


def escape_html(text: str) -> str:
    """Escape raw HTML special characters (&, <, >)."""
    return html.escape(text, quote=False)


def convert_tables_to_bullets(text: str) -> str:
    """
    Detect Markdown tables and convert them to readable formatted bullet points.
    Telegram HTML does not support <table> tags.
    """
    lines = text.split("\n")
    out_lines = []
    in_table = False
    headers = []

    for line in lines:
        stripped = line.strip()
        # Table row detector
        if stripped.startswith("|") and stripped.endswith("|"):
            cells = [c.strip() for c in stripped[1:-1].split("|")]
            # Separator line (|---|---|)
            if all(re.match(r"^:?-+:?$", c) for c in cells if c):
                in_table = True
                continue
            if not in_table:
                # First row is headers
                headers = cells
                in_table = True
                out_lines.append(f"📊 **{' | '.join(headers)}**")
            else:
                # Data row
                if headers and len(cells) == len(headers):
                    items = [f"**{h}**: {c}" for h, c in zip(headers, cells) if c]
                    out_lines.append(f"• {'; '.join(items)}")
                else:
                    out_lines.append(f"• {' — '.join(cells)}")
        else:
            if in_table:
                in_table = False
                headers = []
            out_lines.append(line)

    return "\n".join(out_lines)


def markdown_to_telegram_html(text: str) -> str:
    """
    Convert Markdown text to Telegram-compatible HTML.
    Supports code blocks, inline code, bold, italic, strikethrough, blockquotes, and links.
    """
    if not text:
        return ""

    # 1. Convert markdown tables to bullets first
    converted = convert_tables_to_bullets(text)

    # 2. Extract and protect code blocks
    code_blocks = []
    def _save_code_block(match):
        lang = match.group(1) or ""
        code_content = match.group(2)
        idx = len(code_blocks)
        escaped_code = escape_html(code_content)
        if lang:
            tag = f'<pre><code class="language-{escape_html(lang)}">{escaped_code}</code></pre>'
        else:
            tag = f'<pre><code>{escaped_code}</code></pre>'
        code_blocks.append(tag)
        return f"FRIDAYCODEBLOCK{idx}END"

    converted = re.sub(r"```([a-zA-Z0-9_-]*)\n?([\s\S]*?)```", _save_code_block, converted)

    # 3. Extract and protect inline code
    inline_codes = []
    def _save_inline_code(match):
        idx = len(inline_codes)
        escaped_code = escape_html(match.group(1))
        inline_codes.append(f"<code>{escaped_code}</code>")
        return f"FRIDAYINLINECODE{idx}END"

    converted = re.sub(r"`([^`\n]+)`", _save_inline_code, converted)

    # 4. Escape general HTML in remaining text
    converted = escape_html(converted)

    # 5. Convert Blockquotes (> Quote)
    blockquote_lines = []
    in_quote = False
    current_quote = []
    for line in converted.split("\n"):
        if line.startswith("&gt; ") or line.startswith("&gt;"):
            q_line = line[5:] if line.startswith("&gt; ") else line[4:]
            current_quote.append(q_line)
            in_quote = True
        else:
            if in_quote:
                blockquote_lines.append(f"<blockquote>{chr(10).join(current_quote)}</blockquote>")
                current_quote = []
                in_quote = False
            blockquote_lines.append(line)
    if in_quote:
        blockquote_lines.append(f"<blockquote>{chr(10).join(current_quote)}</blockquote>")
    converted = "\n".join(blockquote_lines)

    # 6. Convert Bold (**bold** or __bold__)
    converted = re.sub(r"\*\*(.+?)\*\*", r"<b>\1</b>", converted)
    converted = re.sub(r"__(.+?)__", r"<b>\1</b>", converted)

    # 7. Convert Italic (*italic* or _italic_)
    converted = re.sub(r"(?<!\w)\*([^*]+?)\*(?!\w)", r"<i>\1</i>", converted)
    converted = re.sub(r"(?<!\w)_([^_]+?)_(?!\w)", r"<i>\1</i>", converted)

    # 8. Convert Strikethrough (~~del~~)
    converted = re.sub(r"~~(.+?)~~", r"<s>\1</s>", converted)

    # 9. Convert Markdown Links ([Title](url))
    converted = re.sub(r"\[([^\]]+)\]\((https?://[^\)]+)\)", r'<a href="\2">\1</a>', converted)

    # 10. Restore inline code
    for idx, snippet in enumerate(inline_codes):
        converted = converted.replace(f"FRIDAYINLINECODE{idx}END", snippet)

    # 11. Restore code blocks
    for idx, snippet in enumerate(code_blocks):
        converted = converted.replace(f"FRIDAYCODEBLOCK{idx}END", snippet)

    return converted


def chunk_message(text: str, limit: int = MAX_MSG_UTF16) -> List[str]:
    """
    Split text into Telegram-compliant chunks under the limit (4096 UTF-16 units).
    Splits naturally on paragraphs or line breaks.
    Adds '(1/N)' indicators when split.
    """
    if not text:
        return []

    if get_utf16_length(text) <= limit:
        return [text]

    # Target limit minus margin for (N/M) indicator and tag closures
    margin = 32
    target_limit = limit - margin

    paragraphs = text.split("\n\n")
    raw_chunks: List[str] = []
    current_chunk = ""

    for p in paragraphs:
        candidate = f"{current_chunk}\n\n{p}" if current_chunk else p
        if get_utf16_length(candidate) <= target_limit:
            current_chunk = candidate
        else:
            if current_chunk:
                raw_chunks.append(current_chunk)
                current_chunk = ""
            # If a single paragraph is too large, split by single newline
            if get_utf16_length(p) > target_limit:
                lines = p.split("\n")
                for line in lines:
                    line_candidate = f"{current_chunk}\n{line}" if current_chunk else line
                    if get_utf16_length(line_candidate) <= target_limit:
                        current_chunk = line_candidate
                    else:
                        if current_chunk:
                            raw_chunks.append(current_chunk)
                            current_chunk = ""
                        # If a single line is still too long, hard-slice by UTF-16 units
                        while get_utf16_length(line) > target_limit:
                            lo, hi = 0, len(line)
                            while lo < hi:
                                mid = (lo + hi + 1) // 2
                                if get_utf16_length(line[:mid]) <= target_limit:
                                    lo = mid
                                else:
                                    hi = mid - 1
                            raw_chunks.append(line[:lo])
                            line = line[lo:]
                        current_chunk = line
            else:
                current_chunk = p

    if current_chunk:
        raw_chunks.append(current_chunk)

    total_chunks = len(raw_chunks)
    if total_chunks <= 1:
        return raw_chunks

    # Add chunk count suffixes
    final_chunks = []
    for i, c in enumerate(raw_chunks):
        suffix = f"\n\n<i>({i + 1}/{total_chunks})</i>"
        final_chunks.append(f"{c}{suffix}")

    return final_chunks
