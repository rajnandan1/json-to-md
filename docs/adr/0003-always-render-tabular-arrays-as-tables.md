# Always render tabular arrays as tables

Every Tabular Array will render as one exhaustive GFM table regardless of its projected row, column, or cell count. We will not fall back to list rendering or raise a converter-defined table-size error, because stable shape-based output takes precedence over protection from pathological table expansion. Consequently, the 10 MiB performance target applies only when the generated Output Document fits available runtime memory; highly sparse arrays with many distinct keys may expand quadratically and remain subject to host resource limits.
