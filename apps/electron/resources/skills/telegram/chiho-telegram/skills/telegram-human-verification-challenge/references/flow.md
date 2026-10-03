# Flow

Use this workflow for a normal Telegram message challenge in one-to-one chats.

1. Resolve the peer from the user's target or the recent dialog list.
2. Read recent messages and decide whether the risk justifies a challenge.
3. Pick a challenge type and compute the expected answer locally.
4. Preview the outgoing challenge message.
5. Complete the selected runtime's approval and executor steps; approval alone does not send. Use a direct-send path only for an explicit direct-send request.
6. Read the next contact reply and normalize whitespace and case before comparing.
7. Classify the outcome:
   - `passed`: the reply matches the expected answer.
   - `failed`: the reply is present but wrong.
   - `no reply`: no relevant reply is available yet.
   - `needs manual review`: the reply is ambiguous, edited, or contains extra context.
   - `skipped`: the chat is already trusted or the user declined the challenge.

Do not approve sensitive actions based only on a passed challenge.
