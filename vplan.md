# VPlan

## 2026-05-24：结果表格分页沉底修复方案

### 目标

- 表数据预览和查询结果区域要占满可用高度。
- 数据很少时，表格 body 留空，分页栏固定在结果区最底部。
- 横向滚动条应靠近表格 body 底部，不紧挨最后一行数据。
- 不再依赖 Ant Table 自带分页布局沉底。
- 保留当前分页语义：500/1000 表示后端重新查询条数，不是前端分页条数。

### 当前现象

- 虽然表格已改为 `pagination={false}`，分页也已外置为 `.result-pagination`。
- 但分页行仍然紧挨最后一行数据。
- 这说明 `.result-pagination` 的父容器 `.result-table-shell` 本身没有撑满可用高度。
- `.result-pagination` 已经在自己的父容器底部，但父容器高度只有内容高度。

### 根因

- 当前修复只处理了结果区内部：
```css
.result-table-shell { flex: 1; }
.result-table { flex: 1; }
```
- 但是结果区是否能撑满，依赖所有父级都必须具备明确高度或 flex 剩余空间。
- 高度链路可能在以下任一级断开：
  - `.workspace-tabs .ant-tabs-content-holder`
  - `.workspace-tabs .ant-tabs-content`
  - `.workspace-tabs .ant-tabs-tabpane`
  - `.editor-placeholder`
  - `.main-panel`
  - `.studio-shell`
  - `Splitter.Panel` 内部容器
- 如果某个父级没有 `height: 100%` / `flex: 1` / `min-height: 0`，子级的 `height: 100%` 和 `flex: 1` 就没有有效参考。
- 最终结果是 `.result-table-shell` 按内容高度布局，分页自然紧挨最后一行。

### 设计原则

- 先修外层高度链路，再修表格内部布局。
- 所有 flex 子容器都要设置 `min-height: 0`，否则子元素可能按内容高度撑开，无法内部滚动。
- 结果区中只有表格 body 滚动，分页栏不参与滚动。
- 分页栏作为固定 footer，位于 `.result-table-shell` 最底部。
- 不使用 Ant Table 内置分页沉底，因为其 DOM 结构和 flex 关系不可控。

### 方案一：补齐 Tabs 和工作区高度链路

#### 1. Tabs 容器

- 当前已有：
```css
.workspace-tabs {
  height: 100%;
  display: flex;
  flex-direction: column;
}
```
- 需要补充：
```css
.workspace-tabs .ant-tabs-content-holder {
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

.workspace-tabs .ant-tabs-content {
  height: 100%;
  min-height: 0;
}

.workspace-tabs .ant-tabs-tabpane {
  height: 100%;
  min-height: 0;
}
```

#### 2. 主内容容器

- 给工作区外层补齐高度：
```css
.main-panel,
.studio-shell,
.editor-placeholder {
  height: 100%;
  min-height: 0;
}
```
- 如果 `.editor-placeholder` 是结果页直接父级，建议设为 flex：
```css
.editor-placeholder {
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
```

#### 3. query workspace

- 当前 `.query-workspace` 已有：
```css
.query-workspace {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  overflow: hidden;
}
```
- 保留该规则。

### 方案二：结果区内部使用三段式布局

#### 1. 结构目标

```text
result-table-shell
  result-status         固定高度
  table-data-toolbar    固定高度，仅 preview 有
  result-table-body     flex: 1，内部放 Ant Table
  result-pagination     固定高度，始终在底部
```

#### 2. 修改 `renderResultTable`

- 当前结构是：
```tsx
<div className="result-table-shell">
  {renderResultStatus(tab)}
  {renderTableToolbar(tab)}
  <Alert ... />
  <Table className="result-table" pagination={false} ... />
  <Flex className="result-pagination">...</Flex>
</div>
```
- 建议改为：
```tsx
<div className="result-table-shell">
  {renderResultStatus(tab)}
  {renderTableToolbar(tab)}
  {tab.error && <Alert ... />}
  {tab.result?.limited && <Alert ... />}
  <div className="result-table-body">
    <Table
      className="result-table"
      pagination={false}
      scroll={{ x: true, y: '100%' }}
      ...
    />
  </div>
  <Flex className="result-pagination">...</Flex>
</div>
```

#### 3. CSS

```css
.result-table-shell {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.result-table-body {
  flex: 1;
  min-height: 0;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.result-table {
  flex: 1;
  min-height: 0;
}

.result-table .ant-spin-nested-loading,
.result-table .ant-spin-container,
.result-table .ant-table,
.result-table .ant-table-container {
  height: 100%;
  min-height: 0;
}

.result-table .ant-spin-container,
.result-table .ant-table {
  display: flex;
  flex-direction: column;
}

.result-table .ant-table-container {
  flex: 1;
  display: flex;
  flex-direction: column;
}

.result-table .ant-table-body {
  flex: 1;
  min-height: 0;
  height: auto !important;
}

.result-pagination {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 8px;
  border-top: 1px solid var(--dj-border-default);
  background: var(--dj-bg-panel);
}
```

### 方案三：如果 `scroll.y: '100%'` 不稳定，使用 ResizeObserver

#### 1. 问题

- Ant Table 的 `scroll.y` 对字符串高度支持不如数字稳定。
- 即使外层高度正确，`scroll.y: '100%'` 也可能让 body 高度计算异常。

#### 2. 稳定方案

- 新增一个小组件或 hook，测量 `.result-table-body` 高度。
- 减去表头高度，得到 body 可滚动高度。
- 传数字给 `scroll.y`。

#### 3. 示例思路
```tsx
const [tableBodyHeight, setTableBodyHeight] = useState(360)
const tableBodyRef = useRef<HTMLDivElement | null>(null)

useEffect(() => {
  const element = tableBodyRef.current
  if (!element) return

  const observer = new ResizeObserver(([entry]) => {
    setTableBodyHeight(Math.max(160, entry.contentRect.height - 40))
  })

  observer.observe(element)
  return () => observer.disconnect()
}, [])
```

- Table：
```tsx
<div ref={tableBodyRef} className="result-table-body">
  <Table scroll={{ x: true, y: tableBodyHeight }} ... />
</div>
```

#### 4. 推荐优先级

- 第一阶段先补齐高度链路和三段式布局。
- 如果仍不沉底，再加 ResizeObserver。

### 分页语义保持

- 保持当前设计：分页控件不是前端页码，而是“查询条数选择器”。
- 默认 `limit=1000`。
- 选择 500 时重新请求后端 500 条。
- 选择 1000 时重新请求后端 1000 条。
- 不使用 Ant Table 内置分页。
- 外置分页组件可以保留，但建议 UI 文案更明确：
```text
查询条数：500 / 1000
```
- 如果 Ant Pagination 的页码概念容易误导，可以改为 `Segmented` 或 `Select`：
```tsx
<Select value={limit} options={[500, 1000].map((value) => ({ label: `${value} 条`, value }))} />
```
- 这会比 Pagination 更符合“查询条数切换”的语义。

### 实施步骤

1. 补齐 `.workspace-tabs .ant-tabs-content-holder` 的 `flex: 1; min-height: 0; overflow: hidden;`。
2. 补齐 `.workspace-tabs .ant-tabs-content` 的 `height: 100%; min-height: 0;`。
3. 补齐 `.workspace-tabs .ant-tabs-tabpane` 的 `height: 100%; min-height: 0;`。
4. 补齐 `.main-panel`、`.studio-shell`、`.editor-placeholder` 高度链路。
5. 在 `renderResultTable` 中新增 `.result-table-body` 包裹 Table。
6. 将 `.result-pagination` 保持在 `.result-table-shell` 最后一个子元素。
7. 调整 `.result-table-body`、`.result-table`、Ant Table 内部 CSS，让 body 区域 flex 占满剩余空间。
8. 保持 `pagination={false}`。
9. 继续使用外置查询条数控件；如果 Pagination 视觉上误导，则改为 Select/Segmented。
10. 运行 `npm run typecheck`。
11. 实际打开应用，用 1 条、20 条、1000 条数据分别验证分页栏是否沉底。

### 验收标准

- 表数据预览只有 1 行数据时，分页/查询条数行仍位于结果区域最底部。
- 查询结果只有 1 行数据时，分页/查询条数行仍位于结果区域最底部。
- 数据较多时，表格 body 内部滚动，分页/查询条数行保持固定在底部。
- 横向滚动条出现在表格 body 底部，不紧挨最后一行数据。
- 切换 500/1000 仍会重新请求后端，不变成前端分页。
- `npm run typecheck` 通过。

### 风险点

- Ant Table 内部 DOM 类名可能随版本变化，需要以当前 Ant Design 6 实际 DOM 为准微调选择器。
- `scroll.y: '100%'` 可能不稳定，必要时改用 ResizeObserver 计算数字高度。
- 如果父级 Splitter/TabPane 本身没有高度，CSS 需要继续向上补链路。
- 外置 Pagination 组件语义容易让用户误解为前端页码，建议最终改成 Select 或 Segmented 表达“查询条数”。

### 验证结果

- 高度链路已补齐：`.main-panel`、`.studio-shell`、`.editor-placeholder` 均已设置高度和 `min-height: 0`。
- Tabs 高度链路已补齐：`.workspace-tabs .ant-tabs-content-holder` 已设置 `flex: 1; min-height: 0; overflow: hidden;`，`.ant-tabs-content` 和 `.ant-tabs-tabpane` 已设置 `height: 100%; min-height: 0;`。
- 结果区结构已调整：`renderResultTable` 已新增 `.result-table-body` 包裹 `Table`，`.result-pagination` 保持为 `.result-table-shell` 最后一个子元素。
- 表格内部布局已调整：`.result-table-body`、`.result-table`、`.ant-spin-nested-loading`、`.ant-spin-container`、`.ant-table`、`.ant-table-container`、`.ant-table-body` 已按 flex/height 链路处理。
- Ant Table 内置分页已关闭：`pagination={false}`。
- 外置 Pagination 已改为 Select 查询条数控件，避免误解为前端分页页码。
- 查询条数语义保持：`changeTabLimit` 切换 500/1000 时仍会重新请求后端查询或预览接口。
- `npm run typecheck` 通过。
- 后端导入检查通过：`DataDjinn API 0.1.0`。

### 验证结论

- 方案已按代码层面实现，并通过基础校验。
- 是否完全沉底仍需要以实际界面验证为准；如果真实 UI 仍不沉底，下一步应启用 ResizeObserver 数字高度方案。
