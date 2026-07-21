/**
 * 领域错误定义：统一封装分析器配置、调用和响应解析失败，便于 Service 转成前端错误。
 */
export class UnderstandingError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
  }
}

export class AnalyzerConfigurationError extends UnderstandingError {
  constructor(message: string) {
    super('ANALYZER_CONFIGURATION_ERROR', message);
  }
}

export class AnalyzerResponseError extends UnderstandingError {
  constructor(message: string, cause?: unknown) {
    super('ANALYZER_RESPONSE_ERROR', message, cause);
  }
}

export class AnalyzerCallError extends UnderstandingError {
  constructor(message: string, cause?: unknown) {
    super('ANALYZER_CALL_ERROR', message, cause);
  }
}
