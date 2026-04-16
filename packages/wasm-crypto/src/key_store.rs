/// WASM 선형 메모리 내 키 관리
/// sessionId, encKey, sigKey를 JS에 노출하지 않고 WASM 내부에서만 관리

use std::sync::Mutex;

static STATE: Mutex<Option<SessionState>> = Mutex::new(None);

struct SessionState {
    session_id: String,
    enc_key: [u8; 32],
    sig_key: [u8; 32],
}

pub fn store_session(session_id: String, enc_key: [u8; 32], sig_key: [u8; 32]) {
    let mut state = STATE.lock().unwrap();
    *state = Some(SessionState {
        session_id,
        enc_key,
        sig_key,
    });
}

pub fn get_session_id() -> Option<String> {
    let state = STATE.lock().unwrap();
    state.as_ref().map(|s| s.session_id.clone())
}

pub fn get_enc_key() -> Option<[u8; 32]> {
    let state = STATE.lock().unwrap();
    state.as_ref().map(|s| s.enc_key)
}

pub fn get_sig_key() -> Option<[u8; 32]> {
    let state = STATE.lock().unwrap();
    state.as_ref().map(|s| s.sig_key)
}

pub fn clear_session() {
    let mut state = STATE.lock().unwrap();
    *state = None;
}
