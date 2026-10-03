import type {
  AwsProcessRun, DockerRun, GitRun, KeychainGetRun, KeychainListRun, SshListRun,
} from '@rox/shared/credentials'

/** Internal host I/O ports. RPC callers cannot supply executable callbacks. */
export interface HostImportRunners {
  readonly git?: GitRun
  readonly docker?: DockerRun
  readonly aws?: AwsProcessRun
  readonly keychainList?: KeychainListRun
  readonly keychainGet?: KeychainGetRun
  readonly sshAgentList?: SshListRun
}
