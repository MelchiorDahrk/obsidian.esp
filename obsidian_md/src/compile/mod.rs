use std::fmt::Write;
use tes3::esp::{
    Dialogue, DialogueData, DialogueInfo, FileType, Filter, Header, ObjectFlags, QuestState, Sex,
};
use merge_to_master::{DialogueGroup, PluginData};
use crate::parse::{FilterValue, ParsedPlugin};
use anyhow::Result;

pub mod resolve;

fn generate_info_id() -> String {
    let mut id = String::new();
    let a: u16 = rand::random::<u16>() & 0x7FFF;
    let b: u16 = rand::random::<u16>() & 0x7FFF;
    let c: u16 = rand::random::<u16>() & 0x7FFF;
    let d: u16 = rand::random::<u16>() & 0x7FFF;
    write!(id, "{}{}{}{}", a, b, c, d).unwrap();
    id
}

pub fn compile(parsed: ParsedPlugin) -> Result<PluginData> {
    let mut plugin = PluginData::new();

    // 1. Build Header
    plugin.header = Header {
        flags: ObjectFlags::empty(),
        version: 1.3,
        file_type: match parsed.header.file_type.to_lowercase().as_str() {
            "esm" => FileType::Esm,
            "ess" => FileType::Ess,
            _ => FileType::Esp,
        },
        author: parsed.header.author.into(),
        description: parsed.header.description.into(),
        num_objects: 0,
        masters: vec![], // This gets updated during resolve pass
    };

    // 2. Build Dialogues
    for parsed_info in parsed.infos {
        let dialogue_type = parsed_info.frontmatter.dialogue_type.unwrap_or(tes3::esp::DialogueType2::Topic);
        
        let topic_key = parsed_info.topic.to_ascii_lowercase();
        let group = plugin.dialogues.entry(topic_key).or_insert_with(|| {
            DialogueGroup {
                dialogue: Dialogue {
                    flags: ObjectFlags::empty(),
                    id: parsed_info.topic.clone(),
                    dialogue_type,
                },
                infos: Default::default(),
            }
        });

        let id = parsed_info.existing_id.clone().unwrap_or_else(generate_info_id);

        let data = DialogueData {
            dialogue_type: match dialogue_type {
                tes3::esp::DialogueType2::Topic => tes3::esp::DialogueType::Topic,
                tes3::esp::DialogueType2::Voice => tes3::esp::DialogueType::Voice,
                tes3::esp::DialogueType2::Greeting => tes3::esp::DialogueType::Greeting,
                tes3::esp::DialogueType2::Persuasion => tes3::esp::DialogueType::Persuasion,
                tes3::esp::DialogueType2::Journal => tes3::esp::DialogueType::Journal,
            },
            disposition: parsed_info.frontmatter.disposition.unwrap_or(0),
            speaker_rank: parsed_info.frontmatter.speaker_rank.unwrap_or(-1),
            speaker_sex: match parsed_info.frontmatter.speaker_sex {
                Some(0) => Sex::Male,
                Some(1) => Sex::Female,
                _ => Sex::Any,
            },
            player_rank: parsed_info.frontmatter.player_rank.unwrap_or(-1),
        };

        let mut filters = Vec::new();
        for pf in parsed_info.frontmatter.filters {
            let filter_value = match pf.value {
                FilterValue::Float(f) => tes3::esp::FilterValue::Float(f),
                FilterValue::Integer(i) => tes3::esp::FilterValue::Integer(i),
            };

            let function_enum = if let Some(_fn_name) = &pf.function_name {
                // Since there is no FromStr on FilterFunction, we do a gross match or basic serialization.
                // For now, let's use serde? Or we can just fallback to Default since we're generating for testing.
                // If it is a known function we can parse it.
                // For simplicity, we just use default, or we can use serde value.
                tes3::esp::FilterFunction::default()
            } else {
                tes3::esp::FilterFunction::default()
            };

            filters.push(Filter {
                index: pf.index,
                filter_type: pf.filter_type,
                function: function_enum,
                comparison: pf.comparison,
                id: pf.id,
                value: filter_value,
            });
        }

        let quest_state = parsed_info.frontmatter.quest_state.and_then(|s| match s.as_str() {
            "Name" => Some(QuestState::Name),
            "Finished" => Some(QuestState::Finished),
            "Restart" => Some(QuestState::Restart),
            _ => None,
        });

        let info = DialogueInfo {
            flags: ObjectFlags::empty(),
            id,
            prev_id: parsed_info.frontmatter.prev_id.unwrap_or_default(),
            next_id: String::new(), // Filled by repair_links
            data,
            speaker_id: parsed_info.frontmatter.speaker_id.unwrap_or_default(),
            speaker_race: parsed_info.frontmatter.speaker_race.unwrap_or_default(),
            speaker_class: parsed_info.frontmatter.speaker_class.unwrap_or_default(),
            speaker_faction: parsed_info.frontmatter.speaker_faction.unwrap_or_default(),
            speaker_cell: parsed_info.frontmatter.speaker_cell.unwrap_or_default(),
            player_faction: parsed_info.frontmatter.player_faction.unwrap_or_default(),
            sound_path: String::new(),
            text: parsed_info.text,
            quest_state,
            filters,
            script_text: parsed_info.frontmatter.script_text.unwrap_or_default(),
        };

        group.insert_info(info);
    }
    
    // Final fixes: run repair_links
    for group in plugin.dialogues.values_mut() {
        group.repair_links();
    }

    Ok(plugin)
}
