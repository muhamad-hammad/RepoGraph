; Python captures: functions, classes, imports.
; Methods are function_definition nodes nested in a class body; NodeBuilder
; reclassifies them to "method" based on parent nesting.

(function_definition
  name: (identifier) @name.function) @definition.function

(class_definition
  name: (identifier) @name.class) @definition.class

(import_statement) @import
(import_from_statement) @import

; Call expressions (v2): callee name only — foo() and obj.method().
(call function: (identifier) @call)
(call function: (attribute attribute: (identifier) @call))
