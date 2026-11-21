fn main() {
    compile_telemetry();
    tauri_build::build()
}

/// The client of the game's telemetry service (`src/telemetry.rs`), generated
/// from `proto/` with a protobuf compiler written in Rust.
fn compile_telemetry() {
    const FILES: [&str; 2] = [
        "proto/sc/game/telemetry/v1/api.proto",
        "proto/sc/game/telemetry/v1/types.proto",
    ];
    let descriptors = protox::compile(FILES, ["proto"]).expect("telemetry .proto files");
    tonic_prost_build::configure()
        .build_server(false)
        .build_transport(false)
        // Frames go to the windows as they are, in camelCase.
        .message_attribute(
            ".",
            "#[derive(serde::Serialize)] #[serde(rename_all = \"camelCase\")]",
        )
        .compile_fds(descriptors)
        .expect("telemetry client");
    for file in FILES {
        println!("cargo:rerun-if-changed={file}");
    }
}
