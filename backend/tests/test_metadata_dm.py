import unittest
from types import SimpleNamespace
from unittest.mock import patch

from fastapi import BackgroundTasks
from sqlalchemy.engine import default

from app.api import metadata as metadata_api
from app.db import metadata as metadata_module
from app.schemas.metadata import ColumnInfo, DbObjectInfo, TableUpdateColumn, TableUpdateRequest


class FakeConnection:
    def __init__(self) -> None:
        self.statements: list[str] = []
        self.results: list[FakeResult] = []

    def execute(self, statement: object, _parameters: object | None = None) -> "FakeResult":
        self.statements.append(str(statement))
        return self.results.pop(0) if self.results else FakeResult()


class FakeResult:
    def __init__(
        self, rows: list[tuple[object, ...]] | None = None, row: tuple[object, ...] | None = None
    ) -> None:
        self.rows = rows or []
        self.row = row

    def fetchall(self) -> list[tuple[object, ...]]:
        return self.rows

    def fetchone(self) -> tuple[object, ...] | None:
        return self.row


class FakeTransaction:
    def __init__(self, connection: FakeConnection) -> None:
        self.connection = connection

    def __enter__(self) -> FakeConnection:
        return self.connection

    def __exit__(self, _exc_type, _exc_value, _traceback) -> None:
        return None


class FakeDmEngine:
    def __init__(self) -> None:
        dialect = default.DefaultDialect()
        dialect.name = "dm"
        self.dialect = dialect
        self.url = SimpleNamespace(username="APP")
        self.connection = FakeConnection()

    def begin(self) -> FakeTransaction:
        return FakeTransaction(self.connection)

    def connect(self) -> FakeTransaction:
        return FakeTransaction(self.connection)


class DamengMetadataUpdateTests(unittest.TestCase):
    def test_tree_object_endpoint_skips_per_table_statistics_and_comments(self) -> None:
        engine = FakeDmEngine()
        objects = [DbObjectInfo(name=f"ORDERS_{index}", type="table") for index in range(2_000)]

        with (
            patch.object(metadata_api.connection_manager, "get_engine", return_value=engine),
            patch.object(metadata_api, "list_db_objects", return_value=objects) as list_objects,
            patch.object(metadata_api, "get_table_comment") as get_comment,
        ):
            response = metadata_api.get_objects("dm-connection", "APP", type="table")

        self.assertEqual(len(response.objects), 2_000)
        list_objects.assert_called_once_with(engine, "APP", None, "table", False)
        get_comment.assert_not_called()

    def test_tree_object_endpoint_can_request_batch_table_statistics(self) -> None:
        engine = FakeDmEngine()
        objects = [DbObjectInfo(name="ORDERS", type="table", size_display="64K")]

        with (
            patch.object(metadata_api.connection_manager, "get_engine", return_value=engine),
            patch.object(metadata_api, "list_db_objects", return_value=objects) as list_objects,
        ):
            response = metadata_api.get_objects(
                "dm-connection", "APP", type="table", include_stats=True
            )

        self.assertEqual(response.objects[0].size_display, "64K")
        list_objects.assert_called_once_with(engine, "APP", None, "table", True)

    def test_update_endpoint_keeps_the_original_path_and_returns_the_renamed_table(self) -> None:
        engine = FakeDmEngine()
        request = TableUpdateRequest(
            table_name="NEW_TABLE",
            columns=[
                TableUpdateColumn(
                    name="NEW_CODE",
                    source_name="OLD_CODE",
                    type="VARCHAR(32)",
                    nullable=False,
                    primary_key=True,
                )
            ],
        )
        renamed_columns = [
            ColumnInfo(name="NEW_CODE", type="VARCHAR(32)", nullable=False, primary_key=True)
        ]

        with (
            patch.object(metadata_api.connection_manager, "get_engine", return_value=engine),
            patch.object(metadata_api, "update_table_columns", return_value="NEW_TABLE") as update,
            patch.object(metadata_api, "list_columns", return_value=renamed_columns) as list_updated,
            patch.object(metadata_api, "get_table_comment", return_value="") as get_comment,
            patch.object(metadata_api.schema_versioning_service, "schedule_snapshot") as schedule_snapshot,
        ):
            background_tasks = BackgroundTasks()
            response = metadata_api.update_columns(
                "dm-connection", "OLD_TABLE", request, background_tasks, "APP"
            )

        self.assertEqual(response.columns, renamed_columns)
        update.assert_called_once_with(
            engine,
            "OLD_TABLE",
            request.columns,
            "APP",
            None,
            None,
            "NEW_TABLE",
        )
        list_updated.assert_called_once_with(engine, "NEW_TABLE", "APP", None)
        get_comment.assert_called_once_with(engine, "NEW_TABLE", "APP", None)
        schedule_snapshot.assert_called_once_with(
            background_tasks, "dm-connection", "修改表结构 NEW_TABLE"
        )

    def test_renames_the_exact_source_column_and_table(self) -> None:
        engine = FakeDmEngine()
        current_columns = [
            ColumnInfo(name="OLD_CODE", type="VARCHAR(32)", nullable=False, primary_key=True)
        ]
        next_columns = [
            TableUpdateColumn(
                name="NEW_CODE",
                source_name="OLD_CODE",
                type="VARCHAR(32)",
                nullable=False,
                primary_key=True,
            )
        ]

        with patch.object(metadata_module, "list_columns", return_value=current_columns):
            updated_table_name = metadata_module.update_table_columns(
                engine,  # type: ignore[arg-type]
                "OLD_TABLE",
                next_columns,
                "APP",
                new_table_name="NEW_TABLE",
            )

        self.assertEqual(updated_table_name, "NEW_TABLE")
        self.assertEqual(
            engine.connection.statements,
            [
                'ALTER TABLE "APP"."OLD_TABLE" RENAME COLUMN "OLD_CODE" TO "NEW_CODE"',
                'ALTER TABLE "APP"."OLD_TABLE" RENAME TO "NEW_TABLE"',
            ],
        )

    def test_rejects_an_unmatched_source_column_instead_of_renaming_by_position(self) -> None:
        engine = FakeDmEngine()
        current_columns = [ColumnInfo(name="OLD_CODE", type="VARCHAR(32)", nullable=False, primary_key=False)]
        next_columns = [
            TableUpdateColumn(
                name="NEW_CODE",
                source_name="ANOTHER_COLUMN",
                type="VARCHAR(32)",
                nullable=False,
                primary_key=False,
            )
        ]

        with patch.object(metadata_module, "list_columns", return_value=current_columns):
            with self.assertRaisesRegex(ValueError, "字段"):
                metadata_module.update_table_columns(engine, "OLD_TABLE", next_columns, "APP")  # type: ignore[arg-type]

    def test_reads_and_updates_table_and_column_comments(self) -> None:
        engine = FakeDmEngine()
        engine.connection.results = [
            FakeResult(rows=[("CODE", "字段原注释")]),
            FakeResult(rows=[("CODE", "VARCHAR(32)", "Y", 0)]),
            FakeResult(row=("表原注释",)),
        ]

        columns = metadata_module.list_columns(engine, "ORDERS", "APP")  # type: ignore[arg-type]
        table_comment = metadata_module.get_table_comment(engine, "ORDERS", "APP")  # type: ignore[arg-type]

        self.assertEqual(columns[0].comment, "字段原注释")
        self.assertEqual(table_comment, "表原注释")
        self.assertIn("ALL_COL_COMMENTS", engine.connection.statements[0])
        self.assertIn("ALL_TAB_COLUMNS", engine.connection.statements[1])
        self.assertIn("ALL_TAB_COMMENTS", engine.connection.statements[2])

        current_columns = [
            ColumnInfo(name="CODE", type="VARCHAR(32)", nullable=True, primary_key=False)
        ]
        next_columns = [
            TableUpdateColumn(
                name="CODE",
                source_name="CODE",
                type="VARCHAR(32)",
                nullable=True,
                primary_key=False,
                comment="字段新注释",
            )
        ]
        with patch.object(metadata_module, "list_columns", return_value=current_columns):
            metadata_module.update_table_columns(
                engine,  # type: ignore[arg-type]
                "ORDERS",
                next_columns,
                "APP",
                table_comment="表新注释",
            )

        self.assertEqual(
            engine.connection.statements[-2:],
            [
                'COMMENT ON COLUMN "APP"."ORDERS"."CODE" IS \'字段新注释\'',
                'COMMENT ON TABLE "APP"."ORDERS" IS \'表新注释\'',
            ],
        )


if __name__ == "__main__":
    unittest.main()
