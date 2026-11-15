// Package tlsconf: chạy HTTPS (bản mở rộng C13) từ TLS_CERT / TLS_KEY, báo lỗi rõ ràng khi file sai.
package tlsconf

import (
	"crypto/tls"
	"crypto/x509"
	"errors"
	"fmt"
	"os"
	"strings"
	"time"
)

// Load đọc cặp chứng thư / khóa. Cả hai rỗng ⇒ (nil, nil) — chạy HTTP như bản chuẩn. Trả kèm cảnh báo (vd. chứng thư
// đã / sắp hết hạn) để ghi log.
func Load(certFile, keyFile string) (*tls.Config, []string, error) {
	certFile, keyFile = strings.TrimSpace(certFile), strings.TrimSpace(keyFile)
	if certFile == "" && keyFile == "" {
		return nil, nil, nil
	}
	if certFile == "" || keyFile == "" {
		return nil, nil, errors.New("cần đặt CẢ HAI biến TLS_CERT (file chứng thư .crt/.pem) và TLS_KEY (file khóa riêng .key) để chạy HTTPS")
	}
	for _, f := range []struct{ name, path string }{{"TLS_CERT", certFile}, {"TLS_KEY", keyFile}} {
		st, err := os.Stat(f.path)
		if err != nil {
			return nil, nil, fmt.Errorf("%s: không đọc được file %q (%v)", f.name, f.path, err)
		}
		if st.IsDir() {
			return nil, nil, fmt.Errorf("%s: %q là thư mục, cần đường dẫn tới file", f.name, f.path)
		}
	}
	pair, err := tls.LoadX509KeyPair(certFile, keyFile)
	if err != nil {
		return nil, nil, fmt.Errorf("TLS_CERT / TLS_KEY không dùng được: %v (kiểm tra file là PEM, khóa riêng đúng với chứng thư)", err)
	}
	var warns []string
	if leaf, err := x509.ParseCertificate(pair.Certificate[0]); err == nil {
		now := time.Now()
		switch {
		case now.After(leaf.NotAfter):
			warns = append(warns, fmt.Sprintf("chứng thư HTTPS đã hết hạn từ %s — trình duyệt sẽ báo lỗi, hãy tạo chứng thư mới", leaf.NotAfter.Format("02/01/2006")))
		case now.Add(30 * 24 * time.Hour).After(leaf.NotAfter):
			warns = append(warns, fmt.Sprintf("chứng thư HTTPS sẽ hết hạn ngày %s", leaf.NotAfter.Format("02/01/2006")))
		}
	}
	return &tls.Config{MinVersion: tls.VersionTLS12, Certificates: []tls.Certificate{pair}}, warns, nil
}
