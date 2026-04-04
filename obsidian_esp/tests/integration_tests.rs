use anyhow::Result;
use itertools::Itertools;
use merge_to_master::PluginData;
use obsidian_esp::collect_master_paths;
use std::fs;
use std::iter::zip;
use std::path::Path;
use tes3::esp::{
    Dialogue, DialogueData, DialogueInfo, DialogueType, DialogueType2, ObjectFlags, Plugin, Sex,
};
use uncased::AsUncased;

fn assert_infos_match_ignoring_next_id(
    expected_infos: &std::collections::VecDeque<tes3::esp::DialogueInfo>,
    actual_infos: &std::collections::VecDeque<tes3::esp::DialogueInfo>,
) {
    assert_eq!(expected_infos.len(), actual_infos.len());

    for (expected_info, actual_info) in zip(expected_infos, actual_infos) {
        assert_eq!(expected_info.flags, actual_info.flags);
        assert_eq!(expected_info.id, actual_info.id);
        assert_eq!(expected_info.prev_id, actual_info.prev_id);
        assert_eq!(expected_info.data, actual_info.data);
        assert_eq!(expected_info.speaker_id, actual_info.speaker_id);
        assert_eq!(expected_info.speaker_race, actual_info.speaker_race);
        assert_eq!(expected_info.speaker_class, actual_info.speaker_class);
        assert_eq!(expected_info.speaker_faction, actual_info.speaker_faction);
        assert_eq!(expected_info.speaker_cell, actual_info.speaker_cell);
        assert_eq!(expected_info.player_faction, actual_info.player_faction);
        assert_eq!(expected_info.sound_path, actual_info.sound_path);
        assert_eq!(expected_info.text, actual_info.text);
        assert_eq!(expected_info.quest_state, actual_info.quest_state);
        assert_eq!(expected_info.filters, actual_info.filters);
        assert_eq!(expected_info.script_text, actual_info.script_text);
    }
}

fn collect_project_files(path: &Path) -> Result<Vec<(String, String)>> {
    let mut files = Vec::new();

    for entry in fs::read_dir(path)? {
        let entry = entry?;
        let entry_path = entry.path();

        if entry.file_type()?.is_file() {
            if entry_path.extension().and_then(|ext| ext.to_str()) != Some("md") {
                continue;
            }

            files.push((
                entry_path
                    .strip_prefix(path)?
                    .to_string_lossy()
                    .into_owned(),
                fs::read_to_string(&entry_path)?,
            ));
            continue;
        }

        for topic_dir in fs::read_dir(&entry_path)? {
            let topic_dir = topic_dir?;
            if !topic_dir.file_type()?.is_dir() {
                continue;
            }

            for file in fs::read_dir(topic_dir.path())? {
                let file = file?;
                if !file.file_type()?.is_file() {
                    continue;
                }

                let file_path = file.path();
                if file_path.extension().and_then(|ext| ext.to_str()) != Some("md") {
                    continue;
                }

                files.push((
                    file_path
                        .strip_prefix(path)?
                        .to_string_lossy()
                        .into_owned(),
                    fs::read_to_string(&file_path)?,
                ));
            }
        }
    }

    Ok(files)
}

#[test]
fn test_topics_1() -> Result<()> {
    let markdown_path = Path::new("tests/test_topics_1/project");
    let expected_path = Path::new("tests/test_topics_1/expect/output.esp");

    let parsed = obsidian_esp::parse::parse_project_directory(&markdown_path)?;
    let (master_paths, master_sizes) = collect_master_paths(&parsed.header.masters);

    let compiled = obsidian_esp::compile::compile(parsed)?;
    let resolved = obsidian_esp::compile::resolve::resolve(compiled, &master_paths, master_sizes)?;
    let expected = PluginData::from_path(&expected_path)?;

    assert_eq!(resolved.dialogues.len(), expected.dialogues.len());

    let resolved_groups = resolved
        .dialogues
        .values()
        .sorted_by_key(|g| g.dialogue.id.as_uncased())
        .collect_vec();

    let expected_groups = expected
        .dialogues
        .values()
        .sorted_by_key(|g| g.dialogue.id.as_uncased())
        .collect_vec();

    for (resolved_group, expected_group) in zip(&resolved_groups, &expected_groups) {
        let expected_dialogue = &expected_group.dialogue;
        let resolved_dialogue = &resolved_group.dialogue;

        // Test `Dialogue` fields.

        assert_eq!(expected_dialogue.flags, resolved_dialogue.flags);
        assert_eq!(
            resolved_dialogue.id.as_uncased(),
            expected_dialogue.id.as_uncased()
        );
        assert_eq!(
            expected_dialogue.dialogue_type,
            resolved_dialogue.dialogue_type
        );

        // Test `DialogueInfo` fields.

        // Note: Don't compare `id` fields directly since they are generated randomly.
        // Instead, compare the structure and content of the dialogue infos.

        let expected_infos = &expected_group.infos;
        let resolved_infos = &resolved_group.infos;

        assert_eq!(
            expected_infos.len(),
            resolved_infos.len(),
            "group {}",
            expected_group.dialogue.id
        );

        for (expected_info, resolved_info) in zip(expected_infos, resolved_infos) {
            assert_eq!(expected_info.flags, resolved_info.flags);
            assert_eq!(
                expected_info.speaker_id.as_uncased(),
                resolved_info.speaker_id.as_uncased()
            );
            assert_eq!(
                expected_info.speaker_id.as_uncased(),
                resolved_info.speaker_id.as_uncased()
            );
            assert_eq!(expected_info.data, resolved_info.data);
            assert_eq!(
                expected_info.speaker_id.as_uncased(),
                resolved_info.speaker_id.as_uncased()
            );
            assert_eq!(
                expected_info.speaker_race.as_uncased(),
                resolved_info.speaker_race.as_uncased()
            );
            assert_eq!(
                expected_info.speaker_class.as_uncased(),
                resolved_info.speaker_class.as_uncased()
            );
            assert_eq!(
                expected_info.speaker_faction.as_uncased(),
                resolved_info.speaker_faction.as_uncased()
            );
            assert_eq!(
                expected_info.speaker_cell.as_uncased(),
                resolved_info.speaker_cell.as_uncased()
            );
            assert_eq!(
                expected_info.player_faction.as_uncased(),
                resolved_info.player_faction.as_uncased()
            );
            assert_eq!(
                expected_info.sound_path.as_uncased(),
                resolved_info.sound_path.as_uncased()
            );
            assert_eq!(expected_info.text, resolved_info.text);
            assert_eq!(expected_info.quest_state, resolved_info.quest_state);
            assert_eq!(expected_info.filters, resolved_info.filters);
            assert_eq!(expected_info.script_text, resolved_info.script_text);
        }
    }

    Ok(())
}

#[test]
fn test_export_round_trip() -> Result<()> {
    let expected_path = Path::new("tests/test_topics_1/expect/output.esp");
    let export_path = Path::new("tests/test_topics_1/generated");

    if export_path.exists() {
        fs::remove_dir_all(export_path)?;
    }
    fs::create_dir_all(export_path)?;

    let expected = PluginData::from_path(expected_path)?;
    obsidian_esp::export::write_project_directory(&expected, export_path)?;

    assert!(export_path.join("header.md").exists());
    assert!(export_path.join("Topic").join("Akatosh").join("Akatosh ~0.md").exists());
    assert!(export_path.join("Topic").join("test topic").join("test topic ~0.md").exists());
    assert!(
        export_path
            .join("Journal")
            .join("11111 test journal")
            .join("11111 test journal ~0.md")
            .exists()
    );
    assert!(
        export_path
            .join("Greeting")
            .join("Greeting 1")
            .join("Greeting 1 ~0.md")
            .exists()
    );

    let reparsed = obsidian_esp::parse::parse_project_directory(export_path)?;
    assert_eq!(
        reparsed.header.masters,
        expected
            .header
            .masters
            .iter()
            .map(|(name, _)| name.clone())
            .collect_vec()
    );

    let recompiled = obsidian_esp::compile::compile(reparsed)?;

    assert_eq!(recompiled.header.author, expected.header.author);
    assert_eq!(recompiled.header.description, expected.header.description);
    assert_eq!(recompiled.header.file_type, expected.header.file_type);
    assert_eq!(recompiled.dialogues.len(), expected.dialogues.len());

    let recompiled_groups = recompiled
        .dialogues
        .values()
        .sorted_by_key(|g| g.dialogue.id.as_uncased())
        .collect_vec();

    let expected_groups = expected
        .dialogues
        .values()
        .sorted_by_key(|g| g.dialogue.id.as_uncased())
        .collect_vec();

    for (recompiled_group, expected_group) in zip(&recompiled_groups, &expected_groups) {
        assert_eq!(recompiled_group.dialogue, expected_group.dialogue);
        assert_infos_match_ignoring_next_id(&expected_group.infos, &recompiled_group.infos);
    }

    Ok(())
}

#[test]
fn test_voice_export_includes_empty_result_field() -> Result<()> {
    let mut plugin = PluginData::new();
    plugin.dialogues.insert(
        "hello".to_string(),
        merge_to_master::DialogueGroup {
            dialogue: Dialogue {
                flags: ObjectFlags::empty(),
                id: "Hello".to_string(),
                dialogue_type: DialogueType2::Voice,
            },
            infos: std::collections::VecDeque::from([DialogueInfo {
                flags: ObjectFlags::empty(),
                id: "123456".to_string(),
                prev_id: String::new(),
                next_id: String::new(),
                data: DialogueData {
                    dialogue_type: DialogueType::Voice,
                    disposition: 0,
                    speaker_rank: -1,
                    speaker_sex: Sex::Any,
                    player_rank: -1,
                },
                sound_path: "Vo\\hello.wav".to_string(),
                text: "Hello there.".to_string(),
                ..Default::default()
            }]),
        },
    );

    let export_path = Path::new("tests/test_voice_export/generated");
    if export_path.exists() {
        fs::remove_dir_all(export_path)?;
    }
    fs::create_dir_all(export_path)?;

    obsidian_esp::export::write_project_directory(&plugin, export_path)?;

    let exported = fs::read_to_string(export_path.join("Voice").join("Hello").join("Hello ~0.md"))?;
    assert!(exported.contains("Type: Voice\n"));
    assert!(exported.contains("Sound Path: Vo\\hello.wav\n"));
    assert!(exported.contains("Result:\n"));

    let reparsed = obsidian_esp::parse::parse_project_directory(export_path)?;
    let recompiled = obsidian_esp::compile::compile(reparsed)?;
    let recompiled_group = recompiled.dialogues.get("hello").unwrap();
    let recompiled_info = recompiled_group.infos.front().unwrap();
    assert_eq!(recompiled_info.data.dialogue_type, DialogueType::Voice);
    assert_eq!(recompiled_info.sound_path, "Vo\\hello.wav");
    assert_eq!(recompiled_info.script_text, "");

    Ok(())
}

#[test]
fn test_parse_project_files_with_default_header() -> Result<()> {
    let markdown_path = Path::new("tests/test_topics_1/project");
    let project_files = collect_project_files(markdown_path)?
        .into_iter()
        .filter(|(path, _)| !path.eq_ignore_ascii_case("header.md"))
        .collect_vec();

    let parsed = obsidian_esp::parse::parse_project_files(
        project_files,
        Some(obsidian_esp::parse::ParsedHeader {
            author: String::new(),
            description: String::new(),
            file_type: "ESP".to_string(),
            masters: vec!["Morrowind.esm".to_string()],
        }),
    )?;

    assert_eq!(parsed.header.author, "");
    assert_eq!(parsed.header.description, "");
    assert_eq!(parsed.header.file_type, "ESP");
    assert_eq!(parsed.header.masters, vec!["Morrowind.esm".to_string()]);
    assert!(!parsed.infos.is_empty());

    Ok(())
}

#[test]
fn test_compile_project_files_generates_esp_bytes() -> Result<()> {
    let markdown_path = Path::new("tests/test_topics_1/project");
    let bytes = obsidian_esp::compile_project_files(collect_project_files(markdown_path)?, false)
        .map_err(anyhow::Error::msg)?;

    let mut plugin = Plugin::new();
    plugin.load_bytes(&bytes)?;

    let header = plugin.header().expect("compiled plugin should contain a header");
    assert_eq!(header.file_type, tes3::esp::FileType::Esp);
    assert_eq!(header.author.to_string(), "Melchior Dahrk");
    assert_eq!(header.description.to_string(), "dialogue test");
    assert_eq!(
        header
            .masters
            .iter()
            .map(|(name, _)| name.as_str())
            .collect_vec(),
        vec!["Morrowind.esm"]
    );
    assert_eq!(header.masters[0].1, 0);

    Ok(())
}
