import { ApiError } from './apiClient';

/**
 * Ánh xạ các mã lỗi kỹ thuật chuẩn RFC 7807 từ Backend
 * thành thông báo dễ hiểu, định hướng hành động cho người dùng.
 */
export function mapErrorToUserMessage(error: unknown): string {
  if (error instanceof ApiError) {
    switch (error.code) {
      case 'CUDA_OUT_OF_MEMORY':
        return 'Card đồ họa (VRAM) không đủ bộ nhớ để chạy mô hình AI này. Vui lòng chuyển sang mô hình kích thước nhỏ hơn hoặc chạy bằng CPU trong Model Hub.';

      case 'TASK_ALREADY_RUNNING':
        return 'Tiến trình AI trước đang hoạt động hoặc đang được giải phóng. Hệ thống đã tự động dọn dẹp slot, bạn hãy thử bấm lại sau vài giây.';

      case 'MODEL_NOT_FOUND':
        return 'Chưa tìm thấy tệp mô hình AI trên máy. Nút bấm đã tự động chuyển sang chế độ Tải về, vui lòng bấm tải trước khi chạy.';

      case 'DOWNLOAD_IN_PROGRESS':
        return 'Đang có một mô hình khác trong quá trình tải xuống. Vui lòng đợi tải xong trước khi bắt đầu tải mô hình mới.';

      case 'INVALID_CUE_TIMING':
        return 'Thời gian bắt đầu hoặc kết thúc của câu thoại không hợp lệ (thời gian kết thúc phải lớn hơn thời gian bắt đầu).';

      case 'MEDIA_NOT_FOUND':
        return 'Không tìm thấy tệp video hoặc audio nguồn trên đường dẫn máy chủ.';

      case 'FFMPEG_ERROR':
        return 'Xử lý video bằng FFmpeg gặp lỗi. Vui lòng kiểm tra lại định dạng tệp nguồn hoặc quyền ghi đĩa.';

      case 'REQUEST_TIMEOUT':
        return 'Yêu cầu xử lý AI bị quá thời gian chờ (Timeout). Hãy thử lại với phân đoạn video ngắn hơn.';

      case 'NETWORK_ERROR':
        return 'Không thể kết nối đến máy chủ Backend (FastAPI). Hãy đảm bảo Backend đang chạy tại cổng 8765.';

      default:
        return error.message || `Đã xảy ra lỗi: ${error.code}`;
    }
  }

  if (error instanceof Error) {
    return error.message;
  }

  return 'Đã xảy ra lỗi không xác định trong quá trình xử lý.';
}
