use tracing::Level;
use tracing_appender::non_blocking::WorkerGuard;

pub use tracing::{debug, error, info, trace, warn};

// Note: Filter log levels at compile time using tracing features:
// <https://docs.rs/tracing/latest/tracing/level_filters/index.html>

pub fn init_logger() -> WorkerGuard {
    let (writer, guard) = tracing_appender::non_blocking(std::io::stdout());

    let filter = tracing_subscriber::EnvFilter::builder()
        .with_default_directive(Level::INFO.into())
        .with_regex(false)
        .from_env_lossy();

    tracing_subscriber::fmt()
        .with_env_filter(filter)
        .with_writer(writer)
        // .with_ansi(false)
        // .with_level(false)
        .with_target(false)
        .with_file(true)
        .with_line_number(true)
        .without_time()
        .try_init()
        .unwrap();

    guard
}
