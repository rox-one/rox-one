# Bulk Template Message Safety

- Do not send to more recipients than the tool limit allows.
- Do not infer recipients from ambiguous names.
- Do not silently rewrite the approved template.
- Do not include secrets, private notes, or internal CRM metadata in Telegram messages.
- Do not retry failed sends without checking whether the original run partially succeeded.
- If recipients include mixed relationship types, split the run or ask for confirmation.
