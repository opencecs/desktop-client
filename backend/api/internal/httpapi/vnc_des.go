package httpapi

import "crypto/des"
import "crypto/cipher"

// newDESCipher 创建 DES cipher.Block（用于 VNC 认证）
func newDESCipher(key []byte) (cipher.Block, error) {
	return des.NewCipher(key)
}
