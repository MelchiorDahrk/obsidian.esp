//! Export: the reverse of the parse/compile pipeline.
//!
//! Renders a [`PluginData`] back into Markdown project files (`header.md` plus
//! one file per dialogue response, in the `{Type}/{Topic}/{File}.md` layout
//! described in `src/parse/mod.rs`). Round-tripping is the design goal: a
//! project exported by this module and re-parsed must compile to the same
//! records. The `format_*`/`push_*` helpers therefore mirror the accepted
//! grammar of `src/parse/` exactly — change them in lockstep.
//!
//! Three granularities are exposed: the full database
//! ([`collect_project_files`]), only plugin-modified groups
//! ([`collect_modified_project_files`]), and a single topic
//! ([`collect_single_topic_files`], used for lazy loading in the Obsidian
//! plugin).

use std::fmt::Write as _;
use std::path::Path;
use std::collections::HashMap;

use anyhow::{Context, Result};
use itertools::Itertools;
use merge_to_master::PluginData;
use tes3::esp::{
    DialogueInfo, FileType, Filter, FilterComparison, FilterType, FilterValue, ObjectInfo,
    QuestState, Sex,
};
use uncased::AsUncased;

/// Sanitizes a string for use as a filename by replacing reserved characters and
/// control characters with underscores.
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

/// Maps a dialogue type to its corresponding directory name in the project structure.
fn format_type_directory(dialogue_type: tes3::esp::DialogueType2) -> &'static str {
    match dialogue_type {
        tes3::esp::DialogueType2::Topic => "Topic",
        tes3::esp::DialogueType2::Journal => "Journal",
        tes3::esp::DialogueType2::Voice => "Voice",
        tes3::esp::DialogueType2::Greeting => "Greeting",
        tes3::esp::DialogueType2::Persuasion => "Persuasion",
    }
}

/// Encodes newlines for use in single-line YAML values.
fn encode_inline_value(value: &str) -> String {
    value.replace("\r\n", "\\r\\n").replace('\n', "\\n")
}

/// Pushes a simple key-value property to the output string in YAML format.
fn push_field(output: &mut String, key: &str, value: Option<impl AsRef<str>>) {
    output.push_str(key);
    output.push(':');
    if let Some(value) = value {
        output.push(' ');
        output.push_str(value.as_ref());
    }
    output.push('\n');
}

/// Pushes a potentially multiline key-value property to the output string.
/// Uses YAML block scalar format (`|`) if the value contains newlines.
fn push_multiline_field(output: &mut String, key: &str, value: Option<impl AsRef<str>>) {
    if let Some(value) = value {
        output.push_str(key);
        output.push(':');
        let val = value.as_ref();
        if val.contains('\n') || val.contains('\r') {
            output.push_str(" |\n");
            let normalized = val.replace("\r\n", "\n").replace('\r', "\n");
            for line in normalized.lines() {
                output.push_str("  ");
                output.push_str(line);
                output.push('\n');
            }
        } else {
            output.push(' ');
            output.push_str(val);
            output.push('\n');
        }
    }
}

/// Like [`push_multiline_field`], but always emits the key — with an empty
/// value if needed. Used for fields that must round-trip even when blank
/// (e.g. `Result` on voice lines).
fn push_multiline_field_or_empty(output: &mut String, key: &str, value: &str) {
    if value.is_empty() {
        output.push_str(key);
        output.push_str(":\n");
    } else {
        push_multiline_field(output, key, Some(value));
    }
}

/// Renders the header's `File Type` value (ESP/ESM/ESS).
fn format_file_type(file_type: FileType) -> &'static str {
    match file_type {
        FileType::Esp => "ESP",
        FileType::Esm => "ESM",
        FileType::Ess => "ESS",
    }
}

/// Renders the `Sex` frontmatter value; `Any` is omitted entirely (the
/// parser's default).
fn format_sex(sex: Sex) -> Option<&'static str> {
    match sex {
        Sex::Any => None,
        Sex::Male => Some("Male"),
        Sex::Female => Some("Female"),
    }
}

/// Renders a filter comparison operator in the syntax the parser accepts.
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

/// Renders a filter's numeric right-hand side.
fn format_filter_value(value: FilterValue) -> String {
    match value {
        FilterValue::Float(value) => value.to_string(),
        FilterValue::Integer(value) => value.to_string(),
    }
}

/// Renders a `FunctionN` frontmatter value. Spaced forms (`Not ID`, ...) are
/// emitted; the parser accepts both spaced and unspaced spellings.
fn format_filter_type(filter_type: FilterType) -> &'static str {
    match filter_type {
        FilterType::None => "None",
        FilterType::Function => "Function",
        FilterType::Global => "Global",
        FilterType::Local => "Local",
        FilterType::Journal => "Journal",
        FilterType::Item => "Item",
        FilterType::Dead => "Dead",
        FilterType::NotId => "Not ID",
        FilterType::NotFaction => "Not Faction",
        FilterType::NotClass => "Not Class",
        FilterType::NotRace => "Not Race",
        FilterType::NotCell => "Not Cell",
        FilterType::NotLocal => "Not Local",
    }
}

/// Renders a `VariableN` frontmatter value: `<id-or-function> <op> <value>`.
fn format_filter_variable(filter: &Filter) -> String {
    let comparison = format_comparison(filter.comparison);
    let value = format_filter_value(filter.value);

    if filter.filter_type == FilterType::Function {
        format!("{:?} {comparison} {value}", filter.function)
    } else {
        format!("{} {comparison} {value}", filter.id)
    }
}

/// Renders a rank as `Rank N`; `-1` (no requirement) is omitted.
fn format_rank(rank: i8) -> Option<String> {
    (rank != -1).then(|| format!("Rank {rank}"))
}

/// Returns a string representation of a quest flag's boolean state.
fn format_quest_flag(quest_state: Option<QuestState>, needle: QuestState) -> &'static str {
    if quest_state == Some(needle) {
        "true"
    } else {
        "false"
    }
}

/// Renders the project's `header.md` frontmatter from the plugin's header data.
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

/// Renders an individual `DialogueInfo` record into Markdown frontmatter and body.
fn render_info(topic: &str, info: &DialogueInfo) -> String {
    render_info_with_source(topic, info, None)
}

/// Renders an individual `DialogueInfo` record into Markdown, optionally including
/// a `Source` field in the frontmatter.
fn render_info_with_source(topic: &str, info: &DialogueInfo, source: Option<&str>) -> String {
    let mut output = String::from("---\n");
    let is_journal = info.data.dialogue_type == tes3::esp::DialogueType::Journal;
    let is_voice = info.data.dialogue_type == tes3::esp::DialogueType::Voice;

    push_field(&mut output, "Source", source);
    push_field(
        &mut output,
        "Type",
        Some(format!("{:?}", info.data.dialogue_type)),
    );
    push_field(&mut output, "Topic", Some(topic));
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

    if !is_journal {
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
        push_field(&mut output, "Sex", format_sex(info.data.speaker_sex));
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
    }

    if is_voice {
        push_field(
            &mut output,
            "Sound Path",
            (!info.sound_path.is_empty()).then_some(info.sound_path.as_str()),
        );
    }

    if is_voice {
        push_multiline_field_or_empty(&mut output, "Result", &info.script_text);
    } else if !info.script_text.is_empty() {
        push_multiline_field(&mut output, "Result", Some(&info.script_text));
    }

    if is_journal {
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
    }

    if !is_journal {
        for filter in &info.filters {
            let i = filter.index;
            push_field(
                &mut output,
                &format!("Function{i}"),
                Some(format_filter_type(filter.filter_type)),
            );
            push_field(
                &mut output,
                &format!("Variable{i}"),
                Some(format_filter_variable(filter)),
            );
        }
    }

    output.push_str("---\n");
    if !info.text.is_empty() {
        output.push('\n');
        output.push_str(&info.text);
    }

    output
}

/// Returns the sort priority for a dialogue type. Lower values come first.
///
/// The Morrowind engine requires journal entries to be defined before other types.
fn dialogue_priority(dialogue_type: tes3::esp::DialogueType2) -> u8 {
    match dialogue_type {
        tes3::esp::DialogueType2::Journal => 0,
        tes3::esp::DialogueType2::Topic => 1,
        tes3::esp::DialogueType2::Voice => 2,
        tes3::esp::DialogueType2::Greeting => 3,
        tes3::esp::DialogueType2::Persuasion => 4,
    }
}

/// Builds the filename for a single dialogue info.
///
/// Journal entries are named by their quest index (`{topic} {index}.md`), with
/// ` ~N` suffixes disambiguating duplicate indices; all other types use their
/// position in the response chain (`{topic} ~{position}.md`). The parser's
/// `default_sort_order` relies on this exact scheme to restore ordering.
fn info_file_name(
    dialogue_type: tes3::esp::DialogueType2,
    stem: &str,
    info: &DialogueInfo,
    position: usize,
    journal_index_counts: &mut HashMap<i32, usize>,
) -> String {
    match dialogue_type {
        tes3::esp::DialogueType2::Journal => {
            let duplicate_count = journal_index_counts.entry(info.data.disposition).or_insert(0);
            let suffix = if *duplicate_count == 0 {
                String::new()
            } else {
                format!(" ~{}", *duplicate_count)
            };
            *duplicate_count += 1;
            format!("{stem} {}{suffix}.md", info.data.disposition)
        }
        _ => format!("{stem} ~{position}.md"),
    }
}

/// Returns the dialogue groups from the plugin sorted by type priority and then
/// case-insensitively by ID.
fn sorted_dialogue_groups(plugin: &PluginData) -> Vec<&merge_to_master::DialogueGroup> {
    plugin
        .dialogues
        .values()
        .sorted_by(|left, right| {
            dialogue_priority(left.dialogue.dialogue_type)
                .cmp(&dialogue_priority(right.dialogue.dialogue_type))
                .then_with(|| {
                    left.dialogue
                        .id
                        .as_uncased()
                        .cmp(right.dialogue.id.as_uncased())
                })
        })
        .collect()
}

/// Returns a list of (relative_path, content) pairs representing the project files.
pub fn collect_project_files(plugin: &PluginData) -> Vec<(String, String)> {
    let mut files = Vec::new();

    files.push(("header.md".to_string(), render_header(plugin)));

    for group in sorted_dialogue_groups(plugin) {
        let type_dir = format_type_directory(group.dialogue.dialogue_type);
        let stem = sanitize_file_stem(&group.dialogue.id);
        let mut journal_index_counts = HashMap::new();

        for (index, info) in group.infos.iter().enumerate() {
            let file_name = info_file_name(
                group.dialogue.dialogue_type,
                &stem,
                info,
                index,
                &mut journal_index_counts,
            );
            let path = format!("{type_dir}/{stem}/{file_name}");
            let content = render_info(&group.dialogue.id, info);
            files.push((path, content));
        }
    }

    files
}

/// Writes all project files for the given `PluginData` into the specified directory.
pub fn write_project_directory(plugin: &PluginData, output_dir: &Path) -> Result<()> {
    std::fs::create_dir_all(output_dir)
        .with_context(|| format!("Failed to create directory: {}", output_dir.display()))?;

    for (relative_path, content) in collect_project_files(plugin) {
        let full_path = output_dir.join(&relative_path);
        if let Some(parent) = full_path.parent() {
            std::fs::create_dir_all(parent)
                .with_context(|| format!("Failed to create directory: {}", parent.display()))?;
        }
        std::fs::write(&full_path, &content)
            .with_context(|| format!("Failed to write file: {}", full_path.display()))?;
    }

    Ok(())
}

/// Loads a plugin from the given path and writes its contents as Markdown project files.
pub fn plugin_to_markdown(plugin_path: &Path, output_dir: &Path) -> Result<()> {
    let plugin = PluginData::from_path(plugin_path)
        .with_context(|| format!("Failed to load plugin: {}", plugin_path.display()))?;
    write_project_directory(&plugin, output_dir)
}

/// Like `collect_project_files` but only includes dialogue groups where
/// the dialogue or at least one info is modified (i.e. belongs to the plugin).
/// Within included groups, ALL infos are exported (full chain for context).
pub fn collect_modified_project_files(plugin: &PluginData) -> Vec<(String, String)> {
    let mut files = Vec::new();

    files.push(("header.md".to_string(), render_header(plugin)));

    for group in sorted_dialogue_groups(plugin) {
        let has_modified_infos = group.infos.iter().any(|info| info.modified());
        if !group.dialogue.modified() && !has_modified_infos {
            continue;
        }

        let type_dir = format_type_directory(group.dialogue.dialogue_type);
        let stem = sanitize_file_stem(&group.dialogue.id);
        let mut journal_index_counts = HashMap::new();

        for (index, info) in group.infos.iter().enumerate() {
            let file_name = info_file_name(
                group.dialogue.dialogue_type,
                &stem,
                info,
                index,
                &mut journal_index_counts,
            );

            if !info.modified() {
                continue;
            }
            let path = format!("{type_dir}/{stem}/{file_name}");
            let content = render_info(&group.dialogue.id, info);
            files.push((path, content));
        }
    }

    files
}

/// Returns a sorted list of all topic names (DialogueType2::Topic) in the database.
pub fn collect_all_topic_names(plugin: &PluginData) -> Vec<String> {
    let mut names: Vec<String> = plugin
        .dialogues
        .values()
        .filter(|group| group.dialogue.dialogue_type == tes3::esp::DialogueType2::Topic)
        .map(|group| group.dialogue.id.clone())
        .collect();
    names.sort_by(|a, b| a.as_uncased().cmp(b.as_uncased()));
    names
}

/// Returns (path, content) pairs for a single topic, looked up case-insensitively.
/// Each info is rendered with `Source: master` in its frontmatter.
pub fn collect_single_topic_files(plugin: &PluginData, topic_name: &str) -> Vec<(String, String)> {
    let key = topic_name.to_ascii_lowercase();
    let Some(group) = plugin.dialogues.get(&key) else {
        return Vec::new();
    };

    let type_dir = format_type_directory(group.dialogue.dialogue_type);
    let stem = sanitize_file_stem(&group.dialogue.id);
    let mut journal_index_counts = HashMap::new();

    group
        .infos
        .iter()
        .enumerate()
        .map(|(index, info)| {
            let file_name = info_file_name(
                group.dialogue.dialogue_type,
                &stem,
                info,
                index,
                &mut journal_index_counts,
            );
            let path = format!("{type_dir}/{stem}/{file_name}");
            let content = render_info_with_source(&group.dialogue.id, info, Some("master"));
            (path, content)
        })
        .collect()
}
