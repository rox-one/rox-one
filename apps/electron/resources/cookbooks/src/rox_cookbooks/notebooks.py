from __future__ import annotations

import copy
import json
import os
import uuid
from pathlib import Path
from typing import Any

from .copies import CookbookCopy


class NotebookError(ValueError):
    pass


def source_text(cell: dict[str, Any]) -> str:
    """The cell source as one string.

    A cell ``source`` is either a string or a list of strings (nbformat). Anything
    else is a malformed notebook and raises ``NotebookError`` rather than a bare
    ``TypeError`` (plan 010).
    """
    src = cell.get("source")
    if src is None:
        return ""
    if isinstance(src, str):
        return src
    if isinstance(src, list) and all(isinstance(line, str) for line in src):
        return "".join(src)
    raise NotebookError(
        f"invalid cell source: expected str or list of str, got {type(src).__name__}"
    )


def to_source(text: str) -> list[str]:
    """Split ``text`` into the cell ``source`` list nbformat stores.

    ``""`` becomes ``[]``; otherwise newlines are preserved as their own trailing
    characters (``"a\\nb\\n" -> ["a\\n", "b\\n"]``).
    """
    if text == "":
        return []
    return text.splitlines(keepends=True)


def cell_source(cell: dict[str, Any]) -> str:
    return source_text(cell)


def load_notebook(path: Path) -> dict[str, Any]:
    try:
        data = json.loads(Path(path).read_text(encoding="utf-8"))
    except (json.JSONDecodeError, UnicodeDecodeError, OSError) as exc:
        raise NotebookError(
            f"ноутбук повреждён ({path}): {exc}. Сбросьте копию к оригиналу."
        ) from exc
    if not isinstance(data, dict) or "cells" not in data:
        raise NotebookError(f"ноутбук повреждён ({path}): нет ячеек. Сбросьте копию к оригиналу.")
    nbformat = data.get("nbformat")
    if nbformat is not None and (not isinstance(nbformat, int) or nbformat < 4):
        raise NotebookError(f"неподдерживаемый формат ноутбука (nbformat {nbformat})")
    return data


def save_notebook(path: Path, nb: dict[str, Any]) -> None:
    """Write ``nb`` atomically: temp file in the same dir, then ``os.replace``.

    A crash mid-write leaves the previous ipynb intact instead of a half-written
    one (plan 010).
    """
    path = Path(path)
    tmp = path.with_suffix(".ipynb.tmp")
    try:
        tmp.write_text(json.dumps(nb, indent=2) + "\n", encoding="utf-8")
        os.replace(tmp, path)
    except BaseException:
        try:
            tmp.unlink()
        except OSError:
            pass
        raise


def _md_cell(markdown: str) -> dict[str, Any]:
    # An empty source must round-trip as [] (reads back as ""), the same rule
    # _code_cell and Notebook.set_markdown already follow: /save and the wave-10
    # /cells/add route both treat "" as no lines, so an empty markdown cell must
    # not gain a stray "\n" that would show up as a blank line in the editor.
    return {
        "cell_type": "markdown",
        "metadata": {},
        "source": to_source(
            markdown if (markdown == "" or markdown.endswith("\n")) else markdown + "\n"
        ),
    }


def _code_cell(code: str) -> dict[str, Any]:
    return {
        "cell_type": "code",
        "execution_count": None,
        "metadata": {},
        "outputs": [],
        "source": to_source(code if code.endswith("\n") or code == "" else code + "\n"),
    }


def write_stub_ipynb(path: Path, title: str, code: str, markdown: str | None = None) -> None:
    cells = []
    if markdown:
        cells.append(_md_cell(markdown))
    cells.append(_code_cell(code))
    nb = {
        "nbformat": 4,
        "nbformat_minor": 5,
        "metadata": {
            "kernelspec": {
                "display_name": "Python 3",
                "language": "python",
                "name": "python3",
            },
            "rox": {"title": title},
        },
        "cells": cells,
    }
    path.parent.mkdir(parents=True, exist_ok=True)
    save_notebook(path, nb)


def persist_code_output(
    path: Path, code: str, result: dict[str, Any], *, index: int | None = None
) -> None:
    """Write ``result`` into the copy's ipynb.

    ``index`` names the executed cell: when it is a valid code-cell index its
    outputs replace that cell's. Otherwise (no index, or the index is not a code
    cell) fall back to matching the first code cell whose source equals ``code`` —
    the CLI/back-compat path (plan 010).
    """
    if Path(path).suffix != ".ipynb":
        return
    nb = load_notebook(path)
    cells = nb.get("cells") or []
    target = None
    if index is not None and 0 <= index < len(cells):
        cell = cells[index]
        if isinstance(cell, dict) and cell.get("cell_type") == "code":
            target = cell
    if target is None:
        for cell in cells:
            if isinstance(cell, dict) and cell.get("cell_type") == "code" and source_text(cell).strip() == code.strip():
                target = cell
                break
    if target is None:
        target = _code_cell(code)
        nb.setdefault("cells", []).append(target)
    _apply_result(target, result)
    save_notebook(path, nb)


def _display_outputs(result: dict[str, Any]) -> list[dict[str, Any]]:
    """The ``display_data`` outputs of one cell result (Wave 11).

    ``result["displays"]`` is a list of ``{"mime", "data"}`` records from the
    kernel, already redacted and capped there (and re-checked by the caller). An
    ``application/json`` record is stored parsed — nbformat wants a JSON value,
    not its serialisation — and falls back to the raw string when it does not
    parse; every other mime (base64 for images) is stored verbatim.
    """
    outputs: list[dict[str, Any]] = []
    records = result.get("displays")
    if not isinstance(records, list):
        return outputs
    for record in records:
        if not isinstance(record, dict):
            continue
        mime = record.get("mime")
        data = record.get("data")
        if not isinstance(mime, str) or not mime or not isinstance(data, str):
            continue
        value: Any = data
        if mime == "application/json":
            try:
                value = json.loads(data)
            except (TypeError, ValueError):
                value = data
        outputs.append(
            {"output_type": "display_data", "metadata": {}, "data": {mime: value}}
        )
    return outputs


def _apply_result(cell: dict[str, Any], result: dict[str, Any]) -> None:
    stdout = result.get("stdout") or ""
    stderr = result.get("stderr") or ""
    ok = result.get("ok")
    outputs: list[dict[str, Any]] = []
    # Keep whatever a failing cell streamed before it raised, not just the error
    # (plan 010); a successful cell's stdout is recorded here too.
    if stdout:
        outputs.append(
            {
                "output_type": "stream",
                "name": "stdout",
                "text": to_source(stdout if stdout.endswith("\n") else stdout + "\n"),
            }
        )
    # Wave 11: rich displays sit between the stdout stream and the error/stderr
    # output, so the ipynb reads back in the order the cell produced it.
    outputs.extend(_display_outputs(result))
    if not ok:
        tb = (stderr or stdout or result.get("error") or "").splitlines(keepends=True)
        if tb and not str(tb[-1]).endswith("\n"):
            tb[-1] = str(tb[-1]) + "\n"
        outputs.append(
            {
                "output_type": "error",
                "ename": "CellError",
                "evalue": "",
                "traceback": tb or ["error\n"],
            }
        )
    elif stderr:
        outputs.append(
            {
                "output_type": "stream",
                "name": "stderr",
                "text": to_source(stderr if stderr.endswith("\n") else stderr + "\n"),
            }
        )
    cell["outputs"] = outputs
    cell["execution_count"] = (cell.get("execution_count") or 0) + 1


class Notebook:
    def __init__(self, data: dict[str, Any], path: Path, copy: CookbookCopy | None = None):
        self.data = data
        self.path = Path(path)
        self.copy = copy

    @classmethod
    def load(cls, path: Path) -> Notebook:
        return cls(load_notebook(path), Path(path), None)

    @classmethod
    def open(cls, copy: CookbookCopy) -> Notebook:
        if copy.document.suffix != ".ipynb":
            raise NotebookError("not a notebook")
        return cls(load_notebook(copy.document), copy.document, copy)

    @property
    def cells(self) -> list[dict[str, Any]]:
        return self.data.setdefault("cells", [])

    @property
    def title(self) -> str:
        rox = (self.data.get("metadata") or {}).get("rox") or {}
        return str(rox.get("title") or "")

    def cell_type(self, index: int) -> str:
        try:
            cell = self.cells[index]
        except (IndexError, TypeError) as exc:
            raise NotebookError(f"cell index out of range: {index}") from exc
        if not isinstance(cell, dict) or "cell_type" not in cell:
            raise NotebookError(f"cell {index} has no cell_type")
        return str(cell["cell_type"])

    def source(self, index: int) -> str:
        return source_text(self.cells[index])

    def outputs(self, index: int) -> list[dict[str, Any]]:
        return list(self.cells[index].get("outputs") or [])

    def execution_count(self, index: int) -> int | None:
        return self.cells[index].get("execution_count")

    def set_markdown(self, index: int, source: str) -> None:
        if self.cell_type(index) != "markdown":
            raise NotebookError("not markdown")
        self.cells[index]["source"] = to_source(source)

    def set_code(self, index: int, source: str) -> None:
        if self.cell_type(index) != "code":
            raise NotebookError("not code")
        self.cells[index]["source"] = to_source(source)

    def add_markdown_cell(self, source: str, index: int | None = None) -> int:
        cell = _md_cell(source)
        if index is None:
            self.cells.append(cell)
            return len(self.cells) - 1
        self.cells.insert(index, cell)
        return index

    def add_code_cell(self, source: str, index: int | None = None) -> int:
        cell = _code_cell(source)
        if index is None:
            self.cells.append(cell)
            return len(self.cells) - 1
        self.cells.insert(index, cell)
        return index

    # -- Wave 10: structural cell operations -------------------------------- #
    # Indices are positional (vendored ipynb carry no stable cell ids) and each
    # op returns the index the caller should focus next, so the HTTP layer has
    # nothing to recompute. Callers own persistence: mutate, then ``save()``.

    def delete_cell(self, index: int) -> int:
        """Remove cell ``index`` and return the index to focus afterwards.

        The answer is the cell that slid into the removed one's slot
        (``min(index, len-2)`` measured before the delete), so deleting the last
        cell focuses the new last one instead of falling off the end. Deleting
        the only cell leaves nothing to focus: ``-1``.
        """
        count = len(self.cells)
        if not 0 <= index < count:
            raise NotebookError(f"cell index out of range: {index}")
        del self.cells[index]
        return min(index, count - 2)

    def move_cell(self, from_index: int, to_index: int) -> int:
        """Move a cell in place and return its new index.

        Implemented as remove-then-insert, so ``to_index`` is the destination
        position in the resulting order (``[a,b,c].move(0,2) -> [b,c,a]``).
        ``from_index == to_index`` is a successful no-op.
        """
        count = len(self.cells)
        if not 0 <= from_index < count:
            raise NotebookError(f"cell index out of range: {from_index}")
        if not 0 <= to_index < count:
            raise NotebookError(f"cell index out of range: {to_index}")
        if from_index == to_index:
            return to_index
        cell = self.cells.pop(from_index)
        self.cells.insert(to_index, cell)
        return to_index

    def duplicate_cell(self, index: int) -> int:
        """Deep-copy cell ``index`` into ``index+1`` and return the new index.

        ``copy.deepcopy`` (not a shallow copy) because the copy must be fully
        independent: nbformat cells nest ``metadata``/``outputs``, and editing
        the duplicate's source or clearing its outputs must not touch the
        original. A string ``id`` (nbformat 4.5) is regenerated with a fresh
        UUID so notebook tooling that keys on cell ids still sees a unique set.
        """
        count = len(self.cells)
        if not 0 <= index < count:
            raise NotebookError(f"cell index out of range: {index}")
        cell = copy.deepcopy(self.cells[index])
        if isinstance(cell.get("id"), str):
            cell["id"] = uuid.uuid4().hex[:12]
        self.cells.insert(index + 1, cell)
        return index + 1

    # -- Wave 13: cell-type conversion -------------------------------------- #

    def convert_cell(self, index: int, cell_type: str) -> int:
        """Switch cell ``index`` to ``cell_type`` and return the focus index.

        The cell keeps its position, its source, its ``metadata`` and — when
        nbformat 4.5 stamped one — its ``id``; only the run state moves with the
        type. ``code -> markdown`` drops ``outputs``/``execution_count`` (an md
        cell is ``{cell_type, metadata, source}``), ``markdown -> code`` adds
        ``execution_count: None`` and ``outputs: []`` so the result is a
        well-formed code cell. Converting to the type the cell already has is a
        successful no-op (``index`` comes back unchanged), which keeps ``y```
        /``m`` idempotent in the renderer.
        """
        if cell_type not in ("code", "markdown"):
            raise NotebookError("cellType must be 'code' or 'markdown'")
        if not 0 <= index < len(self.cells):
            raise NotebookError(f"cell index out of range: {index}")
        if self.cell_type(index) == cell_type:
            return index
        cell = self.cells[index]
        if cell_type == "markdown":
            cell.pop("outputs", None)
            cell.pop("execution_count", None)
        else:
            cell["execution_count"] = None
            cell["outputs"] = []
        cell["cell_type"] = cell_type
        return index

    def save(self) -> None:
        save_notebook(self.path, self.data)

    def run_cell(self, index: int) -> dict[str, Any]:
        if self.copy is None:
            raise NotebookError("notebook is not bound to a workspace copy")
        if self.cell_type(index) != "code":
            raise NotebookError("run_cell requires a code cell")
        self.save()
        from .kernel import execute_code

        code = self.source(index)
        result = execute_code(self.copy, code, persist=False)
        _apply_result(self.cells[index], result)
        self.save()
        return result


class Playbook:
    def __init__(self, path: Path, text: str):
        self.path = Path(path)
        self.text = text

    @classmethod
    def open(cls, copy: CookbookCopy) -> Playbook:
        if copy.document.suffix != ".md":
            raise NotebookError("not a playbook")
        return cls(copy.document, copy.document.read_text(encoding="utf-8"))

    def edit(self, old: str, new: str) -> None:
        if old not in self.text:
            raise NotebookError("snippet not found")
        self.text = self.text.replace(old, new, 1)

    def set_text(self, text: str) -> None:
        self.text = text

    def save(self) -> None:
        self.path.write_text(self.text, encoding="utf-8")


def open_document(copy: CookbookCopy):
    if copy.document.suffix == ".ipynb":
        return Notebook.open(copy)
    if copy.document.suffix == ".md":
        return Playbook.open(copy)
    raise NotebookError(f"unsupported document: {copy.document}")


def set_cell_source(path: Path, index: int, source: str) -> dict[str, Any]:
    if Path(path).suffix == ".md":
        Path(path).write_text(source if source.endswith("\n") else source + "\n", encoding="utf-8")
        return {"kind": "md"}
    nb = Notebook.load(path)
    if nb.cell_type(index) == "markdown":
        nb.set_markdown(index, source)
    else:
        nb.set_code(index, source)
    nb.save()
    return nb.data
