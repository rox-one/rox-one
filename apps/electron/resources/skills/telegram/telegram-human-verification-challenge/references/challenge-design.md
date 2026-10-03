# Challenge Design

Prefer simple, varied text challenges that work in ordinary Telegram messages:

- Arithmetic plus instruction: ask for `left + right` and one explicit requested word.
- Token transformation: ask the contact to reverse a short random code.
- Position extraction: ask for the third word in a short sentence plus a small sum.

Keep numbers small enough to avoid legitimate mistakes. Avoid trick questions, cultural references, language-heavy riddles, or anything that could exclude a legitimate contact.

Examples:

```text
Quick verification: please reply with only the number you get from 14 + 8, followed by the word check
```

Expected answer: `22 check`

```text
Quick verification: please reply with the word blue and the result of 9 + 5, separated by one space.
```

Expected answer: `blue 14`

```text
Quick verification: please reverse this short code and send only the reversed code: K7M2
```

Expected answer: `2M7K`
