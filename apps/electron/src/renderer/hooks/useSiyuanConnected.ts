import * as React from 'react'

/**
 * SiYuan kernel probe retired for product UX.
 * Always reports disconnected so chrome never gates on SiYuan.
 * Extension Host still asserts executesSiyuanPlugins === false separately.
 */
export function useSiyuanConnected(): boolean | null {
  return React.useMemo(() => false, [])
}
