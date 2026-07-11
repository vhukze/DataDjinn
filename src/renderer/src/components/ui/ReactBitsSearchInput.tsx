import { CloseOutlined, SearchOutlined } from '@ant-design/icons'
import { forwardRef } from 'react'
import type { KeyboardEvent } from 'react'
import './react-bits-search-input.css'

type ReactBitsSearchInputProps = {
  value: string
  onChange: (value: string) => void
  onClear: () => void
  onKeyDown?: (event: KeyboardEvent<HTMLInputElement>) => void
}

const ReactBitsSearchInput = forwardRef<HTMLInputElement, ReactBitsSearchInputProps>(
  function ReactBitsSearchInput({ value, onChange, onClear, onKeyDown }, ref) {
    return (
      <div className="rb-search-input-row">
        <SearchOutlined className="rb-search-input-icon" />
        <input
          ref={ref}
          className="rb-search-input"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={onKeyDown}
        />
        {value ? (
          <button type="button" className="rb-search-clear" onClick={onClear} aria-label="清空搜索">
            <CloseOutlined />
          </button>
        ) : null}
      </div>
    )
  }
)

export default ReactBitsSearchInput
