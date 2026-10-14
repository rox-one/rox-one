from __future__ import annotations

import hashlib
import json
import shutil
from dataclasses import dataclass
from pathlib import Path

from .catalog import Catalog, CatalogItem

# How many times to re-allocate a copy id after losing a mkdir race.
_ALLOC_ATTEMPTS = 5


class CopyError(ValueError):
    pass


def _read_origin(path: Path) -> dict | None:
    """Parse a copy's ``origin.json``, tolerating interrupted copies.

    Returns the decoded mapping, or ``None`` when the file is missing,
    unreadable, not valid JSON, or not a JSON object. Treating a bad origin as
    ``None`` lets callers skip/recreate half-written copies instead of crashing
    on a single sibling directory.
    """
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    return data if isinstance(data, dict) else None


def _sha256_file(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


@dataclass(frozen=True)
class CookbookCopy:
    item_id: str
    copy_id: str
    root: Path
    document: Path
    origin_path: Path
    requirements_path: Path
    venv_path: Path

    @property
    def origin(self) -> dict:
        data = _read_origin(self.origin_path)
        if data is None:
            raise CopyError(f"copy has no readable origin: {self.origin_path}")
        return data


class CookbookCopies:
    def __init__(self, workspace_root: Path, catalog: Catalog):
        self.workspace_root = Path(workspace_root).resolve()
        self.catalog = catalog
        self.base = self.workspace_root / "cookbooks"

    def open(self, item_id: str, *, new_copy: bool = False) -> CookbookCopy:
        item = self.catalog.item(item_id)
        if not new_copy:
            existing = self._latest(item)
            if existing is not None:
                return existing
        dest = self._allocate_dir(item, reuse=not new_copy)
        src = self.catalog.source_path(item)
        dest_doc = dest / src.name
        try:
            shutil.copy2(src, dest_doc)
        except FileNotFoundError as exc:
            raise CopyError(f"item file is missing: {src}") from exc
        req = dest / "requirements.txt"
        req.write_text("\n".join(item.dependencies) + ("\n" if item.dependencies else ""), encoding="utf-8")
        origin = dest / "origin.json"
        origin.write_text(
            json.dumps(
                {
                    "itemId": item.id,
                    "copyId": dest.name,
                    "catalogRevision": self.catalog.revision,
                    "vendor": item.vendor,
                    "sourcePath": item.path,
                    "kind": item.kind,
                    "documentSha256": _sha256_file(dest_doc),
                },
                indent=2,
            )
            + "\n",
            encoding="utf-8",
        )
        return self._copy_from_dir(item, dest)

    def is_dirty(self, copy: CookbookCopy) -> bool:
        """True when the personal copy diverges from its pinned revision.

        The pin is the ``documentSha256`` recorded in ``origin.json`` when the
        copy was created (or last reset), so a later upstream catalog update
        does not mark an untouched copy dirty. Copies written before the pin
        existed fall back to comparing against the current catalog file.
        """
        if not copy.document.is_file():
            return True
        pinned = (_read_origin(copy.origin_path) or {}).get("documentSha256")
        if pinned:
            return _sha256_file(copy.document) != pinned
        item = self.catalog.item(copy.item_id)
        src = self.catalog.source_path(item)
        return copy.document.read_bytes() != src.read_bytes()

    def reset(
        self,
        copy: CookbookCopy,
        *,
        confirm: bool = False,
        wipe_outputs: bool = False,
        to_current_catalog: bool = False,
    ) -> CookbookCopy:
        if self.is_dirty(copy) and not confirm:
            raise CopyError(
                "reset requires confirm=True because the copy is dirty"
            )
        item = self.catalog.item(copy.item_id)
        src = self.catalog.source_path(item)
        dest_doc = copy.root / src.name
        try:
            shutil.copy2(src, dest_doc)
        except FileNotFoundError as exc:
            raise CopyError(f"item file is missing: {src}") from exc
        copy.requirements_path.write_text(
            "\n".join(item.dependencies) + ("\n" if item.dependencies else ""),
            encoding="utf-8",
        )
        origin = copy.origin
        origin["catalogRevision"] = self.catalog.revision if to_current_catalog else origin.get(
            "catalogRevision", self.catalog.revision
        )
        origin["sourcePath"] = item.path
        origin["documentSha256"] = _sha256_file(dest_doc)
        copy.origin_path.write_text(json.dumps(origin, indent=2) + "\n", encoding="utf-8")
        if wipe_outputs:
            outputs = copy.root / "outputs"
            if outputs.exists():
                shutil.rmtree(outputs)
            if copy.venv_path.exists():
                shutil.rmtree(copy.venv_path)
        return self._copy_from_dir(item, copy.root)

    def _latest(self, item: CatalogItem) -> CookbookCopy | None:
        if not self.base.exists():
            return None
        matches = []
        for child in self.base.iterdir():
            data = _read_origin(child / "origin.json")
            if data is None:
                continue
            if data.get("itemId") == item.id:
                matches.append(child)
        if not matches:
            return None
        matches.sort(key=lambda p: p.stat().st_mtime)
        return self._copy_from_dir(item, matches[-1])

    def _allocate_dir(self, item: CatalogItem, *, reuse: bool) -> Path:
        """Create and return a directory for a new copy of ``item``.

        ``reuse`` targets the canonical ``<itemId>`` slot (the default copy for
        an item); otherwise a unique ``<itemId>[-N]`` id is chosen.

        Directories under ``cookbooks/<itemId>[-N]/`` are ours: one without a
        readable ``origin.json`` is garbage from an interrupted copy, so it is
        removed and recreated. A ``FileExistsError`` means a concurrent writer
        won the race for this id; we retry with a fresh id (bounded), which is
        what makes parallel ``new_copy`` opens safe.
        """
        for _ in range(_ALLOC_ATTEMPTS):
            copy_id = item.id if reuse else self._next_copy_id(item)
            dest = self._dest_for(copy_id)
            if dest.exists():
                if _read_origin(dest / "origin.json") is not None:
                    # A real copy lives here; if we wanted the canonical slot
                    # it belongs to another item, so fall back to a fresh id.
                    if reuse:
                        reuse = False
                    continue
                shutil.rmtree(dest, ignore_errors=True)
            try:
                dest.mkdir(parents=True, exist_ok=False)
                return dest
            except FileExistsError:
                continue
        raise CopyError("could not allocate a copy id")

    def _dest_for(self, copy_id: str) -> Path:
        if not copy_id or copy_id in {".", ".."} or "/" in copy_id or "\\" in copy_id:
            raise CopyError(f"illegal copy id: {copy_id!r}")
        dest = (self.base / copy_id).resolve()
        try:
            dest.relative_to(self.base.resolve())
        except ValueError as exc:
            raise CopyError(f"copy path escapes workspace: {copy_id}") from exc
        catalog_root = self.catalog.root.resolve()
        if dest == catalog_root or catalog_root in dest.parents:
            raise CopyError("refusing to write into the canonical catalog")
        return dest

    def _next_copy_id(self, item: CatalogItem) -> str:
        n = 2
        while (self.base / f"{item.id}-{n}").exists():
            n += 1
        if not (self.base / item.id).exists():
            return item.id
        return f"{item.id}-{n}"

    def _copy_from_dir(self, item: CatalogItem, dest: Path) -> CookbookCopy:
        src_name = Path(item.path).name
        doc = dest / src_name
        if not doc.is_file():
            raise CopyError(f"copy missing document: {doc}")
        return CookbookCopy(
            item_id=item.id,
            copy_id=dest.name,
            root=dest,
            document=doc,
            origin_path=dest / "origin.json",
            requirements_path=dest / "requirements.txt",
            venv_path=dest / ".venv",
        )
