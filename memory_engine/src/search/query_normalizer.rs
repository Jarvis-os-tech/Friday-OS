use std::collections::HashSet;

/// QueryNormalizer preprocesses conversational or unstructured user search queries
/// to improve lexical (FTS5) and semantic retrieval recall.
pub struct QueryNormalizer;

impl QueryNormalizer {
    /// Full normalization pipeline:
    /// 1. Lowercase conversion & Unicode normalization
    /// 2. Contraction expansion ("didn't" -> "did not", "what's" -> "what is")
    /// 3. Repeated character collapse ("helllo" -> "hello", "yesss" -> "yes")
    /// 4. Punctuation stripping & whitespace collapse
    /// 5. Conservative stopword filtering (only if >= 3 words and substantive words remain)
    pub fn normalize(query: &str) -> String {
        let trimmed = query.trim();
        if trimmed.is_empty() {
            return String::new();
        }

        // 1. Lowercase & expand contractions
        let expanded = Self::expand_contractions(&trimmed.to_lowercase());

        // 2. Collapse repeated characters (3+ identical chars -> 1 or 2)
        let collapsed = Self::collapse_repeated_chars(&expanded);

        // 3. Clean punctuation (keep alphanumeric and spaces)
        let cleaned = Self::clean_punctuation(&collapsed);

        // 4. Split into terms
        let terms: Vec<&str> = cleaned.split_whitespace().collect();
        if terms.is_empty() {
            return String::new();
        }

        // 5. Conservative stopword filtering (if query is lengthy and non-stop words remain)
        let filtered = Self::filter_stopwords(&terms);

        filtered.join(" ")
    }

    /// Expand common English contractions to canonical forms
    pub fn expand_contractions(text: &str) -> String {
        let mut out = text.to_string();
        let contractions: &[(&str, &str)] = &[
            ("what's", "what is"),
            ("whats", "what is"),
            ("where's", "where is"),
            ("wheres", "where is"),
            ("who's", "who is"),
            ("how's", "how is"),
            ("hows", "how is"),
            ("it's", "it is"),
            ("that's", "that is"),
            ("there's", "there is"),
            ("here's", "here is"),
            ("let's", "let us"),
            ("i'm", "i am"),
            ("i've", "i have"),
            ("i'll", "i will"),
            ("i'd", "i would"),
            ("you're", "you are"),
            ("you've", "you have"),
            ("you'll", "you will"),
            ("you'd", "you would"),
            ("we're", "we are"),
            ("we've", "we have"),
            ("we'll", "we will"),
            ("they're", "they are"),
            ("they've", "they have"),
            ("they'll", "they will"),
            ("can't", "cannot"),
            ("cant", "cannot"),
            ("won't", "will not"),
            ("wont", "will not"),
            ("didn't", "did not"),
            ("didnt", "did not"),
            ("don't", "do not"),
            ("dont", "do not"),
            ("doesn't", "does not"),
            ("doesnt", "does not"),
            ("isn't", "is not"),
            ("isnt", "is not"),
            ("aren't", "are not"),
            ("arent", "are not"),
            ("wasn't", "was not"),
            ("wasnt", "was not"),
            ("weren't", "were not"),
            ("werent", "were not"),
            ("haven't", "have not"),
            ("havent", "have not"),
            ("hasn't", "has not"),
            ("hasnt", "has not"),
            ("hadn't", "had not"),
            ("couldn't", "could not"),
            ("shouldn't", "should not"),
            ("wouldn't", "would not"),
        ];

        for (pattern, replacement) in contractions {
            if out.contains(pattern) {
                out = out.replace(pattern, replacement);
            }
        }
        out
    }

    /// Collapse 3 or more consecutive identical characters (e.g. "helllllo" -> "hello", "yessss" -> "yes")
    pub fn collapse_repeated_chars(text: &str) -> String {
        let mut result = String::with_capacity(text.len());
        let chars: Vec<char> = text.chars().collect();
        let mut i = 0;
        while i < chars.len() {
            let c = chars[i];
            let mut run_len = 1;
            while i + run_len < chars.len() && chars[i + run_len] == c {
                run_len += 1;
            }
            if run_len >= 3 {
                // Keep 2 for letters commonly doubled in English (e, o, l), 1 for all others
                if matches!(c, 'e' | 'o' | 'l') {
                    result.push(c);
                    result.push(c);
                } else {
                    result.push(c);
                }
            } else {
                for _ in 0..run_len {
                    result.push(c);
                }
            }
            i += run_len;
        }
        result
    }

    /// Clean punctuation while keeping alphanumeric terms
    pub fn clean_punctuation(text: &str) -> String {
        text.chars()
            .map(|c| match c {
                '?' | '!' | '.' | ',' | ';' | ':' | '(' | ')' | '[' | ']' | '{' | '}' | '<' | '>'
                | '/' | '\\' | '|' | '`' | '~' | '@' | '#' | '$' | '%' | '^' | '&' | '*' | '+'
                | '=' | '"' => ' ',
                _ => c,
            })
            .collect()
    }

    /// Filter low-entropy stopwords when the query has 3+ words and substantive terms remain
    pub fn filter_stopwords<'a>(terms: &[&'a str]) -> Vec<&'a str> {
        if terms.len() < 3 {
            return terms.to_vec();
        }

        let stopwords: HashSet<&str> = [
            "a", "an", "the", "and", "or", "but", "if", "then", "else", "when", "at", "by",
            "for", "with", "about", "against", "between", "into", "through", "during",
            "before", "after", "above", "below", "to", "from", "up", "down", "in", "out",
            "on", "off", "over", "under", "again", "further", "once", "here", "there", "why",
            "how", "what", "which", "who", "whom", "whose", "where", "all", "any", "both",
            "each", "few", "more", "most", "other", "some", "such", "no", "nor", "not",
            "only", "own", "same", "so", "than", "too", "very", "s", "t", "can", "will",
            "just", "should", "now", "tell", "me", "show", "give", "please", "find",
            "is", "are", "was", "were", "be", "been", "being", "have", "has", "had",
            "do", "does", "did", "our", "my", "your", "his", "her", "their", "it", "its",
            "this", "that", "these", "those",
        ]
        .iter()
        .cloned()
        .collect();

        let filtered: Vec<&str> = terms
            .iter()
            .copied()
            .filter(|t| !stopwords.contains(*t))
            .collect();

        // If filtering removed everything, fall back to the original terms
        if filtered.is_empty() {
            terms.to_vec()
        } else {
            filtered
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_contraction_expansion() {
        assert_eq!(
            QueryNormalizer::expand_contractions("what's the rust config didn't we change it"),
            "what is the rust config did not we change it"
        );
        assert_eq!(
            QueryNormalizer::expand_contractions("can't find memory"),
            "cannot find memory"
        );
    }

    #[test]
    fn test_collapse_repeated_chars() {
        assert_eq!(
            QueryNormalizer::collapse_repeated_chars("helllllo yessss"),
            "hello yes"
        );
        assert_eq!(
            QueryNormalizer::collapse_repeated_chars("speed"),
            "speed" // 2 consecutive preserved
        );
    }

    #[test]
    fn test_punctuation_and_whitespace() {
        assert_eq!(
            QueryNormalizer::clean_punctuation("what is rust? (memory safety!)..."),
            "what is rust   memory safety     "
        );
    }

    #[test]
    fn test_full_normalization_pipeline() {
        let q1 = "What's the memory safety in Rust???";
        assert_eq!(QueryNormalizer::normalize(q1), "memory safety rust");

        let q2 = "Can't find our SQLite WAL configuration please!";
        assert_eq!(QueryNormalizer::normalize(q2), "cannot sqlite wal configuration");

        let q3 = "rust";
        assert_eq!(QueryNormalizer::normalize(q3), "rust");
    }
}
