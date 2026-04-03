use std::path::Path;
use anyhow::{Context, Result};
use tes3::esp::{DialogueType2, FilterComparison, FilterType};

pub mod frontmatter;
pub mod header;
pub mod info;

#[derive(Debug)]
pub struct ParsedPlugin {
    pub header: ParsedHeader,
    pub infos: Vec<ParsedInfo>,
}

#[derive(Debug)]
pub struct ParsedHeader {
    pub author: String,
    pub description: String,
    pub file_type: String,
    pub masters: Vec<String>,
}

#[derive(Debug, Default)]
pub struct ParsedInfo {
    pub topic: String,
    pub existing_id: Option<String>,
    pub frontmatter: ParsedInfoFrontmatter,
    pub text: String,
}

#[derive(Debug, Default)]
pub struct ParsedInfoFrontmatter {
    pub dialogue_type: Option<DialogueType2>,
    pub prev_id: Option<String>,
    pub speaker_id: Option<String>,
    pub disposition: Option<i32>,
    pub speaker_race: Option<String>,
    pub speaker_sex: Option<i32>,
    pub speaker_class: Option<String>,
    pub speaker_faction: Option<String>,
    pub speaker_rank: Option<i8>,
    pub speaker_cell: Option<String>,
    pub player_faction: Option<String>,
    pub player_rank: Option<i8>,
    pub script_text: Option<String>,
    pub quest_state: Option<String>, // "Name", "Finished", "Restart"
    pub filters: Vec<ParsedFilter>,
}

#[derive(Debug)]
pub struct ParsedFilter {
    pub index: u8,
    pub filter_type: FilterType,
    pub function_name: Option<String>,
    pub comparison: FilterComparison,
    pub id: String,
    pub value: FilterValue,
}

#[derive(Debug)]
pub enum FilterValue {
    Float(f32),
    Integer(i32),
}

pub fn parse_project_directory(path: &Path) -> Result<ParsedPlugin> {
    let mut header = None;
    let mut infos = Vec::new();

    let entries = std::fs::read_dir(path)
        .with_context(|| format!("Failed to read directory: {}", path.display()))?;

    for entry in entries {
        let entry = entry?;
        let entry_path = entry.path();

        if entry_path.extension().and_then(|e| e.to_str()) != Some("md") {
            continue;
        }

        let file_name = entry_path.file_stem().unwrap().to_string_lossy().into_owned();
        let content = std::fs::read_to_string(&entry_path)
            .with_context(|| format!("Failed to read file: {}", entry_path.display()))?;
        let mut input = content.as_str();

        if file_name.eq_ignore_ascii_case("header") {
            header = Some(header::parse_header(&mut input)
                .map_err(|e| anyhow::anyhow!("{}", e))
                .with_context(|| format!("Failed to parse header.md"))?);
        } else {
            // Parse topic and optional ID from filename
            // Names typically like "Akatosh 20160125141604927941" or "Akatosh ~1"
            let (topic, existing_id) = if let Some(idx) = file_name.rfind(' ') {
                let topic_part = &file_name[..idx];
                let id_part = &file_name[idx + 1..];
                if id_part.starts_with('~') {
                    (topic_part.to_string(), None)
                } else {
                    (topic_part.to_string(), Some(id_part.to_string()))
                }
            } else {
                (file_name, None)
            };

            let (frontmatter, text) = info::parse_info_file(&mut input)
                .map_err(|e| anyhow::anyhow!("{}", e))
                .with_context(|| format!("Failed to parse info file: {}", entry_path.display()))?;

            infos.push(ParsedInfo {
                topic,
                existing_id,
                frontmatter,
                text,
            });
        }
    }

    let header = header.context("Missing header.md")?;

    Ok(ParsedPlugin { header, infos })
}
