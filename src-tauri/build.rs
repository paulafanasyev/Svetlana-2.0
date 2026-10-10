// tauri-build needs src-tauri/icons/icon.ico on Windows (it is embedded into the
// .exe resources) and the NSIS bundler needs it for SvetlanaSetup.exe. The repo
// has no icons, which breaks the Windows build. Until real branded icons are
// committed (run `cargo tauri icon path/to/logo.png`), this writes a small
// generated placeholder icon. An existing icon is never overwritten.
use std::fs;
use std::path::Path;

const SIZE: u32 = 32;

fn push_u16(buf: &mut Vec<u8>, v: u16) {
    buf.extend_from_slice(&v.to_le_bytes());
}

fn push_u32(buf: &mut Vec<u8>, v: u32) {
    buf.extend_from_slice(&v.to_le_bytes());
}

/// 32x32 32-bit BMP-based .ico: purple disc with a white ring.
fn placeholder_ico() -> Vec<u8> {
    let mut pixels: Vec<u8> = Vec::with_capacity((SIZE * SIZE * 4) as usize);
    for row in 0..SIZE {
        let y = SIZE - 1 - row; // DIB rows are stored bottom-up
        for x in 0..SIZE {
            let dx = x as f64 + 0.5 - 16.0;
            let dy = y as f64 + 0.5 - 16.0;
            let d = (dx * dx + dy * dy).sqrt();
            let bgra: [u8; 4] = if d <= 15.0 {
                if (8.0..=11.0).contains(&d) {
                    [0xFF, 0xFF, 0xFF, 0xFF]
                } else {
                    [0xED, 0x3A, 0x7C, 0xFF]
                }
            } else {
                [0, 0, 0, 0]
            };
            pixels.extend_from_slice(&bgra);
        }
    }
    let mask_len = (SIZE * SIZE / 8) as usize; // 1 bit per pixel, rows already 32-bit aligned
    let image_len = 40 + pixels.len() + mask_len;

    let mut ico = Vec::with_capacity(22 + image_len);
    // ICONDIR
    push_u16(&mut ico, 0);
    push_u16(&mut ico, 1);
    push_u16(&mut ico, 1);
    // ICONDIRENTRY
    ico.push(SIZE as u8);
    ico.push(SIZE as u8);
    ico.push(0);
    ico.push(0);
    push_u16(&mut ico, 1);
    push_u16(&mut ico, 32);
    push_u32(&mut ico, image_len as u32);
    push_u32(&mut ico, 22);
    // BITMAPINFOHEADER (height is doubled: XOR bitmap + AND mask)
    push_u32(&mut ico, 40);
    push_u32(&mut ico, SIZE);
    push_u32(&mut ico, SIZE * 2);
    push_u16(&mut ico, 1);
    push_u16(&mut ico, 32);
    push_u32(&mut ico, 0);
    push_u32(&mut ico, (pixels.len() + mask_len) as u32);
    push_u32(&mut ico, 0);
    push_u32(&mut ico, 0);
    push_u32(&mut ico, 0);
    push_u32(&mut ico, 0);
    ico.extend_from_slice(&pixels);
    ico.extend(std::iter::repeat(0u8).take(mask_len));
    ico
}

fn main() {
    let manifest_dir = std::env::var("CARGO_MANIFEST_DIR").expect("CARGO_MANIFEST_DIR not set");
    let icons = Path::new(&manifest_dir).join("icons");
    let ico_path = icons.join("icon.ico");
    if !ico_path.exists() {
        fs::create_dir_all(&icons).expect("cannot create src-tauri/icons");
        fs::write(&ico_path, placeholder_ico()).expect("cannot write src-tauri/icons/icon.ico");
        println!(
            "cargo:warning=Svetlana: generated placeholder {}; replace it with real icons via `cargo tauri icon`",
            ico_path.display()
        );
    }
    tauri_build::build()
}
