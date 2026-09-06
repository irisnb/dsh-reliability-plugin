## MODIFIED Requirements

### Requirement: Separate factual oracle
Each long-context tier SHALL have oracle metadata separate from the material sent to the model, identifying expected facts, source locations, relevant entities, wrong conclusions, and question category; the oracle SHALL NOT be included in replayed material or model prompts. When the material does not uniquely determine a fact, the oracle SHALL NOT encode a single unique expected conclusion; instead it SHALL allow an uncertain or hedged answer as correct rather than forcing the model to commit to a conclusion the source text does not establish.

#### Scenario: Check a known answer boundary
- **WHEN** a query references an oracle fact
- **THEN** the case SHALL contain enough expected-boundary data to determine whether the response supports, contradicts, or leaves that fact unresolved

#### Scenario: Ambiguous relationship is not over-specified
- **WHEN** a query asks for a relationship the source text only partially determines (for example 表哥 on the mother's side, which does not decide between 外甥 and 侄子)
- **THEN** the oracle SHALL NOT require a single unique conclusion and SHALL accept an answer that states the relationship is not further specified
