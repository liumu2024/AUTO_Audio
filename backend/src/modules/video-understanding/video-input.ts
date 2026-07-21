/**
 * 视频输入领域模型：区分前端刚上传的内存文件，以及落盘后供分析器使用的视频引用。
 */
export interface UploadedVideoFile {
  buffer: Buffer;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
}

export interface VideoInput {
  storageKind: 'local';
  localPath: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: Date;
}
