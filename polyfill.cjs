// Minimal File polyfill for Node.js environments lacking global File
if (typeof globalThis.File === 'undefined') {
    const BlobClass = globalThis.Blob;
    class File extends BlobClass {
        constructor(parts, name, options = {}) {
            super(parts, options);
            this.name = name || '';
            this.lastModified = options && options.lastModified ? options.lastModified : Date.now();
        }
        get [Symbol.toStringTag]() {
            return 'File';
        }
    }
    globalThis.File = File;
}
