use crate::error::{MemoryError, Result};
use regex::Regex;
use std::sync::LazyLock;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SecretFinding {
    pub pattern_name: &'static str,
    pub matched_sample: String,
}

struct PatternRule {
    name: &'static str,
    regex: &'static LazyLock<Regex>,
}

static RE_OPENAI_KEY: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"sk-(?:proj-)?[0-9a-zA-Z]{20,}").unwrap());

static RE_ANTHROPIC_KEY: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"sk-ant-[0-9a-zA-Z_-]{20,}").unwrap());

static RE_GOOGLE_API_KEY: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"AIza[0-9A-Za-z_-]{30,45}").unwrap());

static RE_AWS_ACCESS_KEY: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?:A3T[A-Z0-9]|AKIA|AGPA|AIDA|AROA|AIPA|ANPA|ANVA|ASIA)[A-Z0-9]{16}").unwrap());

static RE_AWS_SECRET_KEY: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?i)aws_secret_access_key\s*[:=]\s*[A-Za-z0-9/+=]{40}").unwrap());

static RE_GITHUB_PAT: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"gh[pousr]_[0-9a-zA-Z]{36,255}").unwrap());

static RE_GITHUB_FINE_GRAINED: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"github_pat_[0-9a-zA-Z_]{82}").unwrap());

static RE_SLACK_TOKEN: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"xox[baprs]-[0-9a-zA-Z-]{10,}").unwrap());

static RE_SLACK_WEBHOOK: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"https://hooks\.slack\.com/services/T[0-9a-zA-Z_]+/B[0-9a-zA-Z_]+/[0-9a-zA-Z_]+").unwrap());

static RE_DISCORD_WEBHOOK: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"https://discord\.com/api/webhooks/[0-9]+/[a-zA-Z0-9_-]+").unwrap());

static RE_PRIVATE_KEY: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"-----BEGIN (?:[A-Z0-9_-]+\s+)*KEY-----").unwrap());

static RE_JWT_TOKEN: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"eyJ[a-zA-Z0-9_-]{10,}\.eyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}").unwrap());

static RE_STRIPE_KEY: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?:sk|pk)_(?:live|test)_[0-9a-zA-Z]{24,}").unwrap());

static RE_GENERIC_PASSWORD_KV: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r#"(?i)(?:password|passwd|api_key|apikey|secret_key)\s*[:=]\s*['"][^'"]{8,}['"]"#).unwrap());

static RE_DATABASE_URL: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?:postgres|postgresql|mysql|mongodb|redis)://[^:\s]+:[^@\s]+@[^\s]+").unwrap());

static PATTERNS: &[PatternRule] = &[
    PatternRule { name: "OpenAI API Key", regex: &RE_OPENAI_KEY },
    PatternRule { name: "Anthropic API Key", regex: &RE_ANTHROPIC_KEY },
    PatternRule { name: "Google API Key", regex: &RE_GOOGLE_API_KEY },
    PatternRule { name: "AWS Access Key", regex: &RE_AWS_ACCESS_KEY },
    PatternRule { name: "AWS Secret Key", regex: &RE_AWS_SECRET_KEY },
    PatternRule { name: "GitHub Token", regex: &RE_GITHUB_PAT },
    PatternRule { name: "GitHub Fine-Grained Token", regex: &RE_GITHUB_FINE_GRAINED },
    PatternRule { name: "Slack Token", regex: &RE_SLACK_TOKEN },
    PatternRule { name: "Slack Webhook", regex: &RE_SLACK_WEBHOOK },
    PatternRule { name: "Discord Webhook", regex: &RE_DISCORD_WEBHOOK },
    PatternRule { name: "Private Key Header", regex: &RE_PRIVATE_KEY },
    PatternRule { name: "JWT Token", regex: &RE_JWT_TOKEN },
    PatternRule { name: "Stripe API Key", regex: &RE_STRIPE_KEY },
    PatternRule { name: "Plaintext Password KV", regex: &RE_GENERIC_PASSWORD_KV },
    PatternRule { name: "Database Connection String", regex: &RE_DATABASE_URL },
];

pub struct SecretScanner;

impl SecretScanner {
    pub fn new() -> Self {
        Self
    }

    /// Scan text for any matching secret patterns
    pub fn scan(text: &str) -> Vec<SecretFinding> {
        let mut findings = Vec::new();
        for rule in PATTERNS {
            if let Some(mat) = rule.regex.find(text) {
                let matched_str = mat.as_str();
                // Mask the sample for safe logging (show only prefix and suffix)
                let masked = if matched_str.len() > 8 {
                    format!("{}...{}", &matched_str[..4], &matched_str[matched_str.len() - 4..])
                } else {
                    "***".to_string()
                };

                findings.push(SecretFinding {
                    pattern_name: rule.name,
                    matched_sample: masked,
                });
            }
        }
        findings
    }

    /// Check if text contains any secrets
    pub fn contains_secrets(text: &str) -> bool {
        !Self::scan(text).is_empty()
    }

    /// Enforce security: Returns Err(MemoryError::SecurityViolation) if any secret is detected
    pub fn scan_and_enforce(text: &str) -> Result<()> {
        let findings = Self::scan(text);
        if !findings.is_empty() {
            let names: Vec<&str> = findings.iter().map(|f| f.pattern_name).collect();
            let msg = format!(
                "Secret detected in memory payload! Rejected patterns: {}",
                names.join(", ")
            );
            return Err(MemoryError::SecurityViolation(msg));
        }
        Ok(())
    }

    /// Sanitize text by replacing secret occurrences with redact markers
    pub fn sanitize(text: &str) -> String {
        let mut sanitized = text.to_string();
        for rule in PATTERNS {
            sanitized = rule.regex.replace_all(&sanitized, |caps: &regex::Captures| {
                let matched = caps.get(0).map(|m| m.as_str()).unwrap_or("");
                let prefix = if matched.len() >= 4 { &matched[..4] } else { "" };
                format!("[REDACTED_SECRET:{}:{}***]", rule.name, prefix)
            }).to_string();
        }
        sanitized
    }
}

impl Default for SecretScanner {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_secret_scanner_detects_openai() {
        let text = "My OpenAI key is sk-1234567890abcdef1234567890abcdef";
        let findings = SecretScanner::scan(text);
        assert_eq!(findings.len(), 1);
        assert_eq!(findings[0].pattern_name, "OpenAI API Key");
        assert!(SecretScanner::scan_and_enforce(text).is_err());
    }

    #[test]
    fn test_secret_scanner_detects_anthropic() {
        let text = "Here is the key: sk-ant-api03-abcdef1234567890abcdef1234567890";
        let findings = SecretScanner::scan(text);
        assert_eq!(findings.len(), 1);
        assert_eq!(findings[0].pattern_name, "Anthropic API Key");
    }

    #[test]
    fn test_secret_scanner_detects_google() {
        let text = "Google API key AIzaSyD1234567890abcdefghijklmnopqrstu";
        let findings = SecretScanner::scan(text);
        assert_eq!(findings.len(), 1);
        assert_eq!(findings[0].pattern_name, "Google API Key");
    }

    #[test]
    fn test_secret_scanner_detects_aws_and_github() {
        let text = "AWS: AKIAIOSFODNN7EXAMPLE and GitHub: ghp_1234567890abcdefghijklmnopqrstuvwxyz";
        let findings = SecretScanner::scan(text);
        assert_eq!(findings.len(), 2);
    }

    #[test]
    fn test_secret_scanner_detects_private_key() {
        let text = "-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA0...\n-----END RSA PRIVATE KEY-----";
        let findings = SecretScanner::scan(text);
        assert_eq!(findings.len(), 1);
        assert_eq!(findings[0].pattern_name, "Private Key Header");
    }

    #[test]
    fn test_secret_scanner_detects_database_credentials() {
        let text = "Connect to postgres://admin:superSecretPassword123@db.prod.internal:5432/main";
        let findings = SecretScanner::scan(text);
        assert_eq!(findings.len(), 1);
        assert_eq!(findings[0].pattern_name, "Database Connection String");
    }

    #[test]
    fn test_secret_scanner_allows_clean_text() {
        let text = "User preferred editor is Neovim and project Orion uses Rust with React 19.";
        let findings = SecretScanner::scan(text);
        assert!(findings.is_empty());
        assert!(SecretScanner::scan_and_enforce(text).is_ok());
    }

    #[test]
    fn test_secret_scanner_sanitize() {
        let text = "My key is sk-1234567890abcdef1234567890abcdef.";
        let sanitized = SecretScanner::sanitize(text);
        assert!(!sanitized.contains("1234567890abcdef1234567890abcdef"));
        assert!(sanitized.contains("[REDACTED_SECRET:OpenAI API Key:sk-1***]"));
    }
}
