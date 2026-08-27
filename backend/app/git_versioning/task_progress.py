from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
from threading import Event, Lock, Thread
from typing import Callable
from uuid import uuid4


@dataclass
class GitTask:
    id: str
    connection_id: str
    title: str
    status: str = "running"
    current: int = 0
    total: int = 0
    detail: str = "准备开始"
    error: str | None = None
    started_at: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    finished_at: str | None = None
    result: dict[str, object] | None = None
    cancel_event: Event = field(default_factory=Event, repr=False, compare=False)

    @property
    def percent(self) -> int:
        if self.status == "success":
            return 100
        if self.total <= 0:
            return 0
        return min(99, max(0, int(self.current * 100 / self.total)))

    @property
    def cancel_requested(self) -> bool:
        return self.cancel_event.is_set()


class GitTaskRegistry:
    def __init__(self) -> None:
        self._lock = Lock()
        self._tasks: dict[str, GitTask] = {}

    def start(self, connection_id: str, title: str, work: Callable[[GitTask], dict[str, object] | None]) -> GitTask:
        with self._lock:
            existing = next(
                (
                    item
                    for item in self._tasks.values()
                    if item.connection_id == connection_id and item.status == "running"
                ),
                None,
            )
            if existing is not None:
                return existing
            task = GitTask(id=uuid4().hex, connection_id=connection_id, title=title)
            self._tasks[task.id] = task
        Thread(target=self._run, args=(task, work), daemon=True, name=f"datadjinn-git-{task.id[:8]}").start()
        return task

    def get(self, task_id: str) -> GitTask | None:
        with self._lock:
            return self._tasks.get(task_id)

    def cancel(self, task_id: str) -> GitTask | None:
        with self._lock:
            task = self._tasks.get(task_id)
            if task is not None and task.status == "running":
                task.cancel_event.set()
                task.detail = "正在停止后台提交"
            return task

    def list(self, connection_id: str) -> list[GitTask]:
        with self._lock:
            return [task for task in self._tasks.values() if task.connection_id == connection_id]

    def update(self, task: GitTask, **changes: object) -> None:
        with self._lock:
            for key, value in changes.items():
                setattr(task, key, value)

    def _run(self, task: GitTask, work: Callable[[GitTask], dict[str, object] | None]) -> None:
        try:
            result = work(task)
            if task.cancel_requested:
                self.update(task, status="cancelled", detail="已停止", finished_at=datetime.now(timezone.utc).isoformat())
                return
            self.update(
                task,
                status="success",
                current=task.total or task.current,
                detail="提交完成",
                result=result or {},
                finished_at=datetime.now(timezone.utc).isoformat(),
            )
        except Exception as exc:
            if task.cancel_requested:
                self.update(task, status="cancelled", detail="已停止", finished_at=datetime.now(timezone.utc).isoformat())
                return
            self.update(
                task,
                status="error",
                error=str(exc),
                detail="提交失败",
                finished_at=datetime.now(timezone.utc).isoformat(),
            )


git_task_registry = GitTaskRegistry()
