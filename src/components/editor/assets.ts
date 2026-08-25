// 封面与素材的纯逻辑：浏览器端图片压缩、设计卡「素材清单」段落的生成。
// 这里不碰 React、不发请求——上传流程（拿 editKey、调接口、报状态）在 page.tsx。
// 改压缩尺寸/画质、改素材清单在设计卡里长什么样 → 只看这里。

/** 读一张本地图片；失败信息与旧版一致，供上传流程直接展示给作者 */
async function loadImage(file: File): Promise<{ img: HTMLImageElement; url: string }> {
  const img = new Image();
  const url = URL.createObjectURL(file);
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error("图片读取失败"));
    img.src = url;
  });
  return { img, url };
}

function encodeJpeg(canvas: HTMLCanvasElement): Promise<Blob | null> {
  return new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.85));
}

/** 封面：居中裁剪压缩到 640×360 JPEG——上传永远不超限，服务端零图片依赖 */
export async function compressCover(file: File): Promise<Blob> {
  const { img, url } = await loadImage(file);
  const canvas = document.createElement("canvas");
  canvas.width = 640;
  canvas.height = 360;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("浏览器不支持 canvas");
  const scale = Math.max(640 / img.width, 360 / img.height);
  ctx.drawImage(img, (640 - img.width * scale) / 2, (360 - img.height * scale) / 2, img.width * scale, img.height * scale);
  URL.revokeObjectURL(url);
  const blob = await encodeJpeg(canvas);
  if (!blob) throw new Error("图片编码失败");
  return blob;
}

/** 游戏内素材：等比缩到长边 900 以内的 JPEG，保留原始比例 */
export async function compressAsset(file: File): Promise<Blob> {
  const { img, url } = await loadImage(file);
  const scale = Math.min(1, 900 / Math.max(img.width, img.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(img.width * scale);
  canvas.height = Math.round(img.height * scale);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("浏览器不支持 canvas");
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  URL.revokeObjectURL(url);
  const blob = await encodeJpeg(canvas);
  if (!blob) throw new Error("图片编码失败");
  return blob;
}

const ASSET_MARKER = "## 素材清单（自动维护）";

/**
 * 把素材清单写回设计卡正文：有旧段落就替换，没有就追加到末尾。
 * 作者可查，AI 工作室也因此知道有哪些图可用。纯字符串运算，方便单测。
 */
export function withAssetSection(designCard: string, names: string[]): string {
  const body =
    names.length === 0
      ? "（还没有上传素材）"
      : names.map((n) => `- ${n} —— 卡片 image 字段填 "${n}" 即可展示`).join("\n");
  const section = `${ASSET_MARKER}\n${body}\n`;
  const idx = designCard.indexOf(ASSET_MARKER);
  if (idx >= 0) {
    const after = designCard.indexOf("\n## ", idx + ASSET_MARKER.length);
    return after >= 0
      ? designCard.slice(0, idx) + section + designCard.slice(after + 1)
      : designCard.slice(0, idx) + section;
  }
  return designCard.trimEnd() + "\n\n" + section;
}
