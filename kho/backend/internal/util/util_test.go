package util

import "testing"

func TestFormatVND(t *testing.T) {
	cases := map[string]string{"3990000": "3.990.000", "0": "0", "-100000": "-100.000", "100.5": "100,5", "999": "999", "1000": "1.000"}
	for in, want := range cases {
		if got := FormatVND(Dec(in)); got != want {
			t.Errorf("FormatVND(%s) = %s, muốn %s", in, got, want)
		}
	}
}

func TestFold(t *testing.T) {
	cases := map[string]string{"CTY TNHH TM DV VĨNH PHONG": "cty tnhh tm dv vinh phong", "Đầu cos  (khoen đồng)": "dau cos (khoen dong)", "Que hàn": "que han"}
	for in, want := range cases {
		if got := Fold(in); got != want {
			t.Errorf("Fold(%q) = %q, muốn %q", in, got, want)
		}
	}
	if got := LikePattern("50%_a"); got != `%50\%\_a%` {
		t.Errorf("LikePattern: %s", got)
	}
}

func TestParseDate(t *testing.T) {
	d, err := ParseDate("25/09/2026")
	if err != nil || d.String() != "2026-09-25" {
		t.Fatalf("ParseDate: %v %v", d, err)
	}
	if _, err := ParseDate("2026-02-31"); err == nil {
		t.Fatal("ngày 31/02 phải lỗi")
	}
}
