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

/// Parses a string that might be wrapped in double quotes. If wrapped, discards quotes.
pub fn unquoted_string<'s>(input: &mut &'s str) -> Result<&'s str> {
    alt((
        delimited('"', take_till(0.., '"'), '"'),
        take_till(0.., ['\r', '\n']),
    ))
    .parse_next(input)
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

    // Case 1: Empty line after colon or special YAML marker (like |)
    let is_block = if let Ok(_) = winnow::Parser::<_, _, ()>::parse_peek(&mut "|", *input) {
        let _ = "|".parse_next(input)?;
        true
    } else {
        false
    };

    if let Ok(_) = eol_or_eof.parse_next(input) {
        // Case 1a: List item with -
        if !is_block && (peek((space_or_tab, "-", space1)).parse_peek(*input).is_ok()) {
            let _ = (space_or_tab, "-", space1).parse_next(input)?;
            let val = unquoted_string.parse_next(input)?;
            let _ = eol_or_eof.parse_next(input)?;
            return Ok(Some(val.trim().to_string()));
        }

        // Case 1b: Indented multiline block
        let mut lines = Vec::new();
        // We look for lines that start with at least 2 spaces and are not empty lines
        while let Ok(_) = peek(("  ", not(line_ending::<_, ()>))).parse_next(input) {
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
    let val = unquoted_string.parse_next(input)?;
    let _ = eol_or_eof.parse_next(input)?;

    let trimmed = val.trim();
    if trimmed.is_empty() {
        Ok(None)
    } else {
        Ok(Some(trimmed.to_string()))
    }
}

/// Parses a single generic key-value entry handling optional list format
pub fn parse_frontmatter_entry<'s>(input: &mut &'s str) -> Result<(&'s str, Option<String>)> {
    let key = parse_yaml_key.parse_next(input)?;
    let val = parse_yaml_value_or_list.parse_next(input)?;
    Ok((key.trim(), val))
}
