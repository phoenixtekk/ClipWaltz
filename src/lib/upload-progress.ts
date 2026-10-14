/** Upload a file as the raw request body with progress (XHR: fetch has no upload progress). Browser only. */
export function uploadWithProgress(url: string, body: Blob, onProgress: (f: number) => void): Promise<{ seconds: number }> {
  return new Promise((resolve, reject) => {
    const x = new XMLHttpRequest();
    x.open("POST", url);
    x.setRequestHeader("content-type", body.type || "application/octet-stream");
    x.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
    x.onload = () => (x.status >= 200 && x.status < 300 ? resolve(JSON.parse(x.responseText)) : reject(new Error(x.responseText || `Upload failed (${x.status})`)));
    x.onerror = () => reject(new Error("Upload failed — check your connection"));
    x.send(body);
  });
}
