/// 빌드 스크립트 — WASM_CRYPTO_SEED → XOR mask 파일 생성
use std::io::Write;

fn main() {
    let seed = std::env::var("WASM_CRYPTO_SEED").unwrap_or_else(|_| "default".to_string());
    let hash = fnv_hash(seed.as_bytes());
    let mask: [u8; 8] = [
        (hash >> 56) as u8,
        (hash >> 48) as u8,
        (hash >> 40) as u8,
        (hash >> 32) as u8,
        (hash >> 24) as u8,
        (hash >> 16) as u8,
        (hash >> 8) as u8,
        hash as u8,
    ];

    let out_dir = std::env::var("OUT_DIR").unwrap();
    let path = std::path::Path::new(&out_dir).join("xor_mask.rs");
    let mut f = std::fs::File::create(path).unwrap();
    writeln!(
        f,
        "fn xor_mask() -> [u8; 8] {{ [{}] }}",
        mask.iter()
            .map(|b| format!("0x{:02X}", b))
            .collect::<Vec<_>>()
            .join(", ")
    )
    .unwrap();

    println!("cargo:rerun-if-env-changed=WASM_CRYPTO_SEED");
}

fn fnv_hash(data: &[u8]) -> u64 {
    let mut h: u64 = 0xcbf29ce484222325;
    for &b in data {
        h ^= b as u64;
        h = h.wrapping_mul(0x100000001b3);
    }
    h
}
