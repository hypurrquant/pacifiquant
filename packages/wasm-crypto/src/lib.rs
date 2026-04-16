/// WASM Crypto — v1.46.16 (stateless)
/// init + decryptResponse만 export. 세션/서명 제거.
mod master_key;
mod suites;

use base64::{engine::general_purpose::STANDARD as B64, Engine};
use wasm_bindgen::prelude::*;

use master_key::assemble_master_key;
use suites::aes_gcm::AesGcmSuite;

/// 초기화 — WASM 모듈 로드 시 호출
#[wasm_bindgen]
pub fn init() -> Result<(), JsValue> {
    #[cfg(debug_assertions)]
    console_error_panic_hook::set_once();
    Ok(())
}

/// 응답 복호화: ct + iv + aad → plaintext JSON string
#[wasm_bindgen(js_name = "decryptResponse")]
pub fn decrypt_response(ct_b64: &str, iv_b64: &str, aad: &str) -> Result<String, JsValue> {
    let master_key = assemble_master_key();

    let ct = B64
        .decode(ct_b64)
        .map_err(|e| JsValue::from_str(&format!("base64 decode ct: {}", e)))?;
    let iv_vec = B64
        .decode(iv_b64)
        .map_err(|e| JsValue::from_str(&format!("base64 decode iv: {}", e)))?;

    let iv: [u8; 12] = iv_vec
        .try_into()
        .map_err(|_| JsValue::from_str("iv must be 12 bytes"))?;

    let plaintext = AesGcmSuite::decrypt(&master_key, &ct, aad.as_bytes(), &iv)
        .map_err(|e| JsValue::from_str(&e))?;

    String::from_utf8(plaintext).map_err(|e| JsValue::from_str(&format!("utf8: {}", e)))
}
