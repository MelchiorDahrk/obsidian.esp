use std::fmt::Write as _;
use std::path::Path;

use anyhow::{Context, Result};
use itertools::Itertools;
use merge_to_master::PluginData;
use tes3::esp::{
    DialogueInfo, FileType, Filter, FilterComparison, FilterType, FilterValue, QuestState, Sex,
};
use uncased::AsUncased;

fn sanitize_file_stem(input: &str) -> String {
    let mut sanitized = String::with_capacity(input.len());

    for ch in input.chars() {
        let safe =
            !matches!(ch, '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*') && !ch.is_control();
        sanitized.push(if safe { ch } else { '_' });
    }

    let sanitized = sanitized.trim_matches([' ', '.']);
    if sanitized.is_empty() {
        "dialogue".to_string()
    } else {
        sanitized.to_string()
    }
}

fn encode_inline_value(value: &str) -> String {
    value.replace("\r\n", "\\r\\n").replace('\n', "\\n")
}

fn push_field(output: &mut String, key: &str, value: Option<impl AsRef<str>>) {
    output.push_str(key);
    output.push(':');
    if let Some(value) = value {
        output.push(' ');
        output.push_str(value.as_ref());
    }
    output.push('\n');
}

fn format_file_type(file_type: FileType) -> &'static str {
    match file_type {
        FileType::Esp => "ESP",
        FileType::Esm => "ESM",
        FileType::Ess => "ESS",
    }
}

fn format_sex(sex: Sex) -> &'static str {
    match sex {
        Sex::Any => "Any",
        Sex::Male => "Male",
        Sex::Female => "Female",
    }
}

fn format_comparison(comparison: FilterComparison) -> &'static str {
    match comparison {
        FilterComparison::Equal => "=",
        FilterComparison::NotEqual => "!=",
        FilterComparison::Greater => ">",
        FilterComparison::GreaterEqual => ">=",
        FilterComparison::Less => "<",
        FilterComparison::LessEqual => "<=",
    }
}

fn format_filter_value(value: FilterValue) -> String {
    match value {
        FilterValue::Float(value) => value.to_string(),
        FilterValue::Integer(value) => value.to_string(),
    }
}

fn format_filter_type(filter_type: FilterType) -> &'static str {
    match filter_type {
        FilterType::None => "None",
        FilterType::Function => "Function",
        FilterType::Global => "Global",
        FilterType::Local => "Local",
        FilterType::Journal => "Journal",
        FilterType::Item => "Item",
        FilterType::Dead => "Dead",
        FilterType::NotId => "NotId",
        FilterType::NotFaction => "NotFaction",
        FilterType::NotClass => "NotClass",
        FilterType::NotRace => "NotRace",
        FilterType::NotCell => "NotCell",
        FilterType::NotLocal => "NotLocal",
    }
}

fn format_filter_variable(filter: &Filter) -> String {
    let comparison = format_comparison(filter.comparison);
    let value = format_filter_value(filter.value);

    if filter.filter_type == FilterType::Function {
        format!("{:?} {comparison} {value}", filter.function)
    } else {
        format!("{} {comparison} {value}", filter.id)
    }
}

fn format_rank(rank: i8) -> Option<String> {
    (rank != -1).then(|| format!("Rank {rank}"))
}

fn format_quest_flag(quest_state: Option<QuestState>, needle: QuestState) -> &'static str {
    if quest_state == Some(needle) {
        "true"
    } else {
        "false"
    }
}

fn render_header(plugin: &PluginData) -> String {
    let mut output = String::from("---\n");
    push_field(
        &mut output,
        "Author",
        Some(plugin.header.author.to_string()),
    );
    push_field(
        &mut output,
        "Description",
        Some(plugin.header.description.to_string()),
    );
    push_field(
        &mut output,
        "File Type",
        Some(format_file_type(plugin.header.file_type)),
    );
    output.push_str("Masters:\n");
    for (master_name, _) in &plugin.header.masters {
        output.push_str("  - ");
        output.push_str(master_name);
        output.push('\n');
    }
    output.push_str("---\n");
    output
}

fn render_info(topic: &str, info: &DialogueInfo) -> String {
    let mut output = String::from("---\n");

    push_field(&mut output, "Topic", Some(topic));
    push_field(
        &mut output,
        "Type",
        Some(format!("{:?}", info.data.dialogue_type)),
    );
    push_field(&mut output, "DiagID", Some(info.id.as_str()));
    push_field(
        &mut output,
        "PrevID",
        (!info.prev_id.is_empty()).then_some(info.prev_id.as_str()),
    );

    if info.data.dialogue_type == tes3::esp::DialogueType::Journal {
        push_field(
            &mut output,
            "Index",
            Some(info.data.disposition.to_string()),
        );
    } else {
        push_field(
            &mut output,
            "Disposition",
            Some(info.data.disposition.to_string()),
        );
    }

    push_field(
        &mut output,
        "ID",
        (!info.speaker_id.is_empty()).then_some(info.speaker_id.as_str()),
    );
    push_field(
        &mut output,
        "Race",
        (!info.speaker_race.is_empty()).then_some(info.speaker_race.as_str()),
    );
    push_field(&mut output, "Sex", Some(format_sex(info.data.speaker_sex)));
    push_field(
        &mut output,
        "Class",
        (!info.speaker_class.is_empty()).then_some(info.speaker_class.as_str()),
    );
    push_field(
        &mut output,
        "Faction",
        (!info.speaker_faction.is_empty()).then_some(info.speaker_faction.as_str()),
    );
    push_field(&mut output, "Rank", format_rank(info.data.speaker_rank));
    push_field(
        &mut output,
        "Cell",
        (!info.speaker_cell.is_empty()).then_some(info.speaker_cell.as_str()),
    );
    push_field(
        &mut output,
        "PC Faction",
        (!info.player_faction.is_empty()).then_some(info.player_faction.as_str()),
    );
    push_field(&mut output, "PC Rank", format_rank(info.data.player_rank));
    push_field(
        &mut output,
        "Sound Path",
        (!info.sound_path.is_empty()).then_some(info.sound_path.as_str()),
    );
    push_field(
        &mut output,
        "Result",
        (!info.script_text.is_empty()).then(|| encode_inline_value(&info.script_text)),
    );
    push_field(
        &mut output,
        "Quest Name",
        Some(format_quest_flag(info.quest_state, QuestState::Name)),
    );
    push_field(
        &mut output,
        "Finished",
        Some(format_quest_flag(info.quest_state, QuestState::Finished)),
    );
    push_field(
        &mut output,
        "Restart",
        Some(format_quest_flag(info.quest_state, QuestState::Restart)),
    );

    for filter in &info.filters {
        push_field(&mut output, "FunctionIndex", Some(filter.index.to_string()));
        push_field(
            &mut output,
            "Function",
            Some(format_filter_type(filter.filter_type)),
        );
        push_field(
            &mut output,
            "Variable",
            Some(format_filter_variable(filter)),
        );
    }

    output.push_str("---\n");
    if !info.text.is_empty() {
        output.push('\n');
        output.push_str(&info.text);
    }

    output
}

pub fn write_project_directory(plugin: &PluginData, output_dir: &Path) -> Result<()> {
    std::fs::create_dir_all(output_dir)
        .with_context(|| format!("Failed to create directory: {}", output_dir.display()))?;

    let header_path = output_dir.join("header.md");
    std::fs::write(&header_path, render_header(plugin))
        .with_context(|| format!("Failed to write file: {}", header_path.display()))?;

    let dialogue_priority = |dialogue_type| match dialogue_type {
        tes3::esp::DialogueType2::Journal => 0,
        tes3::esp::DialogueType2::Topic => 1,
        tes3::esp::DialogueType2::Voice => 2,
        tes3::esp::DialogueType2::Greeting => 3,
        tes3::esp::DialogueType2::Persuasion => 4,
    };

    let dialogue_groups = plugin.dialogues.values().sorted_by(|left, right| {
        dialogue_priority(left.dialogue.dialogue_type)
            .cmp(&dialogue_priority(right.dialogue.dialogue_type))
            .then_with(|| {
                left.dialogue
                    .id
                    .as_uncased()
                    .cmp(right.dialogue.id.as_uncased())
            })
    });

    for group in dialogue_groups {
        let stem = sanitize_file_stem(&group.dialogue.id);
        for (index, info) in group.infos.iter().enumerate() {
            let mut file_name = String::new();
            write!(&mut file_name, "{stem} ~{index}.md").unwrap();
            let output_path = output_dir.join(file_name);
            std::fs::write(&output_path, render_info(&group.dialogue.id, info))
                .with_context(|| format!("Failed to write file: {}", output_path.display()))?;
        }
    }

    Ok(())
}

pub fn plugin_to_markdown(plugin_path: &Path, output_dir: &Path) -> Result<()> {
    let plugin = PluginData::from_path(plugin_path)
        .with_context(|| format!("Failed to load plugin: {}", plugin_path.display()))?;
    write_project_directory(&plugin, output_dir)
}
