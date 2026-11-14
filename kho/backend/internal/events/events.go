// Package events: phát sự kiện thay đổi dữ liệu tới mọi máy qua SSE (REQ-042…044).
package events

import (
	"sync"
	"time"
)

// Event là một sự kiện thay đổi.
type Event struct {
	Type    string    `json:"type"` // document.changed | voucher.changed | catalog.changed
	ID      int64     `json:"id"`
	DocType string    `json:"doc_type,omitempty"`
	Status  string    `json:"status,omitempty"`
	Entity  string    `json:"entity,omitempty"` // với catalog.changed: warehouse|product_group|product|partner|cash_account|user
	Action  string    `json:"action"`           // created|updated|posted|unposted|deleted
	By      string    `json:"by"`
	ByID    int64     `json:"by_id"`
	At      time.Time `json:"at"`
}

// Broker phân phối sự kiện tới các kết nối SSE.
type Broker struct {
	mu   sync.Mutex
	subs map[chan Event]struct{}
}

// NewBroker tạo broker.
func NewBroker() *Broker { return &Broker{subs: map[chan Event]struct{}{}} }

// Subscribe đăng ký nhận sự kiện; gọi hàm trả về để hủy.
func (b *Broker) Subscribe() (<-chan Event, func()) {
	ch := make(chan Event, 64)
	b.mu.Lock()
	b.subs[ch] = struct{}{}
	b.mu.Unlock()
	return ch, func() {
		b.mu.Lock()
		if _, ok := b.subs[ch]; ok {
			delete(b.subs, ch)
			close(ch)
		}
		b.mu.Unlock()
	}
}

// Publish gửi sự kiện tới mọi người nghe (bỏ qua người nghe bị nghẽn).
func (b *Broker) Publish(e Event) {
	if e.At.IsZero() {
		e.At = time.Now()
	}
	b.mu.Lock()
	defer b.mu.Unlock()
	for ch := range b.subs {
		select {
		case ch <- e:
		default:
		}
	}
}

// Count trả số kết nối đang nghe.
func (b *Broker) Count() int {
	b.mu.Lock()
	defer b.mu.Unlock()
	return len(b.subs)
}
