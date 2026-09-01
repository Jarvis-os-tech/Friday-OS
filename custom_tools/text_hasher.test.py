from text_hasher import run
import hashlib

test_string = "JARVIS_TEST_STRING_57292"
expected_sha256 = hashlib.sha256(test_string.encode('utf-8')).hexdigest()
expected_md5 = hashlib.md5(test_string.encode('utf-8')).hexdigest()

result = run(test_string)

assert "sha256" in result
assert "md5" in result
assert result["sha256"] == expected_sha256
assert result["md5"] == expected_md5
print("Test passed successfully.")