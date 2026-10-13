package dm.jdbc.driver;

import java.lang.reflect.InvocationHandler;
import java.lang.reflect.Proxy;
import java.sql.Connection;
import java.sql.Driver;
import java.sql.DriverManager;
import java.sql.DriverPropertyInfo;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.ResultSetMetaData;
import java.sql.SQLException;
import java.sql.Types;
import java.util.Properties;
import java.util.logging.Logger;

/** Isolated JDBC fixture: no network access, supports the application's SELECT 1 ping. */
public class DmDriver implements Driver {
    static {
        try {
            DriverManager.registerDriver(new DmDriver());
        } catch (SQLException exception) {
            throw new ExceptionInInitializerError(exception);
        }
    }

    private static <T> T proxy(Class<T> type, InvocationHandler handler) {
        return type.cast(Proxy.newProxyInstance(DmDriver.class.getClassLoader(), new Class<?>[]{type}, handler));
    }

    private static Object defaultValue(Class<?> type) {
        if (type == boolean.class) return false;
        if (type == int.class) return 0;
        if (type == long.class) return 0L;
        return null;
    }

    private static ResultSet rows() {
        boolean[] consumed = {false};
        ResultSetMetaData metadata = proxy(ResultSetMetaData.class, (instance, method, arguments) -> switch (method.getName()) {
            case "getColumnCount" -> 1;
            case "getColumnType" -> Types.INTEGER;
            case "getColumnName", "getColumnLabel" -> "VALUE";
            case "getColumnTypeName" -> "INTEGER";
            case "getColumnClassName" -> Integer.class.getName();
            case "getPrecision" -> 10;
            default -> defaultValue(method.getReturnType());
        });
        return proxy(ResultSet.class, (instance, method, arguments) -> switch (method.getName()) {
            case "next" -> {
                boolean next = !consumed[0];
                consumed[0] = true;
                yield next;
            }
            case "getMetaData" -> metadata;
            case "getInt", "getObject" -> 1;
            case "getString" -> "1";
            default -> defaultValue(method.getReturnType());
        });
    }

    public Connection connect(String url, Properties properties) {
        if (!acceptsURL(url)) return null;
        boolean[] autoCommit = {true};
        return proxy(Connection.class, (instance, method, arguments) -> switch (method.getName()) {
            case "prepareStatement" -> {
                ResultSet resultSet = rows();
                yield proxy(PreparedStatement.class, (statement, operation, values) -> switch (operation.getName()) {
                    case "execute" -> true;
                    case "executeQuery", "getResultSet" -> resultSet;
                    case "getUpdateCount" -> -1;
                    default -> defaultValue(operation.getReturnType());
                });
            }
            case "getAutoCommit" -> autoCommit[0];
            case "setAutoCommit" -> {
                autoCommit[0] = (Boolean) arguments[0];
                yield null;
            }
            default -> defaultValue(method.getReturnType());
        });
    }

    public boolean acceptsURL(String url) { return url.startsWith("jdbc:dm:"); }
    public DriverPropertyInfo[] getPropertyInfo(String url, Properties properties) { return new DriverPropertyInfo[0]; }
    public int getMajorVersion() { return 1; }
    public int getMinorVersion() { return 0; }
    public boolean jdbcCompliant() { return false; }
    public Logger getParentLogger() { return Logger.getLogger("jdbc-fixture"); }
}
