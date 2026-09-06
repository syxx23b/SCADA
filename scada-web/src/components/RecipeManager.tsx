import { useState, useMemo } from 'react'
import './Recipe.css'

interface RecipeFile {
  id: string
  name: string
  type: 'DJ' | 'QYJ'
  createdAt: string
  updatedAt: string
}

interface RecipeManagerProps {
  recipeFiles: RecipeFile[]
  onLoadRecipe: (fileId: string) => void
  onDeleteRecipe: (fileId: string) => void
  activeType?: 'DJ' | 'QYJ' | 'all'
}

export function RecipeManager({
  recipeFiles,
  onLoadRecipe,
  onDeleteRecipe,
  activeType = 'all',
}: RecipeManagerProps) {
  const [selectedFileId, setSelectedFileId] = useState<string>('')
  const [deletingId, setDeletingId] = useState<string | null>(null)

  // 根据类型筛选文件
  const filteredFiles = useMemo(() => {
    if (activeType === 'all') return recipeFiles
    return recipeFiles.filter((file) => file.type === activeType)
  }, [recipeFiles, activeType])

  // 获取当前选中的文件
  const selectedFile = useMemo(() => {
    return filteredFiles.find((file) => file.id === selectedFileId)
  }, [filteredFiles, selectedFileId])

  const handleLoad = () => {
    if (selectedFileId) {
      onLoadRecipe(selectedFileId)
    }
  }

  const handleDelete = () => {
    if (selectedFileId && window.confirm(`确定要删除配方文件 "${selectedFile?.name}" 吗？`)) {
      setDeletingId(selectedFileId)
      onDeleteRecipe(selectedFileId)
      setSelectedFileId('')
      setDeletingId(null)
    }
  }

  const handleFileClick = (fileId: string) => {
    setSelectedFileId(fileId)
  }

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr)
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
  }

  const getTypeLabel = (type: 'DJ' | 'QYJ') => {
    return type === 'DJ' ? '电机泵' : '汽油机'
  }

  return (
    <div className="recipe-container">
      <div className="recipe-sheet-head">
        <div className="recipe-sheet-head-main">
          <h3 className="recipe-sheet-title">配方文件管理</h3>
          <p className="recipe-sheet-subtitle">
            共 <strong>{filteredFiles.length}</strong> 个配方文件
            {activeType !== 'all' && `（${getTypeLabel(activeType)}类型）`}
          </p>
        </div>
        <div className="recipe-sheet-actions">
          <select
            className="recipe-file-select"
            value={selectedFileId}
            onChange={(e) => setSelectedFileId(e.target.value)}
            aria-label="选择配方文件"
          >
            <option value="">-- 选择配方文件 --</option>
            {filteredFiles.map((file) => (
              <option key={file.id} value={file.id}>
                {file.name} ({getTypeLabel(file.type)})
              </option>
            ))}
          </select>
          <button
            type="button"
            className="recipe-btn recipe-btn-load"
            onClick={handleLoad}
            disabled={!selectedFileId}
          >
            加载
          </button>
          <button
            type="button"
            className="recipe-btn recipe-btn-delete"
            onClick={handleDelete}
            disabled={!selectedFileId || deletingId === selectedFileId}
          >
            {deletingId === selectedFileId ? '删除中...' : '删除'}
          </button>
        </div>
      </div>

      <div className="recipe-manager-card">
        <div className="recipe-manager-header">
          <h3>配方文件列表</h3>
          <p>点击选择配方文件，然后点击"加载"或"删除"按钮</p>
        </div>

        <div className="recipe-file-list">
          {filteredFiles.length === 0 ? (
            <div className="recipe-empty-files">
              暂无配方文件
            </div>
          ) : (
            filteredFiles.map((file) => (
              <div
                key={file.id}
                className={`recipe-file-item ${selectedFileId === file.id ? 'selected' : ''}`}
                onClick={() => handleFileClick(file.id)}
              >
                <div className="recipe-file-info">
                  <span className="recipe-file-name">{file.name}</span>
                  <span className="recipe-file-meta">
                    {getTypeLabel(file.type)} · 更新于 {formatDate(file.updatedAt)}
                  </span>
                </div>
                <div className="recipe-file-actions">
                  <button
                    type="button"
                    className="recipe-file-btn recipe-file-btn-load"
                    onClick={(e) => {
                      e.stopPropagation()
                      onLoadRecipe(file.id)
                    }}
                  >
                    加载
                  </button>
                  <button
                    type="button"
                    className="recipe-file-btn recipe-file-btn-delete"
                    onClick={(e) => {
                      e.stopPropagation()
                      if (window.confirm(`确定要删除配方文件 "${file.name}" 吗？`)) {
                        setDeletingId(file.id)
                        onDeleteRecipe(file.id)
                        if (selectedFileId === file.id) {
                          setSelectedFileId('')
                        }
                        setDeletingId(null)
                      }
                    }}
                    disabled={deletingId === file.id}
                  >
                    {deletingId === file.id ? '...' : '删除'}
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
