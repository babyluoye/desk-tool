interface OcrEngine {
  recognize(image: HTMLImageElement, options: object, output: { blocks: boolean }): Promise<{ data: any }>;
  terminate(): Promise<void>;
}
declare const Tesseract: {
  createWorker(language: string, mode: number, options: {
    workerPath: string; corePath: string; langPath: string; cacheMethod: string;
    workerBlobURL: boolean; errorHandler: (error: unknown) => void;
  }): Promise<OcrEngine>;
};
export default Tesseract;
