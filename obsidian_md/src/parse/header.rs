use winnow::prelude::*;
use winnow::combinator::*;
use winnow::token::*;
use winnow::ascii::*;
use winnow::Result;
use super::ParsedHeader;
use super::frontmatter::*;

fn parse_masters_list<'s>(input: &mut &'s str) -> Result<Vec<String>> {
    let _ = space_or_tab.parse_next(input)?;
    let _ = eol_or_eof.parse_next(input)?;
    
    let mut masters = Vec::new();
    while let Ok(_) = peek((space_or_tab, "-", space1)).parse_next(input) {
        let _ = (space_or_tab, "-", space1).parse_next(input)?;
        let val = unquoted_string.parse_next(input)?;
        let _ = eol_or_eof.parse_next(input)?;
        masters.push(val.trim().to_string());
    }
    
    Ok(masters)
}

pub fn parse_header<'s>(input: &mut &'s str) -> Result<ParsedHeader> {
    let _ = delimited(
        space0,
        "---",
        line_ending
    ).parse_next(input)?;

    let mut author = String::new();
    let mut description = String::new();
    let mut file_type = String::new();
    let mut masters = Vec::new();

    while let Ok((_, peeked)) = take_till::<_, &'s str, winnow::error::ContextError>(1.., ['\n', '\r']).parse_peek(*input) {
        if peeked.trim() == "---" {
            break;
        }

        let key = parse_yaml_key.parse_next(input)?;
        if key.eq_ignore_ascii_case("Author") {
            if let Some(val) = parse_yaml_value_or_list.parse_next(input)? {
                author = val.to_string();
            }
        } else if key.eq_ignore_ascii_case("Description") {
            if let Some(val) = parse_yaml_value_or_list.parse_next(input)? {
                description = val.to_string();
            }
        } else if key.eq_ignore_ascii_case("File Type") {
            if let Some(val) = parse_yaml_value_or_list.parse_next(input)? {
                file_type = val.to_string();
            }
        } else if key.eq_ignore_ascii_case("Masters") {
            masters = parse_masters_list.parse_next(input)?;
        } else {
            // Ignore unknown keys
            let _ = parse_yaml_value_or_list.parse_next(input)?;
        }
    }

    let _ = delimited(
        space0,
        "---",
        alt((line_ending, eof.value("")))
    ).parse_next(input)?;

    Ok(ParsedHeader {
        author,
        description,
        file_type,
        masters,
    })
}
