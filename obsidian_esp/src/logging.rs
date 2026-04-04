use tracing::Level;
use tracing_appender::non_blocking::WorkerGuard;

pub use tracing::{debug, error, info, trace, warn};
use wasm_bindgen::prelude::*;

// Note: Filter log levels at compile time using tracing features.
// <https://docs.rs/tracing/latest/tracing/level_filters/index.html>

#[cfg(not(target_arch = "wasm32"))]
pub fn init_logger() -> WorkerGuard {
    // Non-WASM (native) logging: Log to stdout (or to a file, etc.)
    let (writer, guard) = tracing_appender::non_blocking(std::io::stdout());

    let filter = tracing_subscriber::EnvFilter::builder()
        .with_default_directive(Level::INFO.into())
        .with_regex(false)
        .from_env_lossy();

    tracing_subscriber::fmt()
        .with_env_filter(filter)
        .with_writer(writer)
        .with_target(false)
        .with_file(true)
        .with_line_number(true)
        .without_time()
        .try_init()
        .unwrap();

    guard
}

#[cfg(target_arch = "wasm32")]
pub fn init_logger() -> WorkerGuard {
    // WASM-specific logging: Log to the JS console
    use web_sys::console;

    let (writer, guard) = tracing_appender::non_blocking(console_log_writer());

    let filter = tracing_subscriber::EnvFilter::builder()
        .with_default_directive(Level::INFO.into())
        .with_regex(false)
        .from_env_lossy();

    tracing_subscriber::fmt()
        .with_env_filter(filter)
        .with_writer(writer)
        .with_target(false)
        .with_file(true)
        .with_line_number(true)
        .without_time()
        .try_init()
        .unwrap();

    guard
}

#[cfg(target_arch = "wasm32")]
fn console_log_writer() -> impl std::io::Write {
    use std::fmt::Write;

    struct ConsoleLogWriter;

    impl std::io::Write for ConsoleLogWriter {
        fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
            let message = String::from_utf8_lossy(buf);
            // Correct conversion to JsValue using JsValue::from_str
            web_sys::console::log_1(&wasm_bindgen::JsValue::from_str(&message));
            Ok(buf.len())
        }

        fn flush(&mut self) -> std::io::Result<()> {
            Ok(())
        }
    }

    ConsoleLogWriter
}
