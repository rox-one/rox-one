/**
 * SE profile icon layer — re-exports the shared v2 SVG extract.
 * Spec §4: packages/ui/src/icons/se/ owns the paths; this stub stays the
 * electron import surface for shell code that still points here.
 */
export {
  SE_ICON_LAYER_VERSION,
  SE_ICON_STROKE,
  createSeIcon,
  FolderGit2,
  GitBranch,
  GitPullRequest,
  CircleCheck,
  type SeIconProps,
} from '@rox/ui/icons/se'
