-- DataDjinn SQL 测试文件
-- 创建用户表
CREATE TABLE IF NOT EXISTS test_users (
    id INT AUTO_INCREMENT PRIMARY KEY,
    username VARCHAR(50) NOT NULL,
    email VARCHAR(100),
    age INT DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 插入测试数据
INSERT INTO test_users (username, email, age) VALUES ('张三', 'zhangsan@example.com', 28);
INSERT INTO test_users (username, email, age) VALUES ('李四', 'lisi@example.com', 32);
INSERT INTO test_users (username, email, age) VALUES ('王五', 'wangwu@example.com', 25);
INSERT INTO test_users (username, email, age) VALUES ('赵六', 'zhaoliu@example.com', 30);

-- 创建订单表
CREATE TABLE IF NOT EXISTS test_orders (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT,
    product VARCHAR(100),
    amount DECIMAL(10, 2),
    order_date DATE
);

-- 插入订单数据
INSERT INTO test_orders (user_id, product, amount, order_date) VALUES (1, '笔记本电脑', 6999.00, '2026-05-01');
INSERT INTO test_orders (user_id, product, amount, order_date) VALUES (1, '鼠标', 199.00, '2026-05-02');
INSERT INTO test_orders (user_id, product, amount, order_date) VALUES (2, '键盘', 599.00, '2026-05-10');
INSERT INTO test_orders (user_id, product, amount, order_date) VALUES (3, '显示器', 2499.00, '2026-05-15');
