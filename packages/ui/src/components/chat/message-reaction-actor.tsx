import { createContext, useContext, type ReactNode } from 'react'
import { LOCAL_REACTION_ACTOR, type LocalActor } from './message-reactions'

// Standalone/local viewers retain their existing author. Connected views pass
// their authenticated actor; null keeps reactions disabled until it is known.
const MessageReactionActorContext = createContext<LocalActor | null>(LOCAL_REACTION_ACTOR)

export function MessageReactionActorProvider({ actor, children }: { actor: LocalActor | null; children: ReactNode }) {
  return <MessageReactionActorContext.Provider value={actor}>{children}</MessageReactionActorContext.Provider>
}

export function useMessageReactionActor(): LocalActor | null {
  return useContext(MessageReactionActorContext)
}
