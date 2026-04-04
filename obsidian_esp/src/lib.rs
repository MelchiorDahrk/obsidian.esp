#![allow(unused)]

pub mod logging;
pub use logging::*;
use tes3::esp::Plugin;

pub mod compile;
pub mod export;
pub mod parse;

use std::path::{Path, PathBuf};

use anyhow::Result;
use openmw_config::OpenMWConfiguration;
use vfstool_lib::VFS;

use merge_to_master::merge_load_order;
use merge_to_master::traits::*;
use merge_to_master::{Cells, Dialogues, Objects, PluginData};

/// Returns the absolute paths of the plugins in the users load order.
///
pub fn collect_load_order() -> Vec<PathBuf> {
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

pub fn collect_master_paths(master_names: &[String]) -> (Vec<PathBuf>, Vec<(String, u64)>) {
    let load_order = collect_load_order();

    let mut master_paths = Vec::with_capacity(master_names.len());
    let mut master_sizes = Vec::with_capacity(master_names.len());

    for name in master_names {
        for plugin_path in &load_order {
            if let Some(file_name) = plugin_path.file_name()
                && file_name
                    .as_encoded_bytes()
                    .eq_ignore_ascii_case(name.as_bytes())
                && let Ok(metadata) = plugin_path.metadata()
            {
                master_paths.push(plugin_path.clone());
                master_sizes.push((name.clone(), metadata.len()));
                break; // Found the master
            }
        }
    }

    (master_paths, master_sizes)
}

use js_sys::{Array, Uint8Array};
use serde_wasm_bindgen::{from_value, to_value};
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub fn load_objects(array: Uint8Array) -> Result<JsValue, JsValue> {
    let mut plugin = Plugin::new();
    plugin
        .load_bytes(array.to_vec().as_ref())
        .map_err(|e| JsValue::from(e.to_string()))?;

    let value = to_value(&plugin.objects)?;

    Ok(value)
}

#[wasm_bindgen]
pub fn save_objects(value: JsValue) -> Result<Uint8Array, JsValue> {
    let mut plugin = Plugin {
        objects: from_value(value)?,
    };

    let bytes = plugin
        .save_bytes()
        .map_err(|e| JsValue::from(e.to_string()))?;

    let length = u32::try_from(bytes.len()) //
        .map_err(|e| JsValue::from(e.to_string()))?;

    let array = Uint8Array::new_with_length(length);
    array.copy_from(&bytes);

    Ok(array)
}

/// Takes raw ESP/ESM bytes and returns an array of [path, content] pairs
/// representing the markdown project files.
#[wasm_bindgen]
pub fn unpack_plugin(array: Uint8Array) -> Result<JsValue, JsValue> {
    let mut plugin = Plugin::new();
    plugin
        .load_bytes(array.to_vec().as_ref())
        .map_err(|e| JsValue::from(e.to_string()))?;

    let plugin_data = PluginData::from_plugin(plugin);
    let files = export::collect_project_files(&plugin_data);

    let result = Array::new();
    for (path, content) in files {
        let pair = Array::new();
        pair.push(&JsValue::from_str(&path));
        pair.push(&JsValue::from_str(&content));
        result.push(&pair);
    }

    Ok(result.into())
}
