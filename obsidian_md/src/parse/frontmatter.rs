use winnow::prelude::*;
use winnow::combinator::*;
use winnow::token::*;
use winnow::ascii::*;
use winnow::Result;

pub fn space_or_tab<'s>(input: &mut &'s str) -> Result<&'s str> {
    take_while(0.., (' ', '\t')).parse_next(input)
}

pub fn eol_or_eof<'s>(input: &mut &'s str) -> Result<&'s str> {
    alt((line_ending, eof.value(""))).parse_next(input)
}

/// Parses a string that might be wrapped in double quotes. If wrapped, discards quotes.
pub fn unquoted_string<'s>(input: &mut &'s str) -> Result<&'s str> {
    alt((
        delimited('"', take_till(0.., '"'), '"'),
        take_till(0.., ['\r', '\n']),
    )).parse_next(input)
}

pub fn parse_bool<'s>(input: &mut &'s str) -> Result<bool> {
    alt((
        winnow::ascii::Caseless("true").value(true),
        winnow::ascii::Caseless("false").value(false),
    )).parse_next(input)
}

pub fn parse_sex<'s>(input: &mut &'s str) -> Result<i32> {
    alt((
        winnow::ascii::Caseless("male").value(0),
        winnow::ascii::Caseless("female").value(1),
        winnow::ascii::Caseless("any").value(-1),
    )).parse_next(input)
}

/// Parses YAML-style frontmatter keys. A key is alphanumeric plus spaces, until a colon.
pub fn parse_yaml_key<'s>(input: &mut &'s str) -> Result<&'s str> {
    terminated(
        take_while(1.., |c: char| c.is_alphanumeric() || c == ' ' || c == '_' || c == '-'),
        (space_or_tab, ':'),
    ).parse_next(input)
}

/// Parses the value for a key, handles both inline values and list items with `-`
pub fn parse_yaml_value_or_list<'s>(input: &mut &'s str) -> Result<Option<&'s str>> {
    let _ = space_or_tab.parse_next(input)?;
    
    // Case 1: Empty line
    if let Ok(_) = eol_or_eof.parse_next(input) {
        // Now check if next line is a list item
        if let Ok(_) = (space_or_tab, "-", space1).parse_peek(*input) {
            let _ = (space_or_tab, "-", space1).parse_next(input)?;
            let val = unquoted_string.parse_next(input)?;
            let _ = eol_or_eof.parse_next(input)?;
            return Ok(Some(val.trim()));
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
        Ok(Some(trimmed))
    }
}

/// Parses a single generic key-value entry handling optional list format
pub fn parse_frontmatter_entry<'s>(input: &mut &'s str) -> Result<(&'s str, Option<&'s str>)> {
    let key = parse_yaml_key.parse_next(input)?;
    let val = parse_yaml_value_or_list.parse_next(input)?;
    Ok((key.trim(), val))
}
