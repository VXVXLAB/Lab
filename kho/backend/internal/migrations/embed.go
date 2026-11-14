// Package migrations chứa các file SQL migration được nhúng vào binary.
package migrations

import "embed"

// FS chứa các file *.sql, chạy theo thứ tự tên file.
//
//go:embed *.sql
var FS embed.FS
