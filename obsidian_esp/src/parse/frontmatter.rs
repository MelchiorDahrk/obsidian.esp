//! Low-level YAML frontmatter parsing primitives shared by the header and
//! dialogue-info parsers.
//!
//! These are winnow combinators over `&str` input. They deliberately implement
//! only the small YAML subset the project format uses — inline scalars, quoted
//! strings, `- item` lists, and indented block scalars (`|`, `|-`, `|+`) — not
//! general YAML.

use winnow::Result;
use winnow::ascii::Caseless;
use winnow::ascii::*;
use winnow::combinator::*;
use winnow::prelude::*;
use winnow::token::*;

/// Consumes zero or more horizontal space characters (space or tab).
pub fn space_or_tab<'s>(input: &mut &'s str) -> Result<&'s str> {
    take_while(0.., (' ', '\t')).parse_next(input)
}

/// Consumes a line ending (CRLF or LF) or the end of the input.
pub fn eol_or_eof<'s>(input: &mut &'s str) -> Result<&'s str> {
    alt((line_ending, eof.value(""))).parse_next(input)
}

/// Decodes an inline YAML scalar: trims whitespace and, when the value is
/// double-quoted, strips the quotes and resolves `\"`, `\\`, and doubled-quote
/// (`""`) escapes. Unquoted values are returned trimmed but otherwise verbatim.
pub(crate) fn decode_inline_yaml_value(raw: &str) -> String {
    let trimmed = raw.trim();
    if !(trimmed.starts_with('"') && trimmed.ends_with('"') && trimmed.len() >= 2) {
        return trimmed.to_string();
    }

    let inner = &trimmed[1..trimmed.len() - 1];
    let mut decoded = String::with_capacity(inner.len());
    let mut chars = inner.chars().peekable();

    while let Some(ch) = chars.next() {
        match ch {
            '\\' => {
                if let Some(next) = chars.next() {
                    match next {
                        '"' => decoded.push('"'),
                        '\\' => decoded.push('\\'),
                        _ => {
                            decoded.push('\\');
                            decoded.push(next);
                        }
                    }
                } else {
                    decoded.push('\\');
                }
            }
            '"' if chars.peek() == Some(&'"') => {
                let _ = chars.next();
                decoded.push('"');
            }
            _ => decoded.push(ch),
        }
    }

    decoded
}

/// Parses a boolean value case-insensitively ("true" or "false").
pub fn parse_bool<'s>(input: &mut &'s str) -> Result<bool> {
    alt((Caseless("true").value(true), Caseless("false").value(false))).parse_next(input)
}

/// Parses a sex identifier ("male", "female", or "any") and returns the engine constant.
pub fn parse_sex<'s>(input: &mut &'s str) -> Result<i32> {
    alt((
        Caseless("male").value(0),
        Caseless("female").value(1),
        Caseless("any").value(-1),
        "".value(-1),
    ))
    .parse_next(input)
}

/// Parses YAML-style frontmatter keys. A key is alphanumeric plus spaces, until a colon.
pub fn parse_yaml_key<'s>(input: &mut &'s str) -> Result<&'s str> {
    terminated(
        take_while(1.., |c: char| {
            c.is_alphanumeric() || c == ' ' || c == '_' || c == '-'
        }),
        (space_or_tab, ':'),
    )
    .parse_next(input)
}

/// Parses a YAML value. Supports inline strings, list items (using `-`),
/// and indented multiline blocks (optionally prefixed with `|`).
pub fn parse_yaml_value_or_list<'s>(input: &mut &'s str) -> Result<Option<String>> {
    let _ = space_or_tab.parse_next(input)?;

    // Case 1: Empty line after colon or special YAML marker (like |, |-, or |+)
    let is_block = if let Some(rest) = (*input).strip_prefix("|-") {
        *input = rest;
        true
    } else if let Some(rest) = (*input).strip_prefix("|+") {
        *input = rest;
        true
    } else if let Some(rest) = (*input).strip_prefix('|') {
        *input = rest;
        true
    } else {
        false
    };

    if let Ok(_) = eol_or_eof.parse_next(input) {
        // Case 1a: List item with -
        if !is_block && (peek((space_or_tab, "-", space1)).parse_peek(*input).is_ok()) {
            let _ = (space_or_tab, "-", space1).parse_next(input)?;
            let val = take_till(0.., ['\r', '\n']).parse_next(input)?;
            let _ = eol_or_eof.parse_next(input)?;
            return Ok(Some(decode_inline_yaml_value(val)));
        }

        // Case 1b: Indented multiline block
        let mut lines = Vec::new();
        while (*input).starts_with("  ") {
            let _ = "  ".parse_next(input)?;
            let line = take_till(0.., ['\r', '\n']).parse_next(input)?;
            lines.push(line.trim_end().to_string());
            let _ = eol_or_eof.parse_next(input)?;
        }

        if !lines.is_empty() {
            return Ok(Some(lines.join("\r\n")));
        }

        return Ok(None);
    }

    // Case 2: Inline value
    let val = take_till(0.., ['\r', '\n']).parse_next(input)?;
    let _ = eol_or_eof.parse_next(input)?;

    if val.trim().is_empty() {
        Ok(None)
    } else {
        Ok(Some(decode_inline_yaml_value(val)))
    }
}

/// Parses a single generic key-value entry handling optional list format
pub fn parse_frontmatter_entry<'s>(input: &mut &'s str) -> Result<(&'s str, Option<String>)> {
    let key = parse_yaml_key.parse_next(input)?;
    let val = parse_yaml_value_or_list.parse_next(input)?;
    Ok((key.trim(), val))
}
