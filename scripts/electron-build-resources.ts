/** Cross-platform resources copy script. */
import { existsSync, cpSync, lstatSync, readdirSync, rmSync } from "node:fs";
import { join, relative } from "node:path";

/** Vendored skills must be ordinary files so checkout/copy works on Windows
 * without symlink privileges and cannot reference a developer's local paths. */
export function assertPortableSkillResources(skillsDir: string): void {
  if (!existsSync(skillsDir)) return;
  const visit = (directory: string): void => {
    for (const name of readdirSync(directory)) {
      const path = join(directory, name);
      const stat = lstatSync(path);
      if (stat.isSymbolicLink()) {
        throw new Error(`Bundled skill contains a non-portable symlink: ${relative(skillsDir, path)}. Vendor ordinary files or remove redundant aliases.`);
      }
      if (stat.isDirectory()) visit(path);
    }
  };
  visit(skillsDir);
}

if (import.meta.main) {
  const electronDir = join(import.meta.dir, "..", "apps/electron");
  const srcDir = join(electronDir, "resources");
  const destDir = join(electronDir, "dist/resources");
  if (existsSync(srcDir)) {
    assertPortableSkillResources(join(srcDir, "skills"));
    // Rebuild generated output so removed resources cannot survive packaging.
    rmSync(destDir, { recursive: true, force: true });
    cpSync(srcDir, destDir, { recursive: true, force: true });
    console.log("📦 Copied resources to dist");
  } else {
    console.log("⚠️ No resources directory found");
  }
}
