//! The QR code of the phone URL as a plain SVG, drawn in the core with `qrcodegen`: one white
//! background rectangle and one black path, a quiet zone of four modules. No script, no external
//! reference, no event attribute, no text.

use qrcodegen::{QrCode, QrCodeEcc};

/// Modules of white border around the code (the minimum the QR standard asks for).
pub const QUIET_ZONE: i32 = 4;

/// The URL does not fit in a QR code (it never happens for the phone URL, which is under 100 bytes).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct TooLong;

pub fn qr_svg(text: &str) -> Result<String, TooLong> {
    let qr = QrCode::encode_text(text, QrCodeEcc::Medium).map_err(|_| TooLong)?;
    let size = qr.size();
    let full = size + 2 * QUIET_ZONE;
    let mut path = String::new();
    // One rectangle per horizontal run of dark modules.
    for y in 0..size {
        let mut x = 0;
        while x < size {
            if !qr.get_module(x, y) {
                x += 1;
                continue;
            }
            let start = x;
            while x < size && qr.get_module(x, y) {
                x += 1;
            }
            let run = x - start;
            path.push_str(&format!(
                "M{},{}h{run}v1h-{run}z",
                start + QUIET_ZONE,
                y + QUIET_ZONE
            ));
        }
    }
    Ok(format!(
        "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 {full} {full}\" \
         shape-rendering=\"crispEdges\"><rect width=\"{full}\" height=\"{full}\" fill=\"#ffffff\"/>\
         <path d=\"{path}\" fill=\"#000000\"/></svg>"
    ))
}

#[cfg(test)]
pub mod tests {
    use super::*;

    /// The SVG back to its module matrix: (size incl. quiet zone, dark modules).
    pub fn modules(svg: &str) -> (usize, Vec<Vec<bool>>) {
        let view = svg.split("viewBox=\"0 0 ").nth(1).unwrap();
        let full: usize = view.split(' ').next().unwrap().parse().unwrap();
        let d = svg
            .split(" d=\"")
            .nth(1)
            .unwrap()
            .split('"')
            .next()
            .unwrap();
        let mut grid = vec![vec![false; full]; full];
        for cell in d.split('M').filter(|s| !s.is_empty()) {
            let (xy, rest) = cell.split_once('h').unwrap();
            let (run, back) = rest.split_once("v1h-").expect("one row high");
            assert_eq!(back, format!("{run}z"), "a closed rectangle");
            let (x, y) = xy.split_once(',').unwrap();
            let (x, y): (usize, usize) = (x.parse().unwrap(), y.parse().unwrap());
            let run: usize = run.parse().unwrap();
            grid[y][x..x + run].fill(true);
        }
        (full, grid)
    }

    /// Decodes the SVG with a QR reader (rqrr) from an 8 px/module greyscale rendering.
    pub fn decode(svg: &str) -> String {
        let (full, grid) = modules(svg);
        const SCALE: usize = 8;
        let px = full * SCALE;
        let mut img = rqrr::PreparedImage::prepare_from_greyscale(px, px, |x, y| {
            if grid[y / SCALE][x / SCALE] {
                0
            } else {
                255
            }
        });
        let grids = img.detect_grids();
        assert_eq!(grids.len(), 1, "one QR code");
        grids[0].decode().unwrap().1
    }

    pub const URL: &str = "http://192.168.178.20:49152/#t=FAKE-TOKEN-for-tests-only";

    #[test]
    fn the_svg_decodes_back_to_exactly_the_url() {
        let svg = qr_svg(URL).unwrap();
        assert_eq!(decode(&svg), URL);
        let long = format!("http://172.31.255.254:65535/#t={}", "A".repeat(43));
        assert_eq!(decode(&qr_svg(&long).unwrap()), long);
    }

    #[test]
    fn the_svg_has_a_quiet_zone_and_nothing_active() {
        let svg = qr_svg(URL).unwrap();
        let (full, grid) = modules(&svg);
        let q = QUIET_ZONE as usize;
        for (y, row) in grid.iter().enumerate() {
            for (x, dark) in row.iter().enumerate() {
                if x < q || y < q || x >= full - q || y >= full - q {
                    assert!(!dark, "module {x},{y} in the quiet zone");
                }
            }
        }
        let lower = svg.to_ascii_lowercase();
        for banned in [
            "<script",
            "<foreignobject",
            "href",
            "url(",
            "<image",
            "<use",
            "<style",
            "<a ",
            "javascript:",
            "<text",
        ] {
            assert!(!lower.contains(banned), "{banned}");
        }
        // No event attribute (onload=, onclick=, …) and only these three elements.
        assert!(!regex_like_event_attribute(&lower));
        let elements: Vec<&str> = lower
            .split('<')
            .skip(1)
            .map(|s| s.split([' ', '>', '/']).next().unwrap())
            .filter(|s| !s.is_empty())
            .collect();
        assert_eq!(elements, ["svg", "rect", "path"]);
        // The URL itself is not in the SVG as text.
        assert!(!svg.contains("FAKE-TOKEN"));
    }

    fn regex_like_event_attribute(s: &str) -> bool {
        s.split([' ', '\n', '\t'])
            .any(|w| w.starts_with("on") && w.contains('='))
    }

    #[test]
    fn a_text_too_long_for_a_qr_code_is_an_error() {
        assert_eq!(qr_svg(&"x".repeat(5_000)), Err(TooLong));
    }
}
