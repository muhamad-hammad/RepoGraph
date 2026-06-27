; TypeScript captures: extends the JavaScript set. The tsx grammar is a
; superset of these node types, so this query is reused for .tsx files too.

(function_declaration
  name: (identifier) @name.function) @definition.function

(class_declaration
  name: (type_identifier) @name.class) @definition.class

; Arrow functions / function expressions assigned to a variable.
(variable_declarator
  name: (identifier) @name.function
  value: [(arrow_function) (function_expression)]) @definition.function

(method_definition
  name: (property_identifier) @name.method) @definition.method

(import_statement) @import

; Call expressions (v2): foo(), obj.method(), new Thing().
(call_expression function: (identifier) @call)
(call_expression function: (member_expression property: (property_identifier) @call))
(new_expression constructor: (identifier) @call)
