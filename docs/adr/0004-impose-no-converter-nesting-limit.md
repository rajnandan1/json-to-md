# Impose no converter-defined nesting limit

Any Convertible JSON Document may be converted regardless of nesting depth; the converter will not reject input at an arbitrary maximum depth. Parsing, validation, and rendering must therefore avoid relying on the JavaScript call stack. Deep list indentation may expand output quadratically, so completion remains subject to the same host-memory constraint accepted for exhaustive tables.
