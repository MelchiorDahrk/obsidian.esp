//! Native scratch binary for exercising the library outside of WASM.
//!
//! The real product is the library crate (consumed as WASM by the Obsidian
//! plugin); this binary exists so developers can quickly test the
//! parse/compile/resolve/export pipeline against local files. The commented
//! blocks below are ready-made snippets for the common workflows — uncomment
//! and adjust paths as needed. Nothing here ships to users.

#![allow(unused)]

use std::path::{Path, PathBuf};

use anyhow::Result;
use openmw_config::OpenMWConfiguration;
use vfstool_lib::VFS;

use merge_to_master::merge_load_order;
use merge_to_master::traits::*;
use merge_to_master::{Cells, Dialogues, Objects, PluginData};

// use obsidian_esp::collect_master_paths;
// use obsidian_esp::logging::*;

// #[global_allocator]
// static GLOBAL: mimalloc::MiMalloc = mimalloc::MiMalloc;

fn main() -> Result<()> {
    // let _guard = init_logger();

    // let example_path = PathBuf::from("tests/test_topics_1/project");
    // info!("Parsing markdown from {}...", example_path.display());

    // let parsed = obsidian_esp::parse::parse_project_directory(&example_path)?;
    // let original_masters = parsed.header.masters.clone();

    // info!("Collecting load order...");
    // let (master_paths, master_sizes) = collect_master_paths(&original_masters);

    // info!("Compiling into dialogue structures...");
    // let compiled = obsidian_esp::compile::compile(parsed)?;

    // info!("Merging into masters and resolving diff...");
    // let resolved = obsidian_esp::compile::resolve::resolve(compiled, &master_paths, master_sizes)?;

    // let out_path = PathBuf::from("tests/test_topics_1/expect/output~1.esp");
    // info!("Saving into {}...", out_path.display());
    // resolved.save_path(&out_path)?; // Uses inner .into_plugin().save_path()

    // info!("Done!");

    // let path = Path::new("D:/Games/Morrowind/Data Files/OAAB_Grazelands.ESP");
    // let export_path = Path::new("D:/Games/Morrowind/Data Files/obsidian.esp export");

    // let plugin = PluginData::from_path(path)?;
    // obsidian_esp::export::write_project_directory(&plugin, export_path)?;

    Ok(())
}
