<script>
  import { getContext } from "svelte"

  export let field
  export let label = "Attachments"
  export let disabled = false
  export let compact = false
  export let extensions = "*"
  export let onChange
  export let maximum = 1
  export let helpText = null
  export let defaultValue = []
  export let validation = null

  // Compression Properties
  export let maxWidth = 2000
  export let maxHeight = 2000
  export let webpQuality = 85
  export let minSizeToCompress = 500
  export let enableAnnotation = false

  let isEditing = false
  let capturedBlob = null
  let capturedImageUrl = null
  let arrows = [] // { id, x, y, angle, scale }
  let selectedArrowId = null
  let isInteracting = false
  let interactMode = "drag" // "drag", "rotate", "scale", "pan"
  let initialMousePos = { x: 0, y: 0 }
  let initialArrowState = {}

  let bgX = 0
  let bgY = 0
  let bgScale = 1
  let initialBgState = { x: 0, y: 0 }
  let imageRatio = 1

  // Budibase Contexts
  const sdk = getContext("sdk")
  const API = sdk?.API
  const styleable = sdk?.styleable
  const component = getContext("component")
  const formContext = getContext("form")

  // Stable state managers
  let fieldState
  let fieldApi
  let unsubscribe

  // Access the Form API from context (matching bb-type-ahead's method)
  const formApi = formContext?.formApi

  // Register the field with the Budibase Form manually (more stable than reactive blocks)
  $: if (formApi && field && !unsubscribe) {
    const formField = formApi.registerField(
      field,
      maximum === 1 ? "attachment" : "attachments",
      defaultValue,
      disabled,
      validation
    )
    if (formField && typeof formField.subscribe === "function") {
      unsubscribe = formField.subscribe(value => {
        fieldState = value?.fieldState
        fieldApi = value?.fieldApi
        // Only update local files if we are not currently uploading
        if (!uploading && fieldState?.value) {
          files = Array.isArray(fieldState.value)
            ? fieldState.value
            : [fieldState.value]
        }
      })
    }
  }

  // Cleanup on destroy
  import { onDestroy } from "svelte"
  onDestroy(() => {
    if (unsubscribe) unsubscribe()
    if (fieldApi?.deregister) fieldApi.deregister()
    if (capturedImageUrl) URL.revokeObjectURL(capturedImageUrl)
  })

  const BYTES_IN_KB = 1000

  let fileInput
  let isDragging = false
  let files = defaultValue || []
  let uploading = false

  /**
   * NO OP: Removing custom camera methods as we are going back to native capture.
   */

  /**
   * ARROW EDITOR METHODS
   */
  const addArrow = () => {
    const id = Date.now()
    // Reduced default size by 20% (1.0 -> 0.8)
    arrows = [...arrows, { id, x: 50, y: 50, angle: 0, scale: 0.8 }]
    selectedArrowId = id
  }

  const deleteArrow = () => {
    if (selectedArrowId) {
      arrows = arrows.filter(a => a.id !== selectedArrowId)
      selectedArrowId = null
    }
  }

  const handlePointerDown = (e, arrow, mode) => {
    e.stopPropagation()
    selectedArrowId = arrow.id
    interactMode = mode
    isInteracting = true
    initialMousePos = { x: e.clientX, y: e.clientY }
    initialArrowState = { ...arrow }
  }

  const handlePointerMove = e => {
    if (!isInteracting) return
    const dx = e.clientX - initialMousePos.x
    const dy = e.clientY - initialMousePos.y

    const container = document.querySelector(".editor-canvas-container")
    const editorRect = container?.getBoundingClientRect()
    if (!editorRect) return

    if (interactMode === "pan") {
      // Limit panning so image never reveals black margins
      const maxX = (editorRect.width * (bgScale - 1)) / 2
      const maxY = (editorRect.height * (bgScale - 1)) / 2

      bgX = Math.max(-maxX, Math.min(maxX, initialBgState.x + dx))
      bgY = Math.max(-maxY, Math.min(maxY, initialBgState.y + dy))
      return
    }

    const arrow = arrows.find(a => a.id === selectedArrowId)
    if (!arrow) return

    if (interactMode === "drag") {
      const pxChange = (dx / editorRect.width) * 100
      const pyChange = (dy / editorRect.height) * 100
      arrow.x = initialArrowState.x + pxChange
      arrow.y = initialArrowState.y + pyChange
    } else if (interactMode === "rotate") {
      const centerX = editorRect.left + (arrow.x / 100) * editorRect.width
      const centerY = editorRect.top + (arrow.y / 100) * editorRect.height
      const angle = Math.atan2(e.clientY - centerY, e.clientX - centerX)
      arrow.angle = angle * (180 / Math.PI)
    } else if (interactMode === "scale") {
      const centerX = editorRect.left + (arrow.x / 100) * editorRect.width
      const centerY = editorRect.top + (arrow.y / 100) * editorRect.height

      const currentDist = Math.sqrt(
        Math.pow(e.clientX - centerX, 2) + Math.pow(e.clientY - centerY, 2)
      )
      const initialDist = Math.sqrt(
        Math.pow(initialMousePos.x - centerX, 2) +
          Math.pow(initialMousePos.y - centerY, 2)
      )

      if (initialDist > 0) {
        arrow.scale = Math.max(
          0.2,
          initialArrowState.scale * (currentDist / initialDist)
        )
      }
    }

    arrows = [...arrows]
  }

  const handlePointerUp = () => {
    isInteracting = false
  }

  const finishEditing = async () => {
    // 1. Capture all necessary DOM info and state immediately
    const editorContainer = document.querySelector(".editor-canvas-container")
    if (!editorContainer) return
    const containerRect = editorContainer.getBoundingClientRect()

    // 2. Capture state snapshots for background processing
    const snapshot = {
      bgX,
      bgY,
      bgScale,
      imageRatio,
      arrows: [...arrows],
      imageUrl: capturedImageUrl,
    }

    // 3. Immediate UI feedback: Close overlay and show spinner
    uploading = true
    isEditing = false

    // 4. Background Processing: Load image and draw to canvas
    const img = new Image()
    img.src = snapshot.imageUrl
    await new Promise(r => {
      img.onload = r
      img.onerror = r
    })

    const canvas = document.createElement("canvas")
    if (snapshot.imageRatio > 1) {
      canvas.width = Math.min(img.width, maxWidth)
      canvas.height = canvas.width / snapshot.imageRatio
    } else {
      canvas.height = Math.min(img.height, maxHeight)
      canvas.width = canvas.height * snapshot.imageRatio
    }

    const ctx = canvas.getContext("2d")
    ctx.clearRect(0, 0, canvas.width, canvas.height)

    const scaleFactorX = canvas.width / containerRect.width
    const scaleFactorY = canvas.height / containerRect.height

    ctx.save()
    ctx.translate(
      canvas.width / 2 + snapshot.bgX * scaleFactorX,
      canvas.height / 2 + snapshot.bgY * scaleFactorY
    )

    const imgRatio = img.width / img.height
    const canvasRatio = canvas.width / canvas.height
    let drawW, drawH
    if (imgRatio > canvasRatio) {
      drawW = canvas.width
      drawH = canvas.width / imgRatio
    } else {
      drawH = canvas.height
      drawW = canvas.height * imgRatio
    }

    ctx.scale(snapshot.bgScale, snapshot.bgScale)
    ctx.drawImage(img, -drawW / 2, -drawH / 2, drawW, drawH)
    ctx.restore()

    // Draw arrows from snapshot
    snapshot.arrows.forEach(arrow => {
      const canvasX = (arrow.x / 100) * canvas.width
      const canvasY = (arrow.y / 100) * canvas.height

      ctx.save()
      ctx.translate(canvasX, canvasY)
      ctx.rotate((arrow.angle * Math.PI) / 180)

      const scaleFactor = (canvas.width / containerRect.width) * arrow.scale
      ctx.scale(scaleFactor, scaleFactor)

      ctx.fillStyle = "#ff0000"
      ctx.strokeStyle = "#ffffff"
      ctx.lineWidth = 4

      ctx.beginPath()
      ctx.moveTo(-40, -10)
      ctx.lineTo(20, -10)
      ctx.lineTo(20, -25)
      ctx.lineTo(50, 0)
      ctx.lineTo(20, 25)
      ctx.lineTo(20, 10)
      ctx.lineTo(-40, 10)
      ctx.closePath()
      ctx.fill()
      ctx.stroke()
      ctx.restore()
    })

    // 5. Export directly to WebP and Upload
    try {
      canvas.toBlob(
        async blob => {
          if (!blob) {
            uploading = false
            return
          }
          const file = new File([blob], `annotated_${Date.now()}.webp`, {
            type: "image/webp",
          })
          // Skip re-compression since we already did it and scaled correctly
          // We pass a flag so handleFiles knows it's okay that 'uploading' is already true
          await handleFiles([file], true)
          cancelEditing() // Clean up refs
        },
        "image/webp",
        webpQuality / 100
      )
    } catch (err) {
      console.error("WebP Editor Error:", err)
      uploading = false
    }
  }

  const portal = node => {
    document.body.appendChild(node)
    return {
      destroy() {
        if (node.parentNode) node.parentNode.removeChild(node)
      },
    }
  }

  const cancelEditing = () => {
    isEditing = false
    capturedBlob = null
    if (capturedImageUrl) URL.revokeObjectURL(capturedImageUrl)
    capturedImageUrl = null
    arrows = []
    selectedArrowId = null
    bgX = 0
    bgY = 0
    bgScale = 1
    imageRatio = 1
  }

  const startPan = e => {
    selectedArrowId = null
    interactMode = "pan"
    isInteracting = true
    initialMousePos = { x: e.clientX, y: e.clientY }
    initialBgState = { x: bgX, y: bgY }
  }

  /**
   * Compresses an image to WebP using native Browser Canvas APIs.
   */
  const compressToWebP = file => {
    return new Promise(resolve => {
      // Skip if not an image
      if (!file.type.startsWith("image/")) {
        return resolve(file)
      }

      // Check min size condition (kB to Bytes)
      if (
        minSizeToCompress > 0 &&
        file.size < minSizeToCompress * BYTES_IN_KB
      ) {
        return resolve(file)
      }

      const reader = new FileReader()
      reader.readAsDataURL(file)
      reader.onload = event => {
        const img = new Image()
        img.src = event.target.result
        img.onload = () => {
          const canvas = document.createElement("canvas")
          let width = img.width
          let height = img.height

          // Resizing logic
          if (width > maxWidth || height > maxHeight) {
            const ratio = Math.min(maxWidth / width, maxHeight / height)
            width *= ratio
            height *= ratio
          }

          canvas.width = width
          canvas.height = height
          const ctx = canvas.getContext("2d")
          ctx.drawImage(img, 0, 0, width, height)

          canvas.toBlob(
            blob => {
              if (blob) {
                const extensionMatch = (file.name || "").match(/\.[^/.]+$/)
                const originalExt = extensionMatch ? extensionMatch[0] : ""
                const newName =
                  (file.name || "image").replace(/\.[^/.]+$/, "") + ".webp"
                const webpFile = new File([blob], newName, {
                  type: "image/webp",
                })
                resolve(webpFile)
              } else {
                resolve(file)
              }
            },
            "image/webp",
            webpQuality / 100
          )
        }
        img.onerror = () => resolve(file)
      }
      reader.onerror = () => resolve(file)
    })
  }

  /**
   * Processes files and uploads them.
   */
  const handleFiles = async (newFiles, skipCompression = false) => {
    // If we are skipping compression, it means we are coming from the editor
    // which has already set 'uploading' to true to show the spinner during processing.
    if (disabled || !API) return
    if (uploading && !skipCompression) return

    uploading = true
    const data = new FormData()
    let filesArray = Array.from(newFiles)

    // Enforce maximum limit
    if (maximum) {
      const remainingSlots = Math.max(0, maximum - files.length)

      // If no slots left, stop immediately
      if (remainingSlots === 0) {
        return
      }
      filesArray = filesArray.slice(0, remainingSlots)
    }

    // Parallel compression
    const processedFiles = skipCompression
      ? filesArray
      : await Promise.all(filesArray.map(file => compressToWebP(file)))

    processedFiles.forEach(file => data.append("file", file))

    try {
      // Find sourceId (priority: tableId, then id)
      let sourceId =
        formContext?.dataSource?.tableId ||
        formContext?.dataSource?.id ||
        formContext?.dataSource?.sourceId

      if (!sourceId) {
        console.error(
          "WebP Attachment Error: No Table/Source ID found. Please ensure the component is inside a Form."
        )
        return
      }

      console.log(
        `WebP Attachment: Uploading ${processedFiles.length} file(s) to ${sourceId}...`
      )
      const result = await API.uploadAttachment(sourceId, data)

      // Update Budibase state via Field API
      if (result && Array.isArray(result)) {
        console.log("WebP Attachment: Upload successful, saving to row.")
        const newFiles = [...files, ...result]
        files = newFiles // Force update local state immediately
        if (fieldApi && typeof fieldApi.setValue === "function") {
          fieldApi.setValue(newFiles)
        }
        if (onChange) {
          onChange({ value: newFiles })
        }
      }
    } catch (error) {
      console.error("WebP Compression Plugin Error:", error)
    } finally {
      uploading = false
      if (fileInput) fileInput.value = ""
    }
  }

  const onFileChange = e => {
    const selectedFiles = e.target.files
    if (selectedFiles && selectedFiles.length > 0) {
      // If exactly one image is uploaded and annotation is enabled, go to editor
      if (
        enableAnnotation &&
        selectedFiles.length === 1 &&
        selectedFiles[0].type.startsWith("image/")
      ) {
        startEditing(selectedFiles[0])
      } else {
        handleFiles(selectedFiles)
      }
    }
  }

  const startEditing = file => {
    const objUrl = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      imageRatio = img.width / img.height
      capturedBlob = file
      capturedImageUrl = objUrl
      isEditing = true
      arrows = []
      bgX = 0
      bgY = 0
      bgScale = 1
      initialBgState = { x: 0, y: 0 }
    }
    img.src = objUrl
  }

  const onDrop = e => {
    e.preventDefault()
    isDragging = false
    const droppedFiles = e.dataTransfer.files
    if (droppedFiles && droppedFiles.length > 0) {
      if (
        enableAnnotation &&
        droppedFiles.length === 1 &&
        droppedFiles[0].type.startsWith("image/")
      ) {
        startEditing(droppedFiles[0])
      } else {
        handleFiles(droppedFiles)
      }
    }
  }

  const removeFile = index => {
    if (disabled || !fieldApi) return
    const newFiles = files.filter((_, i) => i !== index)
    files = newFiles // Force immediate local update
    if (fieldApi && typeof fieldApi.setValue === "function") {
      fieldApi.setValue(newFiles)
    }
    if (onChange) {
      onChange({ value: newFiles })
    }
  }
</script>

<div class="webp-attachment" class:compact use:styleable={$component?.styles}>
  {#if !formContext && !disabled}
    <div class="placeholder-warn">
      <strong>WebP Attachment:</strong> Please place this component inside a Form
      or Data Provider for uploads to work.
    </div>
  {/if}

  {#if label}
    <label class="attachment-label" for="file-upload">{label}</label>
  {/if}

  {#if helpText}
    <p class="help-text">{helpText}</p>
  {/if}

  <!-- File List Preview -->
  <div class="file-list">
    {#each files as file, i}
      <div class="file-item">
        <div class="file-info">
          {#if file.url || file.extension === "webp" || file.type === "image/webp"}
            <div class="thumbnail-wrapper">
              <img
                class="thumbnail"
                src={file.url}
                alt={file.name}
                on:error={e => (e.target.style.display = "none")}
              />
            </div>
          {:else}
            <svg
              class="file-icon"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
            >
              <path
                d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"
              ></path>
              <polyline points="13 2 13 9 20 9"></polyline>
            </svg>
          {/if}
          <div class="file-details">
            <span class="file-name" title={file.name}>{file.name}</span>
            {#if file.size}
              <span class="file-size">{(file.size / 1024).toFixed(1)} KB</span>
            {/if}
          </div>
        </div>
        <button
          class="remove-btn"
          type="button"
          on:click={() => removeFile(i)}
          {disabled}
          aria-label="Remove file"
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
          >
            <line x1="18" y1="6" x2="6" y2="18"></line>
            <line x1="6" y1="6" x2="18" y2="18"></line>
          </svg>
        </button>
      </div>
    {/each}
  </div>

  <!-- Upload Zone -->
  {#if !maximum || files.length < maximum}
    <div
      class="dropzone"
      class:dragging={isDragging}
      class:disabled={disabled || uploading}
      on:dragover|preventDefault={() => (isDragging = true)}
      on:dragleave|preventDefault={() => (isDragging = false)}
      on:drop={onDrop}
      on:click={() => {
        if (!disabled && !uploading) {
          fileInput.click()
        }
      }}
      on:keydown={e => {
        if (e.key === "Enter" || e.key === " ") {
          if (!disabled && !uploading) {
            fileInput.click()
          }
        }
      }}
      role="button"
      tabindex="0"
    >
      <input
        type="file"
        multiple={maximum !== 1}
        accept={extensions}
        bind:this={fileInput}
        on:change={onFileChange}
        hidden
      />
      {#if uploading}
        <div class="status-box">
          <div class="spinner"></div>
          <span>Converting & Uploading...</span>
        </div>
      {:else}
        <div class="instructions">
          {#if !compact}
            <svg
              class="upload-icon"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
            >
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
              <polyline points="17 8 12 3 7 8"></polyline>
              <line x1="12" y1="3" x2="12" y2="15"></line>
            </svg>
          {/if}
          <div class="text-main">
            <strong>Click to upload</strong>
            {#if !compact}or drag and drop{/if}
          </div>
          {#if !compact && extensions !== "*"}
            <div class="text-sub">Format: {extensions}</div>
          {/if}
        </div>
      {/if}
    </div>
  {/if}

  <!-- Photo Editor Overlay -->
  {#if isEditing}
    <div
      class="editor-overlay"
      use:portal
      on:pointermove={handlePointerMove}
      on:pointerup={handlePointerUp}
    >
      <div class="editor-header">
        <button type="button" class="text-btn" on:click={cancelEditing}
          >Discard</button
        >
        <div class="editor-actions">
          <button
            type="button"
            class="icon-btn"
            on:click={addArrow}
            title="Add Arrow"
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"><path d="M5 12h14M12 5l7 7-7 7" /></svg
            >
          </button>
          <button
            type="button"
            class="icon-btn danger"
            class:disabled={!selectedArrowId}
            on:click={deleteArrow}
            title="Delete Selected"
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              ><path
                d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"
              /></svg
            >
          </button>
        </div>
        <button type="button" class="text-btn success" on:click={finishEditing}
          >Upload</button
        >
      </div>

      <div class="editor-view">
        <div
          class="editor-canvas-container"
          on:pointerdown={startPan}
          style="aspect-ratio: {imageRatio};"
        >
          <img
            src={capturedImageUrl}
            alt="Preview"
            class="editor-bg"
            style="transform: translate({bgX}px, {bgY}px) scale({bgScale});"
          />
          {#each arrows as arrow (arrow.id)}
            <div
              class="arrow-element"
              class:selected={selectedArrowId === arrow.id}
              style="left: {arrow.x}%; top: {arrow.y}%; transform: translate(-50%, -50%) rotate({arrow.angle}deg) scale({arrow.scale});"
              on:pointerdown={e => handlePointerDown(e, arrow, "drag")}
            >
              <svg
                viewBox="-50 -30 100 60"
                width="100"
                height="60"
                class="svg-arrow"
              >
                <path
                  d="M-40 -10 L20 -10 L20 -25 L50 0 L20 25 L20 10 L-40 10 Z"
                  fill="#ff0000"
                  stroke="white"
                  stroke-width="3"
                />
              </svg>
              {#if selectedArrowId === arrow.id}
                <div
                  class="handle rotate-handle"
                  style="transform: translateX(-50%) scale({1 / arrow.scale});"
                  on:pointerdown={e => handlePointerDown(e, arrow, "rotate")}
                  title="Rotate"
                >
                  <svg viewBox="0 0 24 24" fill="currentColor"
                    ><path
                      d="M17.65 6.35A7.958 7.958 0 0012 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08A5.99 5.99 0 0112 18c-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"
                    /></svg
                  >
                </div>
                <div
                  class="handle scale-handle"
                  style="transform: translateX(-50%) scale({1 / arrow.scale});"
                  on:pointerdown={e => handlePointerDown(e, arrow, "scale")}
                  title="Scale"
                >
                  <svg viewBox="0 0 24 24" fill="currentColor"
                    ><path
                      d="M10 21v-2H6.41l4.59-4.59L9.59 13 5 17.59V14H3v7h7zm11-11V3h-7v2h3.59l-4.59 4.59 1.41 1.41L19 6.41V10h2z"
                    /></svg
                  >
                </div>
              {/if}
            </div>
          {/each}
        </div>
      </div>
      <div class="editor-footer">
        <label>
          Zoom Image:
          <input
            type="range"
            min="1.0"
            max="5"
            step="0.05"
            bind:value={bgScale}
            on:input={() => {
              // Auto-clamp when zooming out to avoid margins popping in
              const container = document.querySelector(
                ".editor-canvas-container"
              )
              if (container) {
                const rect = container.getBoundingClientRect()
                const maxX = (rect.width * (bgScale - 1)) / 2
                const maxY = (rect.height * (bgScale - 1)) / 2
                bgX = Math.max(-maxX, Math.min(maxX, bgX))
                bgY = Math.max(-maxY, Math.min(maxY, bgY))
              }
            }}
          />
        </label>
        <span>{bgScale.toFixed(2)}x</span>
      </div>
    </div>
  {/if}
</div>

<style>
  .webp-attachment {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto,
      Helvetica, Arial, sans-serif;
    display: flex;
    flex-direction: column;
    /* gap: 10px; */
    width: 100%;
    color: #2c3e50;
  }

  .attachment-label {
    font-size: 13px;
    font-weight: 600;
    color: #4b4b4b;
    margin-bottom: 4px;
  }

  .help-text {
    font-size: 11px;
    color: #747474;
    margin: 0;
    margin-bottom: 4px;
  }

  .placeholder-warn {
    font-size: 12px;
    background: #fff8e1;
    color: #8a6d3b;
    padding: 8px 12px;
    border-radius: 6px;
    border: 1px solid #ffe082;
  }

  .file-list {
    display: flex;
    flex-direction: column;
    /* gap: 6px; */
  }

  .file-item {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 10px 14px;
    background: #ffffff;
    border: 1px solid #e1e1e1;
    border-radius: 8px;
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05);
    transition: all 0.2s ease;
    margin-bottom: 4px;
  }

  .file-item:hover {
    border-color: #0081ff;
  }

  .file-info {
    display: flex;
    align-items: center;
    gap: 12px;
    max-width: 85%;
  }

  .thumbnail-wrapper {
    width: 32px;
    height: 32px;
    border-radius: 4px;
    overflow: hidden;
    background: #f0f0f0;
    flex-shrink: 0;
    border: 1px solid #e5e7eb;
  }

  .thumbnail {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .file-details {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }

  .file-size {
    font-size: 10px;
    color: #94a3b8;
    margin-top: -1px;
  }

  .file-icon {
    width: 18px;
    height: 18px;
    color: #0081ff;
  }

  .file-name {
    font-size: 13px;
    font-weight: 500;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: #334155;
  }

  .remove-btn {
    background: #fdf2f2;
    border: 1px solid #fee2e2;
    color: #dc2626;
    cursor: pointer;
    border-radius: 6px;
    padding: 4px;
    width: 24px;
    height: 24px;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all 0.2s;
  }

  .remove-btn svg {
    width: 14px;
    height: 14px;
  }

  .remove-btn:hover {
    background: #fee2e2;
    color: #b91c1c;
  }

  /* Dropzone */
  .dropzone {
    border: 2px dashed #d1d1d1;
    border-radius: 10px;
    padding: 30px 20px;
    text-align: center;
    cursor: pointer;
    /*background: #fbfbfb;*/
    transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 12px;
  }

  .dropzone:hover:not(.disabled) {
    border-color: #0081ff;
    background: #f5faff;
  }

  .dropzone.dragging {
    border-style: solid;
    border-color: #0081ff;
    background: #f0f7ff;
    transform: scale(0.99);
  }

  .dropzone.disabled {
    cursor: not-allowed;
    opacity: 0.6;
    background: #f5f5f5;
  }

  .upload-icon {
    width: 28px;
    height: 28px;
    color: #0081ff;
    margin-bottom: 4px;
    transition: transform 0.25s ease;
  }

  .dropzone:hover .upload-icon {
    transform: translateY(-2px);
  }

  .text-main {
    font-size: 14px;
    color: #334155;
  }

  .text-main strong {
    color: #0081ff;
    font-weight: 700;
  }

  .text-sub {
    font-size: 11px;
    color: #94a3b8;
  }

  .status-box {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 12px;
    font-size: 14px;
    font-weight: 500;
    color: #0081ff;
  }

  .spinner {
    width: 24px;
    height: 24px;
    border: 3px solid #e0efff;
    border-top-color: #0081ff;
    animation: spin 0.8s linear infinite;
    border-radius: 50%;
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }

  .compact .dropzone {
    padding: 15px;
    flex-direction: row;
    justify-content: center;
  }

  .compact .upload-icon {
    margin-bottom: 0;
    width: 20px;
    height: 20px;
  }

  /* Editor CSS */
  .editor-overlay {
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background: #000;
    z-index: 10000;
    display: flex;
    flex-direction: column;
    touch-action: none;
    overflow: hidden;
    box-sizing: border-box;
  }

  .editor-overlay * {
    box-sizing: border-box;
  }

  .editor-header {
    flex-shrink: 0;
    height: 60px;
    background: #1a1a1a;
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 0 16px;
    color: #fff;
  }

  .editor-actions {
    display: flex;
    gap: 8px;
  }

  .text-btn {
    background: none;
    border: none;
    color: #94a3b8;
    font-weight: 600;
    cursor: pointer;
    padding: 8px 12px;
  }

  .text-btn.success {
    color: #10b981;
    background: rgba(16, 185, 129, 0.1);
    border-radius: 6px;
  }

  .icon-btn {
    background: rgba(255, 255, 255, 0.1);
    border: none;
    color: #fff;
    width: 40px;
    height: 40px;
    border-radius: 8px;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
  }

  .icon-btn.disabled {
    opacity: 0.3;
    pointer-events: none;
  }

  .icon-btn.danger {
    color: #ef4444;
  }

  .icon-btn svg {
    width: 20px;
    height: 20px;
  }

  .editor-footer {
    padding: 16px;
    background: #1a1a1a;
    color: #fff;
    display: flex;
    align-items: center;
    gap: 16px;
    justify-content: center;
    border-top: 1px solid #333;
  }

  .editor-footer input {
    width: 200px;
  }

  .editor-view {
    flex: 1;
    min-height: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: hidden;
    position: relative;
    background: #000;
  }

  .editor-canvas-container {
    position: relative;
    max-width: 100%;
    max-height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: grab;
    overflow: hidden; /* Keep image inside */
    background: #000;
  }

  .editor-canvas-container:active {
    cursor: grabbing;
  }

  .editor-bg {
    max-width: 100%;
    max-height: 100%;
    object-fit: contain;
    user-select: none;
    pointer-events: none;
    transition: transform 0.1s ease-out;
  }

  .arrow-element {
    position: absolute;
    cursor: move;
    user-select: none;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .arrow-element.selected {
    outline: 2px dashed #3b82f6;
    outline-offset: 4px;
  }

  .svg-arrow {
    filter: drop-shadow(0 2px 4px rgba(0, 0, 0, 0.5));
  }

  .handle {
    position: absolute;
    width: 32px;
    height: 32px;
    background: #3b82f6;
    color: #fff;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
  }

  .handle svg {
    width: 16px;
    height: 16px;
  }

  .rotate-handle {
    top: -45px;
    left: 50%;
    transform: translateX(-50%);
  }

  .scale-handle {
    bottom: -45px;
    left: 50%;
    transform: translateX(-50%);
  }
</style>
