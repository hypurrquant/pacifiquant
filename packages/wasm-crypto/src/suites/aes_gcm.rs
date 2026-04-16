use aes_gcm::{
    aead::{Aead, KeyInit, Payload},
    Aes256Gcm, Nonce,
};

const IV_LEN: usize = 12;
const KEY_LEN: usize = 32;

pub struct AesGcmSuite;

impl AesGcmSuite {
    /// AES-256-GCM 복호화
    pub fn decrypt(
        enc_key: &[u8; KEY_LEN],
        ciphertext: &[u8],
        aad: &[u8],
        iv: &[u8; IV_LEN],
    ) -> Result<Vec<u8>, String> {
        let cipher = Aes256Gcm::new_from_slice(enc_key).expect("invalid key length");
        let nonce = Nonce::from_slice(iv);
        cipher
            .decrypt(nonce, Payload { msg: ciphertext, aad })
            .map_err(|e| format!("decryption failed: {}", e))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use aes_gcm::aead::Aead;

    fn encrypt_for_test(key: &[u8; KEY_LEN], plaintext: &[u8], aad: &[u8], iv: &[u8; IV_LEN]) -> Vec<u8> {
        let cipher = Aes256Gcm::new_from_slice(key).expect("invalid key length");
        let nonce = Nonce::from_slice(iv);
        cipher
            .encrypt(nonce, Payload { msg: plaintext, aad })
            .expect("encryption failed")
    }

    #[test]
    fn decrypt_roundtrip() {
        let key = [0x42u8; KEY_LEN];
        let iv = [0x01u8; IV_LEN];
        let aad = b"GET /api/v1/pools v1";
        let plaintext = b"hello world";

        let ct = encrypt_for_test(&key, plaintext, aad, &iv);
        let decrypted = AesGcmSuite::decrypt(&key, &ct, aad, &iv).unwrap();
        assert_eq!(decrypted, plaintext);
    }

    #[test]
    fn decrypt_fails_on_wrong_aad() {
        let key = [0x42u8; KEY_LEN];
        let iv = [0x01u8; IV_LEN];
        let plaintext = b"hello world";

        let ct = encrypt_for_test(&key, plaintext, b"GET /api/v1/pools v1", &iv);
        let result = AesGcmSuite::decrypt(&key, &ct, b"GET /api/v1/ticks v1", &iv);
        assert!(result.is_err(), "AAD mismatch must fail");
    }

    #[test]
    fn decrypt_fails_on_wrong_key() {
        let key = [0x42u8; KEY_LEN];
        let wrong_key = [0x43u8; KEY_LEN];
        let iv = [0x01u8; IV_LEN];
        let plaintext = b"hello";

        let ct = encrypt_for_test(&key, plaintext, b"aad", &iv);
        let result = AesGcmSuite::decrypt(&wrong_key, &ct, b"aad", &iv);
        assert!(result.is_err());
    }
}
