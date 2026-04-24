package main

import (
	"bufio"
	"crypto/rand"
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"fmt"
	"net"
	"strings"
	"time"
)

func main() {
	keyBytes := make([]byte, 16)
	rand.Read(keyBytes)
	key := base64.StdEncoding.EncodeToString(keyBytes)

	token := "cf5924f14d20c833d0c291e923b8ff0520bbf5d4c867415989d12e7d683e21fd"
	addr := "119.96.73.236:56910"

	conn, err := net.DialTimeout("tcp", addr, 10*time.Second)
	if err != nil {
		fmt.Printf("TCP connect failed: %v\n", err)
		return
	}
	defer conn.Close()
	fmt.Println("TCP connected")

	req := fmt.Sprintf(
		"GET /ws?token=%s HTTP/1.1\r\n"+
			"Host: %s\r\n"+
			"Upgrade: websocket\r\n"+
			"Connection: Upgrade\r\n"+
			"Sec-WebSocket-Version: 13\r\n"+
			"Sec-WebSocket-Key: %s\r\n"+
			"Origin: http://%s\r\n"+
			"token: %s\r\n"+
			"\r\n",
		token, addr, key, addr, token,
	)

	conn.Write([]byte(req))

	reader := bufio.NewReader(conn)
	conn.SetReadDeadline(time.Now().Add(5 * time.Second))

	var respBuilder strings.Builder
	for {
		line, err := reader.ReadString('\n')
		if err != nil {
			fmt.Printf("Read error during headers: %v\n", err)
			return
		}
		respBuilder.WriteString(line)
		fmt.Printf("< %q\n", line)
		if line == "\r\n" {
			break
		}
	}

	if !strings.HasPrefix(respBuilder.String(), "HTTP/1.1 101") {
		fmt.Println("Not 101, aborting")
		return
	}

	fmt.Println("=== 101 OK, sending connect message ===")
	conn.SetReadDeadline(time.Time{})

	// First, try reading for 2 seconds to see if device sends anything before we send
	fmt.Println("=== Waiting 2s before sending... ===")
	conn.SetReadDeadline(time.Now().Add(2 * time.Second))
	prebuf := make([]byte, 4096)
	pn, perr := reader.Read(prebuf)
	fmt.Printf("Pre-read: n=%d, err=%v\n", pn, perr)
	if pn > 0 {
		fmt.Printf("  hex: %x\n", prebuf[:min(pn, 64)])
	}
	conn.SetReadDeadline(time.Time{})

	// Build a WebSocket text frame with mask (like a browser would)
	connectMsg := map[string]any{
		"type": "connect",
		"ice_server": []map[string]any{
			{"urls": "stun:stun.l.google.com:19302"},
		},
	}
	payload, _ := json.Marshal(connectMsg)
	fmt.Printf("Payload (%d bytes): %s\n", len(payload), string(payload))

	frame := buildWebSocketFrame(payload)
	fmt.Printf("Frame (%d bytes): %x\n", len(frame), frame[:min(32, len(frame))])

	n, err := conn.Write(frame)
	fmt.Printf("Write: n=%d, err=%v\n", n, err)

	// Wait for response (offer from device)
	fmt.Println("=== Waiting for device response (10s)... ===")
	conn.SetReadDeadline(time.Now().Add(10 * time.Second))
	buf := make([]byte, 8192)
	for {
		n, err := reader.Read(buf)
		if n > 0 {
			fmt.Printf("Read %d bytes\n", n)
			// Try to decode as WebSocket frame
			if buf[0] == 0x81 || buf[0] == 0x82 {
				payloadLen, headerLen := decodeFrameLen(buf[:n])
				fmt.Printf("  WS frame: opcode=%d, len=%d, headerLen=%d\n", buf[0]&0xf, payloadLen, headerLen)
				if headerLen+payloadLen <= n {
					fmt.Printf("  Payload: %.200s\n", string(buf[headerLen:headerLen+min(payloadLen, 200)]))
				}
			} else {
				fmt.Printf("  Raw hex: %x\n", buf[:min(n, 64)])
			}
		}
		if err != nil {
			fmt.Printf("Read error: %v\n", err)
			break
		}
	}
}

func buildWebSocketFrame(payload []byte) []byte {
	var frame []byte
	// FIN + text opcode
	frame = append(frame, 0x81)

	// Mask bit + length
	plen := len(payload)
	if plen < 126 {
		frame = append(frame, byte(0x80|plen))
	} else if plen < 65536 {
		frame = append(frame, 0xfe) // 0x80 | 126
		lenBytes := make([]byte, 2)
		binary.BigEndian.PutUint16(lenBytes, uint16(plen))
		frame = append(frame, lenBytes...)
	}

	// Mask key
	maskKey := make([]byte, 4)
	rand.Read(maskKey)
	frame = append(frame, maskKey...)

	// Masked payload
	masked := make([]byte, plen)
	for i := 0; i < plen; i++ {
		masked[i] = payload[i] ^ maskKey[i%4]
	}
	frame = append(frame, masked...)
	return frame
}

func decodeFrameLen(buf []byte) (int, int) {
	if len(buf) < 2 {
		return 0, 0
	}
	length := int(buf[1] & 0x7f)
	headerLen := 2
	if length == 126 && len(buf) >= 4 {
		length = int(binary.BigEndian.Uint16(buf[2:4]))
		headerLen = 4
	} else if length == 127 && len(buf) >= 10 {
		length = int(binary.BigEndian.Uint64(buf[2:10]))
		headerLen = 10
	}
	return length, headerLen
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}
