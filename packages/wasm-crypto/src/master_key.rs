/// masterKey를 XOR chain으로 인코딩 — build churn 시 시드 변경
/// build.rs가 WASM_CRYPTO_SEED에서 XOR mask를 파생하여 소스 파일로 출력

// 인코딩된 키 파트
const RAW_PARTS: [[u8; 8]; 4] = [
    [0xA1, 0xB2, 0xC3, 0xD4, 0xE5, 0xF6, 0x07, 0x18],
    [0x29, 0x3A, 0x4B, 0x5C, 0x6D, 0x7E, 0x8F, 0x90],
    [0x11, 0x22, 0x33, 0x44, 0x55, 0x66, 0x77, 0x88],
    [0x99, 0xAA, 0xBB, 0xCC, 0xDD, 0xEE, 0xFF, 0x00],
];

// build.rs가 생성한 XOR mask (OUT_DIR/xor_mask.rs)
include!(concat!(env!("OUT_DIR"), "/xor_mask.rs"));

/// masterKey를 런타임에 조립 (XOR decode)
pub fn assemble_master_key() -> [u8; 32] {
    let mask = xor_mask();
    let mut key = [0u8; 32];
    for (i, part) in RAW_PARTS.iter().enumerate() {
        for (j, byte) in part.iter().enumerate() {
            key[i * 8 + j] = byte ^ mask[j];
        }
    }
    key
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn assemble_produces_32_bytes() {
        let key = assemble_master_key();
        assert_eq!(key.len(), 32);
    }

    #[test]
    fn assemble_is_deterministic() {
        let k1 = assemble_master_key();
        let k2 = assemble_master_key();
        assert_eq!(k1, k2);
    }
}
