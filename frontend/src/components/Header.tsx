import React, { useState, useEffect, useRef, useCallback } from 'react'
import {
  Save,
  FolderOpen,
  Cpu,
  RefreshCw,
  AlertCircle,
  Video,
  Plus,
  HardDrive,
  UploadCloud,
  FileVideo,
  X,
  Clock,
  Film,
  Folder,
  Loader2,
  Layers
} from 'lucide-react'
import { useProjectStore } from '../stores/projectStore'
import { useCueStore } from '../stores/cueStore'
import { ModelHubModal } from './ModelHubModal'

interface RecentProject {
  projectId: string
  name: string
  updatedAt: string
  cueCount: number
  currentStep: number
  videoName: string
  duration: number
}

export const Header: React.FC = () => {
  const {
    project,
    backendConnected,
    gpuInfo,
    isSaving,
    lastSavedAt,
    saveProject,
    checkHealth,
    setProject
  } = useProjectStore()

  const { cues, setCues } = useCueStore()

  const [showModal, setShowModal] = useState(false)
  const [modalMode, setModalMode] = useState<'create' | 'load'>('create')
  const [showModelHub, setShowModelHub] = useState(false)
  
  // Create project form state
  const [inputName, setInputName] = useState('')
  const [inputPath, setInputPath] = useState('')
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [selectedNativePath, setSelectedNativePath] = useState<string>('')
  const [selectedFileName, setSelectedFileName] = useState<string>('')
  const [selectedFileSizeMb, setSelectedFileSizeMb] = useState<number | null>(null)
  const [isBrowsingNative, setIsBrowsingNative] = useState(false)
  const [showManualPath, setShowManualPath] = useState(false)
  const [isDragging, setIsDragging] = useState(false)

  // Load project state
  const [loadProjectId, setLoadProjectId] = useState('')
  const [recentProjects, setRecentProjects] = useState<RecentProject[]>([])
  const [isLoadingProjects, setIsLoadingProjects] = useState(false)

  const [modalError, setModalError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  const fileInputRef = useRef<HTMLInputElement | null>(null)

  // Auto check backend connection on mount and every 10s
  useEffect(() => {
    checkHealth()
    const timer = setInterval(() => {
      checkHealth()
    }, 10000)
    return () => clearInterval(timer)
  }, [checkHealth])

  // Fetch recent projects when opening modal or switching to load tab
  const fetchRecentProjects = useCallback(async () => {
    setIsLoadingProjects(true)
    try {
      const res = await fetch('/api/project/list')
      if (res.ok) {
        const data = await res.json()
        setRecentProjects(data.projects || [])
      }
    } catch {
      // Ignore network errors on background list fetch
    } finally {
      setIsLoadingProjects(false)
    }
  }, [])

  useEffect(() => {
    if (showModal && modalMode === 'load') {
      void fetchRecentProjects()
    }
  }, [showModal, modalMode, fetchRecentProjects])

  const handleSave = async () => {
    if (!project) return
    useProjectStore.setState({
      project: {
        ...project,
        cues,
        updatedAt: new Date().toISOString()
      }
    })
    await saveProject()
  }

  // Open native Windows File Explorer dialog via Python backend
  const handleBrowseNativeFile = async () => {
    setIsBrowsingNative(true)
    setModalError(null)
    try {
      const res = await fetch('/api/system/browse-file', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'Chọn tệp Video gốc để lồng tiếng', file_type: 'video' })
      })
      if (!res.ok) throw new Error(`Lỗi máy chủ: HTTP ${res.status}`)
      const data = await res.json()
      if (!data.cancelled && data.filePath) {
        setSelectedNativePath(data.filePath)
        setSelectedFile(null)
        setSelectedFileName(data.fileName)
        setSelectedFileSizeMb(data.fileSizeMb || null)
        setInputPath(data.filePath)
        // Auto fill project name if empty
        if (!inputName.trim()) {
          const autoName = data.fileName.replace(/\.[^/.]+$/, '').replace(/[\s_]+/g, '-')
          setInputName(autoName)
        }
      }
    } catch (err: unknown) {
      setModalError(err instanceof Error ? err.message : 'Không thể mở hộp thoại chọn tệp.')
    } finally {
      setIsBrowsingNative(false)
    }
  }

  // Browse existing project folder via native Windows dialog
  const handleBrowseNativeFolder = async () => {
    setIsBrowsingNative(true)
    setModalError(null)
    try {
      const res = await fetch('/api/system/browse-folder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'Chọn thư mục dự án' })
      })
      if (!res.ok) throw new Error(`Lỗi máy chủ: HTTP ${res.status}`)
      const data = await res.json()
      if (!data.cancelled && data.folderName) {
        setLoadProjectId(data.folderName)
      }
    } catch (err: unknown) {
      setModalError(err instanceof Error ? err.message : 'Không thể mở hộp thoại chọn thư mục.')
    } finally {
      setIsBrowsingNative(false)
    }
  }

  // Handle HTML5 file input change
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      setSelectedFile(file)
      setSelectedNativePath('')
      setSelectedFileName(file.name)
      setSelectedFileSizeMb(+(file.size / (1024 * 1024)).toFixed(2))
      setInputPath('')
      // Auto fill project name
      if (!inputName.trim()) {
        const autoName = file.name.replace(/\.[^/.]+$/, '').replace(/[\s_]+/g, '-')
        setInputName(autoName)
      }
    }
  }

  // Drag and drop handlers
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(true)
  }

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
    const file = e.dataTransfer.files?.[0]
    if (file && file.type.startsWith('video/')) {
      setSelectedFile(file)
      setSelectedNativePath('')
      setSelectedFileName(file.name)
      setSelectedFileSizeMb(+(file.size / (1024 * 1024)).toFixed(2))
      setInputPath('')
      if (!inputName.trim()) {
        const autoName = file.name.replace(/\.[^/.]+$/, '').replace(/[\s_]+/g, '-')
        setInputName(autoName)
      }
    } else if (file) {
      setModalError('Vui lòng chọn một tệp video hợp lệ (.mp4, .mkv, .mov, .webm...).')
    }
  }

  const handleClearSelectedVideo = () => {
    setSelectedFile(null)
    setSelectedNativePath('')
    setSelectedFileName('')
    setSelectedFileSizeMb(null)
    setInputPath('')
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const handleCreateProject = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!inputName.trim()) {
      setModalError('Vui lòng nhập tên dự án.')
      return
    }
    setIsSubmitting(true)
    setModalError(null)

    try {
      const formData = new FormData()
      formData.append('name', inputName.trim())

      if (selectedFile) {
        formData.append('file', selectedFile)
      } else if (selectedNativePath || inputPath.trim()) {
        formData.append('existing_path', selectedNativePath || inputPath.trim())
      }

      const res = await fetch('/api/project/create', {
        method: 'POST',
        body: formData
      })

      if (!res.ok) {
        const errJson = await res.json().catch(() => null)
        const errMsg = errJson?.detail || `HTTP ${res.status}`
        throw new Error(`Tạo dự án thất bại: ${errMsg}`)
      }

      const data = await res.json()
      if (data.project) {
        setProject(data.project)
        setCues(data.project.cues || [])
        setShowModal(false)
        handleClearSelectedVideo()
        setInputName('')
      } else {
        throw new Error('Dữ liệu trả về không đúng định dạng.')
      }
    } catch (err: unknown) {
      setModalError(err instanceof Error ? err.message : 'Lỗi khi tạo dự án.')
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleOpenSpecificProject = async (projectId: string) => {
    setIsSubmitting(true)
    setModalError(null)
    try {
      const res = await fetch(`/api/project/load?projectId=${encodeURIComponent(projectId.trim())}`)
      if (!res.ok) {
        throw new Error(`Không tìm thấy dự án: HTTP ${res.status}`)
      }
      const data = await res.json()
      setProject(data)
      setCues(data.cues || [])
      setShowModal(false)
    } catch (err: unknown) {
      setModalError(err instanceof Error ? err.message : 'Lỗi khi tải dự án.')
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleLoadProjectSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!loadProjectId.trim()) {
      setModalError('Vui lòng nhập hoặc chọn mã dự án.')
      return
    }
    handleOpenSpecificProject(loadProjectId.trim())
  }

  return (
    <>
      <header className="h-14 bg-slate-900/90 border-b border-slate-800 flex items-center justify-between px-4 select-none shrink-0 z-20 backdrop-blur">
        {/* Left: App Logo & Project Info */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-indigo-600 flex items-center justify-center text-white shadow-md shadow-indigo-500/20">
              <Video className="w-4 h-4" />
            </div>
            <span className="font-bold text-slate-100 text-sm tracking-wide hidden sm:inline">
              VideoDubbing <span className="text-indigo-400 font-semibold">Studio</span>
            </span>
          </div>

          <div className="h-5 w-px bg-slate-800 mx-1 hidden sm:block" />

          {project ? (
            <div className="flex items-center gap-2">
              <span className="font-medium text-slate-200 text-sm max-w-[200px] truncate" title={project.name}>
                {project.name}
              </span>
              <span className="text-xs bg-slate-800 text-slate-400 px-2 py-0.5 rounded font-mono">
                {project.projectId}
              </span>
            </div>
          ) : (
            <span className="text-xs text-slate-400 italic">Chưa mở dự án</span>
          )}
        </div>

        {/* Center: GPU & Backend Status */}
        <div className="flex items-center gap-3">
          <div
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs border ${
              backendConnected
                ? 'bg-emerald-950/40 border-emerald-800/60 text-emerald-300'
                : 'bg-rose-950/40 border-rose-800/60 text-rose-300'
            }`}
          >
            <span
              className={`w-2 h-2 rounded-full ${
                backendConnected ? 'bg-emerald-400 animate-pulse' : 'bg-rose-500'
              }`}
            />
            <span className="font-medium">
              {backendConnected ? 'Backend: 8765' : 'Mất kết nối Server'}
            </span>
            {!backendConnected && (
              <button
                onClick={() => checkHealth()}
                className="hover:text-white transition-colors p-0.5"
                title="Thử kết nối lại"
              >
                <RefreshCw className="w-3 h-3" />
              </button>
            )}
          </div>

          {gpuInfo && (
            <div
              className="hidden md:flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs bg-slate-800/80 border border-slate-700/80 text-slate-300"
              title={`${gpuInfo.device_name} (VRAM: ${gpuInfo.free_vram_mb}MB trống / ${gpuInfo.total_vram_mb}MB)`}
            >
              <Cpu className="w-3.5 h-3.5 text-indigo-400" />
              <span>GTX 1060</span>
              <span className="text-slate-500">|</span>
              <span className="text-indigo-300 font-mono">
                {gpuInfo.free_vram_mb}MB VRAM
              </span>
            </div>
          )}
        </div>

        {/* Right: Project Actions & Model Hub */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowModelHub(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-gradient-to-r from-violet-600/25 to-indigo-600/25 hover:from-violet-600/35 hover:to-indigo-600/35 active:scale-95 text-indigo-200 rounded text-xs font-medium border border-indigo-500/40 transition shadow-sm"
            title="Quản lý & Tải mô hình AI Offline (1-Click)"
          >
            <Layers className="w-3.5 h-3.5 text-indigo-400" />
            <span className="font-semibold">Model Hub</span>
          </button>

          <button
            onClick={() => {
              setModalMode('create')
              setShowModal(true)
            }}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 active:bg-slate-600 text-slate-200 rounded text-xs font-medium border border-slate-700 transition"
          >
            <FolderOpen className="w-3.5 h-3.5 text-slate-400" />
            <span>Mở / Tạo Dự án</span>
          </button>

          {project && (
            <button
              onClick={handleSave}
              disabled={isSaving}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 active:bg-indigo-700 disabled:opacity-50 text-white rounded text-xs font-medium shadow transition"
              title={lastSavedAt ? `Đã lưu lúc: ${new Date(lastSavedAt).toLocaleTimeString()}` : 'Lưu dự án'}
            >
              <Save className={`w-3.5 h-3.5 ${isSaving ? 'animate-spin' : ''}`} />
              <span>{isSaving ? 'Đang lưu...' : 'Lưu dự án'}</span>
            </button>
          )}
        </div>
      </header>

      {/* Project Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4 backdrop-blur-xs">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-xl shadow-2xl p-6 text-slate-200 animate-in fade-in zoom-in-95 duration-150">
            {/* Modal Header Tabs */}
            <div className="flex items-center justify-between border-b border-slate-800 pb-3 mb-5">
              <div className="flex gap-4">
                <button
                  type="button"
                  onClick={() => setModalMode('create')}
                  className={`text-sm font-semibold pb-2 border-b-2 transition flex items-center gap-2 ${
                    modalMode === 'create'
                      ? 'border-indigo-500 text-indigo-400'
                      : 'border-transparent text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <Plus className="w-4 h-4" />
                  <span>Tạo Dự án Mới</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setModalMode('load')
                    fetchRecentProjects()
                  }}
                  className={`text-sm font-semibold pb-2 border-b-2 transition flex items-center gap-2 ${
                    modalMode === 'load'
                      ? 'border-indigo-500 text-indigo-400'
                      : 'border-transparent text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <FolderOpen className="w-4 h-4" />
                  <span>Mở Dự án Cũ</span>
                </button>
              </div>

              <button
                onClick={() => setShowModal(false)}
                className="text-slate-500 hover:text-slate-300 p-1 rounded-lg transition"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Error Message Box */}
            {modalError && (
              <div className="mb-4 p-3 bg-rose-950/60 border border-rose-800/80 rounded-xl text-rose-300 text-xs flex items-start gap-2.5">
                <AlertCircle className="w-4 h-4 shrink-0 text-rose-400 mt-0.5" />
                <span className="leading-relaxed">{modalError}</span>
              </div>
            )}

            {/* TAB 1: CREATE PROJECT */}
            {modalMode === 'create' ? (
              <form onSubmit={handleCreateProject} className="space-y-4">
                {/* Project Name */}
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1.5">
                    Tên Dự án <span className="text-rose-400">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={inputName}
                    onChange={(e) => setInputName(e.target.value)}
                    placeholder="Ví dụ: Bai-Giang-Tri-Tue-Nhan-Tao"
                    className="w-full bg-slate-950 border border-slate-700/80 rounded-lg px-3.5 py-2.5 text-sm text-slate-100 placeholder:text-slate-600 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition"
                  />
                </div>

                {/* Video Picker Section */}
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="text-xs font-medium text-slate-300">
                      Tệp Video Gốc (Nguồn lồng tiếng)
                    </label>
                    <button
                      type="button"
                      onClick={() => setShowManualPath(!showManualPath)}
                      className="text-[11px] text-slate-400 hover:text-indigo-400 transition"
                    >
                      {showManualPath ? 'Ẩn đường dẫn thủ công' : 'Nhập đường dẫn tay'}
                    </button>
                  </div>

                  {/* Hidden file input */}
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="video/mp4,video/mkv,video/mov,video/avi,video/webm,video/quicktime,video/*"
                    onChange={handleFileChange}
                    className="hidden"
                  />

                  {/* Selected Video Card Preview */}
                  {selectedFileName ? (
                    <div className="p-3.5 bg-indigo-950/30 border border-indigo-700/60 rounded-xl flex items-center justify-between gap-3">
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="w-10 h-10 rounded-lg bg-indigo-600/20 text-indigo-400 flex items-center justify-center shrink-0 border border-indigo-500/30">
                          <FileVideo className="w-5 h-5" />
                        </div>
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-slate-100 truncate" title={selectedFileName}>
                            {selectedFileName}
                          </p>
                          <p className="text-xs text-indigo-300/80 flex items-center gap-2 mt-0.5">
                            {selectedFileSizeMb ? <span>{selectedFileSizeMb} MB</span> : null}
                            {selectedNativePath ? (
                              <span className="text-[11px] text-slate-400 font-mono truncate max-w-[260px]" title={selectedNativePath}>
                                • {selectedNativePath}
                              </span>
                            ) : (
                              <span className="text-[11px] text-emerald-400 font-medium">• Đã sẵn sàng tải lên</span>
                            )}
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center gap-1.5 shrink-0">
                        <button
                          type="button"
                          onClick={handleBrowseNativeFile}
                          disabled={isBrowsingNative}
                          className="px-2.5 py-1.5 text-xs text-slate-300 hover:text-white bg-slate-800 hover:bg-slate-700 rounded-lg transition"
                        >
                          Đổi tệp
                        </button>
                        <button
                          type="button"
                          onClick={handleClearSelectedVideo}
                          className="p-1.5 text-slate-400 hover:text-rose-400 hover:bg-rose-950/40 rounded-lg transition"
                          title="Bỏ chọn video"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  ) : (
                    /* Dropzone & Browse Buttons */
                    <div className="space-y-2.5">
                      {/* Big Native Browse Button */}
                      <button
                        type="button"
                        onClick={handleBrowseNativeFile}
                        disabled={isBrowsingNative}
                        className="w-full flex items-center justify-center gap-2.5 py-3 px-4 bg-gradient-to-r from-indigo-900/60 to-purple-900/60 hover:from-indigo-800/80 hover:to-purple-800/80 active:scale-[0.99] border border-indigo-700/60 hover:border-indigo-500 rounded-xl text-sm font-semibold text-indigo-100 shadow-md shadow-indigo-950/50 transition cursor-pointer"
                      >
                        {isBrowsingNative ? (
                          <>
                            <Loader2 className="w-4 h-4 animate-spin text-indigo-400" />
                            <span>Đang mở File Explorer từ máy tính...</span>
                          </>
                        ) : (
                          <>
                            <HardDrive className="w-4 h-4 text-indigo-400" />
                            <span>Duyệt tệp từ máy tính (Mở File Explorer)</span>
                          </>
                        )}
                      </button>

                      {/* Drag & Drop HTML5 Zone */}
                      <div
                        onDragOver={handleDragOver}
                        onDragLeave={handleDragLeave}
                        onDrop={handleDrop}
                        onClick={() => fileInputRef.current?.click()}
                        className={`border-2 border-dashed rounded-xl p-5 text-center transition cursor-pointer flex flex-col items-center justify-center ${
                          isDragging
                            ? 'border-indigo-400 bg-indigo-950/40 scale-[1.01]'
                            : 'border-slate-800 hover:border-slate-600 bg-slate-950/60 hover:bg-slate-950'
                        }`}
                      >
                        <UploadCloud className="w-8 h-8 mb-2 text-slate-500" />
                        <p className="text-xs font-medium text-slate-300">
                          Kéo thả tệp video vào đây hoặc <span className="text-indigo-400 underline">bấm để tải lên</span>
                        </p>
                        <p className="text-[11px] text-slate-500 mt-1">
                          Hỗ trợ: MP4, MKV, MOV, WebM, AVI, TS
                        </p>
                      </div>
                    </div>
                  )}

                  {/* Manual Path Input (Optional accordion) */}
                  {showManualPath && (
                    <div className="mt-3 p-3 bg-slate-950 border border-slate-800 rounded-xl space-y-1.5">
                      <label className="text-[11px] font-medium text-slate-400">
                        Đường dẫn tuyệt đối trên ổ đĩa:
                      </label>
                      <input
                        type="text"
                        value={inputPath}
                        onChange={(e) => {
                          setInputPath(e.target.value)
                          setSelectedNativePath(e.target.value)
                        }}
                        placeholder="D:/Videos/my_lecture.mp4"
                        className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-slate-200 font-mono focus:outline-none focus:border-indigo-500"
                      />
                    </div>
                  )}

                  <p className="text-[11px] text-slate-500 mt-2">
                    * Bạn có thể tạo dự án rỗng trước và thêm video vào thư mục dự án sau.
                  </p>
                </div>

                {/* Form Actions */}
                <div className="flex justify-end gap-2.5 pt-3 border-t border-slate-800">
                  <button
                    type="button"
                    onClick={() => setShowModal(false)}
                    className="px-4 py-2 text-xs font-medium text-slate-400 hover:text-slate-200 rounded-lg transition"
                  >
                    Hủy bỏ
                  </button>
                  <button
                    type="submit"
                    disabled={isSubmitting || !inputName.trim()}
                    className="px-5 py-2 bg-indigo-600 hover:bg-indigo-500 active:bg-indigo-700 disabled:opacity-50 text-white rounded-lg text-xs font-semibold flex items-center gap-2 shadow-lg shadow-indigo-600/30 transition cursor-pointer"
                  >
                    {isSubmitting ? (
                      <>
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        <span>Đang xử lý tạo dự án...</span>
                      </>
                    ) : (
                      <>
                        <Plus className="w-3.5 h-3.5" />
                        <span>Tạo Dự Án</span>
                      </>
                    )}
                  </button>
                </div>
              </form>
            ) : (
              /* TAB 2: LOAD EXISTING PROJECT */
              <div className="space-y-4">
                {/* Header with Browse Folder */}
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-slate-300">
                    Danh sách dự án gần đây trong hệ thống:
                  </span>
                  <button
                    type="button"
                    onClick={handleBrowseNativeFolder}
                    disabled={isBrowsingNative}
                    className="flex items-center gap-1.5 px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-indigo-300 border border-slate-700 rounded-lg text-xs transition"
                  >
                    <Folder className="w-3.5 h-3.5 text-indigo-400" />
                    <span>Duyệt thư mục trên máy...</span>
                  </button>
                </div>

                {/* Project List View */}
                {isLoadingProjects ? (
                  <div className="py-8 text-center text-slate-500 text-xs flex items-center justify-center gap-2">
                    <Loader2 className="w-4 h-4 animate-spin text-indigo-400" />
                    <span>Đang tải danh sách dự án...</span>
                  </div>
                ) : recentProjects.length === 0 ? (
                  <div className="py-8 text-center text-slate-500 text-xs border border-dashed border-slate-800 rounded-xl">
                    Chưa có dự án nào được tạo. Hãy bấm tab &quot;Tạo Dự án Mới&quot; ở trên.
                  </div>
                ) : (
                  <div className="max-h-60 overflow-y-auto space-y-2 pr-1 custom-scrollbar">
                    {recentProjects.map((p) => (
                      <div
                        key={p.projectId}
                        onClick={() => handleOpenSpecificProject(p.projectId)}
                        className="p-3 bg-slate-950/80 hover:bg-indigo-950/40 border border-slate-800 hover:border-indigo-600/50 rounded-xl flex items-center justify-between gap-3 transition cursor-pointer group"
                      >
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-slate-100 group-hover:text-indigo-300 transition truncate">
                            {p.name}
                          </p>
                          <div className="flex items-center gap-3 text-[11px] text-slate-400 mt-1">
                            <span className="font-mono text-slate-500">{p.projectId}</span>
                            <span>•</span>
                            <span className="flex items-center gap-1">
                              <Film className="w-3 h-3 text-slate-500" />
                              {p.cueCount} câu thoại
                            </span>
                            {p.updatedAt ? (
                              <>
                                <span>•</span>
                                <span className="flex items-center gap-1 text-slate-500">
                                  <Clock className="w-3 h-3" />
                                  {new Date(p.updatedAt).toLocaleDateString()}
                                </span>
                              </>
                            ) : null}
                          </div>
                        </div>

                        <button
                          type="button"
                          className="px-3 py-1.5 bg-slate-800 group-hover:bg-indigo-600 text-slate-300 group-hover:text-white rounded-lg text-xs font-medium transition shrink-0"
                        >
                          Mở
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                {/* Direct ID Input Form */}
                <form onSubmit={handleLoadProjectSubmit} className="pt-3 border-t border-slate-800 space-y-3">
                  <div>
                    <label className="block text-xs font-medium text-slate-400 mb-1">
                      Hoặc nhập trực tiếp mã dự án (Project ID):
                    </label>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={loadProjectId}
                        onChange={(e) => setLoadProjectId(e.target.value)}
                        placeholder="prj_20261117_175608"
                        className="flex-1 bg-slate-950 border border-slate-700/80 rounded-lg px-3 py-2 text-sm text-slate-100 font-mono focus:outline-none focus:border-indigo-500"
                      />
                      <button
                        type="submit"
                        disabled={isSubmitting || !loadProjectId.trim()}
                        className="px-4 py-2 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-slate-200 rounded-lg text-xs font-semibold transition"
                      >
                        {isSubmitting ? 'Đang mở...' : 'Mở'}
                      </button>
                    </div>
                  </div>

                  <div className="flex justify-end pt-2">
                    <button
                      type="button"
                      onClick={() => setShowModal(false)}
                      className="px-4 py-2 text-xs font-medium text-slate-400 hover:text-slate-200 rounded-lg transition"
                    >
                      Đóng
                    </button>
                  </div>
                </form>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Model Hub Modal (Zero-Config) */}
      <ModelHubModal
        isOpen={showModelHub}
        onClose={() => setShowModelHub(false)}
      />
    </>
  )
}
