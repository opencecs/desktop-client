package httpapi

// VNC 截图 REST 端点
// 通过 TCP 直连 VNC 服务器，完成 RFB 握手，获取一帧画面，返回 JPEG 图片。
// 前端可周期性调用此接口获取设备缩略图，无需建立持久 WebSocket 连接。

import (
	"bytes"
	"encoding/binary"
	"fmt"
	"image"
	"image/color"
	"image/jpeg"
	"io"
	"log/slog"
	"net"
	"net/http"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"

	"device-control-center/backend/api/internal/observability"
)

// vncScreenshotHandler 通过 RFB 协议获取设备屏幕截图
// GET /api/console/instances/:id/screenshot?host=X&port=5900&password=xxx
func vncScreenshotHandler(c *gin.Context) {
	instanceID := c.Param("id")
	host := c.Query("host")
	portStr := c.Query("port")
	password := c.Query("password")
	token := c.Query("token")
	if portStr == "" {
		portStr = "5900"
	}

	logger := slog.Default().With(
		"component", "vnc-screenshot",
		"instance_id", instanceID,
		"client_ip", observability.ClientIP(c.Request),
	)

	if token == "" {
		logger.Warn("VNC 截图请求缺少 token")
		c.JSON(http.StatusUnauthorized, gin.H{"message": "missing token"})
		return
	}
	if host == "" {
		c.JSON(http.StatusBadRequest, gin.H{"message": "missing host"})
		return
	}

	port, err := strconv.Atoi(portStr)
	if err != nil || port <= 0 {
		port = 5900
	}

	addr := fmt.Sprintf("%s:%d", host, port)
	logger.Info("VNC 截图请求", "addr", addr)

	// TCP 连接 VNC 服务器
	conn, err := net.DialTimeout("tcp", addr, 10*time.Second)
	if err != nil {
		logger.Error("VNC TCP 连接失败", "err", err)
		c.JSON(http.StatusBadGateway, gin.H{"message": "vnc connection failed"})
		return
	}
	defer conn.Close()
	conn.SetDeadline(time.Now().Add(15 * time.Second))

	// RFB 握手
	img, err := rfbCaptureFrame(conn, password)
	if err != nil {
		logger.Error("RFB 截图失败", "err", err)
		c.JSON(http.StatusInternalServerError, gin.H{"message": fmt.Sprintf("capture failed: %v", err)})
		return
	}

	// 编码为 JPEG 返回
	var buf bytes.Buffer
	if err := jpeg.Encode(&buf, img, &jpeg.Options{Quality: 70}); err != nil {
		logger.Error("JPEG 编码失败", "err", err)
		c.JSON(http.StatusInternalServerError, gin.H{"message": "jpeg encode failed"})
		return
	}

	logger.Info("VNC 截图成功", "size", buf.Len())
	c.Writer.Header().Set("Content-Type", "image/jpeg")
	c.Writer.Header().Set("Cache-Control", "no-cache")
	c.Writer.WriteHeader(http.StatusOK)
	c.Writer.Write(buf.Bytes())
}

// rfbCaptureFrame 执行最小 RFB 握手并捕获一帧画面
func rfbCaptureFrame(conn net.Conn, password string) (*image.RGBA, error) {
	// 1. 读取服务端版本
	verBuf := make([]byte, 12)
	if _, err := io.ReadFull(conn, verBuf); err != nil {
		return nil, fmt.Errorf("read server version: %w", err)
	}

	// 2. 回复客户端版本（使用 3.8）
	if _, err := conn.Write([]byte("RFB 003.008\n")); err != nil {
		return nil, fmt.Errorf("write client version: %w", err)
	}

	// 3. 安全类型协商
	if err := rfbSecurityHandshake(conn, password); err != nil {
		return nil, fmt.Errorf("security: %w", err)
	}

	// 4. ClientInit - shared=1（不独占）
	if _, err := conn.Write([]byte{1}); err != nil {
		return nil, fmt.Errorf("write ClientInit: %w", err)
	}

	// 5. 读取 ServerInit
	var width, height uint16
	if err := binary.Read(conn, binary.BigEndian, &width); err != nil {
		return nil, fmt.Errorf("read width: %w", err)
	}
	if err := binary.Read(conn, binary.BigEndian, &height); err != nil {
		return nil, fmt.Errorf("read height: %w", err)
	}

	// 读取 pixel format (16 bytes) + name-length (4 bytes) + name
	pfBuf := make([]byte, 16)
	if _, err := io.ReadFull(conn, pfBuf); err != nil {
		return nil, fmt.Errorf("read pixel format: %w", err)
	}
	bpp := pfBuf[0]         // bits per pixel
	depth := pfBuf[1]       // depth
	bigEndian := pfBuf[2]   // big-endian flag
	trueColor := pfBuf[3]   // true-color flag
	rMax := binary.BigEndian.Uint16(pfBuf[4:6])
	gMax := binary.BigEndian.Uint16(pfBuf[6:8])
	bMax := binary.BigEndian.Uint16(pfBuf[8:10])
	rShift := pfBuf[10]
	gShift := pfBuf[11]
	bShift := pfBuf[12]

	_ = depth
	_ = trueColor

	var nameLen uint32
	if err := binary.Read(conn, binary.BigEndian, &nameLen); err != nil {
		return nil, fmt.Errorf("read name length: %w", err)
	}
	if nameLen > 0 && nameLen < 4096 {
		nameBuf := make([]byte, nameLen)
		io.ReadFull(conn, nameBuf)
	}

	// 6. 设置我们偏好的像素格式 (32bpp RGBA, little-endian)
	setPixelFormat := []byte{
		0, // message-type: SetPixelFormat
		0, 0, 0, // padding
		32,   // bits-per-pixel
		24,   // depth
		0,    // big-endian: no
		1,    // true-colour: yes
		0, 255, // red-max: 255
		0, 255, // green-max: 255
		0, 255, // blue-max: 255
		0,    // red-shift
		8,    // green-shift
		16,   // blue-shift
		0, 0, 0, // padding
	}
	if _, err := conn.Write(setPixelFormat); err != nil {
		return nil, fmt.Errorf("write SetPixelFormat: %w", err)
	}

	// 7. 设置编码为 Raw (0)
	setEncodings := []byte{
		2,    // message-type: SetEncodings
		0,    // padding
		0, 1, // number of encodings
		0, 0, 0, 0, // Raw encoding (0)
	}
	if _, err := conn.Write(setEncodings); err != nil {
		return nil, fmt.Errorf("write SetEncodings: %w", err)
	}

	// 8. 请求全屏帧缓冲更新
	fbReq := make([]byte, 10)
	fbReq[0] = 3 // message-type: FramebufferUpdateRequest
	fbReq[1] = 0 // incremental: no
	// x=0, y=0 (already zeros)
	binary.BigEndian.PutUint16(fbReq[6:8], width)
	binary.BigEndian.PutUint16(fbReq[8:10], height)
	if _, err := conn.Write(fbReq); err != nil {
		return nil, fmt.Errorf("write FBUpdateRequest: %w", err)
	}

	// 使用我们设置的像素格式
	useBpp := uint8(32)
	useRMax := uint16(255)
	useGMax := uint16(255)
	useBMax := uint16(255)
	useRShift := uint8(0)
	useGShift := uint8(8)
	useBShift := uint8(16)
	useBigEndian := uint8(0)

	// 9. 读取 FramebufferUpdate 消息
	// 注意：服务器可能先发送其他消息类型，需要处理
	img := image.NewRGBA(image.Rect(0, 0, int(width), int(height)))

	// 有些服务器不立即响应 SetPixelFormat（尤其是第一帧），回退使用服务器原始格式
	fallbackToServerFormat := false

	for attempts := 0; attempts < 20; attempts++ {
		var msgType uint8
		if err := binary.Read(conn, binary.BigEndian, &msgType); err != nil {
			// 可能服务器不支持 SetPixelFormat, 回退
			if !fallbackToServerFormat {
				fallbackToServerFormat = true
				useBpp = bpp
				useRMax = rMax
				useGMax = gMax
				useBMax = bMax
				useRShift = rShift
				useGShift = gShift
				useBShift = bShift
				useBigEndian = bigEndian
			}
			return nil, fmt.Errorf("read message type: %w", err)
		}

		switch msgType {
		case 0: // FramebufferUpdate
			var pad uint8
			var numRects uint16
			binary.Read(conn, binary.BigEndian, &pad)
			binary.Read(conn, binary.BigEndian, &numRects)

			for i := 0; i < int(numRects); i++ {
				var rx, ry, rw, rh uint16
				var encoding int32
				binary.Read(conn, binary.BigEndian, &rx)
				binary.Read(conn, binary.BigEndian, &ry)
				binary.Read(conn, binary.BigEndian, &rw)
				binary.Read(conn, binary.BigEndian, &rh)
				binary.Read(conn, binary.BigEndian, &encoding)

				if encoding != 0 { // 非 Raw 编码，跳过
					return nil, fmt.Errorf("unsupported encoding: %d", encoding)
				}

				bytesPerPixel := int(useBpp) / 8
				rectSize := int(rw) * int(rh) * bytesPerPixel
				pixBuf := make([]byte, rectSize)
				if _, err := io.ReadFull(conn, pixBuf); err != nil {
					return nil, fmt.Errorf("read rect pixels: %w", err)
				}

				// 将像素写入 image
				for py := 0; py < int(rh); py++ {
					for px := 0; px < int(rw); px++ {
						offset := (py*int(rw) + px) * bytesPerPixel
						pixel := pixBuf[offset : offset+bytesPerPixel]
						r, g, b := decodePixel(pixel, useBpp, useBigEndian, useRMax, useGMax, useBMax, useRShift, useGShift, useBShift)
						img.SetRGBA(int(rx)+px, int(ry)+py, color.RGBA{R: r, G: g, B: b, A: 255})
					}
				}
			}
			return img, nil

		case 1: // SetColourMapEntries - skip
			var pad uint8
			var firstColor uint16
			var numColors uint16
			binary.Read(conn, binary.BigEndian, &pad)
			binary.Read(conn, binary.BigEndian, &firstColor)
			binary.Read(conn, binary.BigEndian, &numColors)
			skip := make([]byte, int(numColors)*6)
			io.ReadFull(conn, skip)

		case 2: // Bell - no data
			// nothing to read

		case 3: // ServerCutText
			var pad [3]byte
			var textLen uint32
			io.ReadFull(conn, pad[:])
			binary.Read(conn, binary.BigEndian, &textLen)
			if textLen > 0 && textLen < 10*1024*1024 {
				skip := make([]byte, textLen)
				io.ReadFull(conn, skip)
			}

		default:
			return nil, fmt.Errorf("unknown message type: %d", msgType)
		}
	}

	return img, nil
}

// rfbSecurityHandshake 处理 RFB 3.8 安全类型协商
func rfbSecurityHandshake(conn net.Conn, password string) error {
	// 读取安全类型数量
	var numTypes uint8
	if err := binary.Read(conn, binary.BigEndian, &numTypes); err != nil {
		return fmt.Errorf("read security types count: %w", err)
	}

	if numTypes == 0 {
		// 服务器拒绝连接，读取原因
		var reasonLen uint32
		binary.Read(conn, binary.BigEndian, &reasonLen)
		if reasonLen > 0 && reasonLen < 4096 {
			reason := make([]byte, reasonLen)
			io.ReadFull(conn, reason)
			return fmt.Errorf("server refused: %s", string(reason))
		}
		return fmt.Errorf("server refused connection")
	}

	types := make([]byte, numTypes)
	if _, err := io.ReadFull(conn, types); err != nil {
		return fmt.Errorf("read security types: %w", err)
	}

	// 优先选择 None(1)，其次 VNC Auth(2)
	hasNone := false
	hasVncAuth := false
	for _, t := range types {
		if t == 1 {
			hasNone = true
		}
		if t == 2 {
			hasVncAuth = true
		}
	}

	if hasNone {
		// 选择 None
		conn.Write([]byte{1})
	} else if hasVncAuth && password != "" {
		// 选择 VNC Auth
		conn.Write([]byte{2})
		if err := rfbVncAuth(conn, password); err != nil {
			return err
		}
	} else if hasVncAuth {
		return fmt.Errorf("vnc auth required but no password provided")
	} else {
		return fmt.Errorf("no supported security type (available: %v)", types)
	}

	// 读取安全结果
	var result uint32
	if err := binary.Read(conn, binary.BigEndian, &result); err != nil {
		return fmt.Errorf("read security result: %w", err)
	}
	if result != 0 {
		// 读取失败原因（RFB 3.8）
		var reasonLen uint32
		if binary.Read(conn, binary.BigEndian, &reasonLen) == nil && reasonLen > 0 && reasonLen < 4096 {
			reason := make([]byte, reasonLen)
			io.ReadFull(conn, reason)
			return fmt.Errorf("auth failed: %s", string(reason))
		}
		return fmt.Errorf("authentication failed (result=%d)", result)
	}

	return nil
}

// rfbVncAuth 处理 VNC 认证（DES challenge-response）
func rfbVncAuth(conn net.Conn, password string) error {
	// 读取 16 字节挑战
	challenge := make([]byte, 16)
	if _, err := io.ReadFull(conn, challenge); err != nil {
		return fmt.Errorf("read challenge: %w", err)
	}

	// VNC 密码 DES 加密：密码截断/填充到 8 字节, 每字节位翻转, 作为 DES key 加密 challenge
	key := make([]byte, 8)
	pw := []byte(password)
	for i := 0; i < 8 && i < len(pw); i++ {
		key[i] = pw[i]
	}
	// 位翻转
	for i := range key {
		key[i] = reverseBits(key[i])
	}

	// DES ECB 加密 16 字节 challenge（两个 8 字节块）
	response, err := desEncrypt(key, challenge)
	if err != nil {
		return fmt.Errorf("des encrypt: %w", err)
	}

	if _, err := conn.Write(response); err != nil {
		return fmt.Errorf("write auth response: %w", err)
	}
	return nil
}

// reverseBits 翻转一个字节的位顺序（VNC DES 密钥格式要求）
func reverseBits(b byte) byte {
	var result byte
	for i := 0; i < 8; i++ {
		result = (result << 1) | (b & 1)
		b >>= 1
	}
	return result
}

// desEncrypt 使用 DES ECB 模式加密数据
func desEncrypt(key, data []byte) ([]byte, error) {
	// Go 标准库的 crypto/des
	// 由于 VNC 使用非标准的位翻转 DES，我们用 crypto/des
	block, err := newDESCipher(key)
	if err != nil {
		return nil, err
	}
	result := make([]byte, len(data))
	for i := 0; i < len(data); i += 8 {
		block.Encrypt(result[i:i+8], data[i:i+8])
	}
	return result, nil
}

// decodePixel 将 RFB 像素字节解码为 RGB
func decodePixel(pixel []byte, bpp, bigEndian uint8, rMax, gMax, bMax uint16, rShift, gShift, bShift uint8) (r, g, b uint8) {
	var val uint32
	switch bpp {
	case 32:
		if bigEndian != 0 {
			val = uint32(pixel[0])<<24 | uint32(pixel[1])<<16 | uint32(pixel[2])<<8 | uint32(pixel[3])
		} else {
			val = uint32(pixel[3])<<24 | uint32(pixel[2])<<16 | uint32(pixel[1])<<8 | uint32(pixel[0])
		}
	case 16:
		if bigEndian != 0 {
			val = uint32(pixel[0])<<8 | uint32(pixel[1])
		} else {
			val = uint32(pixel[1])<<8 | uint32(pixel[0])
		}
	case 8:
		val = uint32(pixel[0])
	}

	r = uint8(((val >> rShift) & uint32(rMax)) * 255 / uint32(rMax))
	g = uint8(((val >> gShift) & uint32(gMax)) * 255 / uint32(gMax))
	b = uint8(((val >> bShift) & uint32(bMax)) * 255 / uint32(bMax))
	return
}
