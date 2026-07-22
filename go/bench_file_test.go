package jsontomd

import (
	"os"
	"testing"
)

// BenchmarkConvertTextFile times ConvertText over a real JSON document:
//
//	BENCH_FILE=path/to/big.json go test -bench ConvertTextFile -run '^$'
//
// Skipped when BENCH_FILE is unset so the normal suite stays hermetic.
func BenchmarkConvertTextFile(b *testing.B) {
	path := os.Getenv("BENCH_FILE")
	if path == "" {
		b.Skip("set BENCH_FILE to a JSON document")
	}
	src, err := os.ReadFile(path)
	if err != nil {
		b.Fatal(err)
	}
	b.SetBytes(int64(len(src)))
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		if _, err := ConvertText(src); err != nil {
			b.Fatal(err)
		}
	}
}
