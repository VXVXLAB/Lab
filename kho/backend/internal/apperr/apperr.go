// Package apperr định nghĩa lỗi nghiệp vụ có mã chuẩn (SPEC §4) và thông báo tiếng Việt.
package apperr

import (
	"errors"
	"fmt"
	"net/http"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

// Mã lỗi chuẩn.
const (
	CodeUnauthorized      = "UNAUTHORIZED"
	CodeForbidden         = "FORBIDDEN"
	CodeNotFound          = "NOT_FOUND"
	CodeValidation        = "VALIDATION"
	CodeVersionConflict   = "VERSION_CONFLICT"
	CodeLossWarning       = "LOSS_WARNING"
	CodeInsufficientStock = "INSUFFICIENT_STOCK"
	CodeInUse             = "IN_USE"
	CodeInternal          = "INTERNAL"
	CodeFeatureOff        = "FEATURE_OFF"
	CodePeriodLocked      = "PERIOD_LOCKED"
	CodeImportInvalid     = "IMPORT_INVALID"
)

// Error là lỗi trả về cho client.
type Error struct {
	Status  int    `json:"-"`
	Code    string `json:"code"`
	Message string `json:"message"`
	Details any    `json:"details,omitempty"`
}

func (e *Error) Error() string { return e.Code + ": " + e.Message }

// New tạo lỗi.
func New(status int, code, msg string, details any) *Error {
	return &Error{Status: status, Code: code, Message: msg, Details: details}
}

// Validation tạo lỗi dữ liệu nhập 400.
func Validation(format string, args ...any) *Error {
	return New(http.StatusBadRequest, CodeValidation, fmt.Sprintf(format, args...), nil)
}

// ValidationField tạo lỗi dữ liệu nhập 400 kèm tên trường.
func ValidationField(field, msg string) *Error {
	return New(http.StatusBadRequest, CodeValidation, msg, map[string]any{"field": field})
}

// NotFound tạo lỗi 404.
func NotFound(what string) *Error {
	return New(http.StatusNotFound, CodeNotFound, "Không tìm thấy "+what, nil)
}

// Unauthorized tạo lỗi 401.
func Unauthorized(msg string) *Error {
	return New(http.StatusUnauthorized, CodeUnauthorized, msg, nil)
}

// Forbidden tạo lỗi 403.
func Forbidden(msg string) *Error { return New(http.StatusForbidden, CodeForbidden, msg, nil) }

// InUse tạo lỗi 409 khi xóa dữ liệu đã phát sinh.
func InUse(msg string) *Error { return New(http.StatusConflict, CodeInUse, msg, nil) }

// From chuyển một error bất kỳ thành *Error (lỗi CSDL đã biết được dịch sang tiếng Việt).
func From(err error) *Error {
	var ae *Error
	if errors.As(err, &ae) {
		return ae
	}
	if errors.Is(err, pgx.ErrNoRows) {
		return NotFound("dữ liệu")
	}
	var pe *pgconn.PgError
	if errors.As(err, &pe) {
		switch pe.Code {
		case "23505":
			return New(http.StatusBadRequest, CodeValidation, "Mã đã tồn tại, vui lòng chọn mã khác", map[string]any{"constraint": pe.ConstraintName})
		case "23503":
			if strings.Contains(pe.Message, "update or delete") {
				return InUse("Dữ liệu đã phát sinh chứng từ, không xóa được (có thể ngừng sử dụng thay vì xóa)")
			}
			return New(http.StatusBadRequest, CodeValidation, "Dữ liệu tham chiếu không tồn tại", map[string]any{"constraint": pe.ConstraintName})
		case "23514":
			return New(http.StatusBadRequest, CodeValidation, "Dữ liệu không hợp lệ", map[string]any{"constraint": pe.ConstraintName})
		case "22003":
			return New(http.StatusBadRequest, CodeValidation, "Số quá lớn", nil)
		case "22P02", "22007", "22008":
			return New(http.StatusBadRequest, CodeValidation, "Giá trị không hợp lệ", nil)
		}
	}
	return New(http.StatusInternalServerError, CodeInternal, "Lỗi hệ thống, vui lòng thử lại hoặc báo quản trị", nil)
}

// FeatureOff tạo lỗi 404 khi tính năng mở rộng đang tắt.
func FeatureOff(name string) *Error {
	return New(http.StatusNotFound, CodeFeatureOff, "Tính năng \""+name+"\" chưa được bật (Danh mục › Tính năng mở rộng)", nil)
}
