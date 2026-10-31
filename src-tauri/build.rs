use std::path::{Path, PathBuf};

fn main() {
    embed_phone_assets();
    tauri_build::build()
}

/// Writes `$OUT_DIR/phone_assets.rs`: the files of `dist/phone/` (the phone page, `npm run build`)
/// as `include_bytes!` tables, so the phone view serves exactly these files and never touches the disk.
/// A release build needs them; a debug build without them embeds none.
fn embed_phone_assets() {
    let manifest = PathBuf::from(std::env::var("CARGO_MANIFEST_DIR").unwrap());
    let dist = manifest.join("../dist/phone");
    // Watch only folders that exist: a missing path would rerun this script on every build.
    if dist.is_dir() {
        println!("cargo:rerun-if-changed={}", dist.display());
    } else if dist.parent().is_some_and(Path::is_dir) {
        println!(
            "cargo:rerun-if-changed={}",
            dist.parent().unwrap().display()
        );
    }
    let page = dist.join("phone.html");
    let mut out = String::new();
    if page.is_file() {
        println!("cargo:rerun-if-changed={}", page.display());
        out.push_str(&format!(
            "pub static PAGE: Option<(&str, &[u8])> = Some((\"text/html; charset=utf-8\", include_bytes!({:?})));\n",
            canonical(&page)
        ));
    } else {
        if std::env::var("PROFILE").as_deref() == Ok("release") {
            panic!(
                "dist/phone/phone.html is missing: run `npm run build` before a release build \
                 (the phone page is embedded in the app)"
            );
        }
        out.push_str("pub static PAGE: Option<(&str, &[u8])> = None;\n");
    }
    out.push_str("pub static ASSETS: &[(&str, &str, &[u8])] = &[\n");
    let mut names = Vec::new();
    if let Ok(entries) = std::fs::read_dir(dist.join("assets")) {
        for entry in entries.flatten() {
            let path = entry.path();
            let Some(name) = path.file_name().and_then(|n| n.to_str()).map(str::to_owned) else {
                continue;
            };
            let Some(mime) = mime_of(&name) else { continue };
            if path.is_file() && safe_name(&name) {
                names.push((name, mime, canonical(&path)));
            }
        }
    }
    names.sort();
    for (name, mime, path) in names {
        println!("cargo:rerun-if-changed={path}");
        out.push_str(&format!(
            "    ({name:?}, {mime:?}, include_bytes!({path:?})),\n"
        ));
    }
    out.push_str("];\n");
    let target = PathBuf::from(std::env::var("OUT_DIR").unwrap()).join("phone_assets.rs");
    std::fs::write(target, out).unwrap();
}

fn canonical(p: &Path) -> String {
    p.canonicalize().unwrap().to_string_lossy().into_owned()
}

/// Names Vite gives assets: letters, digits, `-`, `_` and dots, no leading dot.
fn safe_name(name: &str) -> bool {
    !name.starts_with('.')
        && name
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_' | b'.'))
}

fn mime_of(name: &str) -> Option<&'static str> {
    let ext = name.rsplit_once('.')?.1;
    Some(match ext {
        "js" => "text/javascript; charset=utf-8",
        "css" => "text/css; charset=utf-8",
        "woff2" => "font/woff2",
        "woff" => "font/woff",
        "svg" => "image/svg+xml",
        "png" => "image/png",
        _ => return None,
    })
}
