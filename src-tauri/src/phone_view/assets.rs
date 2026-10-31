//! The phone page's static files, embedded in the binary at build time from `dist/phone/` (the second
//! Vite entry, `vite.phone.config.ts`; see `build.rs`). The server answers only names in this table:
//! nothing is ever read from the file system, so no request path can reach outside it.

/// One embedded file.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Asset {
    pub mime: &'static str,
    pub bytes: &'static [u8],
}

/// The page and its assets.
pub trait PhoneAssets: Send + Sync {
    /// `phone.html`, the page served at `/`.
    fn page(&self) -> Option<Asset>;
    /// A file under `/assets/` by its exact name (no folders).
    fn asset(&self, name: &str) -> Option<Asset>;
}

mod embedded {
    include!(concat!(env!("OUT_DIR"), "/phone_assets.rs"));
}

/// The files of the last `npm run build` (the release build always has them; a debug build without
/// `dist/phone/` has none, and the page answers 404).
pub struct EmbeddedAssets;

impl PhoneAssets for EmbeddedAssets {
    fn page(&self) -> Option<Asset> {
        embedded::PAGE.map(|(mime, bytes)| Asset { mime, bytes })
    }
    fn asset(&self, name: &str) -> Option<Asset> {
        embedded::ASSETS
            .iter()
            .find(|(n, _, _)| *n == name)
            .map(|(_, mime, bytes)| Asset { mime, bytes })
    }
}

/// A fixed page and asset list (tests).
pub struct StaticAssets {
    pub page: Option<Asset>,
    pub assets: Vec<(&'static str, Asset)>,
}

impl StaticAssets {
    /// A page that loads one script and one stylesheet, like the real build.
    pub fn sample() -> Self {
        Self {
            page: Some(Asset {
                mime: "text/html; charset=utf-8",
                bytes: b"<!doctype html><html lang=\"de\"><head><script type=\"module\" src=\"./assets/phone-test.js\"></script><link rel=\"stylesheet\" href=\"./assets/phone-test.css\"></head><body><div id=\"root\"></div></body></html>",
            }),
            assets: vec![
                (
                    "phone-test.js",
                    Asset {
                        mime: "text/javascript; charset=utf-8",
                        bytes: b"document.getElementById('root');",
                    },
                ),
                (
                    "phone-test.css",
                    Asset {
                        mime: "text/css; charset=utf-8",
                        bytes: b"body{margin:0}",
                    },
                ),
            ],
        }
    }
}

impl PhoneAssets for StaticAssets {
    fn page(&self) -> Option<Asset> {
        self.page
    }
    fn asset(&self, name: &str) -> Option<Asset> {
        self.assets
            .iter()
            .find(|(n, _)| *n == name)
            .map(|(_, a)| *a)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// When the build embedded the real page (after `npm run build`), it has no inline script or
    /// style, and every asset it names is embedded.
    #[test]
    fn the_embedded_page_has_no_inline_script_or_style() {
        let Some(page) = EmbeddedAssets.page() else {
            return;
        };
        let html = std::str::from_utf8(page.bytes)
            .unwrap()
            .to_ascii_lowercase();
        assert!(!html.contains("<style"));
        assert!(!html.contains(" style="));
        for script in html.split("<script").skip(1) {
            let tag = script.split('>').next().unwrap();
            assert!(tag.contains("src="), "inline script: {tag}");
            let body = script.split('>').nth(1).unwrap();
            assert!(body.starts_with("</script"), "inline script body");
        }
        for name in html.split("./assets/").skip(1) {
            let name = name.split('"').next().unwrap();
            assert!(EmbeddedAssets.asset(name).is_some(), "{name}");
        }
    }

    #[test]
    fn lookups_are_by_exact_name_only() {
        let a = StaticAssets::sample();
        assert!(a.asset("phone-test.js").is_some());
        for name in [
            "../phone-test.js",
            "PHONE-TEST.JS",
            "phone-test.js/",
            "",
            "phone.html",
        ] {
            assert!(a.asset(name).is_none(), "{name}");
        }
        assert!(EmbeddedAssets.asset("../../Cargo.toml").is_none());
    }
}
