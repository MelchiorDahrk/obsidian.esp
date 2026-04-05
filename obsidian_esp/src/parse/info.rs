use std::collections::BTreeMap;
use super::frontmatter::*;
use super::{FilterValue, ParsedFilter, ParsedInfoFrontmatter};
use tes3::esp::{DialogueType2, FilterComparison, FilterType};
use winnow::Result;
use winnow::ascii::*;
use winnow::combinator::*;
use winnow::error::ContextError;
use winnow::prelude::*;
use winnow::token::*;

fn parse_filter_comparison(input: &mut &str) -> Result<FilterComparison> {
    alt((
        ">=".value(FilterComparison::GreaterEqual),
        "<=".value(FilterComparison::LessEqual),
        "!=".value(FilterComparison::NotEqual),
        "==".value(FilterComparison::Equal),
        ">".value(FilterComparison::Greater),
        "<".value(FilterComparison::Less),
        "=".value(FilterComparison::Equal), // Sometimes just = is used
    ))
    .parse_next(input)
}

fn parse_filter_value(input: &mut &str) -> Result<FilterValue> {
    let raw = take_till(1.., |c: char| c == '\r' || c == '\n').parse_next(input)?;
    let raw = raw.trim();

    if raw.contains(['.', 'e', 'E']) {
        Ok(FilterValue::Float(
            raw.parse().expect("filter value should parse as float"),
        ))
    } else {
        Ok(FilterValue::Integer(
            raw.parse().expect("filter value should parse as integer"),
        ))
    }
}

pub fn parse_variable_expression<'s>(
    input: &mut &'s str,
) -> Result<(String, FilterComparison, FilterValue)> {
    let id_str =
        take_till(1.., |c: char| c == '=' || c == '<' || c == '>' || c == '!').parse_next(input)?;
    let id = id_str.trim().to_string();
    let comparison = parse_filter_comparison.parse_next(input)?;
    let _ = space0.parse_next(input)?;
    let value = parse_filter_value.parse_next(input)?;
    Ok((id, comparison, value))
}

pub fn parse_info_file<'s>(input: &mut &'s str) -> Result<(ParsedInfoFrontmatter, String)> {
    let _ = delimited(space0, "---", line_ending).parse_next(input)?;

    let mut info = ParsedInfoFrontmatter::default();

    let mut filters_map: BTreeMap<u8, (Option<FilterType>, Option<String>)> = BTreeMap::new();

    while let Ok((_, peeked)) =
        take_till::<_, &'s str, ContextError>(1.., ['\n', '\r']).parse_peek(*input)
    {
        if peeked.trim() == "---" {
            break;
        }

        let key_str = parse_yaml_key.parse_next(input)?;
        let key = key_str.trim();

        let val_opt = parse_yaml_value_or_list.parse_next(input)?;

        if key.eq_ignore_ascii_case("Topic") {
            info.topic_override = val_opt;
        } else if key.eq_ignore_ascii_case("Type") {
            if let Some(val) = val_opt {
                info.dialogue_type = alt::<_, _, ContextError, _>((
                    Caseless("Topic").value(DialogueType2::Topic),
                    Caseless("Journal").value(DialogueType2::Journal),
                    Caseless("Voice").value(DialogueType2::Voice),
                    Caseless("Greeting").value(DialogueType2::Greeting),
                    Caseless("Persuasion").value(DialogueType2::Persuasion),
                ))
                .parse_peek(val.as_str())
                .ok()
                .map(|x| x.1);
            }
        } else if key.eq_ignore_ascii_case("DiagID") {
            info.diag_id = val_opt;
        } else if key.eq_ignore_ascii_case("PrevID") {
            info.prev_id = val_opt;
        } else if key.eq_ignore_ascii_case("ID") {
            info.speaker_id = val_opt;
        } else if key.eq_ignore_ascii_case("Disposition") || key.eq_ignore_ascii_case("Index") {
            if let Some(val) = val_opt {
                if let Ok(disp) = val.parse::<i32>() {
                    info.disposition = Some(disp);
                }
            }
        } else if key.eq_ignore_ascii_case("Race") {
            info.speaker_race = val_opt;
        } else if key.eq_ignore_ascii_case("Sex") {
            if let Some(val) = val_opt {
                info.speaker_sex = parse_sex.parse_peek(val.as_str()).ok().map(|x| x.1);
            }
        } else if key.eq_ignore_ascii_case("Class") {
            info.speaker_class = val_opt;
        } else if key.eq_ignore_ascii_case("Faction") {
            info.speaker_faction = val_opt;
        } else if key.eq_ignore_ascii_case("Rank") {
            if let Some(val) = val_opt {
                if val.eq_ignore_ascii_case("-1") {
                    info.speaker_rank = Some(-1);
                } else if let Some(rank_str) = val.strip_prefix("Rank ") {
                    if let Ok(rank) = rank_str.parse::<i8>() {
                        info.speaker_rank = Some(rank);
                    }
                } else if let Ok(rank) = val.parse::<i8>() {
                    info.speaker_rank = Some(rank);
                }
            }
        } else if key.eq_ignore_ascii_case("Cell") {
            info.speaker_cell = val_opt;
        } else if key.eq_ignore_ascii_case("PC Faction") {
            info.player_faction = val_opt;
        } else if key.eq_ignore_ascii_case("PC Rank") {
            if let Some(val) = val_opt {
                if val.eq_ignore_ascii_case("-1") {
                    info.player_rank = Some(-1);
                } else if let Some(rank_str) = val.strip_prefix("Rank ") {
                    if let Ok(rank) = rank_str.parse::<i8>() {
                        info.player_rank = Some(rank);
                    }
                } else if let Ok(rank) = val.parse::<i8>() {
                    info.player_rank = Some(rank);
                }
            }
        } else if key.eq_ignore_ascii_case("Sound Path") || key.eq_ignore_ascii_case("SoundPath") {
            info.sound_path = val_opt;
        } else if key.eq_ignore_ascii_case("Result") {
            info.script_text = val_opt;
        } else if key.eq_ignore_ascii_case("Quest Name") {
            if let Some(val) = val_opt {
                if parse_bool.parse_peek(val.as_str()).ok().map(|x| x.1) == Some(true) {
                    info.quest_state = Some("Name".to_string());
                }
            }
        } else if key.eq_ignore_ascii_case("Finished") {
            if let Some(val) = val_opt {
                if parse_bool.parse_peek(val.as_str()).ok().map(|x| x.1) == Some(true) {
                    info.quest_state = Some("Finished".to_string());
                }
            }
        } else if key.eq_ignore_ascii_case("Restart") {
            if let Some(val) = val_opt {
                if parse_bool.parse_peek(val.as_str()).ok().map(|x| x.1) == Some(true) {
                    info.quest_state = Some("Restart".to_string());
                }
            }
        }
 else if let Some(idx_str) = key.to_lowercase().strip_prefix("function") {
            if let Ok(idx) = idx_str.parse::<u8>() {
                if let Some(val) = val_opt {
                    let ftype = alt::<_, _, ContextError, _>((
                        Caseless("Function").value(FilterType::Function),
                        Caseless("Global").value(FilterType::Global),
                        Caseless("Local").value(FilterType::Local),
                        Caseless("Journal").value(FilterType::Journal),
                        Caseless("Item").value(FilterType::Item),
                        Caseless("Dead").value(FilterType::Dead),
                        alt::<_, _, ContextError, _>((
                            alt::<_, _, ContextError, _>((
                                Caseless("NotId"),
                                Caseless("Not ID"),
                            ))
                            .value(FilterType::NotId),
                            alt::<_, _, ContextError, _>((
                                Caseless("NotFaction"),
                                Caseless("Not Faction"),
                            ))
                            .value(FilterType::NotFaction),
                            alt::<_, _, ContextError, _>((
                                Caseless("NotClass"),
                                Caseless("Not Class"),
                            ))
                            .value(FilterType::NotClass),
                            alt::<_, _, ContextError, _>((
                                Caseless("NotRace"),
                                Caseless("Not Race"),
                            ))
                            .value(FilterType::NotRace),
                            alt::<_, _, ContextError, _>((
                                Caseless("NotCell"),
                                Caseless("Not Cell"),
                            ))
                            .value(FilterType::NotCell),
                            alt::<_, _, ContextError, _>((
                                Caseless("NotLocal"),
                                Caseless("Not Local"),
                            ))
                            .value(FilterType::NotLocal),
                        )),
                    ))
                    .parse_peek(val.as_str())
                    .ok()
                    .map(|x| x.1);
                    if let Some(ftype) = ftype {
                        filters_map.insert(idx, (Some(ftype), None));
                    }
                }
            }
        } else if let Some(idx_str) = key.to_lowercase().strip_prefix("variable") {
            if let Ok(idx) = idx_str.parse::<u8>() {
                if let Some(val) = val_opt {
                    filters_map.entry(idx).or_insert((None, None)).1 = Some(val);
                }
            }
        }
    }

    for (idx, (ftype_opt, var_opt)) in filters_map {
        if let (Some(ftype), Some(val)) = (ftype_opt, var_opt) {
            let mut v_input = &val[..];
            if let Ok((id, comparison, value)) = parse_variable_expression(&mut v_input) {
                let mut function_name = None;
                let mut id_val = id.clone();

                match ftype {
                    FilterType::Function => {
                        function_name = Some(id.clone());
                        id_val = "".to_string();
                    }
                    FilterType::Journal => {
                        function_name = Some("JournalType".to_string());
                    }
                    FilterType::Dead => {
                        function_name = Some("DeadType".to_string());
                    }
                    FilterType::Item => {
                        function_name = Some("ItemType".to_string());
                    }
                    FilterType::Global | FilterType::Local | FilterType::NotLocal => {
                        function_name = Some("VariableCompare".to_string());
                    }
                    _ => {}
                }

                info.filters.push(ParsedFilter {
                    index: idx,
                    filter_type: ftype,
                    function_name,
                    comparison,
                    id: id_val,
                    value,
                });
            }
        }
    }

    let _ = delimited(space0, "---", alt((line_ending, eof.value("")))).parse_next(input)?;

    // Remaining text is the body text
    let text = rest.parse_next(input)?;

    // Trim leading whitespace but preserve newlines
    let text = text
        .trim_start_matches(|c: char| c == ' ' || c == '\t' || c == '\r' || c == '\n')
        .trim_end_matches(['\r', '\n'])
        .replace("\r\n", "\n")
        .replace('\r', "\n")
        .replace('\n', "\r\n");

    // Un-escape \r\n in result
    if let Some(script_text) = &mut info.script_text {
        *script_text = script_text.replace("\\r\\n", "\r\n").replace("\\n", "\n");
    }

    Ok((info, text))
}
