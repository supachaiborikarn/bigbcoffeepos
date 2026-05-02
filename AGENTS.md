# Working Rules

These rules apply to every Codex change in this repository.

## 1. No Magic

- Make assumptions explicit.
- If context is missing, state the assumptions before acting.
- Do not hallucinate hidden infrastructure or invent unspecified services.

## 2. Verify Before Done

- Never claim a change is complete without running verification.
- "I edited the file" is not done.
- "I edited the file and here is the verification output" is done.
- Avoid "should work now"; provide evidence before assertions.

## 3. Dissent Before Commit

Before any major change, surface concerns:

- What is the blast radius if this goes wrong?
- What assumptions are being made?
- What is the reversibility path?
- What are we not seeing because of momentum?

## 4. Scope Drift Detection

Track stated goals against actual execution. Flag when:

- "Just one more thing" accumulates.
- Nice-to-haves are treated as must-haves.
- The ask was "fix bug X" but the work has become "refactor the entire module".

## 5. R0 / R1 / R2 Reversibility

- R0, irreversible: stop and ask before proceeding.
- R1, costly to reverse: proceed only after explaining why.
- R2, easily reversed: proceed without extra permission.
