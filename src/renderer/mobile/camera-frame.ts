/** Wait briefly for permission/device switching to deliver a frame, but never capture a stopped stream. */
export async function waitForCameraFrame(video: HTMLVideoElement, timeoutMs = 2500): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const stream = video.srcObject as MediaStream | null
    if (!video.isConnected || (stream && !stream.getVideoTracks().some((track) => track.readyState === 'live')))
      throw new Error('camera_disabled')
    if (stream && video.readyState >= 2 && video.videoWidth > 0 && video.videoHeight > 0) return
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  throw new Error('camera_frame_not_ready: 请等待摄像头预览出现后重试')
}
