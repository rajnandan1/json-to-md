# Preserve numeric lexemes from serialized JSON

Serialized JSON Text may contain numbers that JavaScript cannot represent exactly or whose meaningful spelling would be normalized by native parsing. Conversion from serialized input will therefore preserve each original numeric token, while conversion from a Parsed JSON Document will render the numeric value supplied by its caller. This requires a lossless parsing path and means the two input forms may differ after callers have already normalized a number, but it prevents the converter from silently changing numeric content.
