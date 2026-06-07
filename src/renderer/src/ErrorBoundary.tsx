import { Component, type ErrorInfo, type ReactNode } from 'react'
import { Button, Typography } from 'antd'

type ErrorBoundaryProps = {
  children: ReactNode
}

type ErrorBoundaryState = {
  error?: Error
}

class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = {}

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('Renderer crashed', error, info)
  }

  render(): ReactNode {
    if (!this.state.error) {
      return this.props.children
    }

    return (
      <div className="app-error-boundary">
        <div className="app-error-card">
          <Typography.Title level={4}>界面渲染异常</Typography.Title>
          <Typography.Paragraph type="secondary">
            当前页面遇到运行时错误，已阻止继续白屏。可以先刷新界面恢复，错误信息如下：
          </Typography.Paragraph>
          <pre>{this.state.error.message}</pre>
          <Button type="primary" onClick={() => window.location.reload()}>刷新界面</Button>
        </div>
      </div>
    )
  }
}

export default ErrorBoundary
