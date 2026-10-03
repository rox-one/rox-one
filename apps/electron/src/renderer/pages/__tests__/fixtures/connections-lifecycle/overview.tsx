import * as React from 'react'
export type OverviewStatus='connected'|'error'|'notConfigured'|'disabled'|'pending'
export const ConnectionsOverview=()=>null
export const OverviewGroup=({title,children,action}:any)=><section><h2>{title}</h2>{action}<ul>{children}</ul></section>
export const OverviewRow=({title,subtitle,children,testId}:any)=><li data-testid={testId}><span>{title}</span><span>{subtitle}</span>{children}</li>
