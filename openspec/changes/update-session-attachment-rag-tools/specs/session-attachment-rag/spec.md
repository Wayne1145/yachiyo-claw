## MODIFIED Requirements

### Requirement: Session Attachment Retrieval Is Model-Driven

The system SHALL expose ready session attachment content through retrieval tools instead of automatically querying and injecting evidence before generation.

#### Scenario: User asks about a ready uploaded file

- **WHEN** a desktop chat session contains a large retrieval-mode attachment with `ready` index status
- **AND** the selected model supports file tool use
- **AND** the user asks a question that may depend on the uploaded file
- **THEN** the system SHALL include session attachment retrieval tools in the model toolset
- **AND** the system SHALL include system instructions telling the model to query before answering document-specific questions
- **AND** the renderer SHALL NOT pre-query the attachment before the model starts generating

#### Scenario: User asks an unrelated question

- **WHEN** a desktop chat session contains a retrieval-mode attachment
- **AND** the user asks a question clearly unrelated to the uploaded file
- **THEN** the system SHALL instruct the model that retrieval is unnecessary for unrelated questions

### Requirement: Retrieval Attachments Remain Visible In Context

The system SHALL include lightweight attachment tags for retrieval-mode files without inlining full parsed file content.

#### Scenario: Retrieval attachment is included in prompt context

- **WHEN** a message contains a file with `ragMode` set to `session-retrieval`
- **THEN** the context builder SHALL insert an `<ATTACHMENT_FILE>` tag containing file name, file key, retrieval mode, and index status
- **AND** the context builder SHALL include a `<SYSTEM_REMINDER>` telling the model to use session attachment retrieval tools for document-specific questions
- **AND** the context builder SHALL NOT read or inline the parsed file body for that attachment

### Requirement: Model Behavior Evaluation

The system SHALL provide a PoC evaluation harness for comparing whether models call session attachment retrieval tools appropriately.

#### Scenario: Eval fixture requires retrieval

- **WHEN** an eval case asks about a unique fact in an uploaded fixture document
- **THEN** the harness SHALL fail the case if the model does not call `query_session_attachment`

#### Scenario: Eval fixture is unrelated

- **WHEN** an eval case includes uploaded files but asks a clearly unrelated question
- **THEN** the harness SHALL fail the case if the model calls `query_session_attachment`
