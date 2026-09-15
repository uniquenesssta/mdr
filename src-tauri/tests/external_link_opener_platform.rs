//! Compile and link the exact production OS boundary on native Windows, macOS and Linux.
//! This checks cfg selection, visibility and native FFI linkage, not a desktop GUI launch.
#[path = "../src/external_link/opener.rs"]
mod opener;

#[test]
fn native_opener_keeps_the_launch_signature() {
    let launch: fn(&str) -> Result<(), String> = opener::open_platform_url;
    std::hint::black_box(launch);
}
