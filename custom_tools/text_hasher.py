import hashlib

def get_tool_schema():
    return {
        "name": "text_hasher",
        "description": "Calculates the SHA256 and MD5 hash of any text string.",
        "parameters": {
            "type": "object",
            "properties": {
                "text": {
                    "type": "string",
                    "description": "The input text string to hash."
                }
            },
            "required": ["text"]
        }
    }

def run(text):
    """
    Calculates SHA256 and MD5 hashes of the input text.
    """
    try:
        sha256_hash = hashlib.sha256(text.encode('utf-8')).hexdigest()
        md5_hash = hashlib.md5(text.encode('utf-8')).hexdigest()
        return {
            "sha256": sha256_hash,
            "md5": md5_hash
        }
    except Exception as e:
        return {"error": str(e)}