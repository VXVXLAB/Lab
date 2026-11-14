package util

// Page là kết quả danh sách có phân trang.
type Page[T any] struct {
	Items    []T `json:"items"`
	Total    int `json:"total"`
	Page     int `json:"page"`
	PageSize int `json:"page_size"`
}

// ListParams là tham số chung của danh sách.
type ListParams struct {
	Q        string
	Page     int
	PageSize int
	// Active: nil = tất cả.
	Active *bool
}

// Normalize đặt giá trị mặc định cho trang.
func (p *ListParams) Normalize(defSize, maxSize int) {
	if p.Page < 1 {
		p.Page = 1
	}
	if p.PageSize < 1 {
		p.PageSize = defSize
	}
	if p.PageSize > maxSize {
		p.PageSize = maxSize
	}
}

// Offset trả vị trí bắt đầu.
func (p ListParams) Offset() int { return (p.Page - 1) * p.PageSize }
