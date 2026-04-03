#![allow(unused)]

use std::path::{Path, PathBuf};

use anyhow::Result;
use openmw_config::OpenMWConfiguration;
use vfstool_lib::VFS;

use merge_to_master::merge_load_order;
use merge_to_master::traits::*;
use merge_to_master::{Cells, Dialogues, Objects, PluginData};

use obsidian_md::collect_master_paths;
use obsidian_md::logging::*;

#[global_allocator]
static GLOBAL: mimalloc::MiMalloc = mimalloc::MiMalloc;

fn main() -> Result<()> {
    let _guard = init_logger();

    let example_path = PathBuf::from("tests/test_topics_1/project");
    info!("Parsing markdown from {}...", example_path.display());

    let parsed = obsidian_md::parse::parse_project_directory(&example_path)?;
    let original_masters = parsed.header.masters.clone();

    info!("Collecting load order...");
    let (master_paths, master_sizes) = collect_master_paths(&original_masters);

    info!("Compiling into dialogue structures...");
    let compiled = obsidian_md::compile::compile(parsed)?;

    info!("Merging into masters and resolving diff...");
    let resolved = obsidian_md::compile::resolve::resolve(compiled, &master_paths, master_sizes)?;

    let out_path = PathBuf::from("tests/test_topics_1/expect/output~1.esp");
    info!("Saving into {}...", out_path.display());
    resolved.save_path(&out_path)?; // Uses inner .into_plugin().save_path()

    info!("Done!");
    Ok(())
}
