# Local cookbook photo recognition

Tesseract.js and matching core version 7.0.0. English LSTM integer model bundled locally. No external requests are needed after these assets are served by the app.

Load `/vendor/ocr/tesseract.min.js` then initialize:

```js
const worker = await Tesseract.createWorker('eng', 1, {
  workerPath: new URL('/vendor/ocr/worker.min.js', location.origin).href,
  corePath: new URL('/vendor/ocr', location.origin).href,
  langPath: new URL('/vendor/ocr', location.origin).href,
  workerBlobURL: false,
  gzip: true,
  logger: progress => { /* update photo importing progress */ }
});
const { data: { text } } = await worker.recognize(imageFile);
await worker.terminate();
```

The numeric engine mode 1 is required for the bundled LSTM-only cores. Directory corePath lets version 7 select normal, SIMD, or relaxed SIMD based on device capabilities. Each `.wasm.js` file embeds its WebAssembly payload, so separate `.wasm` files are unnecessary. Do not serve eng.traineddata.gz with automatic Content-Encoding gzip: the worker decompresses it itself. Serve all assets from the application origin and cache them for offline imports.

Source: https://github.com/naptha/tesseract.js/blob/master/docs/local-installation.md
Language model: https://cdn.jsdelivr.net/npm/@tesseract.js-data/eng@1.0.0/4.0.0_best_int/eng.traineddata.gz
Apache 2.0 license files accompany the JS engine, compiled core, and language data. Bundle dependency notices are also included.
