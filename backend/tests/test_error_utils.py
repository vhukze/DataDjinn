import unittest

from app.db.error_utils import friendly_error


class PostgreSqlErrorMessageTests(unittest.TestCase):
    def test_group_concat_error_is_not_misclassified_as_missing_database(self) -> None:
        error = Exception(
            'function group_concat(text) does not exist\n'
            'LINE 1: SELECT GROUP_CONCAT(dataset_prefix) FROM dict_dataset WHERE database_id = 1'
        )

        self.assertEqual(
            friendly_error(error),
            'PostgreSQL 函数不存在：GROUP_CONCAT。请使用 string_agg(字段, 分隔符)。',
        )

    def test_driver_error_code_without_message_is_not_shown_as_zero(self) -> None:
        self.assertEqual(
            friendly_error(Exception(0)),
            "数据库操作失败，驱动未返回有效错误信息，请查看后端日志",
        )

    def test_missing_postgresql_database_uses_the_specific_message(self) -> None:
        self.assertEqual(
            friendly_error(Exception('database "missing_db" does not exist')),
            'PostgreSQL 数据库不存在，请检查填写的数据库名。',
        )
