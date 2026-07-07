//! # obsidian_esp
//!
//! Core crate for authoring The Elder Scrolls III: Morrowind dialogue and quests
//! in Markdown and compiling them into native TES3 plugin files (`.esp`/`.esm`).
//!
//! The crate is consumed in two ways:
//!
//! - **Natively** — by the integration tests and the scratch binary in `main.rs`,
//!   where projects are read from disk and resolved against the user's OpenMW
//!   load order.
//! - **As WebAssembly** — inside the companion Obsidian plugin
//!   (`obsidian_plugin/`). Every `#[wasm_bindgen]` item in this file is part of
//!   the JS-facing API surface.
//!
//! ## Pipeline overview
//!
//! ```text
//! Markdown files --parse--> ParsedPlugin --compile--> PluginData --resolve--> .esp bytes
//!                                                          ^
//!                                        master plugins ---+ (merge + diff)
//! ```
//!
//! - [`parse`] turns Markdown/YAML project files into the intermediate
//!   [`parse::ParsedPlugin`] representation.
//! - [`compile`] lowers that representation into native TES3 records
//!   ([`merge_to_master::PluginData`]), validates references against master
//!   plugins, and resolves diffs against the load order.
//! - [`export`] performs the reverse trip: unpacking a compiled plugin back
//!   into Markdown project files.
//! - [`logging`] wires `tracing` up for both native and WASM targets.
//!
//! The WASM API also exposes [`GameDatabase`], an in-memory merged view of a
//! plugin plus its masters that the Obsidian plugin queries for topic lists,
//! lazy topic unpacking, and incidental-edit detection.

#![allow(unused)]

pub mod logging;
pub use logging::*;
use tes3::esp::{DialogueInfo, DialogueType, ObjectInfo, Plugin, QuestState, Sex, TES3Object};

pub mod compile;
pub mod export;
pub mod parse;

use std::collections::{BTreeMap, HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};

use anyhow::Result;
use openmw_config::OpenMWConfiguration;
use serde::{Deserialize, Serialize};
use vfstool_lib::VFS;

use merge_to_master::merge_load_order;
use merge_to_master::traits::*;
use merge_to_master::{Cells, Dialogues, Objects, PluginData};

/// Returns the absolute paths of all Morrowind plugins found in the user's OpenMW load order.
///
/// This function locates the `openmw.cfg` file, parses its data directories to build a
/// virtual file system (VFS), and then iterates through the content files to find
/// their corresponding absolute paths on disk.
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

/// Given a list of master plugin names, returns their absolute paths and file sizes.
///
/// It searches for each master name within the user's load order (retrieved via
/// `collect_load_order`). The file size is required for the TES3 header's master list.
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
use js_sys::{Object, Reflect};
use serde_wasm_bindgen::{from_value, to_value};
use wasm_bindgen::prelude::*;

/// Counts how many times raw plugin bytes have crossed the JS -> WASM boundary.
///
/// Large master files are expensive to copy into WASM memory, so the plugin's
/// test suite uses this counter (via [`get_byte_ingress_counter`]) to assert
/// that loading paths do not copy payloads more often than intended.
static BYTE_INGRESS_COUNTER: AtomicUsize = AtomicUsize::new(0);

/// Increments [`BYTE_INGRESS_COUNTER`]. Call this at every point where raw
/// plugin bytes are copied from JS into WASM memory.
fn record_byte_ingress() {
    BYTE_INGRESS_COUNTER.fetch_add(1, Ordering::Relaxed);
}

/// Parses a [`Plugin`] from a raw byte slice handed over from JS,
/// recording the boundary crossing for ingress accounting.
fn load_plugin_from_slice(bytes: &[u8]) -> Result<Plugin, JsValue> {
    record_byte_ingress();
    let mut plugin = Plugin::new();
    plugin
        .load_bytes(bytes)
        .map_err(|e| JsValue::from_str(&e.to_string()))?;
    Ok(plugin)
}

/// Parses a [`Plugin`] from a buffer that already lives in WASM memory.
///
/// Unlike [`load_plugin_from_slice`] this does not count as a new byte
/// ingress: the copy was already recorded when the [`PluginBytes`] was built.
fn load_plugin_from_buffer(bytes: &PluginBytes) -> Result<Plugin, JsValue> {
    let mut plugin = Plugin::new();
    plugin
        .load_bytes(bytes.as_slice())
        .map_err(|e| JsValue::from_str(&e.to_string()))?;
    Ok(plugin)
}

/// A WASM-owned plugin byte buffer.
///
/// This is the single intended JS -> WASM ingress point for large TES3 binary payloads
/// used during database loading.
#[wasm_bindgen]
pub struct PluginBytes {
    bytes: Vec<u8>,
}

#[wasm_bindgen]
impl PluginBytes {
    /// Copies the given JS byte array into WASM memory (counted as one ingress).
    #[wasm_bindgen(constructor)]
    pub fn new(bytes: &[u8]) -> PluginBytes {
        record_byte_ingress();
        PluginBytes {
            bytes: bytes.to_vec(),
        }
    }

    /// The size of the owned buffer in bytes.
    #[wasm_bindgen(getter)]
    pub fn len(&self) -> usize {
        self.bytes.len()
    }
}

impl PluginBytes {
    /// Borrows the owned buffer for parsing without another copy.
    fn as_slice(&self) -> &[u8] {
        &self.bytes
    }
}

/// Resets the byte-ingress counter to zero. Used by tests to measure a single
/// loading operation in isolation.
#[wasm_bindgen(js_name = "resetByteIngressCounter")]
pub fn reset_byte_ingress_counter() {
    BYTE_INGRESS_COUNTER.store(0, Ordering::Relaxed);
}

/// Returns how many times raw plugin bytes were copied from JS into WASM
/// memory since the last reset. See the `BYTE_INGRESS_COUNTER` static.
#[wasm_bindgen(js_name = "getByteIngressCounter")]
pub fn get_byte_ingress_counter() -> usize {
    BYTE_INGRESS_COUNTER.load(Ordering::Relaxed)
}

/// Flags controlling which record types [`extract_property_values`] scans.
///
/// Deserialized from a plain JS object; any missing flag defaults to `false`.
#[derive(Default, Deserialize)]
#[serde(default)]
struct PropertyExtractionOptions {
    include_factions: bool,
    include_races: bool,
    include_classes: bool,
    /// NPC and creature record IDs (used for the `ID` frontmatter field).
    include_ids: bool,
    include_cells: bool,
}

/// Unique record IDs/names harvested from a plugin, grouped by category.
///
/// Serialized back to JS to power autocomplete in the Obsidian plugin.
#[derive(Default, Serialize)]
struct PropertyValueSet {
    factions: Vec<String>,
    races: Vec<String>,
    classes: Vec<String>,
    /// NPC and creature IDs.
    ids: Vec<String>,
    cells: Vec<String>,
}

/// Inserts a value into a collection if it's not already present, performing case-insensitive
/// matching but preserving the original casing of the first instance found.
fn push_unique_value(values: &mut BTreeMap<String, String>, value: &str) {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return;
    }

    values
        .entry(trimmed.to_ascii_lowercase())
        .or_insert_with(|| trimmed.to_string());
}

/// Iterates through a plugin's objects and extracts unique ID/Name values for specific
/// record types (Factions, Races, Classes, etc.) based on the provided options.
///
/// This is primarily used to provide autocomplete data to the Obsidian plugin.
fn collect_property_values(
    plugin: Plugin,
    options: &PropertyExtractionOptions,
) -> PropertyValueSet {
    let mut factions = BTreeMap::new();
    let mut races = BTreeMap::new();
    let mut classes = BTreeMap::new();
    let mut ids = BTreeMap::new();
    let mut cells = BTreeMap::new();

    for object in plugin.objects {
        match object {
            TES3Object::Faction(record) if options.include_factions => {
                push_unique_value(&mut factions, &record.id);
            }
            TES3Object::Race(record) if options.include_races => {
                push_unique_value(&mut races, &record.id);
            }
            TES3Object::Class(record) if options.include_classes => {
                push_unique_value(&mut classes, &record.id);
            }
            TES3Object::Npc(record) if options.include_ids => {
                push_unique_value(&mut ids, &record.id);
            }
            TES3Object::Creature(record) if options.include_ids => {
                push_unique_value(&mut ids, &record.id);
            }
            TES3Object::Cell(record) if options.include_cells => {
                push_unique_value(&mut cells, &record.name);
            }
            _ => {}
        }
    }

    PropertyValueSet {
        factions: factions.into_values().collect(),
        races: races.into_values().collect(),
        classes: classes.into_values().collect(),
        ids: ids.into_values().collect(),
        cells: cells.into_values().collect(),
    }
}

/// Returns a fallback `ParsedHeader` used when no `header.yaml` is provided in the project.
fn default_header() -> parse::ParsedHeader {
    parse::ParsedHeader {
        author: String::new(),
        description: String::new(),
        file_type: "ESP".to_string(),
        masters: vec!["Morrowind.esm".to_string()],
    }
}

/// Compiles a set of Markdown files and an optional header into a binary TES3 plugin (`.esp`).
///
/// Under the hood, this calls `compile_project_files_with_log` and discards the log output.
pub fn compile_project_files(
    files: Vec<(String, String)>,
    allow_default_header: bool,
    force_esp: bool,
) -> Result<Vec<u8>, String> {
    compile_project_files_with_log(files, allow_default_header, force_esp, vec![])
        .map(|(bytes, _log)| bytes)
}

/// The core project compilation routine.
///
/// 1. Parses Markdown project files into an internal representation.
/// 2. Validates the project against provided master plugin data (for ID/Script checking).
/// 3. Compiles the internal representation into TES3 records.
/// 4. Serializes the records into the final plugin byte array.
///
/// Returns the binary plugin data and a compilation/validation log string.
pub fn compile_project_files_with_log(
    files: Vec<(String, String)>,
    allow_default_header: bool,
    force_esp: bool,
    masters: Vec<(String, Vec<u8>)>,
) -> Result<(Vec<u8>, String), String> {
    let default_header = allow_default_header.then(default_header);
    let parsed =
        parse::parse_project_files(files, default_header).map_err(|error| error.to_string())?;
    let authored_masters = parsed.header.masters.clone();
    let log = compile::validate::validate_project(&parsed, &masters)
        .map_err(|error| error.to_string())?;

    let mut compiled = compile::compile(parsed).map_err(|error| error.to_string())?;
    compiled.header.masters = authored_masters
        .into_iter()
        .map(|master_name| (master_name, 0))
        .collect();

    let mut plugin = compiled.into_plugin();

    if let Some(header) = plugin.header_mut()
        && force_esp
    {
        header.file_type = tes3::esp::FileType::Esp;
    }

    let bytes = plugin.save_bytes().map_err(|error| error.to_string())?;
    Ok((bytes, log))
}

/// Deserializes a TES3 plugin from bytes into a `JsValue` containing an array of records.
#[wasm_bindgen]
pub fn load_objects(array: &[u8]) -> Result<JsValue, JsValue> {
    let plugin = load_plugin_from_slice(array)?;

    let value = to_value(&plugin.objects)?;

    Ok(value)
}

/// Serializes an array of records from a `JsValue` into a TES3 plugin byte array.
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

/// Compiles a project (Markdown files) into a TES3 plugin.
#[wasm_bindgen]
pub fn compile_project(files: JsValue, allow_default_header: bool) -> Result<Uint8Array, JsValue> {
    let files: Vec<(String, String)> = from_value(files)?;
    let bytes = compile_project_files(files, allow_default_header, /*force_esp*/ true)
        .map_err(JsValue::from)?;

    let length = u32::try_from(bytes.len()).map_err(|error| JsValue::from(error.to_string()))?;
    let array = Uint8Array::new_with_length(length);
    array.copy_from(&bytes);

    Ok(array)
}

/// Compiles a project (Markdown files) into a TES3 plugin and returns both the bytes and a log.
///
/// `masters` should be a JS array of `[name: string, bytes: Uint8Array]` pairs for validation.
#[wasm_bindgen]
pub fn compile_project_with_log(
    files: JsValue,
    allow_default_header: bool,
    masters: JsValue,
) -> Result<JsValue, JsValue> {
    let files: Vec<(String, String)> = from_value(files)?;
    let masters: Vec<(String, Vec<u8>)> = from_value(masters)?;
    let (bytes, log) = compile_project_files_with_log(
        files,
        allow_default_header,
        /*force_esp*/ true,
        masters,
    )
    .map_err(JsValue::from)?;

    let length = u32::try_from(bytes.len()).map_err(|error| JsValue::from(error.to_string()))?;
    let array = Uint8Array::new_with_length(length);
    array.copy_from(&bytes);

    let result = Object::new();
    Reflect::set(&result, &JsValue::from_str("bytes"), &array.into())?;
    Reflect::set(&result, &JsValue::from_str("log"), &JsValue::from_str(&log))?;

    Ok(result.into())
}

/// Extracts unique property values (IDs, Names) from a plugin for use in UI autocompletion.
#[wasm_bindgen]
pub fn extract_property_values(array: &[u8], options: JsValue) -> Result<JsValue, JsValue> {
    let plugin = load_plugin_from_slice(array)?;

    let options: PropertyExtractionOptions = from_value(options)?;
    let values = collect_property_values(plugin, &options);

    to_value(&values).map_err(Into::into)
}

/// Parse raw plugin bytes and return the master names from the header as a JS string array.
/// Lightweight — avoids creating a full GameDatabase just to read the header.
#[wasm_bindgen(js_name = "extractMasterNames")]
pub fn extract_master_names(bytes: &[u8]) -> Result<JsValue, JsValue> {
    let plugin = load_plugin_from_slice(bytes)?;
    let names: Vec<String> = plugin
        .header()
        .map(|h| h.masters.iter().map(|(name, _)| name.clone()).collect())
        .unwrap_or_default();
    to_value(&names).map_err(Into::into)
}

/// A full game database loaded into WASM memory.
/// Constructed from raw ESP/ESM bytes; kept alive as long as the JS handle exists.
#[wasm_bindgen]
pub struct GameDatabase {
    /// The merged record set (plugin content layered over its masters).
    data: PluginData,
    /// `true` when the database was built together with master files, meaning
    /// `modified` flags reliably distinguish plugin content from master content.
    merged: bool,
    /// `(topic_key, info_id)` pairs whose only difference from the masters is
    /// their prev/next link pointers. These are treated as non-edits when
    /// exporting or scanning for incidental changes.
    link_only_changes: Vec<(String, String)>,
}

#[wasm_bindgen]
impl GameDatabase {
    /// Parse raw ESP/ESM bytes into a structured PluginData held in WASM memory.
    #[wasm_bindgen(constructor)]
    pub fn load(bytes: &[u8]) -> Result<GameDatabase, JsValue> {
        let plugin = load_plugin_from_slice(bytes)?;
        let data = PluginData::from_plugin(plugin);
        Ok(GameDatabase {
            data,
            merged: false,
            link_only_changes: Vec::new(),
        })
    }

    /// Parse raw ESP/ESM bytes from a WASM-owned buffer into a structured `PluginData`.
    #[wasm_bindgen(js_name = "loadFromBytes")]
    pub fn load_from_bytes(bytes: &PluginBytes) -> Result<GameDatabase, JsValue> {
        let plugin = load_plugin_from_buffer(bytes)?;
        let data = PluginData::from_plugin(plugin);
        Ok(GameDatabase {
            data,
            merged: false,
            link_only_changes: Vec::new(),
        })
    }

    /// Load a plugin merged with its masters into a single resolved database.
    /// `masters_js` is a JS array of `[name: string, bytes: Uint8Array]` pairs.
    #[wasm_bindgen(js_name = "loadWithMasters")]
    pub fn load_with_masters(
        plugin_bytes: &[u8],
        masters_js: JsValue,
    ) -> Result<GameDatabase, JsValue> {
        let master_entries: Vec<(String, Vec<u8>)> =
            from_value(masters_js).map_err(|e| JsValue::from_str(&e.to_string()))?;

        // Parse plugin
        let mut plugin_raw = Plugin::new();
        plugin_raw
            .load_bytes(plugin_bytes)
            .map_err(|e| JsValue::from_str(&e.to_string()))?;

        // Save original masters list before conversion
        let original_masters: Vec<(String, u64)> = plugin_raw
            .header()
            .map(|h| h.masters.clone())
            .unwrap_or_default();

        let plugin_data = PluginData::from_plugin(plugin_raw);

        // Parse each master into PluginData
        let mut master_datas = Vec::with_capacity(master_entries.len());
        for (name, bytes) in master_entries {
            let mut master_raw = Plugin::new();
            master_raw
                .load_bytes(&bytes)
                .map_err(|e| JsValue::from_str(&format!("Failed to load master '{name}': {e}")))?;
            master_datas.push(PluginData::from_plugin(master_raw));
        }

        let (data, link_only_changes) =
            compile::resolve::resolve_full_database(plugin_data, master_datas, original_masters)
                .map_err(|e| JsValue::from_str(&e.to_string()))?;

        Ok(GameDatabase {
            data,
            merged: true,
            link_only_changes,
        })
    }

    /// Load a plugin merged with pre-parsed masters.
    /// `masters_js` is a JS array of object arrays (obtained via `load_objects` on workers).
    #[wasm_bindgen(js_name = "loadWithPreparsedMasters")]
    pub fn load_with_preparsed_masters(
        plugin_bytes: &[u8],
        masters_js: JsValue,
    ) -> Result<GameDatabase, JsValue> {
        let master_objects: Vec<Vec<TES3Object>> = from_value(masters_js).map_err(|e| {
            JsValue::from_str(&format!("Failed to deserialize master objects: {e}"))
        })?;

        // Parse plugin
        let mut plugin_raw = Plugin::new();
        plugin_raw
            .load_bytes(plugin_bytes)
            .map_err(|e| JsValue::from_str(&e.to_string()))?;

        // Save original masters list before conversion
        let original_masters: Vec<(String, u64)> = plugin_raw
            .header()
            .map(|h| h.masters.clone())
            .unwrap_or_default();

        let plugin_data = PluginData::from_plugin(plugin_raw);

        // Convert object lists to PluginData
        let master_datas: Vec<PluginData> = master_objects
            .into_iter()
            .map(|objects| PluginData::from_plugin(Plugin { objects }))
            .collect();

        let (data, link_only_changes) =
            compile::resolve::resolve_full_database(plugin_data, master_datas, original_masters)
                .map_err(|e| JsValue::from_str(&e.to_string()))?;

        Ok(GameDatabase {
            data,
            merged: true,
            link_only_changes,
        })
    }

    /// Load a plugin merged with master buffers that already live in this WASM instance.
    #[wasm_bindgen(js_name = "loadWithMasterBuffers")]
    pub fn load_with_master_buffers(
        plugin_bytes: &PluginBytes,
        masters_js: JsValue,
    ) -> Result<GameDatabase, JsValue> {
        let master_entries: Vec<(String, Vec<u8>)> =
            from_value(masters_js).map_err(|e| JsValue::from_str(&e.to_string()))?;

        let plugin_raw = load_plugin_from_buffer(plugin_bytes)?;

        let original_masters: Vec<(String, u64)> = plugin_raw
            .header()
            .map(|h| h.masters.clone())
            .unwrap_or_default();

        let plugin_data = PluginData::from_plugin(plugin_raw);

        let mut master_datas = Vec::with_capacity(master_entries.len());
        for (name, bytes) in master_entries {
            record_byte_ingress();
            let mut master_raw = Plugin::new();
            master_raw
                .load_bytes(&bytes)
                .map_err(|e| JsValue::from_str(&format!("Failed to load master '{name}': {e}")))?;
            master_datas.push(PluginData::from_plugin(master_raw));
        }

        let (data, link_only_changes) =
            compile::resolve::resolve_full_database(plugin_data, master_datas, original_masters)
                .map_err(|e| JsValue::from_str(&e.to_string()))?;

        Ok(GameDatabase {
            data,
            merged: true,
            link_only_changes,
        })
    }

    /// Whether this database was loaded with masters (merged mode).
    #[wasm_bindgen(js_name = "isMerged")]
    pub fn is_merged(&self) -> bool {
        self.merged
    }

    /// Total number of records in the database.
    #[wasm_bindgen(js_name = "objectCount")]
    pub fn object_count(&self) -> usize {
        self.data.count_objects()
    }

    /// Returns all Activator records as a serialized JS array.
    #[wasm_bindgen(js_name = "getActivators")]
    pub fn get_activators(&self) -> Result<JsValue, JsValue> {
        let activators: Vec<&tes3::esp::Activator> = self
            .data
            .objects
            .values()
            .filter_map(|obj| match obj {
                TES3Object::Activator(a) => Some(a),
                _ => None,
            })
            .collect();
        to_value(&activators).map_err(Into::into)
    }

    /// Unpacks the database into markdown project files.
    #[wasm_bindgen]
    pub fn unpack(&self) -> Result<JsValue, JsValue> {
        let files = export::collect_project_files(&self.data);

        let result = Array::new();
        for (path, content) in files {
            let pair = Array::new();
            pair.push(&JsValue::from_str(&path));
            pair.push(&JsValue::from_str(&content));
            result.push(&pair);
        }

        Ok(result.into())
    }

    /// Unpacks only the modified (plugin-owned) dialogues into markdown project files.
    #[wasm_bindgen(js_name = "unpackModified")]
    pub fn unpack_modified(&self) -> Result<JsValue, JsValue> {
        let mut files = export::collect_modified_project_files(&self.data);

        // Filter out files that only had link-pointer (prev/next) changes.
        self.filter_link_only_changes(&mut files);

        let result = Array::new();
        for (path, content) in files {
            let pair = Array::new();
            pair.push(&JsValue::from_str(&path));
            pair.push(&JsValue::from_str(&content));
            result.push(&pair);
        }

        Ok(result.into())
    }

    /// Returns a sorted list of all topic names in the database.
    #[wasm_bindgen(js_name = "getAllTopicNames")]
    pub fn get_all_topic_names(&self) -> Result<JsValue, JsValue> {
        let names = export::collect_all_topic_names(&self.data);
        to_value(&names).map_err(Into::into)
    }

    /// Unpacks a single topic's info files (for lazy loading).
    /// The topic is looked up case-insensitively.
    #[wasm_bindgen(js_name = "unpackTopic")]
    pub fn unpack_topic(&self, topic_name: &str) -> Result<JsValue, JsValue> {
        let files = export::collect_single_topic_files(&self.data, topic_name);

        let result = Array::new();
        for (path, content) in files {
            let pair = Array::new();
            pair.push(&JsValue::from_str(&path));
            pair.push(&JsValue::from_str(&content));
            result.push(&pair);
        }

        Ok(result.into())
    }

    /// Prunes a list of generated files by removing any dialogue blocks that only
    /// contain "structural" link changes and no "semantic" content changes.
    ///
    /// This prevents the user's workspace from being cluttered with hundreds of
    /// "modified" files when they only changed the order of responses in a topic.
    fn filter_link_only_changes(&self, files: &mut Vec<(String, String)>) {
        if self.link_only_changes.is_empty() {
            return;
        }

        use std::collections::HashSet;
        let ignore: HashSet<_> = self.link_only_changes.iter().collect();
        files.retain(|(_path, content)| {
            if let Some((t, d)) = self.parse_frontmatter_values(content) {
                !ignore.contains(&(t, d))
            } else {
                true
            }
        });
    }

    /// Parses the `Topic` and `DiagID` fields from a Markdown file's YAML frontmatter.
    ///
    /// This is a lightweight parser used specifically for filtering link-only changes
    /// during the export pass.
    fn parse_frontmatter_values(&self, s: &str) -> Option<(String, String)> {
        let mut topic: Option<String> = None;
        let mut diagid: Option<String> = None;
        for line in s.lines() {
            if line.starts_with("Topic:") {
                topic = Some(line["Topic:".len()..].trim().to_string());
            } else if line.starts_with("DiagID:") {
                diagid = Some(line["DiagID:".len()..].trim().to_string());
            }
            if topic.is_some() && diagid.is_some() {
                break;
            }
        }
        match (topic, diagid) {
            (Some(t), Some(d)) => Some((t, d)),
            _ => None,
        }
    }

    /// Evaluates a list of markdown file contents and returns the paths of those that
    /// are "incidental" (i.e. functionally identical to the master database).
    #[wasm_bindgen(js_name = "findIncidentalEdits")]
    pub fn find_incidental_edits(&self, files: JsValue) -> Result<JsValue, JsValue> {
        // Safety: If no master files are loaded, we never consider anything incidental.
        if !self.merged {
            return Ok(Array::new().into());
        }

        let files: Vec<(String, String)> = from_value(files)?;
        let incidental_paths = self.collect_incidental_edit_paths(&files);

        let result = Array::new();
        for path in incidental_paths {
            result.push(&JsValue::from_str(&path));
        }

        Ok(result.into())
    }

    /// Core of [`Self::find_incidental_edits`]: returns the paths of files whose
    /// content is functionally identical to the merged master database.
    ///
    /// Files are grouped by their parent (topic) folder. A dialogue file is
    /// incidental when it came from a master (`Source: master`), its record is
    /// unmodified (or only link pointers changed), and its parsed content still
    /// matches the database record. A topic's generated index file is only
    /// considered incidental when every dialogue file in that folder is — so a
    /// partially edited topic keeps its index.
    fn collect_incidental_edit_paths(&self, files: &[(String, String)]) -> Vec<String> {
        if !self.merged {
            return Vec::new();
        }

        let link_only: HashSet<_> = self.link_only_changes.iter().collect();
        let mut folder_state = HashMap::<String, TopicFolderIncidentalState>::new();

        for (path, content) in files {
            let Some((topic_name, diagid)) = self.parse_frontmatter_values(content) else {
                continue;
            };

            let folder_path = parent_relative_path(path);
            let state = folder_state.entry(folder_path).or_default();

            if !is_master_source_file(content) {
                state.has_non_incidental_dialogue = true;
                continue;
            }

            state.has_master_source_dialogue = true;
            if !self.is_dialogue_file_incidental(path, content, &topic_name, &diagid, &link_only) {
                state.has_non_incidental_dialogue = true;
            }
        }

        let mut result = Vec::new();
        for (path, content) in files {
            let folder_path = parent_relative_path(path);
            let Some(state) = folder_state.get(&folder_path) else {
                continue;
            };

            if let Some((topic_name, diagid)) = self.parse_frontmatter_values(content) {
                if is_master_source_file(content)
                    && self.is_dialogue_file_incidental(path, content, &topic_name, &diagid, &link_only)
                {
                    result.push(path.clone());
                }
            } else if state.has_master_source_dialogue
                && !state.has_non_incidental_dialogue
                && self.is_incidental_index_file(content)
            {
                result.push(path.clone());
            }
        }

        result
    }

    /// Checks a single dialogue file against the database record it claims to
    /// represent (matched by topic + DiagID, case-insensitively).
    ///
    /// Returns `true` only when the record is unmodified (or listed in
    /// `link_only_changes`) *and* the file's parsed frontmatter/body still
    /// matches the database content field-for-field.
    fn is_dialogue_file_incidental(
        &self,
        path: &str,
        content: &str,
        topic_name: &str,
        diagid: &str,
        link_only: &HashSet<&(String, String)>,
    ) -> bool {
        let topic_key = topic_name.to_ascii_lowercase();

        let Some(group) = self.data.dialogues.get(&topic_key) else {
            return false;
        };
        let Some(db_info) = group.infos.iter().find(|i| i.id.eq_ignore_ascii_case(diagid)) else {
            return false;
        };

        let is_incidental = !db_info.modified() || link_only.contains(&(topic_key.clone(), db_info.id.clone()));
        if !is_incidental {
            return false;
        }

        use winnow::Parser;
        let Ok((frontmatter, text)) = parse::info::parse_info_file.parse(content) else {
            return false;
        };

        let parsed_info = crate::parse::ParsedInfo {
            source_path: path.to_string(),
            topic: topic_name.to_string(),
            frontmatter,
            text,
        };

        is_parsed_info_matching(&parsed_info, db_info)
    }

    /// Determines if a file is an unedited topic index file generated by the LazyLoader.
    fn is_incidental_index_file(&self, content: &str) -> bool {
        is_generated_topic_index_file(content)
    }
}

/// Per-topic-folder aggregation used by `collect_incidental_edit_paths` to
/// decide whether a topic's generated index file can be cleaned up.
#[derive(Default)]
struct TopicFolderIncidentalState {
    /// At least one dialogue file in the folder declares `Source: master`.
    has_master_source_dialogue: bool,
    /// At least one dialogue file in the folder carries real (user) edits.
    has_non_incidental_dialogue: bool,
}

/// Compares a parsed markdown record against a database record to see if they are
/// functionally identical.
fn is_parsed_info_matching(parsed: &crate::parse::ParsedInfo, db: &DialogueInfo) -> bool {
    // 1. Check basic properties
    if parsed.text != db.text && normalize_incidental_body_text(&parsed.text) != db.text {
        return false;
    }
    if parsed.frontmatter.disposition.unwrap_or(0) != db.data.disposition {
        return false;
    }
    if parsed.frontmatter.speaker_rank.unwrap_or(-1) != db.data.speaker_rank {
        return false;
    }
    if parsed.frontmatter.player_rank.unwrap_or(-1) != db.data.player_rank {
        return false;
    }

    let speaker_sex = match parsed.frontmatter.speaker_sex {
        Some(0) => Sex::Male,
        Some(1) => Sex::Female,
        _ => Sex::Any,
    };
    if speaker_sex != db.data.speaker_sex {
        return false;
    }

    if parsed.frontmatter.speaker_id.as_deref().unwrap_or_default() != db.speaker_id {
        return false;
    }
    if parsed
        .frontmatter
        .speaker_race
        .as_deref()
        .unwrap_or_default()
        != db.speaker_race
    {
        return false;
    }
    if parsed
        .frontmatter
        .speaker_class
        .as_deref()
        .unwrap_or_default()
        != db.speaker_class
    {
        return false;
    }
    if parsed
        .frontmatter
        .speaker_faction
        .as_deref()
        .unwrap_or_default()
        != db.speaker_faction
    {
        return false;
    }
    if parsed
        .frontmatter
        .speaker_cell
        .as_deref()
        .unwrap_or_default()
        != db.speaker_cell
    {
        return false;
    }
    if parsed
        .frontmatter
        .player_faction
        .as_deref()
        .unwrap_or_default()
        != db.player_faction
    {
        return false;
    }
    if parsed.frontmatter.sound_path.as_deref().unwrap_or_default() != db.sound_path {
        return false;
    }
    if parsed
        .frontmatter
        .script_text
        .as_deref()
        .unwrap_or_default()
        != db.script_text
    {
        return false;
    }

    // 2. Check Quest State
    let quest_state = parsed
        .frontmatter
        .quest_state
        .as_deref()
        .and_then(|s| match s {
            "Name" => Some(QuestState::Name),
            "Finished" => Some(QuestState::Finished),
            "Restart" => Some(QuestState::Restart),
            _ => None,
        });
    if quest_state != db.quest_state {
        return false;
    }

    // 3. Check Filters
    if parsed.frontmatter.filters.len() != db.filters.len() {
        return false;
    }
    for (i, pf) in parsed.frontmatter.filters.iter().enumerate() {
        let dbf = &db.filters[i];
        if pf.index != dbf.index {
            return false;
        }
        if pf.filter_type != dbf.filter_type {
            return false;
        }
        if pf.comparison != dbf.comparison {
            return false;
        }
        if pf.id != dbf.id {
            return false;
        }

        let pf_value = match pf.value {
            crate::parse::FilterValue::Float(f) => tes3::esp::FilterValue::Float(f),
            crate::parse::FilterValue::Integer(i) => tes3::esp::FilterValue::Integer(i),
        };
        if pf_value != dbf.value {
            return false;
        }
    }

    true
}

/// Rewrites Obsidian wiki-links (`[[target]]`, `[[target|display]]`,
/// `[[target#heading]]`) into the plain text the game engine would see.
///
/// Topic links are inserted into exported Markdown purely as an authoring aid,
/// so a body that differs from the database only by wiki-link syntax must
/// still compare as identical during incidental-edit detection.
fn normalize_incidental_body_text(text: &str) -> String {
    let chars: Vec<char> = text.chars().collect();
    let mut normalized = String::with_capacity(text.len());
    let mut index = 0;

    while index < chars.len() {
        if chars[index] == '[' && chars.get(index + 1) == Some(&'[') {
            index += 2;

            let mut target = String::new();
            let mut display = String::new();
            let mut has_display = false;
            let mut closed = false;

            while index < chars.len() {
                if chars[index] == ']' && chars.get(index + 1) == Some(&']') {
                    closed = true;
                    index += 2;
                    break;
                }

                if chars[index] == '|' && !has_display {
                    has_display = true;
                    index += 1;
                    continue;
                }

                if has_display {
                    display.push(chars[index]);
                } else {
                    target.push(chars[index]);
                }
                index += 1;
            }

            if closed {
                let replacement = if has_display {
                    display
                } else {
                    target.split('#').next().unwrap_or(&target).to_string()
                };
                normalized.push_str(&replacement);
                continue;
            }

            normalized.push_str("[[");
            normalized.push_str(&target);
            if has_display {
                normalized.push('|');
                normalized.push_str(&display);
            }
            break;
        }

        normalized.push(chars[index]);
        index += 1;
    }

    normalized
}

/// Returns the parent directory portion of a `/`-separated relative path
/// (empty string for top-level files).
fn parent_relative_path(path: &str) -> String {
    path.rsplit_once('/')
        .map(|(parent, _)| parent.to_string())
        .unwrap_or_default()
}

/// Returns `true` if the file's YAML frontmatter declares `Source: master`,
/// i.e. it was generated by unpacking a master rather than authored by hand.
fn is_master_source_file(content: &str) -> bool {
    let normalized = content.replace("\r\n", "\n").replace('\r', "\n");
    let mut lines = normalized.lines();

    if lines.next().map(str::trim) != Some("---") {
        return false;
    }

    for line in lines {
        let trimmed = line.trim();
        if trimmed == "---" {
            break;
        }

        let Some((key, value)) = trimmed.split_once(':') else {
            continue;
        };
        if key.trim().eq_ignore_ascii_case("Source")
            && value.trim().eq_ignore_ascii_case("master")
        {
            return true;
        }
    }

    false
}

/// Returns `true` if the file looks exactly like a topic index generated by the
/// plugin's LazyLoader: a single `![[...base.base#<Type> View]]` embed,
/// optionally preceded by the standard `esp-topic-base-view` cssclasses
/// frontmatter, with no user-added content.
fn is_generated_topic_index_file(content: &str) -> bool {
    let normalized = content.replace("\r\n", "\n").replace('\r', "\n");
    let trimmed = normalized.trim();
    let embed = trimmed
        .strip_prefix("---\ncssclasses:\n  - esp-topic-base-view\n---\n")
        .map(str::trim)
        .unwrap_or(trimmed);

    embed.starts_with("![[")
        && embed.ends_with("]]")
        && !embed.contains('\n')
        && embed.contains("base.base#")
        && ["Topic View", "Greeting View", "Journal View", "Persuasion View", "Voice View"]
            .iter()
            .any(|view_name| embed.contains(&format!("#{view_name}")))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn generated_topic_links_are_incidental() {
        let parsed = crate::parse::ParsedInfo {
            source_path: "Topic/sample/sample ~0.md".to_string(),
            topic: "sample".to_string(),
            frontmatter: crate::parse::ParsedInfoFrontmatter::default(),
            text: "Ask about [[test topic]] today.".to_string(),
        };

        let db = DialogueInfo {
            text: "Ask about test topic today.".to_string(),
            data: tes3::esp::DialogueData {
                dialogue_type: DialogueType::Topic,
                disposition: 0,
                speaker_rank: -1,
                speaker_sex: Sex::Any,
                player_rank: -1,
            },
            ..Default::default()
        };

        assert!(is_parsed_info_matching(&parsed, &db));
    }

    #[test]
    fn generated_topic_index_variants_are_incidental() {
        assert!(is_generated_topic_index_file(
            "![[My Export/base.base#Topic View]]\n",
        ));
        assert!(is_generated_topic_index_file(
            "---\ncssclasses:\n  - esp-topic-base-view\n---\n![[My Export/base.base#Topic View]]\n",
        ));
        assert!(!is_generated_topic_index_file(
            "![[My Export/base.base#Topic View]]\nCustom notes here.\n",
        ));
    }

    #[test]
    fn fresh_unpacked_topics_are_not_cleaned() {
        let db = build_test_database(true);
        let files = vec![
            (
                "Topic/sample/sample ~0.md".to_string(),
                "---\nType: Topic\nTopic: sample\nDiagID: 123456\n---\nAsk about test topic today.\n"
                    .to_string(),
            ),
            (
                "Topic/sample/sample.md".to_string(),
                "![[My Export/base.base#Topic View]]\n".to_string(),
            ),
        ];

        assert!(db.collect_incidental_edit_paths(&files).is_empty());
    }

    #[test]
    fn fully_incidental_lazy_loaded_topic_is_cleaned_as_a_unit() {
        let db = build_test_database(false);
        let files = vec![
            (
                "Topic/sample/sample ~0.md".to_string(),
                "---\nSource: master\nType: Topic\nTopic: sample\nDiagID: 123456\n---\nAsk about [[test topic]] today.\n"
                    .to_string(),
            ),
            (
                "Topic/sample/sample.md".to_string(),
                "![[My Export/base.base#Topic View]]\n".to_string(),
            ),
        ];

        let mut incidental = db.collect_incidental_edit_paths(&files);
        incidental.sort();

        assert_eq!(
            incidental,
            vec![
                "Topic/sample/sample ~0.md".to_string(),
                "Topic/sample/sample.md".to_string(),
            ]
        );
    }

    #[test]
    fn partially_edited_lazy_loaded_topic_keeps_index_and_edited_files() {
        let db = build_test_database(false);
        let files = vec![
            (
                "Topic/sample/sample ~0.md".to_string(),
                "---\nSource: master\nType: Topic\nTopic: sample\nDiagID: 123456\n---\nAsk about [[test topic]] today.\n"
                    .to_string(),
            ),
            (
                "Topic/sample/sample ~1.md".to_string(),
                "---\nSource: master\nType: Topic\nTopic: sample\nDiagID: 654321\n---\nThis line was manually edited.\n"
                    .to_string(),
            ),
            (
                "Topic/sample/sample.md".to_string(),
                "![[My Export/base.base#Topic View]]\n".to_string(),
            ),
        ];

        let incidental = db.collect_incidental_edit_paths(&files);

        assert_eq!(incidental, vec!["Topic/sample/sample ~0.md".to_string()]);
    }

    fn build_test_database(mark_modified: bool) -> GameDatabase {
        let mut data = PluginData::default();
        data.dialogues.insert(
            "sample".to_string(),
            merge_to_master::DialogueGroup {
                dialogue: tes3::esp::Dialogue {
                    flags: tes3::esp::ObjectFlags::empty(),
                    id: "sample".to_string(),
                    dialogue_type: tes3::esp::DialogueType2::Topic,
                },
                infos: std::collections::VecDeque::from([
                    DialogueInfo {
                        id: "123456".to_string(),
                        text: "Ask about test topic today.".to_string(),
                        data: tes3::esp::DialogueData {
                            dialogue_type: DialogueType::Topic,
                            disposition: 0,
                            speaker_rank: -1,
                            speaker_sex: Sex::Any,
                            player_rank: -1,
                        },
                        ..Default::default()
                    },
                    DialogueInfo {
                        id: "654321".to_string(),
                        text: "Ask about something else.".to_string(),
                        data: tes3::esp::DialogueData {
                            dialogue_type: DialogueType::Topic,
                            disposition: 0,
                            speaker_rank: -1,
                            speaker_sex: Sex::Any,
                            player_rank: -1,
                        },
                        ..Default::default()
                    },
                ]),
            },
        );
        data.set_all_modified(mark_modified);

        GameDatabase {
            data,
            merged: true,
            link_only_changes: Vec::new(),
        }
    }
}
