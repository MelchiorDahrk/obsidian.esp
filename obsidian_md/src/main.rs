#![allow(unused)]

use std::path::{Path, PathBuf};

use anyhow::Result;
use openmw_config::OpenMWConfiguration;
use vfstool_lib::VFS;

use merge_to_master::merge_load_order;
use merge_to_master::traits::*;
use merge_to_master::{Cells, Dialogues, Objects, PluginData};

use obsidian_md::logging::*;

#[global_allocator]
static GLOBAL: mimalloc::MiMalloc = mimalloc::MiMalloc;

/// Returns the absolute paths of the plugins in the users load order.
///
fn collect_load_order() -> Vec<PathBuf> {
    // This takes care of finding the users `openmw.cfg` file and parsing it
    // into structures we can work with.
    let config = OpenMWConfiguration::new(None).unwrap();

    // Once we have the configuration, we can construct the virtual file system
    // from the users data directories. This will allow us to find the absolute
    // paths of their plugins.
    let vfs = VFS::from_directories(config.data_directories(), None);

    // We only care about TES3 plugins, so we filter the contents by extension.
    config
        .content_files_iter()
        .filter_map(move |entry| {
            let value = entry.value();
            let path = Path::new(value);
            let ext = path.extension()?;
            let bytes = ext.as_encoded_bytes();
            if bytes.eq_ignore_ascii_case(b"esm")
                || bytes.eq_ignore_ascii_case(b"esp")
                || bytes.eq_ignore_ascii_case(b"omwgame")
                || bytes.eq_ignore_ascii_case(b"omwaddon")
            {
                Some(vfs.get_file(value)?.path().into())
            } else {
                None
            }
        })
        .collect()
}

fn main() -> Result<()> {
    let _guard = init_logger();

    let example_path = PathBuf::from("examples/obsidianDialogueTest");
    info!("Parsing markdown from {}...", example_path.display());
    
    let parsed = obsidian_md::parse::parse_project_directory(&example_path)?;
    let original_masters = parsed.header.masters.clone();
    
    info!("Collecting load order...");
    let load_order = collect_load_order();
    let mut master_paths = Vec::new();
    let mut original_masters_sized = Vec::new();
    for m in &original_masters {
        for p in &load_order {
            if p.file_name().unwrap().to_str().unwrap().eq_ignore_ascii_case(m) {
                master_paths.push(p.clone());
                let size = std::fs::metadata(p).map(|md| md.len()).unwrap_or(0);
                original_masters_sized.push((m.clone(), size));
                break; // Found the master
            }
        }
    }
    
    info!("Compiling into dialogue structures...");
    let compiled = obsidian_md::compile::compile(parsed)?;
    
    info!("Merging into masters and resolving diff...");
    let resolved = obsidian_md::compile::resolve::resolve(compiled, &master_paths, original_masters_sized)?;
    
    let out_path = PathBuf::from("examples/output.esp");
    info!("Saving into {}...", out_path.display());
    resolved.save_path(&out_path)?; // Uses inner .into_plugin().save_path()

    info!("Done!");
    Ok(())
}

#[test]
fn load_bethesda_masters() {
    let load_order: Vec<_> = collect_load_order()
        .into_iter()
        .filter(|path| {
            let file_name = path.file_name().unwrap().to_str().unwrap();
            ["Morrowind.esm", "Tribunal.esm", "Bloodmoon.esm"].contains(&file_name)
        })
        .collect();

    assert_eq!(load_order.len(), 3);

    let merged: PluginData = merge_to_master::merge_load_order(&load_order).unwrap();

    assert_eq!(merged.cells.len(), 2887);
    assert_eq!(merged.objects.len(), 21346);
    assert_eq!(merged.dialogues.len(), 2884);
}
