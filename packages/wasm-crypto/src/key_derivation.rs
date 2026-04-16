use hkdf::Hkdf;
use hmac::{Hmac, Mac};
use sha2::Sha256;

const ENC_INFO: &[u8] = b"hq-enc-v1";
const SIG_INFO: &[u8] = b"hq-sig-v1";
const KEY_LEN: usize = 32;

pub struct DerivedKeys {
    pub enc_key: [u8; KEY_LEN],
    pub sig_key: [u8; KEY_LEN],
}

/// rootSecret + nonce → encKey + sigKey (HKDF-SHA256)
pub fn derive_keys(root_secret: &[u8], nonce: &[u8]) -> DerivedKeys {
    let hk = Hkdf::<Sha256>::new(Some(nonce), root_secret);

    let mut enc_key = [0u8; KEY_LEN];
    hk.expand(ENC_INFO, &mut enc_key)
        .expect("HKDF expand for enc_key failed");

    let mut sig_key = [0u8; KEY_LEN];
    hk.expand(SIG_INFO, &mut sig_key)
        .expect("HKDF expand for sig_key failed");

    DerivedKeys { enc_key, sig_key }
}

/// HMAC-SHA256 서명: method\npath\nts\nnonce
pub fn sign_request(sig_key: &[u8], method: &str, path: &str, ts: u64, nonce: &str) -> Vec<u8> {
    let message = format!("{}\n{}\n{}\n{}", method, path, ts, nonce);
    let mut mac = Hmac::<Sha256>::new_from_slice(sig_key).expect("HMAC key length invalid");
    mac.update(message.as_bytes());
    mac.finalize().into_bytes().to_vec()
}

/// HMAC-SHA256 검증
pub fn verify_request(
    sig_key: &[u8],
    method: &str,
    path: &str,
    ts: u64,
    nonce: &str,
    expected_mac: &[u8],
) -> bool {
    let message = format!("{}\n{}\n{}\n{}", method, path, ts, nonce);
    let mut mac = Hmac::<Sha256>::new_from_slice(sig_key).expect("HMAC key length invalid");
    mac.update(message.as_bytes());
    mac.verify_slice(expected_mac).is_ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn derive_keys_produces_different_enc_and_sig() {
        let root = [0xABu8; 32];
        let nonce = [0xCDu8; 16];
        let keys = derive_keys(&root, &nonce);
        assert_ne!(keys.enc_key, keys.sig_key, "encKey and sigKey must differ");
    }

    #[test]
    fn sign_and_verify_roundtrip() {
        let sig_key = [0x42u8; 32];
        let mac = sign_request(&sig_key, "GET", "/api/v1/pools", 1712345678, "abc-123");
        assert!(verify_request(
            &sig_key,
            "GET",
            "/api/v1/pools",
            1712345678,
            "abc-123",
            &mac
        ));
    }

    #[test]
    fn verify_fails_on_tampered_path() {
        let sig_key = [0x42u8; 32];
        let mac = sign_request(&sig_key, "GET", "/api/v1/pools", 1712345678, "abc-123");
        assert!(!verify_request(
            &sig_key,
            "GET",
            "/api/v1/ticks/xyz",
            1712345678,
            "abc-123",
            &mac
        ));
    }
}
