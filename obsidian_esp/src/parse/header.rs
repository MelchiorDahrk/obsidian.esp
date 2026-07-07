//! Parser for the project-level `header.md` file.
//!
//! The header carries plugin metadata — author, description, file type
//! (ESP/ESM/ESS), and the list of master files — as YAML frontmatter. Unknown
//! keys are skipped so users can keep their own notes alongside the required
//! fields.

use super::ParsedHeader;
use super::frontmatter::*;
use winnow::Result;
use winnow::ascii::*;
use winnow::combinator::*;
use winnow::error::ContextError;
use winnow::prelude::*;
use winnow::token::*;

/// Parses the `Masters` list from the header frontmatter.
fn parse_masters_list<'s>(input: &mut &'s str) -> Result<Vec<String>> {
    let _ = space_or_tab.parse_next(input)?;
    let _ = eol_or_eof.parse_next(input)?;

    let mut masters = Vec::new();
    while let Ok(_) = peek((space_or_tab, "-", space1)).parse_next(input) {
        let _ = (space_or_tab, "-", space1).parse_next(input)?;
        let val = take_till(0.., ['\r', '\n']).parse_next(input)?;
        let _ = eol_or_eof.parse_next(input)?;
        masters.push(decode_inline_yaml_value(val));
    }

    Ok(masters)
}

/// Parses the `header.md` frontmatter delimited by `---` blocks.
pub fn parse_header<'s>(input: &mut &'s str) -> Result<ParsedHeader> {
    let _ = delimited(space0, "---", line_ending).parse_next(input)?;

    let mut author = String::new();
    let mut description = String::new();
    let mut file_type = String::new();
    let mut masters = Vec::new();

    while let Ok((_, peeked)) =
        take_till::<_, &'s str, ContextError>(1.., ['\n', '\r']).parse_peek(*input)
    {
        if peeked.trim() == "---" {
            break;
        }

        let key = parse_yaml_key.parse_next(input)?;
        if key.eq_ignore_ascii_case("Author") {
            if let Some(val) = parse_yaml_value_or_list.parse_next(input)? {
                author = val;
            }
        } else if key.eq_ignore_ascii_case("Description") {
            if let Some(val) = parse_yaml_value_or_list.parse_next(input)? {
                description = val;
            }
        } else if key.eq_ignore_ascii_case("File Type") {
            if let Some(val) = parse_yaml_value_or_list.parse_next(input)? {
                file_type = val;
            }
        } else if key.eq_ignore_ascii_case("Masters") {
            masters = parse_masters_list.parse_next(input)?;
        } else {
            // Ignore unknown keys
            let _ = parse_yaml_value_or_list.parse_next(input)?;
        }
    }

    let _ = delimited(space0, "---", alt((line_ending, eof.value("")))).parse_next(input)?;

    Ok(ParsedHeader {
        author,
        description,
        file_type,
        masters,
    })
}
