# Reject duplicate object member names

Although JSON syntax permits repeated names within one object, their interpretation varies and a JSON Pointer cannot uniquely identify each occurrence. Serialized input will reject duplicate object member names with a validation error rather than discard a value or introduce a non-standard identity scheme. This narrows accepted input to Convertible JSON Documents while keeping parsed and serialized object semantics unambiguous.
